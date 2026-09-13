/**
 * Reading one account id off a wallet the viewer connects. Read-only by
 * construction: nothing here requests a signature or a transaction, and the
 * dashboard still holds no key.
 *
 * ## The two paths, and which one is standard
 *
 * 1. **Hedera-native wallets over WalletConnect** (HashPack, Kabila, Blade).
 *    This is the standard path: HIP-820's `hedera` namespace, where a session's
 *    accounts are CAIP-10 strings like `hedera:testnet:0.0.1234`. It needs a
 *    WalletConnect (Reown) project id in `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`.
 *    Without one the option is not offered, and the UI says why.
 *
 *    It speaks the same protocol as `@hashgraph/hedera-wallet-connect`'s
 *    `DAppConnector`, using the two WalletConnect packages that library itself
 *    uses (`sign-client`, `modal`). The library is not imported: every one of its
 *    dependencies is a peer, and its entry point re-exports the Reown AppKit and
 *    ethers adapters, which a read of one account id does not need. The session
 *    asks for exactly one method, `hedera_getNodeAddresses`, which signs nothing,
 *    and is disconnected as soon as the account id is read.
 *
 * 2. **An injected EVM wallet** (MetaMask and similar). `eth_requestAccounts`
 *    returns a `0x` address with no signature; the mirror node then resolves it
 *    to a `0.0.x` account (lib/account.ts). Zero credentials, but it only
 *    resolves accounts that were created from that EVM address.
 *
 * The WalletConnect code is loaded with a literal dynamic `import()` only when
 * the viewer clicks, so neither route's first paint carries it.
 */
import type { EvmResolution } from "./account";
import { parseAccountInput, resolveEvmAddress } from "./account";

export const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || null;

/* ---------------------------------------------------------- the namespace */

/** `hedera:testnet` is both this registry's network name and the CAIP-2 chain id. */
export function caipChainFor(network: string | null | undefined): string | null {
  return network && /^hedera:(mainnet|testnet|previewnet)$/.test(network) ? network : null;
}

/**
 * The account ids a WalletConnect session granted on one chain.
 * `hedera:testnet:0.0.1234` → `0.0.1234`; anything else is ignored rather than
 * guessed at, including accounts on a different network than the registry's.
 */
export function hederaAccountsFromSession(
  namespaces: Record<string, { accounts?: string[] } | undefined>,
  chain: string,
): string[] {
  const out: string[] = [];
  for (const caip of namespaces.hedera?.accounts ?? []) {
    const at = caip.lastIndexOf(":");
    if (at === -1 || caip.slice(0, at) !== chain) continue;
    const parsed = parseAccountInput(caip.slice(at + 1));
    if (parsed.kind === "account" && !out.includes(parsed.id)) out.push(parsed.id);
  }
  return out;
}

/* ------------------------------------------------------ injected EVM path */

export interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export function injectedProvider(): Eip1193 | null {
  if (typeof window === "undefined") return null;
  const eth = (window as unknown as { ethereum?: Partial<Eip1193> }).ethereum;
  return eth && typeof eth.request === "function" ? (eth as Eip1193) : null;
}

export type WalletResult =
  | { kind: "account"; id: string; via: string }
  | { kind: "evm-unresolved"; address: string }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

/**
 * `eth_requestAccounts` (a connection approval, not a signature), then the
 * mirror node. No chain switch is requested: the mirror lookup is by address,
 * so the wallet's selected network does not matter and its config is untouched.
 */
export async function connectInjected(
  provider: Eip1193,
  mirrorBase: string,
  resolve: (address: string, base: string) => Promise<EvmResolution> = resolveEvmAddress,
): Promise<WalletResult> {
  let accounts: unknown;
  try {
    accounts = await provider.request({ method: "eth_requestAccounts" });
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (code === 4001) return { kind: "cancelled" };
    return { kind: "error", message: (e as Error).message || "the wallet refused the request" };
  }
  const first = Array.isArray(accounts) ? accounts[0] : undefined;
  if (typeof first !== "string" || !/^0x[0-9a-f]{40}$/i.test(first)) {
    return { kind: "error", message: "the wallet returned no address" };
  }
  const address = first.toLowerCase();
  const resolved = await resolve(address, mirrorBase);
  if (resolved.kind === "account") return { kind: "account", id: resolved.id, via: "browser wallet" };
  if (resolved.kind === "not-found") return { kind: "evm-unresolved", address };
  return { kind: "error", message: resolved.message };
}

/* --------------------------------------------- Hedera wallet extensions */

/**
 * Hedera wallet browser extensions (HashPack and others) announce themselves on
 * `window.postMessage` when asked. This is the discovery half of the protocol
 * `@hashgraph/hedera-wallet-connect` uses; the connect half hands the extension
 * a WalletConnect pairing string, so it still needs the project id.
 */
export interface HederaExtension {
  id: string;
  name: string;
}

export function discoverExtensions(onFound: (ext: HederaExtension) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const seen = new Set<string>();
  const listener = (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as { type?: unknown; metadata?: { id?: unknown; name?: unknown } };
    if (data?.type !== "hedera-extension-response") return;
    const id = data.metadata?.id;
    const name = data.metadata?.name;
    if (typeof id !== "string" || seen.has(id)) return;
    seen.add(id);
    onFound({ id, name: typeof name === "string" && name.trim() ? name : "Hedera wallet extension" });
  };
  window.addEventListener("message", listener);
  const t = window.setTimeout(() => window.postMessage({ type: "hedera-extension-query" }, "*"), 200);
  return () => {
    window.clearTimeout(t);
    window.removeEventListener("message", listener);
  };
}

/* ---------------------------------------------------- WalletConnect path */

export async function connectWalletConnect(args: {
  projectId: string;
  chain: string;
  extensionId?: string;
}): Promise<WalletResult> {
  const { readAccountOverWalletConnect } = await import("./walletconnect-session");
  return readAccountOverWalletConnect(args);
}
