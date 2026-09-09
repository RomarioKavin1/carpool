import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { BATCH_DDL } from "./db.js";
import {
  classifyLedgerResult,
  classifyPrecheckResult,
  createSettler,
  defaultSubmit,
  groupAndChunk,
  DUST,
  MAX_PAYEES,
  RECONCILE_ATTEMPTS_BEFORE_OPERATOR,
  type SettlerDeps,
} from "./settler.js";
import { PAYOUT_DDL, SqliteSettlementLedger } from "./sqlite-ledger.js";
import type { TransferTransaction } from "@hiero-ledger/sdk";

let clock = 1_000_000;
function newLedger() {
  const db = new Database(":memory:");
  db.exec(BATCH_DDL);
  db.exec(PAYOUT_DDL);
  return new SqliteSettlementLedger(db, { now: () => clock });
}

beforeEach(() => {
  clock = 1_000_000;
});

describe("groupAndChunk", () => {
  it("sums by payee and carries sub-dust forward", () => {
    const { chunks, dropped } = groupAndChunk([
      { id: 1, payee: "a", amount: 400 },
      { id: 2, payee: "a", amount: 400 },
      { id: 3, payee: "b", amount: 100 },
    ]);
    expect(chunks.flat().find((c) => c[0] === "a")?.[1]).toBe(800);
    expect(dropped.map((d) => d[0])).toEqual(["b"]);
  });

  it("chunks at MAX_PAYEES so a transfer list never exceeds the limit", () => {
    const rows = Array.from({ length: MAX_PAYEES * 2 + 1 }, (_, i) => ({
      id: i,
      payee: `p${i}`,
      amount: DUST,
    }));
    const { chunks } = groupAndChunk(rows);
    expect(chunks.length).toBe(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(MAX_PAYEES);
  });
});

// Ported from apps/settlement/src/ledger.test.ts — the only coverage of
// conditional claiming, which is what stops two concurrent settlement runs
// paying the same payee twice.
describe("conditional claim (defect C)", () => {
  it("only claims rows that were still unclaimed", () => {
    const l = newLedger();
    const ids = [
      l.accrue({ payee: "a", amount: 5000, reason: "royalty" }),
      l.accrue({ payee: "b", amount: 7000, reason: "royalty" }),
    ];
    expect(l.unsettled()).toHaveLength(2);

    const first = l.claimBatch("root-a", ids);
    const second = l.claimBatch("root-b", ids);

    expect(first.claimed).toEqual(ids);
    expect(second.claimed).toEqual([]);
    expect(l.unsettled()).toHaveLength(0);
  });

  it("sum totals only the ids asked for", () => {
    const l = newLedger();
    const a = l.accrue({ payee: "a", amount: 5000, reason: "r" });
    l.accrue({ payee: "b", amount: 7000, reason: "r" });
    expect(l.sum([a])).toBe(5000);
    expect(l.sum([])).toBe(0);
  });

  it("memo carries the batch id and root prefix", () => {
    const l = newLedger();
    const id = l.accrue({ payee: "a", amount: 5000, reason: "r" });
    const b = l.claimBatch("abcdef0123456789", [id]);
    expect(b.memo).toBe(`carpool:batch:${b.id}:abcdef01`);
  });

  it("pending lists unsettled batches and markSettled clears them", () => {
    const l = newLedger();
    const id = l.accrue({ payee: "a", amount: 5000, reason: "r" });
    const b = l.claimBatch("root", [id]);
    expect(l.pending().map((p) => p.id)).toEqual([b.id]);
    l.markSettled(b.id, "0.0.1@2.3", "SUCCESS");
    expect(l.pending()).toEqual([]);
  });
});

describe("refund hold-back (available_at)", () => {
  it("does not pay a royalty while the buyer's refund window is open", () => {
    const l = newLedger();
    l.accrue({ payee: "author", amount: 8500, reason: "author_royalty", availableAt: clock + 120 });
    expect(l.unsettled(), "held back until the window closes").toHaveLength(0);

    clock += 121;
    expect(l.unsettled()).toHaveLength(1);
  });

  it("a void inside the window removes the royalty permanently", () => {
    const l = newLedger();
    const id = l.accrue({
      payee: "author",
      amount: 8500,
      reason: "author_royalty",
      availableAt: clock + 120,
    });
    expect(l.void(id)).toBe(true);
    clock += 1000;
    expect(l.unsettled(), "a voided royalty never becomes payable").toHaveLength(0);
  });

  it("cannot void a royalty the settler already claimed", () => {
    const l = newLedger();
    const id = l.accrue({ payee: "author", amount: 8500, reason: "author_royalty" });
    l.claimBatch("root", [id]);
    expect(l.void(id), "claimed rows are already being paid").toBe(false);
  });

  it("cannot claim a royalty that was already voided", () => {
    const l = newLedger();
    const id = l.accrue({ payee: "author", amount: 8500, reason: "author_royalty" });
    expect(l.void(id)).toBe(true);
    expect(l.claimBatch("root", [id]).claimed).toEqual([]);
  });

  it("a tracker fee is payable immediately — it is not refundable", () => {
    const l = newLedger();
    l.accrue({ payee: "tracker", amount: 500, reason: "tracker_fee" });
    expect(l.unsettled()).toHaveLength(1);
  });
});

// --- I1: a consensus-reached failure must not be recorded as payment -------
//
// A mirror-node record proves consensus, not payment. A transfer that reached
// consensus and then failed (INSUFFICIENT_TOKEN_BALANCE,
// TOKEN_NOT_ASSOCIATED_TO_ACCOUNT) is recorded exactly like one that paid, so
// marking a batch settled on any match takes the money and pays nobody, with
// the payouts never retried and no error anywhere.

type MirrorTx = { memo_base64: string; transaction_id: string; result?: string | null };

/**
 * A transaction id **as the mirror node writes it**: `0.0.10475802-1789204986-055709931`,
 * not the SDK's `0.0.10475802@1789204986.055709931`.
 *
 * The two notations are the same transaction and this repo stores both in the same
 * column: `settle()` records `TransactionResponse.transactionId.toString()` (the
 * `@` form) while `reconcile()` records `transaction_id` straight off the mirror
 * node (this form). Verified against real captured responses —
 * `docs/evidence/v2-full-feature-run/14-chunk-settlement-mirror.json` has
 * `"transaction_id": "0.0.10475802-1789204986-055709931"` for the batch whose
 * `GET /batches` row in `13-settle-two-chunks.json` reads
 * `"0.0.10475802@1789204986.055709931"`.
 *
 * Every mirror record in this file used to carry the `@` form, which the real
 * mirror node never returns, so nothing here could see that a reconciled batch's
 * `tx_id` comes out in a different notation from a settled one. It is a real wart
 * and it is now asserted rather than hidden — see "the notation reconcile stores"
 * below, and docs/AUDIT-MOCKS.md.
 */
function mirrorTxId(sdkForm: string): string {
  const [account, stamp] = sdkForm.split("@");
  if (stamp === undefined) return sdkForm;
  // The account keeps its dots; only the `@` and the seconds/nanos separator move.
  return `${account}-${stamp.replace(".", "-")}`;
}

/**
 * Stub the mirror-node page `reconcile()` reads.
 *
 * Replaces `globalThis.fetch` wholesale for the duration, so it answers *every*
 * request made inside the `try`, not just the mirror node's — always restore it in
 * a `finally`, and never wrap anything that talks to a second server.
 *
 * What it does not cover: paging. The real endpoint returns at most 100
 * transactions and a `links.next`, and `reconcileHeld` deliberately does not
 * follow it — a batch whose record has scrolled off the page is reported as
 * `UNCONFIRMED` rather than as failed. That is the branch
 * "no mirror-node record carries this batch's memo" below, driven by an empty
 * page rather than by a genuinely overflowing one.
 */
function stubMirror(txs: MirrorTx[] | Error) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    if (txs instanceof Error) throw txs;
    return { json: async () => ({ transactions: txs }) } as Response;
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function mirrorRecord(memo: string, result: string | null, txId = "0.0.9@111.222"): MirrorTx {
  return {
    memo_base64: Buffer.from(memo, "utf8").toString("base64"),
    // Serialised the way the real mirror node does — see `mirrorTxId`.
    transaction_id: mirrorTxId(txId),
    result,
  };
}

const PAYER = "0.0.1001";
const TOKEN = "0.0.429274";

function settlerFor(
  ledger: SqliteSettlementLedger,
  submit?: SettlerDeps["submit"],
): ReturnType<typeof createSettler> {
  return createSettler({
    ledger,
    client: {} as never,
    token: TOKEN,
    payer: PAYER,
    mirrorUrl: "http://mirror.test",
    submit,
  });
}

/** Accrue two payouts and claim them into one pending batch, as settle() would. */
function pendingBatch(l: SqliteSettlementLedger) {
  const ids = [
    l.accrue({ payee: "0.0.2001", amount: 8500, reason: "author_royalty" }),
    l.accrue({ payee: "0.0.2002", amount: 1500, reason: "tracker_fee" }),
  ];
  const b = l.claimBatch("deadbeefcafe", ids);
  expect(b.claimed).toEqual(ids);
  expect(l.unsettled(), "claimed rows are not claimable").toHaveLength(0);
  return { ids, batch: b };
}

function batchRow(l: SqliteSettlementLedger, id: number) {
  return (l as unknown as { db: import("better-sqlite3").Database })
    .db.prepare(`SELECT id, tx_id, status FROM batch WHERE id = ?`)
    .get(id) as { id: number; tx_id: string | null; status: string };
}

describe("classifyLedgerResult", () => {
  it("only SUCCESS-family results count as payment", () => {
    expect(classifyLedgerResult("SUCCESS")).toBe("success");
    expect(classifyLedgerResult("SUCCESS_BUT_MISSING_EXPECTED_OPERATION")).toBe("success");
  });

  it("recognised consensus failures are failures", () => {
    expect(classifyLedgerResult("INSUFFICIENT_TOKEN_BALANCE")).toBe("failed");
    expect(classifyLedgerResult("TOKEN_NOT_ASSOCIATED_TO_ACCOUNT")).toBe("failed");
    expect(classifyLedgerResult("TRANSACTION_EXPIRED")).toBe("failed");
  });

  it("an absent or unrecognised result is unknown, never a failure", () => {
    expect(classifyLedgerResult(null)).toBe("unknown");
    expect(classifyLedgerResult(undefined)).toBe("unknown");
    expect(classifyLedgerResult("")).toBe("unknown");
    expect(classifyLedgerResult("SOME_FUTURE_STATUS")).toBe("unknown");
    // Its winning sibling may sit outside the mirror page we fetched, so
    // releasing on it could pay a batch twice.
    expect(classifyLedgerResult("DUPLICATE_TRANSACTION")).toBe("unknown");
  });
});

/**
 * KNOWN WART, stated rather than hidden: `batch.tx_id` holds two notations.
 *
 * `settle()` writes the SDK's `TransactionResponse.transactionId.toString()`,
 * which is `0.0.10475802@1789204986.055709931`. `reconcile()` writes
 * `transaction_id` straight off the mirror node, which is
 * `0.0.10475802-1789204986-055709931` for the same transaction. Nothing
 * normalises between them, so which notation a row carries depends on whether the
 * batch was confirmed by its own submit or by a later reconcile pass — and a
 * consumer building a HashScan link, or comparing two ids for equality, has to
 * handle both.
 *
 * This was invisible for as long as the stub returned the `@` form the real mirror
 * node never returns. Both formats are real captured values
 * (`docs/evidence/v2-full-feature-run/14-chunk-settlement-mirror.json` against
 * `13-settle-two-chunks.json`). Not fixed here: normalising would change what is
 * recorded on a money path, which is a product decision and not an audit's to make
 * unilaterally. It is logged in docs/AUDIT-MOCKS.md as an open item.
 */
describe("the notation reconcile stores", () => {
  it("records the mirror node's dashed transaction id, not the SDK's @ form", async () => {
    const l = newLedger();
    const { batch } = pendingBatch(l);
    const restore = stubMirror([mirrorRecord(batch.memo, "SUCCESS", "0.0.10475802@1789204986.055709931")]);
    try {
      await settlerFor(l).reconcile();
    } finally {
      restore();
    }
    const stored = batchRow(l, batch.id).tx_id;
    expect(stored).toBe("0.0.10475802-1789204986-055709931");
    expect(stored, "the two notations are NOT interchangeable as strings").not.toBe(
      "0.0.10475802@1789204986.055709931",
    );
    // And the same batch settled through `settle()` instead would have carried the
    // other one — see "reconcile cannot run while a settle is mid-submit" below.
  });
});

describe("reconcile: mirror-node result decides (defect I1)", () => {
  it("a consensus-reached FAILURE leaves the payouts owed and the batch unsettled", async () => {
    const l = newLedger();
    const { ids, batch } = pendingBatch(l);
    const restore = stubMirror([mirrorRecord(batch.memo, "INSUFFICIENT_TOKEN_BALANCE")]);
    try {
      await settlerFor(l).reconcile();
    } finally {
      restore();
    }

    const row = batchRow(l, batch.id);
    expect(row.status, "a failed transfer is not a settled batch").not.toBe(
      "INSUFFICIENT_TOKEN_BALANCE",
    );
    expect(row.status).toBe("FAILED:INSUFFICIENT_TOKEN_BALANCE");
    expect(
      l.unsettled().map((r) => r.id).sort(),
      "the money never left, so every payout is still owed",
    ).toEqual([...ids].sort());
    expect(l.sum(ids), "amounts are unchanged").toBe(10_000);
  });

  it("TOKEN_NOT_ASSOCIATED_TO_ACCOUNT is retried by the next settle()", async () => {
    const l = newLedger();
    const { ids, batch } = pendingBatch(l);
    const restore = stubMirror([mirrorRecord(batch.memo, "TOKEN_NOT_ASSOCIATED_TO_ACCOUNT")]);
    try {
      await settlerFor(l).reconcile();
    } finally {
      restore();
    }

    // The retry path is the ordinary settle() loop: released rows are claimable
    // again, so they are picked up and paid without operator intervention.
    //
    // One batch per payee, not one batch for both: a row released by a failure
    // carries `attempts > 0`, and `groupAndChunk` isolates such a payee into a
    // transfer of its own. Re-forming the identical chunk is what let one
    // un-payable account keep the others in it unpaid forever (M5).
    const settled = await settlerFor(l, async () => ({
      txId: "0.0.9@333.444",
      status: "SUCCESS",
    })).settle();
    expect(settled).toHaveLength(2);
    expect(
      settled.reduce((s, b) => s + b.total, 0),
      "both stranded payouts were retried",
    ).toBe(10_000);
    expect(settled.map((b) => b.payees)).toEqual([1, 1]);
    expect(l.unsettled()).toHaveLength(0);
    expect(l.sum(ids)).toBe(10_000);
    expect(batchRow(l, batch.id).status).toBe("FAILED:TOKEN_NOT_ASSOCIATED_TO_ACCOUNT");
  });

  it("SUCCESS settles the batch and keeps the rows claimed", async () => {
    const l = newLedger();
    const { batch } = pendingBatch(l);
    const restore = stubMirror([mirrorRecord(batch.memo, "SUCCESS", "0.0.9@777.888")]);
    try {
      await settlerFor(l).reconcile();
    } finally {
      restore();
    }
    expect(batchRow(l, batch.id)).toMatchObject({ tx_id: mirrorTxId("0.0.9@777.888"), status: "SUCCESS" });
    expect(l.unsettled(), "paid rows must never be handed back").toHaveLength(0);
    expect(l.pending()).toEqual([]);
  });

  it("an unrecognised result settles nothing and releases nothing", async () => {
    const l = newLedger();
    const { batch } = pendingBatch(l);
    const restore = stubMirror([mirrorRecord(batch.memo, "SOME_FUTURE_STATUS")]);
    try {
      await settlerFor(l).reconcile();
    } finally {
      restore();
    }
    // "we do not know what happened" is not "it failed": settling would strand
    // the payees, releasing could pay them twice. The batch stays pending.
    expect(batchRow(l, batch.id)).toMatchObject({ tx_id: null, status: "pending" });
    expect(l.pending().map((p) => p.id)).toEqual([batch.id]);
    expect(l.unsettled()).toHaveLength(0);
  });

  it("a missing result is not treated as a confirmation", async () => {
    const l = newLedger();
    const { batch } = pendingBatch(l);
    const restore = stubMirror([mirrorRecord(batch.memo, null)]);
    try {
      await settlerFor(l).reconcile();
    } finally {
      restore();
    }
    expect(batchRow(l, batch.id).status, "no fabricated RECONCILED status").toBe("pending");
    expect(l.pending().map((p) => p.id)).toEqual([batch.id]);
  });

  it("prefers a SUCCESS sibling over a DUPLICATE_TRANSACTION record with the same memo", async () => {
    const l = newLedger();
    const { batch } = pendingBatch(l);
    const restore = stubMirror([
      mirrorRecord(batch.memo, "DUPLICATE_TRANSACTION", "0.0.9@1.1"),
      mirrorRecord(batch.memo, "SUCCESS", "0.0.9@2.2"),
    ]);
    try {
      await settlerFor(l).reconcile();
    } finally {
      restore();
    }
    expect(batchRow(l, batch.id)).toMatchObject({ tx_id: mirrorTxId("0.0.9@2.2"), status: "SUCCESS" });
    expect(l.unsettled()).toHaveLength(0);
  });

  it("a DUPLICATE_TRANSACTION alone is not enough to release the payouts", async () => {
    const l = newLedger();
    const { batch } = pendingBatch(l);
    const restore = stubMirror([mirrorRecord(batch.memo, "DUPLICATE_TRANSACTION")]);
    try {
      await settlerFor(l).reconcile();
    } finally {
      restore();
    }
    // The winning sibling may be outside the 100-record page; releasing here
    // would pay a batch that already paid.
    expect(batchRow(l, batch.id).status).toBe("pending");
    expect(l.unsettled()).toHaveLength(0);
  });

  it("no matching record leaves the batch pending", async () => {
    const l = newLedger();
    const { batch } = pendingBatch(l);
    const restore = stubMirror([mirrorRecord("carpool:batch:999:someoneelse", "SUCCESS")]);
    try {
      await settlerFor(l).reconcile();
    } finally {
      restore();
    }
    expect(batchRow(l, batch.id)).toMatchObject({ tx_id: null, status: "pending" });
    expect(l.unsettled()).toHaveLength(0);
  });

  it("an unreachable mirror node changes nothing", async () => {
    const l = newLedger();
    const { batch } = pendingBatch(l);
    const restore = stubMirror(new Error("ECONNREFUSED"));
    try {
      await settlerFor(l).reconcile();
    } finally {
      restore();
    }
    expect(batchRow(l, batch.id)).toMatchObject({ tx_id: null, status: "pending" });
    expect(l.unsettled()).toHaveLength(0);
  });
});

describe("settle: the submit outcome decides", () => {
  it("does not report a failed transfer as a settled batch", async () => {
    const l = newLedger();
    const ids = [
      l.accrue({ payee: "0.0.2001", amount: 8500, reason: "author_royalty" }),
      l.accrue({ payee: "0.0.2002", amount: 1500, reason: "tracker_fee" }),
    ];
    const out = await settlerFor(l, async () => ({
      txId: "0.0.9@5.5",
      status: "INSUFFICIENT_TOKEN_BALANCE",
    })).settle();

    expect(out, "nothing was paid, so nothing is reported paid").toEqual([]);
    expect(l.unsettled().map((r) => r.id).sort()).toEqual([...ids].sort());
  });

  it("a consensus-reached receipt failure is classified, not thrown away", async () => {
    const l = newLedger();
    l.accrue({ payee: "0.0.2001", amount: 9000, reason: "author_royalty" });
    // What the SDK does on a failed receipt: reject with an error carrying the
    // consensus status. v1 let this escape run(), leaving the batch pending for
    // reconcile to mis-settle.
    const out = await settlerFor(l, async () => {
      throw Object.assign(new Error("receipt for transaction failed"), {
        status: { toString: () => "TOKEN_NOT_ASSOCIATED_TO_ACCOUNT" },
      });
    }).settle();
    // The injected submit throws directly (it is not defaultSubmit), so the
    // ambiguous path is taken: nothing settled, nothing released — and the throw
    // is contained to its own chunk rather than rejecting out of the epoch (H3).
    expect(out).toEqual([]);
    expect(l.pending(), "the batch is left for reconcile").toHaveLength(1);
    expect(l.unsettled(), "rows stay claimed while the outcome is unknown").toHaveLength(0);
  });

  it("an unrecognised submit status becomes an operator's problem, not a silent strand", async () => {
    const l = newLedger();
    l.accrue({ payee: "0.0.2001", amount: 9000, reason: "author_royalty" });
    const out = await settlerFor(l, async () => ({
      txId: "0.0.9@6.6",
      status: "SOME_FUTURE_STATUS",
    })).settle();
    expect(out).toEqual([]);
    // Neither settled nor released, exactly as before — but now *stated*. The
    // ledger answered with a code this build cannot classify, so a reconcile
    // pass would read the same code and reach the same verdict; leaving it
    // "pending for an operator" named a role the system gave no tools to (H2).
    expect(batchRow(l, 1).status).toBe("NEEDS_OPERATOR:SOME_FUTURE_STATUS");
    expect(batchRow(l, 1).tx_id, "the id an operator looks up").toBe("0.0.9@6.6");
    expect(l.needsOperator().map((b) => b.id)).toEqual([1]);
    expect(l.pending()).toHaveLength(0);
    expect(l.unsettled()).toHaveLength(0);
  });

  it("a submit that returns no result at all is left pending for reconcile", async () => {
    const l = newLedger();
    l.accrue({ payee: "0.0.2001", amount: 9000, reason: "author_royalty" });
    // Distinct from the case above: there is no result code to classify, so we
    // genuinely do not know whether it reached consensus and the mirror node is
    // the only thing that can tell us.
    expect(await settlerFor(l, async () => ({ txId: "", status: "" })).settle()).toEqual([]);
    expect(batchRow(l, 1)).toMatchObject({ tx_id: null, status: "pending" });
    expect(l.pending()).toHaveLength(1);
  });

  it("SUCCESS settles and keeps the rows claimed", async () => {
    const l = newLedger();
    l.accrue({ payee: "0.0.2001", amount: 9000, reason: "author_royalty" });
    const out = await settlerFor(l, async () => ({ txId: "0.0.9@7.7", status: "SUCCESS" })).settle();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ txId: "0.0.9@7.7", payees: 1, total: 9000 });
    expect(l.unsettled()).toHaveLength(0);
    expect(l.pending()).toEqual([]);
  });
});

