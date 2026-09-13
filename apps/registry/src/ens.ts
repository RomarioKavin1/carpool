import {
  ENS_KEY_RECORD,
  ENS_PROFILE_KEYS,
  HBAR_COIN_TYPE,
  checkEnsBinding,
  parseEnsAuthor,
  resolveEnsPayout,
  type EnsBinding,
  type EnsRecordReader,
} from "@carpool/core";
import { createPublicClient, http, type Chain } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { normalize } from "viem/ens";
import { parseHederaAuthor } from "./identity.js";

/**
 * The registry's read-only ENS client.
 *
 * Resolution goes through viem's ENS actions, which call the ENS Universal
 * Resolver at the canonical proxy address viem ships for both mainnet and
 * Sepolia (`0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`). On Sepolia that proxy
 * resolves through the ENSv2 beta registry hierarchy; on mainnet, until ENSv2
 * ships there, it resolves ENSv1. The code is the same either way, which is
 * what ENS asks of read-only apps (docs.ens.domains/web/ensv2-readiness). See
 * docs/ENS.md for which of the two was actually exercised and how.
 *
 * Nothing in this module writes to any chain, and there is no Ethereum key
 * anywhere in the registry.
 */

export type EnsChainName = "sepolia" | "mainnet" | "off";

export interface EnsConfig {
  chain: EnsChainName;
  rpcUrl?: string;
  /** Upper bound on one binding check. Applies to the purchase path too. */
  timeoutMs: number;
}

export function loadEnsConfig(env: NodeJS.ProcessEnv = process.env): EnsConfig {
  const raw = (env.CARPOOL_ENS_CHAIN ?? "sepolia").trim().toLowerCase();
  if (raw !== "sepolia" && raw !== "mainnet" && raw !== "off") {
    throw new Error(`CARPOOL_ENS_CHAIN must be sepolia, mainnet or off, got ${raw}`);
  }
  const t = Number(env.CARPOOL_ENS_TIMEOUT_MS ?? 3000);
  if (!Number.isFinite(t) || t < 100) throw new Error(`CARPOOL_ENS_TIMEOUT_MS must be at least 100, got ${env.CARPOOL_ENS_TIMEOUT_MS}`);
  return { chain: raw, rpcUrl: env.CARPOOL_ENS_RPC_URL || undefined, timeoutMs: Math.trunc(t) };
}

/** Reader used when ENS is switched off: every read rejects, so every check is `unreachable` and every sale pays the fallback. */
const offReader: EnsRecordReader = {
  text: async () => {
    throw new Error("ENS resolution is disabled on this registry (CARPOOL_ENS_CHAIN=off)");
  },
  hederaAddr: async () => {
    throw new Error("ENS resolution is disabled on this registry (CARPOOL_ENS_CHAIN=off)");
  },
};

/** A viem-backed `EnsRecordReader`. `strict: true` so a resolver revert is an error, not a silent null. */
export function viemEnsReader(cfg: { chain: Exclude<EnsChainName, "off">; rpcUrl?: string }): EnsRecordReader {
  const chain: Chain = cfg.chain === "mainnet" ? mainnet : sepolia;
  const client = createPublicClient({ chain, transport: http(cfg.rpcUrl, { timeout: 10_000, retryCount: 1 }) });
  return {
    async text(name, key) {
      const v = await client.getEnsText({ name: normalize(name), key });
      return v === "" ? null : v;
    },
    async hederaAddr(name) {
      return client.getEnsAddress({ name: normalize(name), coinType: BigInt(HBAR_COIN_TYPE) });
    },
  };
}

let override: EnsRecordReader | null = null;
let cachedReader: EnsRecordReader | null = null;

/** Test seam, like `setEmbedder`: replace the reader for this process. `null` restores the configured one. */
export function setEnsReader(r: EnsRecordReader | null): void {
  override = r;
  cachedReader = null;
}

export function getEnsReader(cfg: EnsConfig = loadEnsConfig()): EnsRecordReader {
  if (override) return override;
  if (!cachedReader) cachedReader = cfg.chain === "off" ? offReader : viemEnsReader({ chain: cfg.chain, rpcUrl: cfg.rpcUrl });
  return cachedReader;
}

/**
 * ENSIP-15 normalisation of an ENS author's name, enforced at publish.
 *
 * The name is inside the signed, content-addressed manifest, so it cannot be
 * corrected afterwards; a non-normalised spelling would resolve differently
 * from the name its owner set records on (or not at all). Rejected, the same
 * way `questionNorm` is.
 */
export function assertNormalisedEnsName(name: string): void {
  let n: string;
  try {
    n = normalize(name);
  } catch (e) {
    throw new Error(`ENS name ${JSON.stringify(name)} is not valid under ENSIP-15: ${(e as Error).message.split("\n")[0]}`);
  }
  if (n !== name) {
    throw new Error(`ENS name ${JSON.stringify(name)} is not normalised; ENSIP-15 normalises it to ${JSON.stringify(n)}`);
  }
}

