import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { BATCH_DDL, PAYOUT_DDL } from "@carpool/hedera-x402";

// Timestamps are unix seconds (matching the rail's `payout`/`batch` tables,
// whose `available_at`/`ts` are seconds — see SqliteSettlementLedger). Money
// is integer µUSDC everywhere.

export const artifact = sqliteTable("artifact", {
  magnet: text("magnet").primaryKey(), // swarm:<sha256 hex of the manifest, minus magnet>
  question: text("question").notNull(),
  questionNorm: text("question_norm").notNull(),
  scope: text("scope"),
  abstract: text("abstract").notNull(),
  sourcesJson: text("sources_json").notNull(),
  provenanceJson: text("provenance_json").notNull(),
  author: text("author").notNull(), // opaque; see src/identity.ts for this registry's convention
  authorSig: text("author_sig").notNull(),
  manifestHash: text("manifest_hash").notNull(),
  bodyHash: text("body_hash").notNull(),
  bodyBytes: integer("body_bytes").notNull(),
  bodyUri: text("body_uri").notNull(),
  priceBase: integer("price_base").notNull(), // µUSDC
  priceFloor: integer("price_floor").notNull(),
  halfLifeDays: real("half_life_days").notNull(),
  producedAt: integer("produced_at").notNull(), // unix ms (Date.parse of decay.producedAt)
  redacted: integer("redacted").notNull().default(0),
  delistedAt: integer("delisted_at"),
  // Unix seconds. NULL until this artifact's manifest_hash has been included
  // in a successful HCS anchor (Task E). Not `produced_at` (that is content —
  // the author's claimed research date, unaffected by a republish) and not an
  // insertion timestamp: using "never anchored" as the epoch cursor rather
  // than a time window is what makes anchoring crash-safe — a restart just
  // re-asks "what has no anchor yet", so nothing is anchored twice and a
  // crash between settling and anchoring can never lose an artifact.
  anchoredAt: integer("anchored_at"),
});

export const purchase = sqliteTable("purchase", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  magnet: text("magnet").notNull(),
  buyer: text("buyer").notNull(),
  txId: text("tx_id").notNull(),
  paid: integer("paid").notNull(),
  ts: integer("ts").notNull(), // unix seconds
  refundState: text("refund_state").notNull().default("none"), // none | window | refunded
  refundDeadline: integer("refund_deadline"),
  // Set when refundState becomes 'refunded'. Distinct from `ts` so GET
  // /events can emit a refund as its own event — a client polling
  // `since = lastTs` would never see a refund that only touched `ts`, since
  // this row's `ts` never changes.
  refundedAt: integer("refunded_at"),
  // ids into the rail's `payout` table, so a refund can void exactly the rows
  // this purchase accrued without a fragile reason/ref string match.
  authorRoyaltyPayoutId: integer("author_royalty_payout_id"),
  trackerFeePayoutId: integer("tracker_fee_payout_id"),
});

/**
 * One buyer's judgement of one artifact, bound to the purchase that paid for it.
 *
 * ## `purchase_id`, not `(buyer, magnet)` — the uniqueness constraint is the
 * anti-ballot-stuffing property
 *
 * Each purchase cost real money at the price the decay curve was charging at that
 * moment, so "one rating per purchase" prices a rating at the cost of an artifact
 * and makes stuffing a ballot box the same expense as buying the thing a second
 * time. Keying on `(buyer, magnet)` would have been *weaker in both directions*:
 * it would silently discard the second opinion of a buyer who legitimately bought
 * the same artifact twice (two purchases, two experiences, two prices), and it
 * would let one purchase's receipt be reused after a re-key. So the unique index
 * below is on `purchase_id` alone, and it is the constraint rather than a policy
 * note in a route handler: `UNIQUE` in SQLite refuses the second insert even if a
 * future caller forgets to look first.
 *
 * ## What is stored, and why the signature is kept
 *
 * `signature` and `rater_public_key` are the buyer's own signature over the
 * rating's content (see `POST /rate`) and the key it verifies under. They are
 * stored rather than checked and discarded for the same reason `artifact.author_sig`
 * is: a count the registry cannot show its working for is a count the registry is
 * asking to be believed. With these columns, every rating row can be re-verified
 * against the message it claims to be, by anyone with a copy of the database — the
 * registry cannot manufacture a rating without forging a signature.
 *
 * `rater` duplicates `purchase.buyer` and `magnet` duplicates `purchase.magnet`,
 * copied at write time. Both are denormalised deliberately: the aggregation on
 * every read route filters by magnet, and the copy means a rating row states who
 * made it without a join, in the same way `payout.payee` states who is owed
 * without one.
 *
 * ## `worth` is 0 or 1, and there is no score column
 *
 * See `@carpool/core`'s `ratings.ts` for the argument against a graded scale. The
 * column is an integer because SQLite has no boolean, not because a 3 might ever
 * be written into it.
 */
