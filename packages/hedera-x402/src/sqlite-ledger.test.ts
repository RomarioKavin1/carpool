/**
 * `SqliteSettlementLedger`'s read side, in its own package.
 *
 * The rail shipped `accrue`, `void`, `claimBatch`, `markSettled`, `markFailed`
 * and `unsettled` — and no way to *read* a payout row. `unsettled()` is a work
 * queue, not a report: it filters to unclaimed, unvoided, already-available rows,
 * so a product using this ledger could accrue money and never show a payee what
 * they were owed, whether it had been paid, or which batch paid it. Three
 * consequences, all of them real in this repository:
 *
 *   - `apps/dashboard` rendered "settled → not observable" in place of an
 *     author's earnings, because nothing served `settled_batch_id`.
 *   - `apps/registry`'s refund paths recomputed the amount to return as
 *     `paid − trackerFee` from *today's* configured fee instead of reading the
 *     row they were reversing, so a fee changed between purchase and refund
 *     silently changed the refund. `amountOf` is what let that become a read.
 *   - the `batch.tx_id` that makes "your royalty was paid, here is the Hedera
 *     transaction" checkable was in the table and served nowhere.
 */
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { BATCH_DDL } from "./db.js";
import { PAYOUT_DDL, SqliteSettlementLedger } from "./sqlite-ledger.js";

let db: Database.Database;
let ledger: SqliteSettlementLedger;
let clock = 1_800_000_000;

beforeEach(() => {
  clock = 1_800_000_000;
  db = new Database(":memory:");
  db.exec(BATCH_DDL);
  db.exec(PAYOUT_DDL);
  ledger = new SqliteSettlementLedger(db, { now: () => clock });
});

describe("amountOf", () => {
  it("reads the amount a row holds, so a reversal need not recompute it", () => {
    const id = ledger.accrue({ payee: "0.0.1", amount: 49_500, reason: "author_royalty" });
    expect(ledger.amountOf(id)).toBe(49_500);
  });

  it("still reads it after the row is voided — the caller has just voided it and needs its worth", () => {
    const id = ledger.accrue({ payee: "0.0.1", amount: 7_000, reason: "author_royalty" });
    expect(ledger.void(id)).toBe(true);
    expect(ledger.amountOf(id)).toBe(7_000);
  });

  it("still reads it after the row is claimed", () => {
    const id = ledger.accrue({ payee: "0.0.1", amount: 7_000, reason: "tracker_fee" });
    ledger.claimBatch("root", [id]);
    expect(ledger.amountOf(id)).toBe(7_000);
  });

  it("returns null for a row that does not exist, rather than 0 — which would look like a real amount", () => {
    expect(ledger.amountOf(9_999)).toBeNull();
  });
});

