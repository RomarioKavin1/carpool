import { PrivateKey } from "@hiero-ledger/sdk";
import { checkEnsBinding, ensAuthorString, parseEnsAuthor, type EnsBinding } from "@carpool/core";
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { sepolia } from "viem/chains";
import { normalize } from "viem/ens";
import { readEnsProfile, viemEnsReader, type EnsProfile } from "./ens.js";

/**
 * ENSv2 beta deployment on Sepolia, from docs.ens.domains/learn/deployments
 * ("Sepolia ENSv2 Beta"). Used ONLY by this probe, to show that a read went
 * through the v2 registry hierarchy; production resolution never hardcodes an
 * address and goes through viem's Universal Resolver, as ENS asks.
 */
export const SEPOLIA_ENSV2 = {
  rootRegistry: "0x8115186e8f2e0b0281e86ab91f0f48ba90364354" as Address,
  ethRegistry: "0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2" as Address,
};

const registryAbi = parseAbi([
  "function getSubregistry(string label) view returns (address)",
  "function getResolver(string label) view returns (address)",
]);

export interface EnsProbeReport {
  network: "sepolia";
  name: string;
  checkedAt: string;
  blockNumber: string;
  /** `RootRegistry.getSubregistry("eth")`, read directly from the v2 root. */
  ethRegistryFromRoot: string;
  ethRegistryMatchesDocs: boolean;
  /** `ETHRegistry.getResolver(label)`, read directly from the v2 .eth registry. */
  resolverFromV2Registry: string;
  /** The resolver viem's Universal Resolver call reports for the same name. */
  resolverFromUniversalResolver: string | null;
  sameResolver: boolean;
  /** ENSIP-5 records, read through the Universal Resolver by the registry's own reader. */
  profile: EnsProfile;
  /** The registry's real binding check against this name, for a throwaway author key. */
  binding: EnsBinding;
}

/**
 * One live, read-only pass over a Sepolia ENSv2 name with the registry's own
 * code: the same `viemEnsReader`, `readEnsProfile` and `checkEnsBinding` the
 * routes and the purchase path use, plus two direct reads of the v2 registries
 * to show which hierarchy answered.
 */
export async function probeSepoliaEnsV2(name: string, rpcUrl?: string): Promise<EnsProbeReport> {
  const n = normalize(name);
  const label = n.split(".")[0]!;
  if (!n.endsWith(".eth") || n.split(".").length !== 2) throw new Error(`probe expects a second-level .eth name, got ${name}`);
  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl, { timeout: 15_000, retryCount: 2 }) });

  const blockNumber = await client.getBlockNumber();
  const ethRegistryFromRoot = await client.readContract({
    address: SEPOLIA_ENSV2.rootRegistry,
    abi: registryAbi,
    functionName: "getSubregistry",
    args: ["eth"],
    blockNumber,
  });
  const resolverFromV2Registry = await client.readContract({
    address: ethRegistryFromRoot,
    abi: registryAbi,
    functionName: "getResolver",
    args: [label],
    blockNumber,
  });
  const resolverFromUniversalResolver = await client.getEnsResolver({ name: n, blockNumber }).catch(() => null);

  const reader = viemEnsReader({ chain: "sepolia", rpcUrl });
  const profile = await readEnsProfile(n, reader, 15_000);
  const throwaway = PrivateKey.generateECDSA().publicKey.toStringRaw();
  const author = parseEnsAuthor(ensAuthorString(n, "0.0.1", throwaway))!;
  const binding = await checkEnsBinding(author, reader, { timeoutMs: 15_000 });

  return {
    network: "sepolia",
    name: n,
    checkedAt: new Date().toISOString(),
    blockNumber: blockNumber.toString(),
    ethRegistryFromRoot,
    ethRegistryMatchesDocs: ethRegistryFromRoot.toLowerCase() === SEPOLIA_ENSV2.ethRegistry,
    resolverFromV2Registry,
    resolverFromUniversalResolver,
    sameResolver: resolverFromUniversalResolver?.toLowerCase() === resolverFromV2Registry.toLowerCase(),
    profile,
    binding,
  };
}
