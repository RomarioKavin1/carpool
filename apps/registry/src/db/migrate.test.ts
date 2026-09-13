/**
 * An existing `ledger.sqlite` meeting the `rating` table for the first time.
 *
 * The discipline this follows is `SqliteSettlementLedger`'s, and its test
 * (`packages/hedera-x402/src/sqlite-ledger.test.ts`, "schema migration for a
 * database created before these columns existed"): build the OLD schema, put real
 * rows in it — money included — open it through the current code, and assert that
 * nothing was lost and every new path works against the migrated file.
 *
 * The interesting difference, and the reason this file says it rather than
 * assuming it: `rating` is a new **table**, not a new column, and `openDb` execs
 * the whole of `DDL` on **every** open rather than only at creation
 * (`packages/hedera-x402/src/db.ts`). So `CREATE TABLE IF NOT EXISTS rating` and
 * its two indexes reach a database that predates them without an `ALTER TABLE`,
 * and `schema.ts`'s `MIGRATIONS` list is deliberately untouched — that list exists
 * for columns added to tables that already exist, which is the one thing
 * `IF NOT EXISTS` cannot do. A `rating` entry in it would be an `ALTER TABLE`
 * against a table SQLite had just created.
 *
 * What could go wrong and therefore has to be checked: the DDL is one `exec` of
 * many statements, so a malformed addition takes the *whole* schema with it and
 * every table in an existing file becomes unreachable. That is what "the rows
 * survive" below is really testing.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb } from "./index.js";

/**
 * The registry's schema exactly as it shipped before ratings existed: four product
 * tables plus the rail's two, and no `rating` anywhere. Trimmed to the columns the
 * assertions below touch, since the point is the *absence* of `rating` rather than
 * a byte-for-byte copy of an old file.
 */
const OLD_DDL = `
CREATE TABLE IF NOT EXISTS batch (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_id TEXT, status TEXT NOT NULL, ts INTEGER NOT NULL,
  root TEXT NOT NULL, memo TEXT NOT NULL,
  reconcile_attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS payout (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payee TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT,
  available_at INTEGER NOT NULL DEFAULT 0,
  voided_at INTEGER,
  settled_batch_id INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  parked_at INTEGER
);
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_txid ON purchase(tx_id) WHERE tx_id <> '';
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
`;

const MAGNET = `swarm:${"a".repeat(64)}`;
let dir: string;
let path: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "carpool-migrate-"));
  path = join(dir, "ledger.sqlite");

  const old = new Database(path);
  old.exec(OLD_DDL);
  // An artifact, a sale, the two payout rows that sale accrued, and a peer row:
  // everything a deployed registry would have, including money.
  old.prepare(
    `INSERT INTO artifact (magnet, question, question_norm, abstract, sources_json, provenance_json,
       author, author_sig, manifest_hash, body_hash, body_bytes, body_uri, price_base, price_floor,
       half_life_days, produced_at)
     VALUES (?, 'pre-migration question', 'pre-migration question', 'abstract', '[]', '{}',
       '0.0.1111:aa', 'sig', ?, 'bh', 10, 'file://x', 30000, 3000, 30, 1789200000000)`,
  ).run(MAGNET, "a".repeat(64));
  old.prepare(
    `INSERT INTO purchase (magnet, buyer, tx_id, paid, ts, refund_state, refund_deadline,
       author_royalty_payout_id, tracker_fee_payout_id)
     VALUES (?, '0.0.2222', '0.0.2222@pre-migration', 33000, 1789200000, 'window', 1789200120, 1, 2)`,
  ).run(MAGNET);
  old.prepare(
    `INSERT INTO payout (payee, amount, reason, ref, available_at)
     VALUES ('0.0.1111', 32500, 'author_royalty', '1', 1789200120)`,
  ).run();
  old.prepare(
    `INSERT INTO payout (payee, amount, reason, ref, available_at)
     VALUES ('0.0.9999', 500, 'tracker_fee', '1', 1789200000)`,
  ).run();
  old.prepare(`INSERT INTO peer (account, purchased) VALUES ('0.0.2222', 1)`).run();
  old.close();
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("opening a pre-rating database", () => {
  it("adds the rating table and its constraint without losing a row or a µUSDC", () => {
    const { sqlite } = openDb(path);

    // The money first: two payout rows, the same amounts, still summing to `paid`.
    const payouts = sqlite.prepare(`SELECT payee, amount, reason FROM payout ORDER BY id`).all() as {
      payee: string;
      amount: number;
      reason: string;
    }[];
    expect(payouts).toEqual([
      { payee: "0.0.1111", amount: 32_500, reason: "author_royalty" },
      { payee: "0.0.9999", amount: 500, reason: "tracker_fee" },
    ]);
    const purchase = sqlite.prepare(`SELECT * FROM purchase`).get() as Record<string, unknown>;
    expect(purchase).toMatchObject({
      tx_id: "0.0.2222@pre-migration",
      paid: 33_000,
      refund_state: "window",
      author_royalty_payout_id: 1,
      tracker_fee_payout_id: 2,
    });
    expect(payouts[0]!.amount + payouts[1]!.amount).toBe(33_000);
    // purchase.payout_via (ENS authors) arrives by ALTER TABLE, NULL on every
    // pre-existing sale: those were all Hedera authors.
    expect(purchase).toHaveProperty("payout_via", null);

    // Then everything else that was in there.
    expect(sqlite.prepare(`SELECT magnet FROM artifact`).pluck().all()).toEqual([MAGNET]);
    expect(sqlite.prepare(`SELECT account FROM peer`).pluck().all()).toEqual(["0.0.2222"]);

    // And the new table exists, empty, with its unique index in place.
    expect(sqlite.prepare(`SELECT count(*) FROM rating`).pluck().get()).toBe(0);
    const indexes = (sqlite.pragma(`index_list(rating)`) as { name: string; unique: number }[]).map((i) => ({
      name: i.name,
      unique: i.unique,
    }));
    expect(indexes).toEqual(
      expect.arrayContaining([{ name: "idx_rating_purchase", unique: 1 }, { name: "idx_rating_magnet", unique: 0 }]),
    );
    sqlite.close();
  });

  it("lets the pre-existing purchase be rated, once", () => {
    const { sqlite } = openDb(path);
    const insert = sqlite.prepare(
      `INSERT INTO rating (purchase_id, magnet, rater, worth, reason, ts, signature, rater_public_key)
       VALUES (1, ?, '0.0.2222', 1, 'worth it', 1789200060, 'sig', 'pk')`,
    );
    insert.run(MAGNET);
    expect(sqlite.prepare(`SELECT worth FROM rating WHERE purchase_id = 1`).pluck().get()).toBe(1);
    // The constraint came with the table, on the migrated file too.
    expect(() => insert.run(MAGNET)).toThrow(/UNIQUE constraint failed: rating\.purchase_id/);
    sqlite.close();
  });

  it("is idempotent: opening again changes nothing", () => {
    const { sqlite } = openDb(path);
    expect(sqlite.prepare(`SELECT count(*) FROM rating`).pluck().get()).toBe(1);
    expect(sqlite.prepare(`SELECT count(*) FROM payout`).pluck().get()).toBe(2);
    expect(sqlite.prepare(`SELECT amount FROM payout WHERE id = 1`).pluck().get()).toBe(32_500);
    sqlite.close();
  });
});