describe("payouts", () => {
  it("returns every row with the three state columns `unsettled()` filters away", () => {
    const held = ledger.accrue({
      payee: "0.0.1",
      amount: 9_500,
      reason: "author_royalty",
      ref: "7",
      availableAt: clock + 120,
    });
    const fee = ledger.accrue({ payee: "0.0.9", amount: 500, reason: "tracker_fee", ref: "7" });

    // The work queue sees one of these; a report must see both.
    expect(ledger.unsettled().map((r) => r.id)).toEqual([fee]);

    const rows = ledger.payouts();
    expect(rows.map((r) => r.id).sort()).toEqual([held, fee].sort());
    const heldRow = rows.find((r) => r.id === held)!;
    expect(heldRow).toEqual({
      id: held,
      payee: "0.0.1",
      amount: 9_500,
      reason: "author_royalty",
      ref: "7",
      available_at: clock + 120,
      voided_at: null,
      settled_batch_id: null,
      // A fresh row has failed nothing and is not parked. Both are served
      // because "owed but no longer being retried" is otherwise invisible.
      attempts: 0,
      parked_at: null,
    });
  });

  it("scopes to one payee and excludes every other", () => {
    ledger.accrue({ payee: "0.0.1", amount: 100, reason: "author_royalty" });
    ledger.accrue({ payee: "0.0.2", amount: 200, reason: "author_royalty" });
    ledger.accrue({ payee: "0.0.1", amount: 300, reason: "refund" });

    const mine = ledger.payouts({ payee: "0.0.1" });
    expect(mine).toHaveLength(2);
    expect(mine.every((r) => r.payee === "0.0.1")).toBe(true);
    expect(ledger.payouts({ payee: "0.0.404" })).toEqual([]);
  });

  it("surfaces the claim and the void, which is the whole reason it exists", () => {
    const settled = ledger.accrue({ payee: "0.0.1", amount: 100, reason: "tracker_fee" });
    const voided = ledger.accrue({ payee: "0.0.1", amount: 200, reason: "author_royalty" });
    const claim = ledger.claimBatch("root", [settled]);
    expect(ledger.void(voided)).toBe(true);

    const rows = ledger.payouts({ payee: "0.0.1" });
    expect(rows.find((r) => r.id === settled)!.settled_batch_id).toBe(claim.id);
    expect(rows.find((r) => r.id === voided)!.voided_at).toBe(clock);
    // A voided row is reported, not dropped: omitting it would make a refunded
    // sale indistinguishable from a sale that never happened.
    expect(rows.find((r) => r.id === voided)).toBeDefined();
  });

  it("orders newest first, so a payee sees their latest position at the top", () => {
    const a = ledger.accrue({ payee: "0.0.1", amount: 1, reason: "author_royalty" });
    const b = ledger.accrue({ payee: "0.0.1", amount: 2, reason: "author_royalty" });
    expect(ledger.payouts({ payee: "0.0.1" }).map((r) => r.id)).toEqual([b, a]);
  });
});