export const rating = sqliteTable("rating", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** The purchase this rating is bound to. UNIQUE — one purchase, one rating. */
  purchaseId: integer("purchase_id").notNull(),
  magnet: text("magnet").notNull(),
  /** `purchase.buyer` — a Hedera account id, copied at write time. */
  rater: text("rater").notNull(),
  /** 1 = "worth what I paid", 0 = "not worth what I paid". Never a 2. */
  worth: integer("worth").notNull(),
  /** Optional, capped at `MAX_RATING_REASON_CHARS`, stored exactly as signed. */
  reason: text("reason"),
  ts: integer("ts").notNull(), // unix seconds
  /** The buyer's signature over the rating message, hex — kept as evidence. */
  signature: text("signature").notNull(),
  raterPublicKey: text("rater_public_key").notNull(),
});

export const peer = sqliteTable("peer", {
  account: text("account").primaryKey(),
  published: integer("published").notNull().default(0),
  purchased: integer("purchased").notNull().default(0),
  refundsReceived: integer("refunds_received").notNull().default(0),
  refundsIssued: integer("refunds_issued").notNull().default(0),
});

/**
 * Money that moved but could not be recorded — the durable side of the gate's
 * `owe()` hook, and the queue that turns it back into a purchase.
 *
 * It used to be a dead letter: written by `owe()`, read by nothing, exposed by no
 * route, with a comment saying a replay loop *may* grow one day. So a settled
 * payment whose `onPaid` threw left the buyer with the goods, the author with no
 * royalty, `POST /refund` with a 404, and recovery meaning "open ledger.sqlite by
 * hand" (docs/AUDIT-MONEY.md H1). The three columns below are what make it a
 * queue instead: `RegistryLedger.replayOwedFailures` retries each unresolved row
 * through the ordinary idempotent `recordPurchase`, `GET /owed` serves them, and
 * `POST /owed/replay` runs it on demand.
 *
 * `resolved_at` is the only state that matters; `attempts` and `last_error` exist
 * so a row that cannot be replayed (no payer, no transaction id, a vanished
 * artifact) says *why* rather than being retried silently for ever.
 */
export const owedFailure = sqliteTable("owed_failure", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ts: integer("ts").notNull(),
  op: text("op").notNull(),
  txId: text("tx_id").notNull(),
  payer: text("payer"),
  paid: integer("paid").notNull(),
  resourceKey: text("resource_key").notNull(),
  reason: text("reason").notNull(),
  /** Unix seconds. NULL while the payment is still unrecorded. */
  resolvedAt: integer("resolved_at"),
  /** The `purchase.id` a successful replay opened (or found already open). */
  purchaseId: integer("purchase_id"),
  replayAttempts: integer("replay_attempts").notNull().default(0),
  lastError: text("last_error"),
});