describe("markFailed is conditional (cost if wrong)", () => {
  it("will not release the rows of a batch already recorded as paid", () => {
    const l = newLedger();
    const { ids, batch } = pendingBatch(l);
    l.markSettled(batch.id, "0.0.9@8.8", "SUCCESS");

    expect(
      l.markFailed(batch.id, "0.0.9@8.8", "INSUFFICIENT_TOKEN_BALANCE"),
      "releasing a paid batch would pay every payee in it twice",
    ).toEqual([]);
    expect(l.unsettled()).toHaveLength(0);
    expect(batchRow(l, batch.id).status).toBe("SUCCESS");
    expect(l.sum(ids)).toBe(10_000);
  });

  it("is idempotent — a second call releases nothing", () => {
    const l = newLedger();
    const { ids, batch } = pendingBatch(l);
    expect(l.markFailed(batch.id, "0.0.9@9.9", "TRANSACTION_EXPIRED").sort()).toEqual(
      [...ids].sort(),
    );
    expect(l.markFailed(batch.id, "0.0.9@9.9", "TRANSACTION_EXPIRED")).toEqual([]);
    expect(l.unsettled()).toHaveLength(2);
  });

  it("does not resurrect a payout that was voided against the batch", () => {
    const l = newLedger();
    const { batch } = pendingBatch(l);
    // A refund voiding a claimed row is normally refused; force the row into the
    // voided-and-claimed state to prove markFailed still will not hand it back.
    (l as unknown as { db: import("better-sqlite3").Database }).db
      .prepare(`UPDATE payout SET voided_at = 1 WHERE settled_batch_id = ? AND reason = ?`)
      .run(batch.id, "author_royalty");

    const released = l.markFailed(batch.id, "0.0.9@10.10", "TOKEN_WAS_DELETED");
    expect(released).toHaveLength(1);
    expect(
      l.unsettled().map((r) => r.amount),
      "only the tracker fee comes back; the voided royalty stays gone",
    ).toEqual([1500]);
  });

  it("held-back royalties released by a failure stay held back", () => {
    const l = newLedger();
    const id = l.accrue({
      payee: "0.0.2001",
      amount: 8500,
      reason: "author_royalty",
      availableAt: clock - 1,
    });
    const b = l.claimBatch("root", [id]);
    expect(l.markFailed(b.id, "0.0.9@11.11", "INSUFFICIENT_TOKEN_BALANCE")).toEqual([id]);
    expect(l.unsettled(), "available_at already passed, so it is claimable again").toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// H3: one chunk's failure must not cost the epoch its other chunks, and a
// precheck rejection is a *known* outcome rather than an ambiguous one.
// ---------------------------------------------------------------------------

describe("per-chunk isolation (defect H3)", () => {
  it("a throwing submit leaves its own batch pending and still attempts the rest", async () => {
    const l = newLedger();
    // 10 payees -> two chunks (MAX_PAYEES = 9).
    for (let i = 0; i < 10; i++) l.accrue({ payee: `0.0.${3000 + i}`, amount: 1_000, reason: "r" });

    let calls = 0;
    const out = await settlerFor(l, async () => {
      calls++;
      if (calls === 1) throw new Error("connection reset while waiting for the receipt");
      return { txId: "0.0.9@2.2", status: "SUCCESS" };
    }).settle();

    expect(calls, "the second chunk was attempted").toBe(2);
    expect(out, "and paid").toHaveLength(1);
    expect(out[0]!.payees).toBe(1);
    // Chunk 1 is pending with a NULL tx_id — which is precisely what reconcile()
    // selects on — and its rows stay claimed, because releasing a transfer that
    // may have landed pays every payee in it twice.
    expect(l.pending()).toHaveLength(1);
    expect(l.unsettled()).toHaveLength(0);
  });

  it("classifyPrecheckResult treats any precheck code but DUPLICATE_TRANSACTION as value-neutral", () => {
    // A precheck rejection means the node never submitted the transfer for
    // consensus, so nothing moved — a stronger statement than a receipt status,
    // and it holds for codes this build has never heard of.
    expect(classifyPrecheckResult("INSUFFICIENT_PAYER_BALANCE")).toBe("failed");
    expect(classifyPrecheckResult("SOME_FUTURE_PRECHECK_CODE")).toBe("failed");
    expect(classifyPrecheckResult("TRANSACTION_EXPIRED")).toBe("failed");
    // Except this one: the submission that got there first may have paid.
    expect(classifyPrecheckResult("DUPLICATE_TRANSACTION")).toBe("unknown");
    expect(classifyPrecheckResult("")).toBe("unknown");
    expect(classifyPrecheckResult(null)).toBe("unknown");
    // A receipt status is still judged by the allow-list, not by this.
    expect(classifyLedgerResult("SOME_FUTURE_PRECHECK_CODE")).toBe("unknown");
  });

  it("defaultSubmit turns a PrecheckStatusError into a failure, so the rows come back", async () => {
    // What `tx.execute(client)` rejects with when a node refuses the transaction
    // before consensus. `defaultSubmit` never inspected this, so it propagated
    // out of the whole epoch — and the batch it left behind could never be
    // reconciled, because the mirror node holds no record for a transaction that
    // was never submitted (H3).
    const precheck = Object.assign(new Error("transaction failed precheck"), {
      name: "PrecheckStatusError",
      nodeId: "0.0.3",
      status: { toString: () => "INSUFFICIENT_PAYER_BALANCE" },
    });
    const tx = { execute: async () => Promise.reject(precheck) } as unknown as TransferTransaction;
    await expect(defaultSubmit(tx, {} as never)).resolves.toEqual({
      txId: "", // there is no transaction id for a transfer that was not submitted
      status: "INSUFFICIENT_PAYER_BALANCE",
    });

    // A code this build has never seen is still value-neutral at precheck.
    const unknownCode = Object.assign(new Error("nope"), {
      name: "PrecheckStatusError",
      nodeId: "0.0.3",
      status: { toString: () => "SOME_FUTURE_PRECHECK_CODE" },
    });
    await expect(
      defaultSubmit({ execute: async () => Promise.reject(unknownCode) } as never, {} as never),
    ).resolves.toEqual({ txId: "", status: "SOME_FUTURE_PRECHECK_CODE" });

    // DUPLICATE_TRANSACTION at precheck is not: a sibling submission may have
    // paid, so this stays a throw and the batch stays pending.
    const dup = Object.assign(new Error("dup"), {
      name: "PrecheckStatusError",
      nodeId: "0.0.3",
      status: { toString: () => "DUPLICATE_TRANSACTION" },
    });
    await expect(
      defaultSubmit({ execute: async () => Promise.reject(dup) } as never, {} as never),
    ).rejects.toThrow(/dup/);

    // And an ordinary transport error carries no status, so it stays ambiguous.
    await expect(
      defaultSubmit({ execute: async () => Promise.reject(new Error("ECONNRESET")) } as never, {} as never),
    ).rejects.toThrow(/ECONNRESET/);
  });

  it("defaultSubmit still classifies a consensus-reached receipt failure, and rethrows an unknown one", async () => {
    const receiptError = (code: string) =>
      Object.assign(new Error("receipt for transaction failed"), {
        name: "ReceiptStatusError",
        transactionReceipt: {},
        status: { toString: () => code },
      });
    const txFor = (code: string | null) =>
      ({
        execute: async () => ({
          transactionId: { toString: () => "0.0.9@1.1" },
          getReceipt: async () => {
            if (code) throw receiptError(code);
            return { status: { toString: () => "SUCCESS" } };
          },
        }),
      }) as never;

    await expect(defaultSubmit(txFor(null), {} as never)).resolves.toEqual({
      txId: "0.0.9@1.1",
      status: "SUCCESS",
    });
    await expect(defaultSubmit(txFor("ACCOUNT_DELETED"), {} as never)).resolves.toEqual({
      txId: "0.0.9@1.1",
      status: "ACCOUNT_DELETED",
    });
    // Unlike a precheck rejection, an unrecognised *receipt* status is ambiguous:
    // consensus was reached and we cannot say what it did.
    await expect(defaultSubmit(txFor("SOME_FUTURE_STATUS"), {} as never)).rejects.toThrow();
  });

  it("a ReceiptStatusError is never read as a precheck rejection", async () => {
    const l = newLedger();
    l.accrue({ payee: "0.0.2001", amount: 5_000, reason: "r" });
    // No nodeId, and it carries a receipt: the permissive reading would release
    // the rows of a transfer that may have paid.
    const out = await settlerFor(l, async () => {
      throw Object.assign(new Error("receipt for transaction failed"), {
        name: "ReceiptStatusError",
        transactionReceipt: {},
        status: { toString: () => "SOME_FUTURE_STATUS" },
      });
    }).settle();
    expect(out).toEqual([]);
    expect(l.pending(), "ambiguous: left for reconcile, rows still claimed").toHaveLength(1);
    expect(l.unsettled()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// H4: the lease, which is the only thing that serialises settle and reconcile
// across two processes over one ledger.sqlite.
// ---------------------------------------------------------------------------

describe("the settlement lease (defect H4)", () => {
  it("reconcile cannot run while a settle is mid-submit", async () => {
    const l = newLedger();
    const id = l.accrue({ payee: "0.0.2001", amount: 8_500, reason: "author_royalty" });

    let release!: (v: { txId: string; status: string }) => void;
    const inflight = new Promise<{ txId: string; status: string }>((r) => (release = r));
    const settler = settlerFor(l, async () => inflight);

    const settling = settler.settle();
    await new Promise((r) => setImmediate(r)); // let run() reach the await

    // The mirror node is showing a FAILED sibling for this memo while the winning
    // submission is still in the air. Before the lease, reconcile released the
    // row here and the next epoch paid the same 8 500 a second time.
    const memo = l.pending()[0]!.memo;
    const restore = stubMirror([mirrorRecord(memo, "INSUFFICIENT_TOKEN_BALANCE", "0.0.1@0.1")]);
    try {
      await settler.reconcile();
    } finally {
      restore();
    }
    expect(l.unsettled(), "the row was NOT handed back mid-flight").toEqual([]);

    release({ txId: "0.0.1@9.9", status: "SUCCESS" });
    await settling;
    // Settle-sourced, so the SDK's `@` notation — contrast the reconcile-sourced
    // rows above, which come out in the mirror node's dashed form. Same column.
    expect(batchRow(l, 1)).toMatchObject({ tx_id: "0.0.1@9.9", status: "SUCCESS" });
    expect(l.payouts()[0]!.settled_batch_id).toBe(1);

    // And no second transfer for an already-paid royalty.
    expect(await settlerFor(l, async () => ({ txId: "0.0.1@10.10", status: "SUCCESS" })).settle()).toEqual(
      [],
    );
    expect(l.sum([id])).toBe(8_500);
  });

  it("a second process's settle is refused rather than building a second batch", async () => {
    const l = newLedger();
    l.accrue({ payee: "0.0.2001", amount: 8_500, reason: "author_royalty" });
    // Exactly what another process holding the lease looks like from here.
    expect(l.acquireLease("some-other-process", 300)).toBe(true);

    let submits = 0;
    const out = await settlerFor(l, async () => {
      submits++;
      return { txId: "0.0.1@1.1", status: "SUCCESS" };
    }).settle();
    expect(out).toEqual([]);
    expect(submits, "no transfer was built over rows another process may have claimed").toBe(0);
    expect(l.unsettled(), "still owed; the next epoch picks them up").toHaveLength(1);

    // Once it is released, the ordinary path resumes.
    l.releaseLease("some-other-process");
    expect(await settlerFor(l, async () => ({ txId: "0.0.1@2.2", status: "SUCCESS" })).settle()).toHaveLength(
      1,
    );
  });

  it("releases the lease after a run, including one that threw", async () => {
    const l = newLedger();
    l.accrue({ payee: "0.0.2001", amount: 8_500, reason: "author_royalty" });
    await settlerFor(l, async () => {
      throw new Error("connection reset");
    }).settle();
    expect(l.lease(), "a held lease would stop settlement for its whole TTL").toBeNull();
    await settlerFor(l).reconcile();
    expect(l.lease()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// L1: a payee that is the payer.
// ---------------------------------------------------------------------------

describe("a payout to the payer itself is netted out, not submitted (defect L1)", () => {
  it("settles a fee-only batch with no transaction at all", async () => {
    const l = newLedger();
    // The registry accrues tracker_fee to its own settlement account, which is
    // also the batch payer, and a royalty is held 120 s while the fee is payable
    // at once — so a batch holding only fee rows is the ordinary case after a sale.
    const id = l.accrue({ payee: PAYER, amount: 1_500, reason: "tracker_fee" });
    let submits = 0;
    const out = await settlerFor(l, async () => {
      submits++;
      return { txId: "0.0.1@1.1", status: "SUCCESS" };
    }).settle();

    expect(submits, "a transfer of a single 0-amount adjustment is not worth a fee").toBe(0);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ txId: "", total: 1_500, moved: 0, payees: 1 });
    expect(l.payouts()[0]!.settled_batch_id, "the obligation is discharged").toBe(out[0]!.id);
    expect(
      batchRow(l, out[0]!.id).status,
      "and it does not claim SUCCESS with a transaction id that moved nothing",
    ).toBe("SETTLED_NO_TRANSFER");
    expect(batchRow(l, out[0]!.id).tx_id).toBeNull();
    expect(l.sum([id])).toBe(1_500);
    expect(l.pending(), "not left for reconcile: there is nothing to confirm").toEqual([]);
  });

  it("a mixed batch still pays the real payee, debiting only what moves", async () => {
    const l = newLedger();
    l.accrue({ payee: "0.0.1111", amount: 9_500, reason: "author_royalty" });
    l.accrue({ payee: PAYER, amount: 500, reason: "tracker_fee" });
    let seen: [string, string, number][] = [];
    const out = await settlerFor(l, async (tx) => {
      seen = (tx as unknown as { _seen?: never }) && collectTransfers(tx);
      return { txId: "0.0.1@1.1", status: "SUCCESS" };
    }).settle();

    // The payer debit is -9 500, not -10 000 plus a 500 credit back to itself.
    // Identical on the wire (the SDK nets them), explicit here.
    expect(seen).toEqual([
      [TOKEN, "0.0.1111", 9_500],
      [TOKEN, PAYER, -9_500],
    ]);
    expect(out[0]).toMatchObject({ total: 10_000, moved: 9_500, payees: 2 });
    expect(l.unsettled(), "both rows are settled by it").toEqual([]);
  });
});

/** The transfer list as built, in order. */
function collectTransfers(tx: import("@hiero-ledger/sdk").TransferTransaction) {
  const byToken = JSON.parse(JSON.stringify(tx.tokenTransfers)) as Record<
    string,
    Record<string, string>
  >;
  const out: [string, string, number][] = [];
  for (const [token, amounts] of Object.entries(byToken)) {
    for (const [acct, amt] of Object.entries(amounts)) out.push([token, acct, Number(amt)]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// H2: an unconfirmable batch stops being an invisible permanent strand.
// ---------------------------------------------------------------------------

describe("reconcile escalates rather than logging forever (defect H2)", () => {
  it("becomes NEEDS_OPERATOR after RECONCILE_ATTEMPTS_BEFORE_OPERATOR fruitless passes", async () => {
    const l = newLedger();
    const { ids, batch } = pendingBatch(l);
    // No record carries this batch's memo — the transfer was never submitted, or
    // its record has scrolled off the page reconcile reads.
    const restore = stubMirror([mirrorRecord("carpool:batch:999:someoneelse", "SUCCESS")]);
    try {
      const settler = settlerFor(l);
      for (let i = 1; i < RECONCILE_ATTEMPTS_BEFORE_OPERATOR; i++) {
        await settler.reconcile();
        expect(batchRow(l, batch.id).status, `pass ${i} is still a retry`).toBe("pending");
      }
      await settler.reconcile();
    } finally {
      restore();
    }
    expect(batchRow(l, batch.id).status).toBe("NEEDS_OPERATOR:UNCONFIRMED");
    expect(l.needsOperator().map((b) => b.id)).toEqual([batch.id]);
    // Nothing was settled and nothing released — the rows are still claimed —
    // but an operator can now see it and act on it.
    expect(l.unsettled()).toEqual([]);
    expect(l.sum(ids)).toBe(10_000);

    const released = l.operatorRelease(batch.id);
    expect(released.ok).toBe(true);
    expect(l.unsettled().map((r) => r.id).sort()).toEqual([...ids].sort());
  });

  it("escalates an unclassifiable record too, and a recheck puts it back", async () => {
    const l = newLedger();
    const { batch } = pendingBatch(l);
    const restore = stubMirror([mirrorRecord(batch.memo, "DUPLICATE_TRANSACTION", "0.0.9@4.4")]);
    try {
      const settler = settlerFor(l);
      for (let i = 0; i < RECONCILE_ATTEMPTS_BEFORE_OPERATOR; i++) await settler.reconcile();
    } finally {
      restore();
    }
    expect(batchRow(l, batch.id)).toMatchObject({
      status: "NEEDS_OPERATOR:DUPLICATE_TRANSACTION",
      tx_id: mirrorTxId("0.0.9@4.4"),
    });

    // The winning sibling may simply have been outside the page. A recheck is the
    // honest action for that, and reconcile sees the batch again.
    expect(l.operatorRecheck(batch.id)).toEqual({ ok: true });
    const restore2 = stubMirror([mirrorRecord(batch.memo, "SUCCESS", "0.0.9@5.5")]);
    try {
      await settlerFor(l).reconcile();
    } finally {
      restore2();
    }
    expect(batchRow(l, batch.id)).toMatchObject({ tx_id: mirrorTxId("0.0.9@5.5"), status: "SUCCESS" });
  });

  it("a confirmed failure still releases on the first pass — escalation is only for the unknown", async () => {
    const l = newLedger();
    const { ids, batch } = pendingBatch(l);
    const restore = stubMirror([mirrorRecord(batch.memo, "NO_REMAINING_AUTOMATIC_ASSOCIATIONS")]);
    try {
      await settlerFor(l).reconcile();
    } finally {
      restore();
    }
    // And this is the H2 code that matters: an author not associated with USDC is
    // now a recognised failure, so the rows come straight back.
    expect(batchRow(l, batch.id).status).toBe("FAILED:NO_REMAINING_AUTOMATIC_ASSOCIATIONS");
    expect(l.unsettled().map((r) => r.id).sort()).toEqual([...ids].sort());
  });
});