describe("batches", () => {
  it("returns a claimed batch before its transaction id is known, and after", () => {
    const id = ledger.accrue({ payee: "0.0.1", amount: 1_000, reason: "tracker_fee" });
    const claim = ledger.claimBatch("deadbeefcafe", [id]);

    let rows = ledger.batches();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: claim.id,
      tx_id: null, // submitted-but-unrecorded is exactly what reconcile() looks for
      status: "pending",
      ts: clock,
      root: "deadbeefcafe",
      memo: claim.memo,
      reconcile_attempts: 0,
    });

    expect(ledger.markSettled(claim.id, "0.0.9@1.0", "SUCCESS")).toBe(true);
    rows = ledger.batches();
    expect(rows[0]!.tx_id).toBe("0.0.9@1.0");
    expect(rows[0]!.status).toBe("SUCCESS");
  });

  it("reports a failed batch as FAILED:<result>, so no reader needs Hedera's status names", () => {
    const id = ledger.accrue({ payee: "0.0.1", amount: 1_000, reason: "tracker_fee" });
    const claim = ledger.claimBatch("root", [id]);
    expect(ledger.markFailed(claim.id, "0.0.9@2.0", "TOKEN_NOT_ASSOCIATED_TO_ACCOUNT")).toEqual([id]);

    expect(ledger.batches()[0]!.status).toBe("FAILED:TOKEN_NOT_ASSOCIATED_TO_ACCOUNT");
    // …and the row it claimed is owed again.
    expect(ledger.payouts()[0]!.settled_batch_id).toBeNull();
  });

  it("orders newest first", () => {
    const a = ledger.claimBatch("root-a", []);
    const b = ledger.claimBatch("root-b", []);
    expect(ledger.batches().map((r) => r.id)).toEqual([b.id, a.id]);
  });

  it("is empty on a fresh ledger rather than throwing", () => {
    expect(ledger.batches()).toEqual([]);
    expect(ledger.payouts()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The recovery surface the audit found missing: an attempt counter, a park, an
// operator-visible state for an unclassifiable result, a conditional
// markSettled that keeps what it refuses, and a lease with cross-process teeth.
// ---------------------------------------------------------------------------

describe("attempts, parking and unparking (M5)", () => {
  it("counts a failure per released row and parks it at maxAttempts", () => {
    const l = new SqliteSettlementLedger(db, { now: () => clock, maxAttempts: 3 });
    const id = l.accrue({ payee: "0.0.dead", amount: 8_500, reason: "author_royalty" });

    for (let attempt = 1; attempt <= 2; attempt++) {
      const b = l.claimBatch("root", [id]);
      expect(l.markFailed(b.id, `0.0.9@${attempt}.0`, "ACCOUNT_DELETED")).toEqual([id]);
      expect(l.payouts()[0]!.attempts).toBe(attempt);
      expect(l.unsettled().map((r) => r.id), "still owed, still retried").toEqual([id]);
    }

    // The third failure is the last one this payee gets for free.
    const last = l.claimBatch("root", [id]);
    expect(l.markFailed(last.id, "0.0.9@3.0", "ACCOUNT_DELETED"), "parked, not released").toEqual(
      [],
    );
    const row = l.payouts()[0]!;
    expect(row.attempts).toBe(3);
    expect(row.parked_at).toBe(clock);
    expect(row.settled_batch_id, "still owed to somebody — not settled, not voided").toBeNull();
    expect(row.voided_at).toBeNull();

    // And it is out of the retry loop: no further epoch builds a transfer for it.
    expect(l.unsettled()).toEqual([]);
    expect(l.claimBatch("root", [id]).claimed, "a parked row is not claimable").toEqual([]);
    expect(l.parked().map((r) => r.id)).toEqual([id]);
  });

  it("unpark returns it to the queue with attempts reset, and only a parked row", () => {
    const l = new SqliteSettlementLedger(db, { now: () => clock, maxAttempts: 1 });
    const id = l.accrue({ payee: "0.0.dead", amount: 8_500, reason: "author_royalty" });
    const b = l.claimBatch("root", [id]);
    expect(l.markFailed(b.id, "0.0.9@1.0", "NO_REMAINING_AUTOMATIC_ASSOCIATIONS")).toEqual([]);
    expect(l.parked()).toHaveLength(1);

    expect(l.unpark(id)).toBe(true);
    expect(l.unsettled().map((r) => r.id)).toEqual([id]);
    expect(l.payouts()[0]!.attempts, "a human looked; this is not another blind retry").toBe(0);
    expect(l.unpark(id), "not parked any more").toBe(false);
    expect(l.unpark(9_999)).toBe(false);
  });

  it("a voided row is never unparked back into the payable set", () => {
    const l = new SqliteSettlementLedger(db, { now: () => clock, maxAttempts: 1 });
    const id = l.accrue({ payee: "0.0.dead", amount: 8_500, reason: "author_royalty" });
    const b = l.claimBatch("root", [id]);
    l.markFailed(b.id, "", "ACCOUNT_DELETED");
    expect(l.void(id), "parked rows are still refundable").toBe(true);
    expect(l.unpark(id)).toBe(false);
    expect(l.unsettled()).toEqual([]);
  });
});

describe("markSettled is conditional and keeps what it refuses (M6)", () => {
  it("refuses to overwrite a FAILED batch, and records the observation", () => {
    const id = ledger.accrue({ payee: "0.0.1", amount: 8_500, reason: "author_royalty" });
    const b1 = ledger.claimBatch("rootone", [id]);
    expect(ledger.markFailed(b1.id, "0.0.1@1.1", "INSUFFICIENT_TOKEN_BALANCE")).toEqual([id]);

    expect(ledger.markSettled(b1.id, "0.0.1@3.3", "SUCCESS"), "refused").toBe(false);
    expect(
      ledger.batches()[0]!.status,
      "the release is still on the record — it is the only evidence it happened",
    ).toBe("FAILED:INSUFFICIENT_TOKEN_BALANCE");
    expect(ledger.batches()[0]!.tx_id).toBe("0.0.1@1.1");

    // Refused, not discarded: a real transaction id must not vanish to keep a
    // status intact, because that transaction may have paid.
    const [conflict] = ledger.conflicts();
    expect(conflict).toMatchObject({
      batch_id: b1.id,
      observed_tx_id: "0.0.1@3.3",
      observed_status: "SUCCESS",
      had_status: "FAILED:INSUFFICIENT_TOKEN_BALANCE",
      had_tx_id: "0.0.1@1.1",
    });
  });

  it("still settles a pending batch, and a NEEDS_OPERATOR one a mirror record later confirms", () => {
    const a = ledger.accrue({ payee: "0.0.1", amount: 1_000, reason: "tracker_fee" });
    const b = ledger.claimBatch("root", [a]);
    expect(ledger.markSettled(b.id, "0.0.9@1.0", "SUCCESS")).toBe(true);

    const c = ledger.accrue({ payee: "0.0.2", amount: 1_000, reason: "tracker_fee" });
    const d = ledger.claimBatch("root", [c]);
    expect(ledger.markNeedsOperator(d.id, "0.0.9@2.0", "WEIRD_CODE", "test")).toBe(true);
    expect(ledger.markSettled(d.id, "0.0.9@2.0", "SUCCESS")).toBe(true);
    expect(ledger.conflicts(), "neither of those was a conflict").toEqual([]);
  });
});

describe("NEEDS_OPERATOR and the ways out of it (H2)", () => {
  it("marks the batch, keeps the rows claimed, and lists it for an operator", () => {
    const id = ledger.accrue({ payee: "0.0.1", amount: 8_500, reason: "author_royalty" });
    const b = ledger.claimBatch("root", [id]);
    expect(ledger.markNeedsOperator(b.id, "0.0.9@1.0", "SOME_FUTURE_STATUS", "why")).toBe(true);

    expect(ledger.batches()[0]!.status).toBe("NEEDS_OPERATOR:SOME_FUTURE_STATUS");
    expect(ledger.batches()[0]!.tx_id, "the id an operator needs to look it up").toBe("0.0.9@1.0");
    expect(ledger.needsOperator().map((r) => r.id)).toEqual([b.id]);
    expect(ledger.pending(), "no longer a reconcile candidate: the result is recorded").toEqual([]);
    expect(ledger.unsettled(), "and releasing it is nobody's guess to make").toEqual([]);
  });

  it("operatorRelease hands the rows back, once, and only for a NEEDS_OPERATOR batch", () => {
    const id = ledger.accrue({ payee: "0.0.1", amount: 8_500, reason: "author_royalty" });
    const b = ledger.claimBatch("root", [id]);
    expect(ledger.operatorRelease(b.id).ok, "a pending batch may still be in the air").toBe(false);

    ledger.markNeedsOperator(b.id, "0.0.9@1.0", "SOME_FUTURE_STATUS", "why");
    const released = ledger.operatorRelease(b.id);
    expect(released).toEqual({ ok: true, released: [id] });
    expect(ledger.unsettled().map((r) => r.id)).toEqual([id]);
    expect(ledger.batches()[0]!.status).toBe(
      "RELEASED_BY_OPERATOR:NEEDS_OPERATOR:SOME_FUTURE_STATUS",
    );
    expect(ledger.operatorRelease(b.id).ok, "not twice").toBe(false);
    expect(ledger.operatorRelease(9_999).ok).toBe(false);
  });

  it("operatorMarkPaid records the transfer an operator found, and demands a txId", () => {
    const id = ledger.accrue({ payee: "0.0.1", amount: 8_500, reason: "author_royalty" });
    const b = ledger.claimBatch("root", [id]);
    ledger.markNeedsOperator(b.id, "", "SOME_FUTURE_STATUS", "why");
    expect(ledger.operatorMarkPaid(b.id, "").ok, "no fabricated transaction ids").toBe(false);
    expect(ledger.operatorMarkPaid(b.id, "0.0.9@7.7")).toEqual({ ok: true });
    expect(ledger.batches()[0]).toMatchObject({
      status: "SETTLED_BY_OPERATOR",
      tx_id: "0.0.9@7.7",
    });
    expect(ledger.unsettled(), "paid rows stay claimed").toEqual([]);
  });

  it("operatorRecheck puts it back in front of reconcile with a clean count", () => {
    const id = ledger.accrue({ payee: "0.0.1", amount: 8_500, reason: "author_royalty" });
    const b = ledger.claimBatch("root", [id]);
    expect(ledger.bumpReconcileAttempt(b.id)).toBe(1);
    expect(ledger.bumpReconcileAttempt(b.id)).toBe(2);
    ledger.markNeedsOperator(b.id, "0.0.9@1.0", "UNCONFIRMED", "why");

    expect(ledger.operatorRecheck(b.id)).toEqual({ ok: true });
    expect(ledger.pending().map((p) => p.id)).toEqual([b.id]);
    expect(ledger.batches()[0]).toMatchObject({ tx_id: null, status: "pending", reconcile_attempts: 0 });
    expect(ledger.operatorRecheck(b.id).ok, "already pending").toBe(false);
  });
});

describe("the settlement lease (H4)", () => {
  it("is exclusive: a second token cannot take it while it is live", () => {
    expect(ledger.acquireLease("a", 60)).toBe(true);
    expect(ledger.acquireLease("b", 60), "two settlers must not both run").toBe(false);
    expect(ledger.acquireLease("a", 60), "not even the same op twice — tokens are per run").toBe(
      false,
    );
    expect(ledger.lease()).toMatchObject({ token: "a", expiresAt: clock + 60 });

    ledger.releaseLease("b");
    expect(ledger.lease()?.token, "releasing is conditional on holding it").toBe("a");
    ledger.releaseLease("a");
    expect(ledger.lease()).toBeNull();
    expect(ledger.acquireLease("b", 60)).toBe(true);
  });

  it("an expired lease is stealable, so a crashed process cannot stop settlement forever", () => {
    expect(ledger.acquireLease("crashed", 30)).toBe(true);
    clock += 29;
    expect(ledger.acquireLease("next", 30), "still live").toBe(false);
    clock += 2;
    expect(ledger.acquireLease("next", 30)).toBe(true);
    expect(ledger.lease()?.token).toBe("next");
  });
});

describe("schema migration for a database created before these columns existed", () => {
  /** The exact DDL this package shipped first, as a pre-existing ledger.sqlite has it. */
  const OLD_DDL = `
    CREATE TABLE IF NOT EXISTS batch (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tx_id TEXT, status TEXT NOT NULL, ts INTEGER NOT NULL,
      root TEXT NOT NULL, memo TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payout (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payee TEXT NOT NULL,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      ref TEXT,
      available_at INTEGER NOT NULL DEFAULT 0,
      voided_at INTEGER,
      settled_batch_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_payout_claimable
      ON payout(available_at) WHERE settled_batch_id IS NULL AND voided_at IS NULL;
  `;

  it("adds the columns without touching the rows already in there", () => {
    const old = new Database(":memory:");
    old.exec(OLD_DDL);
    // Money that predates the migration.
    old.prepare(
      `INSERT INTO payout (payee, amount, reason, ref, available_at) VALUES ('0.0.7',8500,'author_royalty','1',0)`,
    ).run();
    old.prepare(
      `INSERT INTO batch (tx_id, status, ts, root, memo) VALUES ('0.0.9@1.0','SUCCESS',1,'r','m')`,
    ).run();

    // PAYOUT_DDL/BATCH_DDL are CREATE TABLE IF NOT EXISTS, so applying them to an
    // existing database is a no-op — the constructor is what has to migrate.
    old.exec(BATCH_DDL);
    old.exec(PAYOUT_DDL);
    const migrated = new SqliteSettlementLedger(old, { now: () => clock });

    const row = migrated.payouts()[0]!;
    expect(row).toMatchObject({ payee: "0.0.7", amount: 8_500, attempts: 0, parked_at: null });
    expect(migrated.batches()[0]).toMatchObject({ tx_id: "0.0.9@1.0", reconcile_attempts: 0 });
    expect(migrated.unsettled().map((r) => r.id)).toEqual([row.id]);

    // Every new write path works against the migrated shape.
    const b = migrated.claimBatch("root", [row.id]);
    expect(migrated.markFailed(b.id, "0.0.9@2.0", "ACCOUNT_DELETED")).toEqual([row.id]);
    expect(migrated.payouts()[0]!.attempts).toBe(1);
    expect(migrated.acquireLease("t", 60)).toBe(true);
    expect(migrated.conflicts()).toEqual([]);

    // And it is idempotent: constructing again over the same file changes nothing.
    const again = new SqliteSettlementLedger(old, { now: () => clock });
    expect(again.payouts()[0]!.attempts).toBe(1);
    old.close();
  });
});