export const DDL = `
${BATCH_DDL}
${PAYOUT_DDL}

CREATE TABLE IF NOT EXISTS artifact (
  magnet          TEXT PRIMARY KEY,
  question        TEXT NOT NULL,
  question_norm   TEXT NOT NULL,
  scope           TEXT,
  abstract        TEXT NOT NULL,
  sources_json    TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  author          TEXT NOT NULL,
  author_sig      TEXT NOT NULL,
  manifest_hash   TEXT NOT NULL,
  body_hash       TEXT NOT NULL,
  body_bytes      INTEGER NOT NULL,
  body_uri        TEXT NOT NULL,
  price_base      INTEGER NOT NULL,
  price_floor     INTEGER NOT NULL,
  half_life_days  REAL NOT NULL,
  produced_at     INTEGER NOT NULL,
  redacted        INTEGER NOT NULL DEFAULT 0,
  delisted_at     INTEGER,
  anchored_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_artifact_question ON artifact(question_norm);
CREATE INDEX IF NOT EXISTS idx_artifact_scope    ON artifact(scope);

CREATE TABLE IF NOT EXISTS purchase (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  magnet TEXT NOT NULL, buyer TEXT NOT NULL,
  tx_id TEXT NOT NULL, paid INTEGER NOT NULL, ts INTEGER NOT NULL,
  refund_state TEXT NOT NULL DEFAULT 'none',
  refund_deadline INTEGER,
  refunded_at INTEGER,
  author_royalty_payout_id INTEGER,
  tracker_fee_payout_id INTEGER
);
-- One settled payment opens at most one purchase row, and tx_id is the key that
-- makes onPaid idempotent, /refund findable and a replay safe. An empty tx_id
-- escapes this partial index, and three recordPurchase calls with '' produced
-- three purchases and six payout rows for one payment (docs/AUDIT-MONEY.md M2).
-- The index is therefore not the guard: recordPurchase refuses an empty tx_id
-- outright, and PaymentGate never calls onPaid without one. The partial
-- predicate stays only because a NOT NULL column with no natural empty value
-- cannot be indexed unconditionally on an existing database without a rewrite.
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_txid ON purchase(tx_id) WHERE tx_id <> '';
CREATE INDEX IF NOT EXISTS idx_purchase_magnet ON purchase(magnet);

CREATE TABLE IF NOT EXISTS rating (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL,
  magnet TEXT NOT NULL,
  rater TEXT NOT NULL,
  worth INTEGER NOT NULL,
  reason TEXT,
  ts INTEGER NOT NULL,
  signature TEXT NOT NULL,
  rater_public_key TEXT NOT NULL
);
-- THE anti-ballot-stuffing constraint, and it is a constraint rather than a
-- check in a route handler. One purchase buys one rating; a buyer who bought the
-- same artifact twice has two purchases and therefore two ratings, which is
-- correct — they had two experiences and paid for both. Note what is NOT unique
-- here: (rater, magnet). See the rating table comment above.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rating_purchase ON rating(purchase_id);
-- Every read route aggregates by magnet (GET /search, /manifest/:magnet, /state).
CREATE INDEX IF NOT EXISTS idx_rating_magnet ON rating(magnet);

CREATE TABLE IF NOT EXISTS peer (
  account TEXT PRIMARY KEY,
  published INTEGER NOT NULL DEFAULT 0,
  purchased INTEGER NOT NULL DEFAULT 0,
  refunds_received INTEGER NOT NULL DEFAULT 0,
  refunds_issued INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS owed_failure (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  op TEXT NOT NULL,
  tx_id TEXT NOT NULL,
  payer TEXT,
  paid INTEGER NOT NULL,
  resource_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  resolved_at INTEGER,
  purchase_id INTEGER,
  replay_attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_owed_failure_open ON owed_failure(id) WHERE resolved_at IS NULL;
`;

/**
 * Columns added to tables this app's DDL already created, as `ALTER TABLE`.
 *
 * `DDL` is every-statement `IF NOT EXISTS`, which is right for creating a fresh
 * database and does nothing at all for one that already exists — so a column
 * added to `owed_failure` after the first release would be missing on every
 * deployed registry and every statement touching it would throw. Applied by
 * `migrate()` below, which runs inside `openDb`; the rail migrates its own
 * `payout`/`batch` columns the same way in `SqliteSettlementLedger`.
 *
 * **A new *table* does not belong in this list, and `rating` is why that needs
 * saying.** `openDb` execs the whole of `DDL` on every open, not only when the
 * file is created (`packages/hedera-x402/src/db.ts`), so a `CREATE TABLE IF NOT
 * EXISTS` added here reaches an existing `ledger.sqlite` the next time the
 * registry starts, and so do its `CREATE ... INDEX IF NOT EXISTS` lines. What
 * `IF NOT EXISTS` cannot do is add a *column* to a table that already exists —
 * that is this list's whole job, and adding `rating` to it would be an `ALTER
 * TABLE` against a table SQLite had just created, which fails. The property that
 * actually matters is proved rather than argued: `migrate.test.ts` builds the
 * pre-rating schema, puts an artifact, a purchase and a payout row in it, opens it
 * through `openDb`, and asserts every row survived and that a rating can then be
 * written against the pre-existing purchase.
 */
const MIGRATIONS: { table: string; column: string; decl: string }[] = [
  { table: "owed_failure", column: "resolved_at", decl: "INTEGER" },
  { table: "owed_failure", column: "purchase_id", decl: "INTEGER" },
  { table: "owed_failure", column: "replay_attempts", decl: "INTEGER NOT NULL DEFAULT 0" },
  { table: "owed_failure", column: "last_error", decl: "TEXT" },
];

/**
 * Add any missing column to an existing database. Idempotent, and safe to run
 * against a fresh one (where `DDL` has already created every column).
 */
export function migrate(sqlite: {
  pragma(s: string): unknown;
  exec(s: string): unknown;
}): string[] {
  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    let existing: string[];
    try {
      existing = (sqlite.pragma(`table_info(${m.table})`) as { name: string }[]).map((c) => c.name);
    } catch {
      continue; // no such table: nothing to migrate
    }
    if (existing.length === 0 || existing.includes(m.column)) continue;
    try {
      sqlite.exec(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.decl}`);
      applied.push(`${m.table}.${m.column}`);
    } catch (e) {
      // Another process migrating the same file concurrently is the expected
      // way this loses; anything else is a real problem.
      if (!/duplicate column name/i.test((e as Error).message)) throw e;
    }
  }
  return applied;
}

export const schema = { artifact, purchase, rating, peer, owedFailure };