export interface PayoutChoice {
  account: string;
  /** Written to `purchase.payout_via`: `null` for a Hedera author, `ens:<name>` or `ens-fallback:<name>` for an ENS one. */
  via: string | null;
  reason: string;
}

/**
 * The payee for one sale, decided at purchase time. Never rejects for an ENS
 * author (see `resolveEnsPayout`), and is exactly `parseHederaAuthor(..).payout()`
 * for a Hedera one.
 */
export async function choosePayout(opaqueAuthor: string, reader: EnsRecordReader = getEnsReader()): Promise<PayoutChoice> {
  const ens = parseEnsAuthor(opaqueAuthor);
  if (!ens) return { account: parseHederaAuthor(opaqueAuthor).payout(), via: null, reason: "hedera author" };
  const d = await resolveEnsPayout(ens, reader, { timeoutMs: loadEnsConfig().timeoutMs });
  return { account: d.account, via: `${d.source === "ens" ? "ens" : "ens-fallback"}:${ens.name}`, reason: d.reason };
}

export type EnsProfile = Partial<Record<(typeof ENS_PROFILE_KEYS)[number], string>>;

/** ENSIP-5 profile text records. Missing and unreadable records are both omitted; this is display data. */
export async function readEnsProfile(name: string, reader: EnsRecordReader, timeoutMs: number): Promise<EnsProfile> {
  const out: EnsProfile = {};
  await Promise.all(
    ENS_PROFILE_KEYS.map(async (k) => {
      try {
        const v = await Promise.race([
          reader.text(name, k),
          new Promise<null>((res) => setTimeout(() => res(null), timeoutMs).unref?.()),
        ]);
        if (v && v.trim() !== "") out[k] = v.trim().slice(0, 500);
      } catch {
        // display data: an unreadable record is simply not shown
      }
    }),
  );
  return out;
}

export type IdentityView =
  | { kind: "hedera"; author: string; payoutAccount: string; publicKey: string }
  | {
      kind: "ens";
      author: string;
      name: string;
      fallbackAccount: string;
      publicKey: string;
      binding: EnsBinding;
      /** Where the next sale would pay, if it happened now. */
      payoutNow: { account: string; source: "ens" | "fallback" };
      profile: EnsProfile;
      network: EnsChainName;
      checkedAt: number;
    };

/**
 * A short-lived memo for the display routes only. The purchase path never
 * reads it: a sale resolves fresh, so a rotation is honoured by the next sale
 * rather than the next cache expiry.
 */
const memo = new Map<string, { at: number; value: IdentityView }>();
const MEMO_MS = 30_000;

export function clearIdentityMemo(): void {
  memo.clear();
}

/** Throws on an author string neither convention accepts. */
export async function identityView(opaqueAuthor: string, now: () => number = Date.now): Promise<IdentityView> {
  const ens = parseEnsAuthor(opaqueAuthor);
  if (!ens) {
    const h = parseHederaAuthor(opaqueAuthor);
    return { kind: "hedera", author: opaqueAuthor, payoutAccount: h.payout(), publicKey: h.id() };
  }
  const hit = memo.get(opaqueAuthor);
  if (hit && now() - hit.at < MEMO_MS) return hit.value;

  const cfg = loadEnsConfig();
  const reader = getEnsReader(cfg);
  const [binding, profile] = await Promise.all([
    checkEnsBinding(ens, reader, { timeoutMs: cfg.timeoutMs }),
    readEnsProfile(ens.name, reader, cfg.timeoutMs),
  ]);
  const verified = binding.status === "verified" && binding.hederaAccount != null;
  const value: IdentityView = {
    kind: "ens",
    author: opaqueAuthor,
    name: ens.name,
    fallbackAccount: ens.fallbackAccount,
    publicKey: ens.id(),
    binding,
    payoutNow: verified ? { account: binding.hederaAccount!, source: "ens" } : { account: ens.fallbackAccount, source: "fallback" },
    profile,
    network: cfg.chain,
    checkedAt: Math.floor(now() / 1000),
  };
  // Only a definite answer is memoised; an unreachable one is retried next time.
  if (binding.status !== "unreachable") memo.set(opaqueAuthor, { at: now(), value });
  return value;
}

/** The key a name's `io.carpool.key` record names, normalised, or null. Used to list a name's artifacts. */
export async function keyRecordOf(name: string): Promise<string | null> {
  const cfg = loadEnsConfig();
  const v = await getEnsReader(cfg).text(name, ENS_KEY_RECORD);
  return v ? v.trim().toLowerCase().replace(/^0x/, "") : null;
}
