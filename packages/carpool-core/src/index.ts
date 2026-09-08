// The package's public surface, stated. Every name below is API: renaming or
// removing one is a breaking change, and a name that is not here is internal.
//
// This file used to be six `export *` lines, which made all of that implicit —
// anything any module happened to export became API by accident, a rename
// became a silent break, and nothing could be tree-shaken. The worst of it was
// `export * from "@carpool/hedera-x402"`: it re-published an entire payments
// package (Settler, SqliteSettlementLedger, PaymentGate, openDb, merkle, auth,
// the HCS anchor) through `@carpool/core`, so a consumer that wanted
// `parseManifest` got the settlement layer's whole surface with it. RESTRUCTURE
// §3 asks for the opposite: core depends on hedera-x402 for canonical hashing
// and units, and nothing else. Consumers that need the payment rail import
// `@carpool/hedera-x402` directly — several already do.

// --- units, re-exported for convenience (RESTRUCTURE §3) -------------------
// Money units only. The rest of `@carpool/hedera-x402` is not core's API.
export { CENT, USDC_DECIMALS, USDC_TOKEN_ID_TESTNET, sha256 } from "@carpool/hedera-x402";

// --- manifest: the artifact's free half ------------------------------------
export { ManifestSchema, parseManifest, normalizeQuestion, type Manifest } from "./manifest.js";

// --- magnet: content addressing -------------------------------------------
// `canonicalHash` is key-order independent, which is what makes a magnet stable.
export { canonicalHash, magnetOf } from "./magnet.js";

// --- decay: the single freshness term (RESTRUCTURE §5) ---------------------
export { freshness, priceAt, isExpired } from "./decay.js";

// --- pricing defaults: the author's price rule and the buyer's spend cap ---
// One module because they are one decision: the cap is DERIVED from the price
// share, so a change to either without the other is a red test. They shipped
// contradicting each other (15% of production cost against a 20,000 µUSDC cap
// = nothing over $0.1333 to produce was buyable) precisely because they lived in
// three different files across two apps. Here so `apps/mcp` (which prices and
// buys) and `apps/bench` (which buys under load) read the same numbers.
export {
  PRICE_SHARE_OF_REDO_COST,
  MIN_PRICE_MICRO_USDC,
  PRICE_FLOOR_SHARE,
  DEFAULT_MAX_REDO_COST_USD,
  DEFAULT_CAP_MICRO_USDC,
  priceForRedoCost,
  floorForPrice,
  maxBuyableRedoCostUsd,
  capMicroUsdc,
} from "./pricing.js";

// --- health: the tracker/dashboard ranking term (RESTRUCTURE §4) -----------
export { health } from "./health.js";

// --- ratings: the buyer's own judgement, kept OUT of health -----------------
// A separate signal on purpose (see ratings.ts and health.ts for the argument):
// counts and a gated label, never an average. `health` is unchanged.
export {
  MIN_RATINGS_FOR_VERDICT,
  MAX_RATING_REASON_CHARS,
  summariseRatings,
  type RatingVerdict,
  type RatingSummary,
} from "./ratings.js";

// --- identity: who gets paid ----------------------------------------------
export {
  HederaAuthor,
  signManifest,
  publicKeyHexOf,
  type AuthorIdentity,
} from "./identity.js";

// v1 (query classes, cache keys, Zipf workload, the fixed universe.json) is
// gone as of Phase B1: apps/fleet was their only importer, apps/fleet is
// replaced by apps/bench, and bench draws its Zipf workload over whatever
// the registry actually holds rather than a fixed committed universe — see
// apps/bench/src/load.ts. Do not resurrect types.ts/key.ts/workload.ts for
// new v2 code.
//
// `pricing.ts` and `policy.ts` are NOT here either: apps/settlement was their
// only importer (loadPolicy/policyHash/PolicyFile, riderPrice/pioneerPrice/split)
// and Phase D deleted both settlement and these two modules together.
