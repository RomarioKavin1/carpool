import { and, asc, desc, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import type Database from "better-sqlite3";
import { SqliteSettlementLedger } from "@carpool/hedera-x402";
import {
  freshness,
  health,
  isExpired,
  priceAt,
  summariseRatings,
  type Manifest,
  type RatingSummary,
} from "@carpool/core";
import { REFUND_WINDOW_SECONDS } from "./config.js";
import { parseHederaAuthor } from "./identity.js";
import { artifact, purchase, rating, peer, owedFailure, type DB } from "./db/index.js";

export type ArtifactRow = typeof artifact.$inferSelect;
export type PurchaseRow = typeof purchase.$inferSelect;
export type RatingRow = typeof rating.$inferSelect;

/**
 * One rating as served on the wire: the buyer's verdict, their reason, and when.
 *
 * No rater account. A rating is bound to a purchase and `/state` already serves
 * every purchase's `buyer`, so the account is derivable by anyone who wants it —
 * but putting it on every `/search` result would make the buyer's judgement of an
 * author's work a named, attributable statement on a listing page, which is a
 * different and worse thing to publish than an aggregate. The account is in the
 * row (and in the stored signature) for audit; it is not on the listing.
 */
export interface RatingReason {
  worth: boolean;
  reason: string;
  /** Unix seconds. */
  ts: number;
}

/**
 * Ratings for one artifact, as served on `/search`, `/manifest/:magnet` and
 * `/state`. **Counts and a gated label — never an average.**
 *
 * `count` is the denominator of everything else here and is the only one
 * available: there is no ratio, percentage or star figure on this object, so a
 * client that wants "83% said it was worth it" has to divide by `count` itself
 * and therefore has the sample size in hand when it decides whether to print
 * anything at all. `verdict` is `null` below `MIN_RATINGS_FOR_VERDICT`
 * (`@carpool/core`), which is the honest answer at n < 3 and cannot be mistaken
 * for a number. See `packages/carpool-core/src/ratings.ts` for why the scale is
 * binary and `health.ts` for why none of this is folded into `health`.
 */
export interface ArtifactRatings extends RatingSummary {
  /**
   * Ratings excluded from the counts because their purchase was refunded.
   *
   * Served rather than silently dropped: a count that shrinks with no explanation
   * is the sort of number PRODUCT.md's "every number says where it came from"
   * exists to forbid. Non-zero here means somebody rated and then took their money
   * back, and the dissatisfaction is recorded in `refundRate` instead — counting
   * it twice would let one sale move two signals.
   */
  discounted: number;
  /** Most recent reasons first, at most `MAX_REASONS_SERVED`. Counted ratings only. */
  reasons: RatingReason[];
}

/** Reassembles the full public Manifest from a stored row. Inverse of `manifestToRow`. */
export function rowToManifest(row: ArtifactRow): Manifest {
  return {
    magnet: row.magnet,
    question: row.question,
    questionNorm: row.questionNorm,
    scope: row.scope ?? undefined,
    abstract: row.abstract,
    sources: JSON.parse(row.sourcesJson),
    provenance: JSON.parse(row.provenanceJson),
    decay: { halfLifeDays: row.halfLifeDays, producedAt: new Date(row.producedAt).toISOString() },
    author: row.author,
    bodyHash: row.bodyHash,
    bodyBytes: row.bodyBytes,
    redacted: row.redacted !== 0,
  };
}

/** A listing as returned by GET /search: the manifest plus the buyer's evidence for deciding to pay. */
export interface Listing {
  manifest: Manifest;
  priceNow: number;
  freshness: number;
  health: number;
  /**
   * Days since `decay.producedAt`, float, never negative.
   *
   * Served rather than left for the client to derive: `freshness` and
   * `priceNow` are already computed against *this* server's clock, and a
   * client deriving age against its own would print an age that contradicts
   * the freshness beside it whenever the two clocks disagree. One clock, one
   * age. (It was previously in neither place: `apps/mcp` typed `ageDays` on
   * every search result and called `.toFixed(1)` on it, and `GET /search`
   * never sent it — every non-empty search threw a TypeError.)
   */
  ageDays: number;
  /**
   * What the buyers who paid for it said, and how many of them there were.
   *
   * Beside `health` rather than inside it — see `@carpool/core`'s `health.ts`. A
   * buying agent gets the counts (and up to three reasons) in the same response
   * that quotes it a price, which is the only moment the information is worth
   * anything to it.
   */
  ratings: ArtifactRatings;
}

const MS_PER_DAY = 86_400_000;

/**
 * Reasons carried inline on a listing. Three, because a listing is a decision
 * aid rather than a review page, and because `GET /search` serves up to 100 of
 * these in one response — the whole rating block has to stay small enough that
 * putting it on every result is not a reason to leave it off.
 */
const MAX_REASONS_SERVED = 3;

/** No ratings at all, and the only place that shape is written. */
function noRatings(): ArtifactRatings {
  return { ...summariseRatings({ worth: 0, notWorth: 0 }), discounted: 0, reasons: [] };
}

/**
 * The three fields ratings add to `GET /state`, declared **optional** in the
 * emitted type and always set at runtime.
 *
 * Not a hedge: `apps/dashboard/lib/api.ts` derives its `RegistryState` from
 * `ReturnType<RegistryLedger["state"]>` (a type-only import of this file, so a
 * renamed field fails its typecheck instead of drifting), and its test fixtures
 * build that type as object literals. A newly *required* field on `state()`
 * therefore breaks that app's typecheck from here — which is exactly why
 * `Payout.attempts`, `Payout.parkedAt` and `Batch.reconcileAttempts` are all
 * optional too, each with the same note. Optional here means "a consumer written
 * before ratings existed still compiles", never "the registry might not send it":
 * `state()` sets all three unconditionally, and `rate.test.ts` asserts they are
 * on the wire.
 *
 * Spread through these helpers rather than cast, so the optionality is declared
 * in a signature and a future reader can delete it in one place.
 */
function stateArtifactRatings(ratings: ArtifactRatings): { ratings?: ArtifactRatings } {
  return { ratings };
}

function statePurchaseRated(rated: boolean): { rated?: boolean } {
  return { rated };
}

function stateSummaryRatingCount(ratingCount: number): { ratingCount?: number } {
  return { ratingCount };
}

export function ageDaysOf(m: Pick<Manifest, "decay">, nowMs: number): number {
  return Math.max(0, (nowMs - Date.parse(m.decay.producedAt)) / MS_PER_DAY);
}

/**
 * The `data` payload of one GET /events entry — named and exported (rather
 * than left as `unknown`) so a rename of any of these fields in
 * `eventsSince`'s own return literal is a compile error here, in the file
 * that owns the contract, not just a hoped-for test elsewhere.
 */
export interface PurchaseEventData {
  magnet: string;
  buyer: string;
  txId: string;
  paid: number;
}

function toListing(row: ArtifactRow, nowMs: number): Listing {
  const manifest = rowToManifest(row);
  const f = freshness(manifest, nowMs);
  const distinctBuyers = 0; // filled in by RegistryLedger.listLive, which knows the purchase table
  return {
    manifest,
    priceNow: priceAt({ priceBase: row.priceBase, priceFloor: row.priceFloor, decay: manifest.decay }, nowMs),
    freshness: f,
    health: health({ freshness: f, refundRate: 0, distinctBuyers }),
    ageDays: ageDaysOf(manifest, nowMs),
    // Filled in by RegistryLedger.listingOf, which knows the rating table. Never
    // served as-is: an empty summary here would be indistinguishable from "nobody
    // rated it", so the only caller replaces it.
    ratings: noRatings(),
  };
}

export interface AccrualResult {
  authorRoyaltyPayoutId: number;
  trackerFeePayoutId: number;
}

/**
 * Where one payout row stands. The four states are exhaustive and ordered by
 * finality, and each one is a different sentence to a payee:
 *
 * - `held`      — accrued and not payable yet. Either inside its refund window
 *                 (`availableAt` is the refund deadline) or **parked**: the
 *                 transfer failed on chain `attempts` times for a cause that will
 *                 not clear on its own, so the rail stopped spending a
 *                 transaction fee per epoch on it and handed it to an operator.
 *                 `parkedAt` is what separates the two, and it is served.
 * - `claimable` — owed and available; the next settlement epoch will pay it.
 * - `settled`   — a batch claimed it. `settledBatchId` names which; `GET /batches`
 *                 turns that into a Hedera transaction id.
 * - `voided`    — a refund reversed it. It will never be paid, and saying so is
 *                 the point: omitting voided rows would make a refunded sale look
 *                 like a sale that never happened.
 *
 * `voided` is checked before `settled` because `void()` is conditional on the row
 * not already being claimed — the two cannot both be true, and if a future bug
 * makes them so, reporting "voided" is the safe direction to be wrong in.
 *
 * **A parked row reports `held`, not `claimable`, and that is deliberate.** Before
 * `parked_at` existed, such a row was reported `claimable` for ever while 144
 * transfers a day failed behind it (docs/AUDIT-MONEY.md M5) — telling every reader
 * "the next settlement epoch will pay it" about a row nothing was going to pay.
 * `held` at least does not promise payment, and `parkedAt`/`attempts` say exactly
 * what is happening; `GET /payouts` also lists parked rows separately. A fifth
 * `"parked"` member of this union is the better model and is deliberately NOT
 * added here: `PayoutState` is re-exported by apps/dashboard (`lib/api.ts` derives
 * it from this return type) and keyed exhaustively in two of its maps, so widening
 * it is a change to that app, not to this one.
 */
export type PayoutState = "held" | "claimable" | "settled" | "voided";

export interface Payout {
  id: number;
  payee: string;
  amount: number;
  /** `author_royalty` | `tracker_fee` | `refund` | `refund_due`. */
  reason: string;
  /** The `purchase.id` this row was accrued against, as a string. */
  ref: string | null;
  /** Unix seconds; a royalty's is its refund deadline. */
  availableAt: number;
  voidedAt: number | null;
  settledBatchId: number | null;
  /**
   * Consensus-reached transfer failures this row has been released from.
   *
   * Optional only so that adding it did not break every consumer that builds a
   * `Payout` literal (apps/dashboard's fixtures do); `RegistryLedger.payouts`
   * always sets it.
   */
  attempts?: number;
  /**
   * Unix seconds, or null. Set once the rail stopped retrying this row: still
   * owed, no longer attempted, waiting on an operator (`POST /payouts/:id/unpark`).
   * A row with this set reports `state: "held"` — see `PayoutState`.
   */
  parkedAt?: number | null;
  state: PayoutState;
}

export interface Batch {
  id: number;
  /**
   * NULL until the transfer's id is recorded, and NULL for ever on a batch that
   * needed no transfer (`SETTLED_NO_TRANSFER`). Public on a mirror node once set.
   */
  txId: string | null;
  /**
   * `pending` | `SUCCESS` | `FAILED:<result>` | `NEEDS_OPERATOR:<result>` |
   * `RELEASED_BY_OPERATOR:<previous>` | `SETTLED_BY_OPERATOR` |
   * `SETTLED_NO_TRANSFER` | `EMPTY_CLAIM` — see `BATCH_STATUS` in the rail.
   *
   * `NEEDS_OPERATOR:` is the one to watch: the transfer came back with a result
   * the rail cannot classify, so neither settling (which strands the payees) nor
   * releasing (which risks paying them twice) is safe and a human has to look.
   * `POST /batches/:id/resolve` is how they answer.
   */
  status: string;
  ts: number;
  root: string;
  memo: string;
  /**
   * Reconcile passes that could neither confirm nor refute this batch. Optional
   * for the same reason as `Payout.attempts`; `RegistryLedger.batches` always
   * sets it.
   */
  reconcileAttempts?: number;
}

/**
 * A settled payment this registry has not managed to record, as served by
 * `GET /owed`. One row is one open incident: the money moved on chain and the
 * product does not know about it yet.
 */
export interface OwedFailure {
  id: number;
  /** Unix seconds the failure was recorded. */
  ts: number;
  /** Which step failed — `onPaid`, or `settle-no-tx-id` from the gate. */
  op: string;
  txId: string;
  payer: string | null;
  paid: number;
  /** The gate's resource key, which for this registry is the magnet. */
  resourceKey: string;
  /** The failure as thrown, verbatim. */
  reason: string;
  /** Unix seconds; NULL while the payment is still unrecorded. */
  resolvedAt: number | null;
  /** The purchase a successful replay opened, or found already open. */
  purchaseId: number | null;
  replayAttempts: number;
  /** Why the last replay did not work; NULL once it did. */
  lastError: string | null;
}

function payoutState(
  r: {
    voided_at: number | null;
    settled_batch_id: number | null;
    available_at: number;
    parked_at?: number | null;
  },
  nowSeconds: number,
): PayoutState {
  if (r.voided_at != null) return "voided";
  if (r.settled_batch_id != null) return "settled";
  // Parked: owed, and no epoch is going to claim it until an operator unparks it.
  // "held" rather than "claimable" — see PayoutState.
  if (r.parked_at != null) return "held";
  return r.available_at <= nowSeconds ? "claimable" : "held";
}

/**
 * Split one sale into the two payout rows it accrues, such that they sum to
 * **exactly** what the buyer paid.
 *
 * This is the whole "a payout table can never exceed receipts" invariant, in the
 * one place the payout rows are written. It used to live only in `POST /publish`
 * — which rejects `priceFloor < trackerFee` and is a good guard in the wrong
 * place to be the *only* one, because `trackerFee` is environment
 * (`TRACKER_FEE_MICRO_USDC`) and an operator can raise it after artifacts are
 * already live at a price set under the old value. Every subsequent sale of one
 * of those artifacts accrued `tracker_fee` in full while `max(0, paid − fee)`
 * clamped the royalty to zero, so two rows worth more than the sale went into the
 * payout table and the settler would have paid them. Nothing compared the two.
 *
 * The fee is clamped to `paid` rather than the royalty floored at zero. The
 * difference is the whole fix: flooring hides the overspend in a row that reads
 * as legitimate, clamping makes the sum an identity. When a sale cannot cover the
 * fee the tracker takes the sale and the author takes nothing — a zero-royalty
 * row is still written, because the refund path voids *rows*, and a purchase with
 * no royalty row to void is a purchase that cannot be refunded.
 *
 * The post-condition is checked rather than commented, and it **throws** rather
 * than logging. A throw here propagates out of `onPaid`, so the gate's `owe()`
 * writes a durable `owed_failure` row and the buyer gets a 502 naming the txId:
 * money that moved is recorded and a human is told. A log line would leave an
 * over-sum in the payout table for the settler to pay out on the next epoch,
 * which is the one outcome that cannot be undone.
 */
export function splitSale(paid: number, trackerFee: number): { fee: number; royalty: number } {
  if (!Number.isInteger(paid) || paid < 0) {
    throw new Error(`paid must be a non-negative integer µUSDC amount, got ${paid}`);
  }
  if (!Number.isInteger(trackerFee) || trackerFee < 0) {
    throw new Error(`trackerFee must be a non-negative integer µUSDC amount, got ${trackerFee}`);
  }
  const fee = Math.min(trackerFee, paid);
  const royalty = paid - fee;
  if (fee + royalty !== paid) {
    throw new Error(
      `refusing to accrue: tracker_fee ${fee} + author_royalty ${royalty} = ${fee + royalty} ` +
        `µUSDC for a sale of ${paid} µUSDC — the payout table may never exceed what the sale received`,
    );
  }
  return { fee, royalty };
}

/**
 * Artifact / purchase / peer operations over the rail's ledger.
 *
 * Shares one SQLite connection with `SqliteSettlementLedger`: `db` (drizzle)
 * for this package's own tables, `sqlite` (raw better-sqlite3) for the
 * rail's `payout`/`batch` tables. A registry-level transaction wraps both via
 * `sqlite.transaction(...)`, since drizzle's better-sqlite3 driver and the
 * rail's ledger both ultimately run prepared statements against the same
 * connection — mixing them inside one native transaction is exactly what
 * better-sqlite3 supports, and it is the only way to open a purchase row and
 * accrue its two payouts atomically.
 */
export class RegistryLedger {
  /**
   * Typed as the concrete class, not the `SettlementLedger` interface —
   * `accrue`/`void` are product-side helpers `SqliteSettlementLedger` adds on
   * top of what the settler itself needs (`unsettled`/`claimBatch`/etc.), and
   * this is the registry's only way to write a payout row.
   */
  readonly settlement: SqliteSettlementLedger;
  private readonly clock: () => number;
  /**
   * Served on `GET /state` beside every `refundDeadline`, so a client rendering a
   * row never has to hard-code 120 or read it from a second endpoint. A protocol
   * constant, not env (see config.ts), so the default is the real value rather
   * than a placeholder.
   */
  readonly refundWindowSeconds: number;

  constructor(
    readonly db: DB,
    readonly sqlite: Database.Database,
    private readonly cfg: {
      trackerFee: number;
      registryAccount: string;
      refundWindowSeconds?: number;
      now?: () => number;
    },
  ) {
    this.clock = cfg.now ?? (() => Math.floor(Date.now() / 1000));
    this.refundWindowSeconds = cfg.refundWindowSeconds ?? REFUND_WINDOW_SECONDS;
    this.settlement = new SqliteSettlementLedger(sqlite, { now: this.clock });
  }

  private now(): number {
    return this.clock();
  }

  // ---------------------------------------------------------------- publish

  /**
   * Insert or reprice an artifact. Keyed by magnet (content address), so a
   * republish with the same manifest content is either a no-op or a
   * reprice — `author_sig`/`manifest_hash` cannot change without the magnet
   * itself changing, since both are computed over the same signed content.
   */
  publish(
    manifest: Manifest,
    extra: { authorSig: string; manifestHash: string; priceBase: number; priceFloor: number; bodyUri: string },
  ): { created: boolean } {
    const existing = this.getArtifact(manifest.magnet);
    const producedAtMs = Date.parse(manifest.decay.producedAt);
    const row = {
      magnet: manifest.magnet,
      question: manifest.question,
      questionNorm: manifest.questionNorm,
      scope: manifest.scope ?? null,
      abstract: manifest.abstract,
      sourcesJson: JSON.stringify(manifest.sources),
      provenanceJson: JSON.stringify(manifest.provenance),
      author: manifest.author,
      authorSig: extra.authorSig,
      manifestHash: extra.manifestHash,
      bodyHash: manifest.bodyHash,
      bodyBytes: manifest.bodyBytes,
      bodyUri: extra.bodyUri,
      priceBase: extra.priceBase,
      priceFloor: extra.priceFloor,
      halfLifeDays: manifest.decay.halfLifeDays,
      producedAt: producedAtMs,
      redacted: manifest.redacted ? 1 : 0,
    };
    if (existing) {
      this.db.update(artifact).set(row).where(eq(artifact.magnet, manifest.magnet)).run();
      return { created: false };
    }
    this.db.insert(artifact).values({ ...row, delistedAt: null }).run();
    this.bumpPeer(manifest.author, { published: 1 });
    return { created: true };
  }

  getArtifact(magnet: string): ArtifactRow | null {
    return this.db.select().from(artifact).where(eq(artifact.magnet, magnet)).get() ?? null;
  }

  isLive(row: ArtifactRow, nowMs = Date.now()): boolean {
    if (row.delistedAt != null) return false;
    return !isExpired({ decay: { halfLifeDays: row.halfLifeDays, producedAt: new Date(row.producedAt).toISOString() } }, nowMs);
  }

  // --------------------------------------------------------------- delist

  /**
   * Withdraw an artifact from sale. A tombstone, never a DELETE.
   *
   * `delisted_at` had readers from the first commit (`isLive`, `listLive`,
   * `liveQuestions`, the gate's `quote`) and no writer at all: no route set it,
   * so an author had no way to stop selling while four documents and the consent
   * prompt promised "delisting stops new sales". This is the writer.
   *
   * Nothing is deleted, and that is the design rather than laziness:
   *
   *  - `purchase` rows and their `payout` rows are untouched, so a buyer inside
   *    their refund window keeps it. `refundPurchase` never consults the
   *    artifact, and `refundUndelivered` re-reads the purchase row inside its own
   *    transaction — delete the artifact and both lose their footing.
   *  - `body_hash` and the stored body stay, so a delivery failure during the
   *    window can still be reversed against real content.
   *  - `manifest_hash` stays, and `unanchoredManifests()` deliberately ignores
   *    `delisted_at`: "this content existed, unmodified, at a consensus time" is
   *    provenance, and it remains true after a withdrawal. An artifact delisted
   *    before its first anchor still gets anchored.
   *
   * Conditional on `delisted_at IS NULL`, like every other state flip here, so a
   * retry reports the original timestamp instead of moving it. Note that
   * `publish()`'s reprice path does not write `delisted_at`, so republishing the
   * same manifest does not resurrect a withdrawn artifact — the magnet *is* the
   * content, and withdrawing it is a final statement about that content.
   */
  delist(magnet: string, at = this.now()): { delisted: boolean; delistedAt: number } | null {
    const row = this.getArtifact(magnet);
    if (!row) return null;
    if (row.delistedAt != null) return { delisted: false, delistedAt: row.delistedAt };
    const res = this.db
      .update(artifact)
      .set({ delistedAt: at })
      .where(and(eq(artifact.magnet, magnet), isNull(artifact.delistedAt)))
      .run();
    if (res.changes === 0) {
      // Lost a race with a concurrent delist: report theirs, not a second one.
      const current = this.getArtifact(magnet);
      return { delisted: false, delistedAt: current?.delistedAt ?? at };
    }
    return { delisted: true, delistedAt: at };
  }

  // ---------------------------------------------------------------- anchor

  /**
   * Artifacts whose manifest_hash has never been included in a successful
   * HCS anchor — live or not, delisted or not: this is provenance ("this
   * content existed, unmodified, at a consensus time"), not a marketplace
   * listing concern. Task E's settlement.ts feeds these hashes into
   * `anchorEpoch`'s leaves alongside that epoch's payout rows.
   */
  unanchoredManifests(): { magnet: string; manifestHash: string }[] {
    return this.db
      .select({ magnet: artifact.magnet, manifestHash: artifact.manifestHash })
      .from(artifact)
      .where(isNull(artifact.anchoredAt))
      .all();
  }

  /**
   * Marks these magnets anchored. Call only after `anchorEpoch` reports
   * `anchored: true` for the epoch that included them — an epoch that was
   * skipped (empty, no topic, no client) must leave them NULL so the next
   * epoch picks them up instead of losing them.
   */
  markAnchored(magnets: string[], at: number): void {
    if (magnets.length === 0) return;
    this.db
      .update(artifact)
      .set({ anchoredAt: at })
      .where(and(inArray(artifact.magnet, magnets), isNull(artifact.anchoredAt)))
      .run();
  }

  // ------------------------------------------------------------------ search

  /**
   * FREE. Live (not delisted, not expired) artifacts, newest first.
   *
   * This is the *browse*, not the search: `GET /search` uses it only when the
   * caller supplied neither a `vector` nor a `q` (see `search.ts` for the
   * ranked path). Semantic ranking is not "newest first with extra steps" —
   * conflating the two is how the tracker stayed unwired while the docs said
   * it ranked.
   */
  listLive(limit: number, nowMs = Date.now()): Listing[] {
    const rows = this.db
      .select()
      .from(artifact)
      .where(isNull(artifact.delistedAt))
      .orderBy(desc(artifact.producedAt))
      .all();
    const out: Listing[] = [];
    for (const row of rows) {
      if (!this.isLive(row, nowMs)) continue;
      out.push(this.listingOf(row, nowMs));
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * A listing with the real refundRate/distinctBuyers folded into `health`, and
   * the real ratings served **beside** it.
   *
   * Note the asymmetry, which is the decision: `refundRate` and `distinctBuyers`
   * go *into* `health`; ratings do not. See `@carpool/core`'s `health.ts` for the
   * argument (small samples, a negative signal already priced in money, and a
   * term that would be constant for most rows).
   */
  private listingOf(row: ArtifactRow, nowMs: number): Listing {
    const listing = toListing(row, nowMs);
    listing.health = health({
      freshness: listing.freshness,
      refundRate: this.refundRate(row.magnet),
      distinctBuyers: this.distinctBuyers(row.magnet),
    });
    listing.ratings = this.ratingsFor(row.magnet);
    return listing;
  }

  /** One artifact's listing, or null if unknown or no longer live. */
  liveListing(magnet: string, nowMs = Date.now()): Listing | null {
    const row = this.getArtifact(magnet);
    if (!row || !this.isLive(row, nowMs)) return null;
    return this.listingOf(row, nowMs);
  }

  /**
   * Listings for exactly these magnets, live ones only, keyed by magnet.
   *
   * The ranked search path's manifest lookup: the vector index returns magnets
   * and nothing else, and a magnet it holds may since have been delisted or
   * expired — the index and the manifest store are allowed to disagree
   * transiently, so an unknown or dead magnet is skipped rather than an error
   * (`rank()` in @carpool/tracker makes the same allowance from the other
   * side).
   */
  liveListingsFor(magnets: readonly string[], nowMs = Date.now()): Map<string, Listing> {
    const out = new Map<string, Listing>();
    for (const magnet of magnets) {
      const listing = this.liveListing(magnet, nowMs);
      if (listing) out.set(magnet, listing);
    }
    return out;
  }

  /**
   * Every live artifact's magnet + question, for the index-repair pass in
   * `search.ts`. Cheap (two columns, no JSON parsing) because it runs on every
   * ranked query to check whether anything is missing from the index.
   */
  liveQuestions(nowMs = Date.now()): { magnet: string; questionNorm: string }[] {
    return this.db
      .select({
        magnet: artifact.magnet,
        questionNorm: artifact.questionNorm,
        halfLifeDays: artifact.halfLifeDays,
        producedAt: artifact.producedAt,
        delistedAt: artifact.delistedAt,
      })
      .from(artifact)
      .where(isNull(artifact.delistedAt))
      .all()
      .filter((r) =>
        !isExpired(
          { decay: { halfLifeDays: r.halfLifeDays, producedAt: new Date(r.producedAt).toISOString() } },
          nowMs,
        ),
      )
      .map((r) => ({ magnet: r.magnet, questionNorm: r.questionNorm }));
  }

  /** Live artifacts' questions, for the exact-duplicate signal at publish time. */
  liveQuestionTexts(nowMs = Date.now()): { magnet: string; question: string; scope: string | null }[] {
    return this.db
      .select({
        magnet: artifact.magnet,
        question: artifact.question,
        scope: artifact.scope,
        halfLifeDays: artifact.halfLifeDays,
        producedAt: artifact.producedAt,
      })
      .from(artifact)
      .where(isNull(artifact.delistedAt))
      .all()
      .filter((r) =>
        !isExpired(
          { decay: { halfLifeDays: r.halfLifeDays, producedAt: new Date(r.producedAt).toISOString() } },
          nowMs,
        ),
      )
      .map((r) => ({ magnet: r.magnet, question: r.question, scope: r.scope }));
  }

  private distinctBuyers(magnet: string): number {
    const rows = this.db.select({ buyer: purchase.buyer }).from(purchase).where(eq(purchase.magnet, magnet)).all();
    return new Set(rows.map((r) => r.buyer)).size;
  }

  private refundRate(magnet: string): number {
    const rows = this.db.select({ refundState: purchase.refundState }).from(purchase).where(eq(purchase.magnet, magnet)).all();
    if (rows.length === 0) return 0;
    const refunded = rows.filter((r) => r.refundState === "refunded").length;
    return refunded / rows.length;
  }

  // --------------------------------------------------------------- purchase

  /** The purchase already recorded for a settled tx, if any (onPaid idempotency). */
  purchaseByTxId(txId: string): PurchaseRow | null {
    if (!txId) return null;
    return this.db.select().from(purchase).where(eq(purchase.txId, txId)).get() ?? null;
  }

  getPurchase(id: number): PurchaseRow | null {
    return this.db.select().from(purchase).where(eq(purchase.id, id)).get() ?? null;
  }

  /**
   * Opens a purchase row and accrues its two payouts atomically:
   * `author_royalty` (paid − trackerFee, held back `refundWindowSeconds`,
   * payee = `payoutAccount` resolved by the caller from `AuthorIdentity` and
   * pinned here) and `tracker_fee` (immediately payable). Idempotent on
   * `txId` — a retried `onPaid` returns the original purchase untouched.
   */
  recordPurchase(args: {
    magnet: string;
    buyer: string;
    txId: string;
    paid: number;
    payoutAccount: string;
    refundWindowSeconds: number;
  }): { purchaseId: number } & AccrualResult {
    // The idempotency key, and therefore not optional. `purchaseByTxId`
    // short-circuits on a falsy txId and the unique index excludes '', so an
    // empty one defeats every de-duplication in this path at once: three
    // recordPurchase calls with '' produced three purchases and six payout rows
    // for one payment, and `purchaseByTxId("")` could not even find them
    // (docs/AUDIT-MONEY.md M2, verified). Refusing here is what makes that
    // unreachable regardless of what a facilitator returns; `PaymentGate` also
    // declines to call `onPaid` without one, and routes it to `owe()` instead.
    if (!args.txId) {
      throw new Error(
        "refusing to record a purchase with no transaction id: it is the key onPaid is " +
          "idempotent on, the key POST /refund is looked up by, and the key the unique " +
          "index on purchase.tx_id covers",
      );
    }
    const prior = this.purchaseByTxId(args.txId);
    if (prior) {
      return {
        purchaseId: prior.id,
        authorRoyaltyPayoutId: prior.authorRoyaltyPayoutId!,
        trackerFeePayoutId: prior.trackerFeePayoutId!,
      };
    }

    const now = this.now();
    const refundDeadline = now + args.refundWindowSeconds;
    // The invariant, enforced where the rows are written: fee + royalty === paid.
    // See splitSale — this used to be `max(0, paid − trackerFee)` alongside a
    // full-price fee, which sums above `paid` whenever the fee exceeds the price.
    const { fee, royalty: royaltyAmount } = splitSale(args.paid, this.cfg.trackerFee);

    const run = this.sqlite.transaction(() => {
      const ins = this.db
        .insert(purchase)
        .values({
          magnet: args.magnet,
          buyer: args.buyer,
          txId: args.txId,
          paid: args.paid,
          ts: now,
          refundState: "window",
          refundDeadline,
        })
        .run();
      const purchaseId = Number(ins.lastInsertRowid);

      const authorRoyaltyPayoutId = this.settlement.accrue({
        payee: args.payoutAccount,
        amount: royaltyAmount,
        reason: "author_royalty",
        ref: String(purchaseId),
        availableAt: refundDeadline,
      });
      const trackerFeePayoutId = this.settlement.accrue({
        payee: this.cfg.registryAccount,
        amount: fee,
        reason: "tracker_fee",
        ref: String(purchaseId),
        availableAt: now,
      });

      this.db
        .update(purchase)
        .set({ authorRoyaltyPayoutId, trackerFeePayoutId })
        .where(eq(purchase.id, purchaseId))
        .run();

      this.bumpPeer(args.buyer, { purchased: 1 });
      return { purchaseId, authorRoyaltyPayoutId, trackerFeePayoutId };
    });
    // `.immediate()`: every money transaction here takes the write lock at BEGIN.
    // A deferred transaction that reads before it writes is refused with
    // SQLITE_BUSY_SNAPSHOT the instant another connection commits — immediately,
    // without consulting busy_timeout, because waiting cannot refresh a stale
    // snapshot — and that throw lands in the gate's onPaid catch, which is a
    // settled payment with no purchase row (docs/AUDIT-MONEY.md H1). See
    // packages/hedera-x402/src/db.test.ts for the mechanism.
    return run.immediate();
  }

  // ----------------------------------------------------------------- refund

  /**
   * Voids `author_royalty` and accrues that row's own amount back to the buyer.
   * Conditional on the void succeeding (the row not already claimed by a
   * settlement batch) and the window not having closed, so a refund racing the
   * settler cannot double-spend.
   *
   * The refund is read from the voided payout row, not recomputed as
   * `paid − trackerFee`: the fee is environment, so recomputing it means a fee
   * changed between the purchase and the refund silently changes the refund.
   * Raised, and the buyer was credited less than was taken from the author while
   * the registry kept the difference; lowered, and they were credited more than
   * the sale received. The row is what the money is, so reverse the row. The
   * tracker fee is deliberately not reversed here — buyer's remorse is not a
   * service failure (see `refundUndelivered` for the case that is).
   *
   * ## A zero-value refund is refused rather than reported as a success
   *
   * `POST /publish` rejects `priceFloor < trackerFee` using the fee **at publish
   * time**. Raise `TRACKER_FEE_MICRO_USDC` afterwards and every later sale of an
   * already-live artifact hits `splitSale`'s clamp: `fee = paid`, `royalty = 0`.
   * This path would then void a 0, accrue a **0 µUSDC refund row**, return
   * `{ ok: true }` and write `refundState = 'refunded'` — permanently closing the
   * only refund route the buyer has, in exchange for nothing (docs/AUDIT-MONEY.md
   * M1, verified: paid 10 000, refunded 0, registry kept 10 000, and the
   * arithmetic invariant still held, which is why nothing caught it).
   *
   * So it refuses, and leaves `refundState` alone: the buyer's attempt is not
   * burnt, and the reason names the cause rather than blaming a settlement batch
   * that never touched it. The tracker fee is still not reversible here — that is
   * the documented policy — but "there is nothing to refund" has to be said out
   * loud rather than returned as a refund.
   */
  refundPurchase(p: PurchaseRow): { ok: true; refunded: number } | { ok: false; reason: string } {
    if (p.refundState === "refunded") return { ok: false, reason: "already refunded" };
    const now = this.now();
    if (p.refundDeadline == null || now > p.refundDeadline) {
      return { ok: false, reason: "refund window has closed" };
    }
    if (p.authorRoyaltyPayoutId == null) {
      return { ok: false, reason: "purchase has no royalty payout to void" };
    }
    const run = this.sqlite.transaction(() => {
      const royaltyAmount = this.settlement.amountOf(p.authorRoyaltyPayoutId!) ?? 0;
      if (royaltyAmount <= 0) {
        return {
          ok: false as const,
          reason:
            `this sale's author royalty is ${royaltyAmount} µUSDC — the tracker fee ` +
            `(${this.cfg.trackerFee} µUSDC) covered the whole ${p.paid} µUSDC price, so there is ` +
            "nothing for this route to reverse. The tracker fee is not refundable here; the " +
            "purchase is left refundable so this attempt is not wasted, and an operator can " +
            "return the fee out of band",
        };
      }
      const voided = this.settlement.void(p.authorRoyaltyPayoutId!);
      if (!voided) {
        // Either a settlement batch claimed it, or a concurrent /refund already
        // voided it. Both are correctly refused here — `void()` is conditional on
        // exactly that — and the caller is told which rather than being sent to
        // the batch table for a race that happened in this route.
        const row = this.settlement.payouts().find((r) => r.id === p.authorRoyaltyPayoutId);
        return {
          ok: false as const,
          reason:
            row?.settled_batch_id != null
              ? `royalty already claimed by settlement batch ${row.settled_batch_id}`
              : "royalty was already voided by a concurrent refund",
        };
      }
      const refundAmount = royaltyAmount;
      this.settlement.accrue({
        payee: p.buyer,
        amount: refundAmount,
        reason: "refund",
        ref: String(p.id),
        availableAt: now,
      });
      this.db
        .update(purchase)
        .set({ refundState: "refunded", refundedAt: now })
        .where(eq(purchase.id, p.id))
        .run();
      this.bumpPeer(p.buyer, { refundsReceived: 1 });
      this.bumpRefundIssuer(p.magnet);
      return { ok: true as const, refunded: refundAmount };
    });
    return run.immediate();
  }

  /**
   * Count a reversed sale against the author whose royalty it reversed.
   *
   * `peer.refunds_issued` existed in the schema from the first commit, was served
   * on `GET /state`, and was written by nothing — so it was always 0, and
   * `ledger.test.ts` pinned that 0 as if it meant something (docs/AUDIT-TESTS.md).
   * A column whose value is always the same constant is worse than no column.
   * Keyed on the artifact's `author` string, the same identity `publish` counts,
   * so one participant is one row rather than one per representation.
   */
  private bumpRefundIssuer(magnet: string): void {
    const art = this.getArtifact(magnet);
    if (art) this.bumpPeer(art.author, { refundsIssued: 1 });
  }

  /**
   * Delivery itself failed (stored body no longer matches its hash) — a
   * service defect, not buyer's remorse. Reverses whichever of the two
   * payout rows this purchase accrued can still be voided and refunds
   * exactly that much, since nothing was delivered.
   *
   * Idempotent on `refundState`, and conditional on each `void()`'s own
   * result rather than assuming both succeed — unreachable in a single
   * request today (this only runs inside the request that already ran
   * `onPaid`), but Task E adds replay of failed post-payment work, and this
   * is the one money-writing path here that had no guard at all: a replay
   * used to accrue a second full `refund_due` even when the royalty (or,
   * via a buyer-initiated `/refund` racing in between, both rows) had
   * already been voided.
   *
   * Re-reads the purchase row from the DB inside the transaction rather than
   * trusting `p`'s fields for the guard — a caller (or a replay) holding a
   * snapshot taken before a concurrent `/refund` committed must not decide
   * "not yet refunded" from stale data and double-accrue.
   */
  refundUndelivered(p: Pick<PurchaseRow, "id">): { ok: true; refunded: number } | { ok: false; reason: string } {
    const run = this.sqlite.transaction(() => {
      const current = this.db.select().from(purchase).where(eq(purchase.id, p.id)).get();
      if (!current) return { ok: false as const, reason: "purchase not found" };
      if (current.refundState === "refunded") return { ok: false as const, reason: "already refunded" };

      // Each row's own amount, read before it is voided — never `paid − trackerFee`
      // and `trackerFee` recomputed from today's environment. Nothing was
      // delivered, so the sum of the rows this actually manages to void is
      // exactly what comes back, which for an untouched purchase is `paid` and
      // never more (see splitSale: the two rows sum to `paid` by construction).
      const royaltyAmount =
        current.authorRoyaltyPayoutId != null ? this.settlement.amountOf(current.authorRoyaltyPayoutId) ?? 0 : 0;
      const feeAmount =
        current.trackerFeePayoutId != null ? this.settlement.amountOf(current.trackerFeePayoutId) ?? 0 : 0;
      const royaltyVoided = current.authorRoyaltyPayoutId != null && this.settlement.void(current.authorRoyaltyPayoutId);
      const feeVoided = current.trackerFeePayoutId != null && this.settlement.void(current.trackerFeePayoutId);
      const refundAmount = (royaltyVoided ? royaltyAmount : 0) + (feeVoided ? feeAmount : 0);
      if (refundAmount < current.paid) {
        // A row an epoch already claimed cannot be voided, so a nothing-delivered
        // refund can come up short — usually the tracker fee, which is payable
        // immediately and can be claimed between `onPaid` committing and
        // `store.read` failing (docs/AUDIT-MONEY.md M3: 9 500 of 10 000, and
        // `refundState` is written 'refunded' either way, so it is never retried).
        // The shortfall is a real payout row to the registry rather than invented
        // money, so the ledger still balances — but it must not be silent.
        console.error(
          `refundUndelivered: purchase ${current.id} (tx ${current.txId}) paid ${current.paid} ` +
            `µUSDC and only ${refundAmount} could be reversed — royalty ` +
            `${royaltyVoided ? "voided" : "unavailable"}, fee ` +
            `${feeVoided ? "voided" : "unavailable (already claimed by a settlement batch)"}. ` +
            "The buyer is owed the difference out of band.",
        );
      }
      if (refundAmount > 0) {
        this.settlement.accrue({
          payee: current.buyer,
          amount: refundAmount,
          reason: "refund_due",
          ref: String(current.id),
          availableAt: this.now(),
        });
      }
      this.db
        .update(purchase)
        .set({ refundState: "refunded", refundedAt: this.now() })
        .where(eq(purchase.id, current.id))
        .run();
      this.bumpPeer(current.buyer, { refundsReceived: 1 });
      if (royaltyVoided) this.bumpRefundIssuer(current.magnet);
      return { ok: true as const, refunded: refundAmount };
    });
    return run.immediate();
  }

  // ----------------------------------------------------------------- ratings

  /**
   * Record one buyer's rating of the artifact they bought.
   *
   * Every check that decides whether this rating exists happens **inside** the
   * transaction, over a re-read `purchase` row, for the same reason
   * `refundUndelivered` re-reads: a caller holding a snapshot taken before a
   * concurrent `/refund` committed must not decide "not refunded" from stale data.
   * The route has already proved *who* is calling (a signature over the rating's
   * own content, by the key that controls `purchase.buyer`); this decides whether
   * that purchase may still say anything.
   *
   * ## Nothing here touches money
   *
   * No `payout` row is written, voided or read, no `purchase` column is updated,
   * and the transaction inserts into exactly one table. A rating is an opinion
   * about a sale, not a change to it: `splitSale`'s invariant, both refund paths
   * and the settle lease are untouched by construction, which is why a rating
   * cannot become a way to move value. It is still `.immediate()` — it shares the
   * connection with the money paths, and taking the write lock at BEGIN is what
   * keeps a rating from being the transaction that gets refused with
   * `SQLITE_BUSY_SNAPSHOT` (or, worse, that makes a concurrent `recordPurchase`
   * the one refused).
   *
   * ## A refunded purchase may not rate, and that is a deliberate choice
   *
   * The buyer got their money back inside the window, which is already the
   * strongest statement of dissatisfaction this system can record: it voids the
   * author's royalty, it moves `refundRate`, and `refundRate` is a term in
   * `health`. Letting the same sale *also* register a rating would let one
   * transaction move two independent-looking signals, and since a refunded buyer's
   * rating is realistically only ever negative, the rating counts would inherit the
   * refund's bias while looking like separate evidence. The other half of the same
   * rule lives in `ratingsFor`: a rating written *before* a refund landed is kept
   * as a row (nothing here is ever deleted) and stops being counted. So the rule is
   * one rule — **a refunded purchase's rating does not count** — and it holds
   * whichever order the two requests arrive in.
   */
  recordRating(args: {
    purchaseId: number;
    magnet: string;
    rater: string;
    worth: boolean;
    reason: string | null;
    signature: string;
    raterPublicKey: string;
  }):
    | { ok: true; ratingId: number }
    | { ok: false; code: "not-found" | "magnet-mismatch" | "refunded" | "already-rated"; reason: string } {
    const run = this.sqlite.transaction(() => {
      const current = this.db.select().from(purchase).where(eq(purchase.id, args.purchaseId)).get();
      if (!current) {
        return { ok: false as const, code: "not-found" as const, reason: "purchase not found" };
      }
      if (current.magnet !== args.magnet) {
        return {
          ok: false as const,
          code: "magnet-mismatch" as const,
          reason: "magnet does not match the purchase recorded for this tx",
        };
      }
      if (current.refundState === "refunded") {
        return {
          ok: false as const,
          code: "refunded" as const,
          reason:
            "this purchase was refunded, so it cannot be rated: the refund already records the " +
            "buyer's dissatisfaction, in money, and counting it again as a rating would let one " +
            "sale move two signals",
        };
      }
      const prior = this.db.select().from(rating).where(eq(rating.purchaseId, args.purchaseId)).get();
      if (prior) {
        return {
          ok: false as const,
          code: "already-rated" as const,
          reason:
            `purchase ${args.purchaseId} was already rated (rating ${prior.id}). One purchase buys ` +
            "one rating, and a rating is not editable — buy again to say something new",
        };
      }
      const ins = this.db
        .insert(rating)
        .values({
          purchaseId: args.purchaseId,
          magnet: args.magnet,
          rater: args.rater,
          worth: args.worth ? 1 : 0,
          reason: args.reason,
          ts: this.now(),
          signature: args.signature,
          raterPublicKey: args.raterPublicKey,
        })
        .run();
      return { ok: true as const, ratingId: Number(ins.lastInsertRowid) };
    });
    return run.immediate();
  }

  /** The rating bound to one purchase, if it has been rated. */
  ratingForPurchase(purchaseId: number): RatingRow | null {
    return this.db.select().from(rating).where(eq(rating.purchaseId, purchaseId)).get() ?? null;
  }

  /**
   * One artifact's ratings, from real rows, with the refunded ones discounted.
   *
   * Counted over `rating` joined to its `purchase`, so the refund rule is applied
   * in the read rather than trusted to have been applied in every write: a refund
   * that lands after a rating silently un-counts it, which is what makes
   * "rate, then refund" and "refund, then rate" produce the same numbers.
   *
   * Re-derived per magnet on every read rather than cached, exactly as
   * `refundRate` and `distinctBuyers` are — the counts are always what the rows
   * say, and there is no denormalised total to drift. That is also why there is no
   * stored per-author rating counter on `peer`: a counter incremented at rating
   * time would be wrong the moment a refund discounted the row behind it, and a
   * stored number that disagrees with the rows is worse than no number.
   */
  ratingsFor(magnet: string): ArtifactRatings {
    const rows = this.db
      .select({
        worth: rating.worth,
        reason: rating.reason,
        ts: rating.ts,
        refundState: purchase.refundState,
      })
      .from(rating)
      .innerJoin(purchase, eq(rating.purchaseId, purchase.id))
      .where(eq(rating.magnet, magnet))
      .all();

    let worth = 0;
    let notWorth = 0;
    let discounted = 0;
    const counted: RatingReason[] = [];
    for (const r of rows) {
      if (r.refundState === "refunded") {
        discounted++;
        continue;
      }
      if (r.worth !== 0) worth++;
      else notWorth++;
      if (r.reason != null && r.reason !== "") {
        counted.push({ worth: r.worth !== 0, reason: r.reason, ts: r.ts });
      }
    }
    counted.sort((a, b) => b.ts - a.ts);
    return {
      ...summariseRatings({ worth, notWorth }),
      discounted,
      reasons: counted.slice(0, MAX_REASONS_SERVED),
    };
  }

  // ------------------------------------------------------------------ owe()

  /**
   * Durable record of a settled payment this process failed to otherwise record.
   *
   * Idempotent on `(tx_id, op)` for a non-empty txId, so a buyer retrying the
   * paid request against a ledger that is still refusing writes does not queue
   * the same obligation twice.
   */
  recordOwedFailure(args: { op: string; txId: string; payer: string | null; paid: number; resourceKey: string; reason: string }): boolean {
    try {
      if (args.txId) {
        const prior = this.db
          .select()
          .from(owedFailure)
          .where(and(eq(owedFailure.txId, args.txId), eq(owedFailure.op, args.op)))
          .get();
        if (prior) return true;
      }
      this.db
        .insert(owedFailure)
        .values({
          ts: this.now(),
          op: args.op,
          txId: args.txId,
          payer: args.payer,
          paid: args.paid,
          resourceKey: args.resourceKey,
          reason: args.reason,
        })
        .run();
      return true;
    } catch (e) {
      console.error(`owed_failure INSERT ITSELF FAILED for tx ${args.txId}: ${(e as Error).message}`);
      return false;
    }
  }

  /**
   * Settled payments this registry has not managed to record, newest first.
   *
   * The read `owed_failure` never had. Every HTTP surface omitted the table, so a
   * sale that existed on chain and nowhere in the product was invisible to
   * `/state`, `/payouts`, `/batches`, `/events` and `/health` alike, and the only
   * recovery was opening SQLite by hand (docs/AUDIT-MONEY.md H1). `GET /owed`
   * serves this, behind the operator secret: unlike `/payouts?payee=`, these rows
   * are not derivable from anything public and each one is an open incident.
   */
  owedFailures(filter: { open?: boolean } = {}): OwedFailure[] {
    const rows = filter.open
      ? this.db.select().from(owedFailure).where(isNull(owedFailure.resolvedAt)).orderBy(desc(owedFailure.id)).all()
      : this.db.select().from(owedFailure).orderBy(desc(owedFailure.id)).all();
    return rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      op: r.op,
      txId: r.txId,
      payer: r.payer,
      paid: r.paid,
      resourceKey: r.resourceKey,
      reason: r.reason,
      resolvedAt: r.resolvedAt,
      purchaseId: r.purchaseId,
      replayAttempts: r.replayAttempts,
      lastError: r.lastError,
    }));
  }

  /**
   * Replay every unrecorded settled payment through the ordinary purchase path.
   *
   * This is the half of `owe()` that was missing. Writing a durable row and then
   * never reading it is a dead letter, not a safety net: the buyer had the goods,
   * the author was owed nothing, `POST /refund` returned 404, and nothing in the
   * system would ever change that. `recordPurchase` is idempotent on `txId`, so
   * replaying is safe by construction — a row whose purchase was in fact written
   * (a partially-successful `onPaid`, or a second attempt that won) resolves to
   * the existing purchase and accrues nothing new.
   *
   * Called at the start of every epoch (see `runSettleEpoch`) and on demand from
   * `POST /owed/replay`, so a deferred sale becomes a real royalty before the next
   * batch rather than waiting on a human.
   *
   * A row that *cannot* be replayed is marked, not retried for ever: no payer
   * means no `purchase.buyer`, no transaction id means no idempotency key, and a
   * vanished artifact means no author to pay. Those three need a person, and
   * `lastError` says so.
   */
  replayOwedFailures(): { replayed: number; failed: number; unresolvable: number } {
    const open = this.owedFailures({ open: true });
    let replayed = 0;
    let failed = 0;
    let unresolvable = 0;

    for (const row of open) {
      const fail = (why: string, terminal: boolean) => {
        this.db
          .update(owedFailure)
          .set({ replayAttempts: row.replayAttempts + 1, lastError: why })
          .where(eq(owedFailure.id, row.id))
          .run();
        if (terminal) unresolvable++;
        else failed++;
        console.error(
          `owed_failure ${row.id} (tx ${row.txId || "none"}, ${row.paid} µUSDC) cannot be ` +
            `replayed${terminal ? " and never will be" : ""}: ${why}`,
        );
      };

      if (!row.txId) {
        fail(
          "no transaction id, so a purchase row cannot be de-duplicated against the payment; " +
            "reconcile this against the facilitator by hand",
          true,
        );
        continue;
      }
      if (!row.payer) {
        fail(
          "the settlement identified no payer, so there is no buyer to open a purchase row for",
          true,
        );
        continue;
      }
      const art = this.getArtifact(row.resourceKey);
      if (!art) {
        fail(`artifact ${row.resourceKey} no longer exists, so there is no author to pay`, true);
        continue;
      }

      try {
        const { purchaseId } = this.recordPurchase({
          magnet: row.resourceKey,
          buyer: row.payer,
          txId: row.txId,
          paid: row.paid,
          // The same resolution `onPaid` does, re-derived now rather than stored:
          // an author who has since republished with a new payout account is paid
          // at the account they hold today, which is the only one that can receive.
          payoutAccount: parseHederaAuthor(art.author).payout(),
          refundWindowSeconds: this.refundWindowSeconds,
        });
        this.db
          .update(owedFailure)
          .set({ resolvedAt: this.now(), purchaseId, lastError: null })
          .where(eq(owedFailure.id, row.id))
          .run();
        replayed++;
        console.log(
          `owed_failure ${row.id} replayed: purchase ${purchaseId} for tx ${row.txId} ` +
            `(${row.paid} µUSDC) — the author's royalty is now accrued`,
        );
      } catch (e) {
        fail((e as Error).message, false);
      }
    }
    return { replayed, failed, unresolvable };
  }

  // ------------------------------------------------------------------- peer

  private bumpPeer(
    account: string,
    delta: Partial<{ published: number; purchased: number; refundsReceived: number; refundsIssued: number }>,
  ): void {
    const existing = this.db.select().from(peer).where(eq(peer.account, account)).get();
    if (!existing) {
      this.db
        .insert(peer)
        .values({
          account,
          published: delta.published ?? 0,
          purchased: delta.purchased ?? 0,
          refundsReceived: delta.refundsReceived ?? 0,
          refundsIssued: delta.refundsIssued ?? 0,
        })
        .run();
      return;
    }
    this.db
      .update(peer)
      .set({
        published: existing.published + (delta.published ?? 0),
        purchased: existing.purchased + (delta.purchased ?? 0),
        refundsReceived: existing.refundsReceived + (delta.refundsReceived ?? 0),
        refundsIssued: existing.refundsIssued + (delta.refundsIssued ?? 0),
      })
      .where(eq(peer.account, account))
      .run();
  }

  // -------------------------------------------------------- dashboard reads

  /**
   * The effective refund state of a purchase, on **this server's clock**.
   *
   * `purchase.refund_state` is written `"window"` by `recordPurchase` and nothing
   * ever moves it: no job flips it when the deadline passes, so the stored column
   * alone could not distinguish a reversible sale from a claimable one, and every
   * client re-derived it from `ts + refundWindowSeconds` against a browser clock.
   * A served field whose value is always the same constant is worse than no
   * field, because it looks like an answer.
   *
   * Derived rather than persisted, deliberately. A sweeper flipping
   * `window → none` at each deadline would be a timer, a write path and a new
   * failure mode to buy a value that is a pure function of two columns already in
   * the row — and it would still be wrong for any client that read between the
   * deadline and the sweep. The stored column keeps its job: the durable record of
   * whether a refund *happened*. This is that plus the clock.
   *
   * `"closed"` is additive to the stored vocabulary (`none | window | refunded`);
   * `"none"` is never served, because a purchase always has a deadline.
   */
  effectiveRefundState(
    p: Pick<PurchaseRow, "refundState" | "refundDeadline">,
    nowSeconds = this.now(),
  ): "refunded" | "window" | "closed" {
    if (p.refundState === "refunded") return "refunded";
    if (p.refundDeadline != null && nowSeconds <= p.refundDeadline) return "window";
    return "closed";
  }

  /**
   * Payout rows, with the one derived field a client cannot compute for itself.
   *
   * ## Why this is served, and where the line is
   *
   * Scoped to a `payee`, this is **public**, and that is a decision rather than an
   * oversight. Every input is already public: `GET /state` serves every purchase's
   * `paid` and `buyer`, every free manifest carries `author` (which *is* the payout
   * account under this registry's convention), and `/.well-known/carpool` publishes
   * the tracker fee. One payee's earnings are therefore already computable by
   * anyone with a browser and `splitSale`'s arithmetic — serving them discloses
   * nothing new, and it removes the arithmetic, which is exactly where a client
   * gets it wrong.
   *
   * What it *adds*, and what nothing else can supply, is the **state**:
   * `available_at`, `voided_at`, `settled_batch_id`. A payment rail that cannot
   * tell a payee whether they have been paid is not a payment rail, and the
   * dashboard was reduced to rendering "settled → not observable" where an
   * author's earnings belong.
   *
   * Requiring a signature to read one's own payouts was considered and rejected:
   * it buys no confidentiality (the data is derivable) at the cost of putting a
   * key in a browser. Gating it behind the operator's shared secret would be
   * worse still — it would mean handing a static dashboard the secret that also
   * authorises `POST /settle`.
   *
   * The **unscoped** table is a different object and `server.ts` gates it with the
   * operator secret: it aggregates the registry's own `tracker_fee` take beside
   * every author's position, is not derivable in one request, and no end-user
   * surface needs it. Note also the boundary this does not cross: the HCS anchor
   * commits a Merkle *root* over payout leaves, never the leaves themselves. That
   * commitment stays a commitment.
   */
  payouts(filter: { payee?: string } = {}): Payout[] {
    const now = this.now();
    return this.settlement.payouts(filter).map((r) => ({
      id: r.id,
      payee: r.payee,
      amount: r.amount,
      reason: r.reason,
      /** The `purchase.id` this row was accrued against, as a string. */
      ref: r.ref,
      availableAt: r.available_at,
      voidedAt: r.voided_at,
      settledBatchId: r.settled_batch_id,
      attempts: r.attempts,
      parkedAt: r.parked_at,
      state: payoutState(r, now),
    }));
  }

  /**
   * Settlement batches, newest first. Open: `tx_id` is a public Hedera
   * transaction that anyone can already read on a mirror node, and it is the
   * whole point of batching that a payee can check it.
   */
  batches(): Batch[] {
    return this.settlement.batches().map((b) => ({
      id: b.id,
      txId: b.tx_id,
      status: b.status,
      ts: b.ts,
      root: b.root,
      memo: b.memo,
      reconcileAttempts: b.reconcile_attempts,
    }));
  }

  /**
   * Purchase/refund feed for GET /events. There is no `event` table in v2
   * (docs/RESTRUCTURE.md §4 specifies exactly `artifact`, `purchase`, `peer`
   * for this package) — derived from `purchase` since that is what a live
   * dashboard needs.
   *
   * A refund is emitted as its own event, keyed by `refunded_at` rather than
   * reusing the purchase's `id`/`ts` — a client polling `since = lastTs`
   * would otherwise never see it, since the same row's `ts` never changes.
   *
   * `since`/`ts` are unix **seconds** (matching the rail's `payout`/`batch`
   * tables). `apps/dashboard/lib/api.ts`'s `getEvents(sinceSeconds)` sends
   * seconds too — Task G's rewrite settled the v1→v2 unit mismatch that used
   * to live here (the dashboard previously sent milliseconds); see
   * apps/registry/README.md.
   */
  eventsSince(since: number): { id: number; ts: number; type: "purchase" | "refund"; data: PurchaseEventData }[] {
    const purchased = this.db.select().from(purchase).where(gt(purchase.ts, since)).orderBy(asc(purchase.ts)).all();
    const refunded = this.db
      .select()
      .from(purchase)
      .where(and(isNotNull(purchase.refundedAt), gt(purchase.refundedAt, since)))
      .orderBy(asc(purchase.refundedAt))
      .all();
    const events = [
      ...purchased.map((p) => ({
        id: p.id,
        ts: p.ts,
        type: "purchase" as const,
        data: { magnet: p.magnet, buyer: p.buyer, txId: p.txId, paid: p.paid },
      })),
      ...refunded.map((p) => ({
        id: p.id,
        ts: p.refundedAt!,
        type: "refund" as const,
        data: { magnet: p.magnet, buyer: p.buyer, txId: p.txId, paid: p.paid },
      })),
    ];
    events.sort((a, b) => a.ts - b.ts);
    return events;
  }

  /**
   * Full per-artifact picture for GET /state: the manifest (Info/Files tabs
   * need `sources`, `provenance`, `decay`, `author` — none of which the
   * pre-dashboard shape carried) plus the same freshness/health/priceNow
   * math `listLive` uses, computed here for EVERY artifact (live or not —
   * a dead artifact is a legible state for a torrent-style dashboard, not
   * something to omit). `distinctBuyers`/`refundRate` are re-derived per
   * magnet rather than cached, same as `listLive`.
   */
  state() {
    const artifacts = this.db.select().from(artifact).all();
    const purchases = this.db.select().from(purchase).all();
    const peers = this.db.select().from(peer).all();
    // One query for the whole table rather than one per purchase: `rated` below is
    // only a boolean, and the unique index on `rating.purchase_id` is what makes a
    // set the right shape for it.
    const rated = new Set(this.db.select({ purchaseId: rating.purchaseId }).from(rating).all().map((r) => r.purchaseId));
    const nowMs = Date.now();
    const nowSeconds = this.now();
    return {
      artifacts: artifacts.map((row) => {
        const manifest = rowToManifest(row);
        const f = freshness(manifest, nowMs);
        const distinctBuyers = this.distinctBuyers(row.magnet);
        const refundRate = this.refundRate(row.magnet);
        return {
          manifest,
          live: this.isLive(row, nowMs),
          // priceBase/priceFloor ride along raw, not just the computed
          // priceNow: the dashboard's Trackers tab shows an artifact's
          // pricing inputs directly (see apps/dashboard's TrackersTab).
          // The dashboard does NOT re-run priceAt()/freshness() itself —
          // it deliberately never imports @carpool/core client-side (its
          // export surface drags in better-sqlite3/express, wrong for a
          // browser bundle) and instead renders priceNow/freshness/health
          // exactly as computed here, refreshed on each poll.
          priceBase: row.priceBase,
          priceFloor: row.priceFloor,
          priceNow: priceAt({ priceBase: row.priceBase, priceFloor: row.priceFloor, decay: manifest.decay }, nowMs),
          freshness: f,
          health: health({ freshness: f, refundRate, distinctBuyers }),
          distinctBuyers,
          refundRate,
          // What the buyers said, counted from `rating` rows, refunded ones
          // discounted. Beside `health` and deliberately not inside it — the same
          // object therefore carries a score with its terms shown AND a sample size,
          // and the sample size is the only denominator on offer (there is no ratio
          // field anywhere in here). See @carpool/core's health.ts and ratings.ts.
          // Always set; optional in the type only — see `stateArtifactRatings`.
          ...stateArtifactRatings(this.ratingsFor(row.magnet)),
          // Served, not left to the client: `/search` has always sent `ageDays`
          // computed on this clock, and `/state` is the same table. Two surfaces
          // deriving age against two clocks print ages that contradict the
          // freshness beside them whenever the clocks disagree — see `Listing`.
          ageDays: ageDaysOf(manifest, nowMs),
          // Unix seconds, NULL until this manifest hash has been in a successful
          // HCS anchor. The only trace of anchoring the registry keeps, so it is
          // the only thing a client can say "timestamped at consensus" from.
          anchoredAt: row.anchoredAt,
          // Unix seconds, NULL while on sale. `live` already folds this together
          // with expiry; this distinguishes *withdrawn by its author* from
          // *decayed past usefulness*, which are different facts about an artifact.
          delistedAt: row.delistedAt,
        };
      }),
      purchases: purchases.map((p) => ({
        id: p.id,
        magnet: p.magnet,
        buyer: p.buyer,
        txId: p.txId,
        paid: p.paid,
        ts: p.ts,
        // The EFFECTIVE state, on this server's clock. The stored column DOES
        // move to "refunded" when a refund lands; what it never does is age out
        // of "window" into "closed" on its own, because that is a pure function
        // of `ts + refundWindowSeconds` and a timer that swept it would still be
        // wrong for any read between the deadline and the sweep. See
        // effectiveRefundState.
        refundState: this.effectiveRefundState(p, nowSeconds),
        // Served so a client can render a countdown (and stop recomputing
        // `ts + refundWindowSeconds` itself, which is what every one of them did).
        refundDeadline: p.refundDeadline,
        refundedAt: p.refundedAt,
        // The join key into GET /payouts. Row ids, not money.
        authorRoyaltyPayoutId: p.authorRoyaltyPayoutId,
        trackerFeePayoutId: p.trackerFeePayoutId,
        // Whether this purchase has spent its one rating. On the wire because the
        // constraint is per purchase, so "can I still rate?" is a fact about this
        // row and nothing else — a client that has to POST /rate and read a 409 to
        // find out is a client that rates by trial and error.
        ...statePurchaseRated(rated.has(p.id)),
      })),
      peers,
      // The window every `refundDeadline` above was computed with, so a client
      // never has to hard-code 120 or read it from a second endpoint to render
      // one of these rows.
      refundWindowSeconds: this.refundWindowSeconds,
      summary: {
        artifactCount: artifacts.length,
        purchaseCount: purchases.length,
        gross: purchases.reduce((s, p) => s + p.paid, 0),
        refunded: purchases.filter((p) => p.refundState === "refunded").length,
        // Rating ROWS, across every artifact — including any whose purchase was
        // later refunded and which therefore count towards no artifact's totals.
        // It is the size of the table, not a sum of the per-artifact counts, and
        // it is named for the row rather than for a judgement so it cannot be read
        // as "this many buyers approved".
        ...stateSummaryRatingCount(rated.size),
      },
    };
  }
}
