// Registry config: env only. There is no per-product policy file in v2 — the
// three numbers v1 pulled from carpool.policy.json (P, floors, epoch) are now
// per-artifact (priceBase/priceFloor, set by the author at publish) or fixed
// protocol constants (below), so nothing here can drift from a JSON file the
// way v1's ports/policy pair did.

/** Seconds a buyer has to request a refund after a purchase settles. */
export const REFUND_WINDOW_SECONDS = 120;

export interface Config {
  port: number;
  facilitatorUrl: string;
  network: string;
  /** The USDC token id, used as the x402 `asset`. */
  asset: string;
  /** The registry's own settlement account — x402 `payTo` for every sale. Never the author's. */
  registryAccount: string;
  /** Flat µUSDC fee the tracker keeps per sale, taken immediately (never refunded). */
  trackerFee: number;
  /** Where content-addressed bodies live on disk. */
  artifactStore: string;
  ledgerDbPath: string;
  mirrorNodeUrl: string;
  /** Served from /.well-known/carpool so every client embeds with the same model. */
  embedding: { model: string; dim: number };
  /** HCS topic Task E anchors epochs to. Falls back to anchorEpoch's own env read if unset. */
  hcsTopicId?: string;
  /** Seconds between epoch-timer settle runs (Task E). */
  epochSeconds: number;
  /** Batch memo prefix, passed to `createSettler` — v1 hard-coded "carpool:batch:". */
  memoPrefix: string;
}

let cached: Config | null = null;

/**
 * An integer env var, range-checked.
 *
 * `min` is not optional decoration. `int` used to truncate and accept anything:
 * `TRACKER_FEE_MICRO_USDC=-1` was taken as a real fee, which makes `splitSale`
 * throw on **every** sale — and a throw out of `onPaid` meant a settled payment
 * with no purchase row, no royalty and no refund path (docs/AUDIT-MONEY.md L3,
 * which is H1's second trigger). `EPOCH_SECONDS=0` likewise made `setInterval`
 * fire continuously. Refusing to start is the only safe answer: a money constant
 * nobody can name a legitimate value for is a configuration error, not a value.
 */
function int(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got ${raw}`);
  const t = Math.trunc(n);
  if (t < min) throw new Error(`${name} must be at least ${min}, got ${raw}`);
  return t;
}

export function loadConfig(): Config {
  if (cached) return cached;
  const registryAccount = process.env.CARPOOL_ACCOUNT_ID;
  if (!registryAccount || registryAccount === "0.0.000000") {
    // The service still starts (search/publish/state don't need a payTo), but
    // any x402-gated purchase would issue a 402 no one could ever pay.
    console.warn(
      "registry: CARPOOL_ACCOUNT_ID is not set — GET /artifact/:magnet will quote " +
        "requirements with an invalid payTo until it is.",
    );
  }
  cached = {
    port: int("REGISTRY_PORT", 8403, 1),
    facilitatorUrl: process.env.FACILITATOR_URL || "https://api.testnet.blocky402.com",
    network: process.env.HEDERA_NETWORK || "hedera:testnet",
    asset: process.env.USDC_TOKEN_ID || "0.0.429274",
    registryAccount: registryAccount || "0.0.000000",
    // Range-checked: a negative fee makes splitSale throw on every sale, which
    // is a settled payment the registry cannot record. See int().
    trackerFee: int("TRACKER_FEE_MICRO_USDC", 500), // $0.0005 flat, matches v1's carpool fee; see README "Money"
    artifactStore: process.env.ARTIFACT_STORE || "./data/artifacts",
    ledgerDbPath: process.env.LEDGER_DB || "./data/ledger.sqlite",
    mirrorNodeUrl: process.env.MIRROR_NODE_URL || "https://testnet.mirrornode.hedera.com",
    embedding: {
      model: process.env.EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2",
      dim: int("EMBEDDING_DIM", 384, 1),
    },
    hcsTopicId: process.env.HCS_TOPIC_ID,
    // At least 1: zero makes setInterval fire continuously.
    epochSeconds: int("EPOCH_SECONDS", 600, 1),
    memoPrefix: process.env.SETTLE_MEMO_PREFIX || "carpool:batch:",
  };
  return cached;
}

/** test hook: force a fresh load (e.g. after env changes). */
export function resetConfig(): void {
  cached = null;
}
