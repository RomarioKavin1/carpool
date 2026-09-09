/**
 * ADVERSARIAL MONEY-PATH AUDIT — the rail half.
 *
 * These started as probes: each one *demonstrated* a reachable outcome of the
 * settlement path so the audit in docs/AUDIT-MONEY.md rested on an executed
 * interleaving rather than a reading, and each assertion pinned the **defective**
 * behaviour so that fixing the defect would fail the test and force the fixer to
 * come here and read why.
 *
 * That is what happened. Every assertion below has been turned round to pin the
 * **fixed** behaviour, keeping the original interleaving intact — the setup is
 * the audit's, the expectation is now what the money path is supposed to do. They
 * remain the executable witnesses: F1 is the un-associated author who used to be
 * stranded forever, F4 is the verified double payment, F6 is the dead account that
 * held eight solvent authors hostage.
 */
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BATCH_DDL } from "./db.js";
import {
  classifyLedgerResult,
  createSettler,
  RECONCILE_ATTEMPTS_BEFORE_OPERATOR,
  type SettlerDeps,
} from "./settler.js";
import { PAYOUT_DDL, SqliteSettlementLedger } from "./sqlite-ledger.js";

let clock = 1_000_000;
function newLedger(opts: { maxAttempts?: number } = {}) {
  const db = new Database(":memory:");
  db.exec(BATCH_DDL);
  db.exec(PAYOUT_DDL);
  return new SqliteSettlementLedger(db, { now: () => clock, ...opts });
}

const PAYER = "0.0.1001";
const TOKEN = "0.0.429274";

function settlerFor(ledger: SqliteSettlementLedger, submit?: SettlerDeps["submit"]) {
  return createSettler({
    ledger,
    client: {} as never,
    token: TOKEN,
    payer: PAYER,
    mirrorUrl: "http://mirror.test",
    submit,
  });
}

function batchRows(l: SqliteSettlementLedger) {
  return (l as unknown as { db: Database.Database }).db
    .prepare(`SELECT id, tx_id, status FROM batch ORDER BY id`)
    .all() as { id: number; tx_id: string | null; status: string }[];
}

type MirrorTx = { memo_base64: string; transaction_id: string; result?: string | null };

/**
 * A transaction id **as the mirror node writes it** — `0.0.9-111-222`, not the
 * SDK's `0.0.9@111.222`. Same convention and same reasoning as
 * `settler.test.ts`'s `mirrorTxId`: the two notations are the same transaction,
 * nothing normalises between them, and `batch.tx_id` therefore holds whichever the
 * recording path produced. Real captured pair:
 * `docs/evidence/v2-full-feature-run/14-chunk-settlement-mirror.json` against
 * `13-settle-two-chunks.json`. Duplicated here because there is no shared test
 * helper module in this package; both copies carry the pointer.
 */
function mirrorTxId(sdkForm: string): string {
  const [account, stamp] = sdkForm.split("@");
  if (stamp === undefined) return sdkForm;
  return `${account}-${stamp.replace(".", "-")}`;
}

function mirrorRecord(memo: string, result: string | null, txId = "0.0.9@111.222"): MirrorTx {
  return {
    memo_base64: Buffer.from(memo, "utf8").toString("base64"),
    transaction_id: mirrorTxId(txId),
    result,
  };
}
function stubMirror(pages: () => MirrorTx[]) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({ json: async () => ({ transactions: pages() }) }) as Response) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

beforeEach(() => {
  clock = 1_000_000;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// F1  The allow-list's unknown branch used to strand payees permanently.
// ---------------------------------------------------------------------------

describe("F1: real Hedera failure codes are recognised, and an unrecognised one is escapable", () => {
  /**
   * These are all real ResponseCodeEnum values (verified against
   * `Status._fromCode` in @hiero-ledger/sdk 2.88) that a *fungible token
   * TransferTransaction* can come back with, every one of which moved no value.
   * None of them was in FAILED_RESULTS, so each one left its payees claimed by a
   * batch nothing could ever release.
   *
   * NO_REMAINING_AUTOMATIC_ASSOCIATIONS is the one that mattered most: it is
   * what a transfer to an author who is not associated with USDC and whose
   * auto-association slots are used up returns — i.e. the single most likely
   * real-world payout failure for a marketplace paying arbitrary accounts.
   *
   * All 23 are now allow-listed. See `FAILED_RESULTS` for the per-code
   * justification; each is either a precheck rejection (never submitted for
   * consensus) or a handle-stage rejection of an atomic transfer list, so
   * releasing on it cannot double-pay.
   */
  const realCodesThatMovedNoValue = [
    "NO_REMAINING_AUTOMATIC_ASSOCIATIONS", // 262 — payee has no free auto-assoc slot
    "ACCOUNT_EXPIRED_AND_PENDING_REMOVAL", // 223 — payee account expired
    "PAYER_ACCOUNT_DELETED", // 256
    "INVALID_PAYER_ACCOUNT_ID", // 71
    "INVALID_PAYER_SIGNATURE", // 43
    "ACCOUNT_ID_DOES_NOT_EXIST", // 60
    "RECEIVER_SIG_REQUIRED", // 113 — payee has receiverSigRequired
    "TRANSFER_LIST_SIZE_LIMIT_EXCEEDED", // 92 — sibling of the code that IS listed
    "TOKENS_PER_ACCOUNT_LIMIT_EXCEEDED", // 166
    "INSUFFICIENT_SENDER_ACCOUNT_BALANCE_FOR_CUSTOM_FEE", // 259
    "INSUFFICIENT_PAYER_BALANCE_FOR_CUSTOM_FEE", // 231
    "THROTTLED_AT_CONSENSUS", // 366
    "FAIL_INVALID", // 23 — node-internal error, nothing applied
    "PLATFORM_NOT_ACTIVE", // 67
    "PLATFORM_TRANSACTION_NOT_CREATED", // 69
    "BUSY", // 12
    "INVALID_ACCOUNT_AMOUNTS", // 48
    "SETTING_NEGATIVE_ACCOUNT_BALANCE", // 75
    "ACCOUNT_IS_TREASURY", // 196
    "TOKEN_ID_REPEATED_IN_TOKEN_LIST", // 197
    "MEMO_TOO_LONG", // 8 — reachable via a long SETTLE_MEMO_PREFIX
    "TRANSACTION_OVERSIZE", // 64
    "MAX_CHILD_RECORDS_EXCEEDED", // 328
  ];

  it.each(realCodesThatMovedNoValue)("%s classifies as failed, so its payees are retried", (code) => {
    expect(classifyLedgerResult(code)).toBe("failed");
  });

  it("a batch that fails as NO_REMAINING_AUTOMATIC_ASSOCIATIONS is released and retried", async () => {
    const l = newLedger();
    const ids = [
      l.accrue({ payee: "0.0.2001", amount: 8_500, reason: "author_royalty" }),
      l.accrue({ payee: "0.0.2002", amount: 1_500, reason: "tracker_fee" }),
    ];

    let fail = true;
    const settler = settlerFor(l, async () =>
      fail
        ? { txId: "0.0.1001@1.2", status: "NO_REMAINING_AUTOMATIC_ASSOCIATIONS" }
        : { txId: "0.0.1001@2.3", status: "SUCCESS" },
    );
    await settler.settle();

    // Nothing moved on chain, so the rows are owed again and the batch says so.
    expect(l.unsettled().map((r) => r.id).sort(), "owed and claimable").toEqual([...ids].sort());
    expect(batchRows(l)[0]!.status).toBe("FAILED:NO_REMAINING_AUTOMATIC_ASSOCIATIONS");
    expect(l.pending(), "not a reconcile candidate: the outcome is known").toHaveLength(0);

    // The author associates the token; the next epoch pays them. One transfer per
    // previously-failed payee, so neither waits on the other.
    fail = false;
    clock += 600;
    const out = await settler.settle();
    expect(out.reduce((s, b) => s + b.total, 0)).toBe(10_000);
    expect(l.unsettled()).toHaveLength(0);
    expect(l.payouts().every((r) => r.settled_batch_id !== null && r.voided_at === null)).toBe(true);
  });

  it("a code even this build cannot classify is escalated, not stranded", async () => {
    const l = newLedger();
    const id = l.accrue({ payee: "0.0.2001", amount: 8_500, reason: "author_royalty" });
    const settler = settlerFor(l, async () => ({
      txId: "0.0.1001@1.2",
      status: "SOME_STATUS_INVENTED_AFTER_THIS_BUILD",
    }));
    await settler.settle();

    // Still neither settled nor released — that judgement is unchanged and
    // correct. What is new is that the system says so, and can be acted on.
    expect(l.unsettled()).toHaveLength(0);
    expect(batchRows(l)[0]!.status).toBe("NEEDS_OPERATOR:SOME_STATUS_INVENTED_AFTER_THIS_BUILD");
    expect(batchRows(l)[0]!.tx_id, "with the id an operator looks up").toBe("0.0.1001@1.2");
    expect(l.needsOperator().map((b) => b.id)).toEqual([1]);

    // Ten more epochs change nothing — the batch is not retried behind an
    // operator's back — and then the operator decides.
    for (let i = 0; i < 10; i++) {
      clock += 600;
      expect(await settler.settle()).toHaveLength(0);
    }
    expect(batchRows(l), "and no batch row per epoch while it waits").toHaveLength(1);

    expect(l.operatorRelease(1)).toEqual({ ok: true, released: [id] });
    expect(l.unsettled().map((r) => r.id), "payable again, on a human's word").toEqual([id]);
  });

  it("reconcile confirms the failure off the mirror node on the first pass", async () => {
    const l = newLedger();
    l.accrue({ payee: "0.0.2001", amount: 8_500, reason: "author_royalty" });
    // An ambiguous submit (no result at all) is what leaves a batch for reconcile.
    const settler = settlerFor(l, async () => ({ txId: "", status: "" }));
    await settler.settle();
    const memo = l.pending()[0]!.memo;

    const restore = stubMirror(() => [mirrorRecord(memo, "NO_REMAINING_AUTOMATIC_ASSOCIATIONS")]);
    try {
      await settler.reconcile();
    } finally {
      restore();
    }
    expect(l.pending(), "resolved, not left pending forever").toHaveLength(0);
    expect(l.unsettled(), "the money never left, so it is owed again").toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// F2  Every allow-listed code is genuinely value-neutral (no defect found).
// ---------------------------------------------------------------------------

describe("F2: the FAILED_RESULTS allow-list contains no code under which value could have moved", () => {
  /**
   * The opposite direction of F1, which is the expensive one. Each listed code
   * is either a precheck rejection (never submitted to consensus) or a
   * handle-stage rejection of an atomic HAPI CryptoTransfer (all-or-nothing
   * transfer list). None can leave a partial transfer behind, so releasing on
   * any of them cannot double-pay. Recorded as an executed assertion so a
   * future addition to the list has to justify itself here.
   */
  const listed = [
    "INSUFFICIENT_TOKEN_BALANCE",
    "TOKEN_NOT_ASSOCIATED_TO_ACCOUNT",
    "INSUFFICIENT_ACCOUNT_BALANCE",
    "INSUFFICIENT_PAYER_BALANCE",
    "INSUFFICIENT_TX_FEE",
    "ACCOUNT_FROZEN_FOR_TOKEN",
    "ACCOUNT_KYC_NOT_GRANTED_FOR_TOKEN",
    "ACCOUNT_DELETED",
    "ACCOUNT_REPEATED_IN_ACCOUNT_AMOUNTS",
    "ACCOUNT_AMOUNT_TRANSFERS_ONLY_ALLOWED_FOR_FUNGIBLE_COMMON",
    "EMPTY_TOKEN_TRANSFER_ACCOUNT_AMOUNTS",
    "INVALID_ACCOUNT_ID",
    "INVALID_TOKEN_ID",
    "INVALID_SIGNATURE",
    "INVALID_TRANSACTION",
    "INVALID_TRANSACTION_BODY",
    "INVALID_TRANSACTION_DURATION",
    "INVALID_TRANSACTION_START",
    "PAYER_ACCOUNT_NOT_FOUND",
    "TOKEN_IS_PAUSED",
    "TOKEN_WAS_DELETED",
    "TOKEN_TRANSFER_LIST_SIZE_LIMIT_EXCEEDED",
    "TRANSFERS_NOT_ZERO_SUM_FOR_TOKEN",
    "TRANSACTION_EXPIRED",
    "UNAUTHORIZED",
  ];
  it.each(listed)("%s is treated as failed and is value-neutral", (code) => {
    expect(classifyLedgerResult(code)).toBe("failed");
  });

  it("DUPLICATE_TRANSACTION stays out of it, which is the load-bearing exclusion", () => {
    expect(classifyLedgerResult("DUPLICATE_TRANSACTION")).toBe("unknown");
  });

  it("and an unrecognised code is still never guessed at", () => {
    // Extending the list did not turn it into `!== "SUCCESS"`. A code nobody has
    // justified is `unknown`, which is what keeps the double-pay direction safe.
    expect(classifyLedgerResult("SOME_FUTURE_STATUS")).toBe("unknown");
    expect(classifyLedgerResult(null)).toBe("unknown");
    expect(classifyLedgerResult("")).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// F3  A submit that throws used to abort the whole epoch.
// ---------------------------------------------------------------------------

describe("F3: a throwing submit costs its own batch a retry and nothing else", () => {
  it("leaves later chunks to run, and the thrown chunk to reconcile", async () => {
    const l = newLedger();
    // 10 payees -> two chunks (MAX_PAYEES = 9).
    for (let i = 0; i < 10; i++) l.accrue({ payee: `0.0.${3000 + i}`, amount: 1_000, reason: "r" });
    expect(l.unsettled()).toHaveLength(10);

    let calls = 0;
    const settler = settlerFor(l, async () => {
      calls++;
      if (calls > 1) return { txId: "0.0.1@2.2", status: "SUCCESS" };
      // A transport-level failure: we do not know whether it reached consensus.
      throw new Error("connection reset while waiting for the receipt");
    });

    const out = await settler.settle();
    expect(calls, "the second chunk was attempted").toBe(2);
    expect(out, "and paid").toHaveLength(1);
    expect(out[0]!.payees).toBe(1);

    // Chunk 1's rows stay claimed by a pending batch — correct, because a
    // transfer that may have landed must not be released — and the batch is
    // exactly the shape reconcile() selects on.
    expect(l.payouts().filter((r) => r.settled_batch_id !== null)).toHaveLength(10);
    expect(l.pending()).toHaveLength(1);

    // Reconcile resolves it: the transfer never reached consensus, so the nine
    // come back and the next epoch pays them.
    const memo = l.pending()[0]!.memo;
    const restore = stubMirror(() => [mirrorRecord(memo, "TRANSACTION_EXPIRED")]);
    try {
      await settler.reconcile();
    } finally {
      restore();
    }
    expect(l.unsettled(), "the nine are owed again").toHaveLength(9);
  });

  it("a precheck rejection is a result, not an exception, whatever its code", async () => {
    const l = newLedger();
    const id = l.accrue({ payee: "0.0.2001", amount: 5_000, reason: "r" });
    // The shape `tx.execute` rejects with. `defaultSubmit` now inspects it (see
    // settler.test.ts for the direct tests), so an unlisted *precheck* code is
    // still known to have moved nothing: the node never submitted the transfer.
    const settler = settlerFor(l, async () => ({
      txId: "",
      status: "NO_REMAINING_AUTOMATIC_ASSOCIATIONS",
    }));
    await settler.settle();
    expect(l.pending(), "no batch left dangling").toHaveLength(0);
    expect(l.unsettled().map((r) => r.id), "owed and retried").toEqual([id]);
  });
});

// ---------------------------------------------------------------------------
// F4  reconcile() vs an in-flight settle: the verified double payment.
// ---------------------------------------------------------------------------

describe("F4: reconcile() cannot release the rows of a transfer settle() is still submitting", () => {
  it("pays the payee exactly once", async () => {
    const l = newLedger();
    const id = l.accrue({ payee: "0.0.2001", amount: 8_500, reason: "author_royalty" });

    const submitted: string[] = [];
    let release!: (v: { txId: string; status: string }) => void;
    const inflight = new Promise<{ txId: string; status: string }>((r) => (release = r));

    const settler = settlerFor(l, async (tx) => {
      submitted.push(tx.transactionMemo ?? "");
      return inflight; // the real gap: execute + getReceipt is seconds long
    });

    const settlePromise = settler.settle();
    await new Promise((r) => setImmediate(r)); // let run() reach the await

    // claimBatch inserts the batch as ('pending', tx_id NULL) BEFORE submitting,
    // so it is visible to pending() while the transfer is in the air, and the
    // mirror node is already showing a record for this memo -- here a *failed
    // sibling* of a transfer whose winning submission has not landed in the page
    // yet. reconcile() used to release the row on that evidence.
    const memo = l.pending()[0]!.memo;
    const restore = stubMirror(() => [mirrorRecord(memo, "INSUFFICIENT_TOKEN_BALANCE", "0.0.1@0.1")]);
    try {
      await settler.reconcile();
    } finally {
      restore();
    }

    // The settlement lease is held by the in-flight settle, so reconcile did not
    // run at all. The row is still claimed by the batch that is paying it.
    expect(l.unsettled(), "nothing was handed back mid-flight").toEqual([]);

    release({ txId: "0.0.1@9.9", status: "SUCCESS" });
    await settlePromise;
    expect(batchRows(l)[0]).toMatchObject({ tx_id: "0.0.1@9.9", status: "SUCCESS" });

    // And the next epoch finds nothing owed: no second on-chain transfer for a
    // royalty that has been paid.
    const second = await settlerFor(l, async () => ({ txId: "0.0.1@10.10", status: "SUCCESS" })).settle();
    expect(second, "no second transfer for an already-paid royalty").toEqual([]);
    expect(submitted).toHaveLength(1);
    expect(l.sum([id]), "and the amount is untouched").toBe(8_500);
  });

  it("the lease is what does it, across processes and not just within one", async () => {
    const l = newLedger();
    l.accrue({ payee: "0.0.2001", amount: 8_500, reason: "author_royalty" });
    const a = settlerFor(l, async () => ({ txId: "0.0.1@1.1", status: "SUCCESS" }));
    // A *different Settler instance* is what two registry processes over one
    // ledger.sqlite are, and what the per-instance mutex could never cover.
    const b = settlerFor(l, async () => ({ txId: "0.0.1@2.2", status: "SUCCESS" }));

    expect(l.acquireLease("held-by-process-b", 300), "b is mid-run").toBe(true);
    expect(await a.settle(), "a refuses to build a batch over b's rows").toEqual([]);
    expect(l.unsettled(), "still owed").toHaveLength(1);
    l.releaseLease("held-by-process-b");

    expect(await b.settle()).toHaveLength(1);
    expect(await a.settle(), "and afterwards there is nothing left to pay").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F5  markSettled is conditional, and the FAILED evidence survives.
// ---------------------------------------------------------------------------

describe("F5: a late markSettled cannot overwrite a FAILED batch", () => {
  it("keeps the failure, and records the observation it refused", async () => {
    const l = newLedger();
    const id = l.accrue({ payee: "0.0.2001", amount: 8_500, reason: "author_royalty" });
    const b1 = l.claimBatch("rootone", [id]);

    // Marked failed; row released.
    expect(l.markFailed(b1.id, "0.0.1@1.1", "INSUFFICIENT_TOKEN_BALANCE")).toEqual([id]);
    // Re-claimed and paid by a new batch.
    const b2 = l.claimBatch("roottwo", [id]);
    expect(l.markSettled(b2.id, "0.0.1@2.2", "SUCCESS")).toBe(true);

    // A reconcile pass that started before the release (pending() is snapshotted
    // before its `await fetch`) now finds a SUCCESS sibling for b1's memo.
    expect(l.markSettled(b1.id, "0.0.1@3.3", "SUCCESS"), "refused").toBe(false);

    const rows = batchRows(l);
    expect(rows[0], "the record that b1's rows were released is intact").toMatchObject({
      id: b1.id,
      status: "FAILED:INSUFFICIENT_TOKEN_BALANCE",
      tx_id: "0.0.1@1.1",
    });
    expect(rows[1]).toMatchObject({ id: b2.id, status: "SUCCESS" });

    // And the refused observation is not lost either: if 0.0.1@3.3 really did
    // pay, this is the row that says two transfers exist for one batch.
    expect(l.conflicts()).toHaveLength(1);
    expect(l.conflicts()[0]).toMatchObject({
      batch_id: b1.id,
      observed_tx_id: "0.0.1@3.3",
      observed_status: "SUCCESS",
      had_status: "FAILED:INSUFFICIENT_TOKEN_BALANCE",
    });
    expect(l.payouts()[0]!.settled_batch_id).toBe(b2.id);
    expect(l.sum([id])).toBe(8_500);
  });

  it("markFailed, likewise, is conditional and refuses to release twice", () => {
    const l = newLedger();
    const id = l.accrue({ payee: "0.0.2001", amount: 8_500, reason: "r" });
    const b = l.claimBatch("root", [id]);
    expect(l.markFailed(b.id, "0.0.1@1.1", "INSUFFICIENT_TOKEN_BALANCE")).toEqual([id]);
    expect(l.markFailed(b.id, "0.0.1@1.1", "INSUFFICIENT_TOKEN_BALANCE")).toEqual([]);
    // And it never releases a row a refund voided in the meantime.
    const l2 = newLedger();
    const a = l2.accrue({ payee: "0.0.1", amount: 1_000, reason: "r" });
    const c = l2.accrue({ payee: "0.0.2", amount: 2_000, reason: "r" });
    const b2 = l2.claimBatch("root", [a, c]);
    (l2 as unknown as { db: Database.Database }).db
      .prepare(`UPDATE payout SET voided_at = 1 WHERE id = ?`)
      .run(a);
    expect(l2.markFailed(b2.id, "", "ACCOUNT_DELETED")).toEqual([c]);
  });
});

// ---------------------------------------------------------------------------
// F6  The attempt counter, the park, and per-payee isolation.
// ---------------------------------------------------------------------------

describe("F6: a permanently-failing payout stops costing fees, and stops blocking others", () => {
  it("is retried a bounded number of times and then parked", async () => {
    const l = newLedger({ maxAttempts: 5 });
    const id = l.accrue({ payee: "0.0.2001", amount: 8_500, reason: "author_royalty" });

    let submits = 0;
    const settler = settlerFor(l, async () => {
      submits++;
      // A cause that will never clear on its own: the author's account is
      // deleted. Allow-listed, so the rows are released -- but not forever.
      return { txId: `0.0.1@${submits}.0`, status: "ACCOUNT_DELETED" };
    });

    const EPOCHS = 50;
    for (let i = 0; i < EPOCHS; i++) {
      clock += 600;
      await settler.settle();
    }
    expect(submits, "five transactions, not one per epoch for ever").toBe(5);
    expect(batchRows(l), "and five batch rows, not fifty").toHaveLength(5);

    // Still owed — nothing was invented or written off — but out of the retry
    // loop and in front of a human.
    expect(l.unsettled(), "not retried").toHaveLength(0);
    expect(l.parked().map((r) => r.id)).toEqual([id]);
    expect(l.parked()[0]).toMatchObject({ amount: 8_500, attempts: 5, settled_batch_id: null });
    expect(l.payouts()).toHaveLength(1);

    // The operator fixes the cause (a new payout account, an association) and
    // unparks it; the next epoch pays it.
    expect(l.unpark(id)).toBe(true);
    clock += 600;
    const ok = await settlerFor(l, async () => ({ txId: "0.0.1@99.0", status: "SUCCESS" })).settle();
    expect(ok[0]!.total).toBe(8_500);
  });

  it("one un-payable payee no longer blocks the eight others in its chunk", async () => {
    const l = newLedger({ maxAttempts: 5 });
    const ids = Array.from({ length: 9 }, (_, i) =>
      l.accrue({ payee: `0.0.${2000 + i}`, amount: 1_000, reason: "author_royalty" }),
    );
    const BAD = "0.0.2008";

    // The realistic model: the transfer fails only when it contains the bad
    // payee. Before the fix, that meant every chunk — all nine were grouped
    // together every epoch and all nine stayed unpaid.
    let transfers = 0;
    const settler = settlerFor(l, async (tx) => {
      transfers++;
      const listed = JSON.stringify(tx.tokenTransfers);
      return listed.includes(BAD)
        ? { txId: `0.0.1@${transfers}.0`, status: "ACCOUNT_DELETED" }
        : { txId: `0.0.1@${transfers}.0`, status: "SUCCESS" };
    });

    await settler.settle(); // one chunk of nine: fails, all nine released
    expect(l.unsettled()).toHaveLength(9);

    clock += 600;
    await settler.settle(); // nine isolated transfers: eight pay, one fails
    const unpaid = l.unsettled().map((r) => r.payee);
    expect(unpaid, "the eight solvent authors are paid").toEqual([BAD]);
    expect(
      l.payouts().filter((r) => r.settled_batch_id !== null),
      "eight settled rows",
    ).toHaveLength(8);

    // And the ninth parks rather than re-failing for ever.
    for (let i = 0; i < 10; i++) {
      clock += 600;
      await settler.settle();
    }
    expect(l.parked().map((r) => r.payee)).toEqual([BAD]);
    expect(l.unsettled()).toHaveLength(0);
    expect(
      l.payouts().filter((r) => r.payee !== BAD).every((r) => r.settled_batch_id !== null),
      "nobody but the bad payee was affected",
    ).toBe(true);
    expect(l.sum(ids)).toBe(9_000);
  });
});

// ---------------------------------------------------------------------------
// F7  reconcile's mirror window is still one 100-record page — but the strand
//     it causes is now bounded.
// ---------------------------------------------------------------------------

describe("F7: reconcile's fixed 100-record mirror page", () => {
  it("still never pages, but an unreachable batch escalates instead of waiting forever", async () => {
    const l = newLedger();
    l.accrue({ payee: "0.0.2001", amount: 8_500, reason: "author_royalty" });
    // A batch left pending by an ambiguous submit.
    const settler = settlerFor(l, async () => ({ txId: "", status: "" }));
    await settler.settle();
    const memo = l.pending()[0]!.memo;

    const urls: string[] = [];
    const original = globalThis.fetch;
    // The payer account has since done 100 other things, so the batch's own
    // record has scrolled off the only page reconcile ever reads.
    globalThis.fetch = (async (u: string) => {
      urls.push(String(u));
      return {
        json: async () => ({
          transactions: Array.from({ length: 100 }, (_, i) =>
            mirrorRecord(`carpool:batch:${9000 + i}:x`, "SUCCESS"),
          ),
        }),
      } as Response;
    }) as typeof fetch;
    try {
      for (let i = 0; i < RECONCILE_ATTEMPTS_BEFORE_OPERATOR; i++) await settler.reconcile();
    } finally {
      globalThis.fetch = original;
    }

    // The pagination limit is unfixed and deliberately still pinned here: a batch
    // must be reconciled within 100 payer transactions or it never can be.
    expect(urls[0]).toContain("limit=100");
    expect(urls[0]).toContain("order=desc");
    expect(urls.every((u) => !/timestamp|next|cursor/.test(u)), "no cursor, no window").toBe(true);

    // What is no longer true is that it is invisible and permanent.
    expect(l.pending(), "it stops being asked about").toEqual([]);
    expect(l.needsOperator().map((b) => b.memo)).toEqual([memo]);
    expect(l.needsOperator()[0]!.status).toBe("NEEDS_OPERATOR:UNCONFIRMED");
    expect(l.unsettled(), "and nothing was released on a guess").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F8  The payer is also a payee: every tracker_fee row is a self-transfer.
// ---------------------------------------------------------------------------

describe("F8: a payout whose payee is the batch payer is netted out before submitting", () => {
  /** The transfer list as it will be encoded, {account: amount} per token. */
  const wire = (tx: { tokenTransfers: unknown }): Record<string, string> => {
    const byToken = JSON.parse(JSON.stringify(tx.tokenTransfers)) as Record<
      string,
      Record<string, string>
    >;
    return Object.values(byToken)[0]!;
  };

  it("a fee-only batch submits no transaction at all", async () => {
    const l = newLedger();
    // apps/registry: recordPurchase accrues tracker_fee to cfg.registryAccount,
    // and createRegistrySettler passes that same account as `payer`. A royalty
    // is held for 120s while the fee is payable at once, so an epoch holding
    // only fee rows is the ordinary case right after a sale.
    l.accrue({ payee: PAYER, amount: 1_500, reason: "tracker_fee" });

    let submits = 0;
    const out = await settlerFor(l, async () => {
      submits++;
      return { txId: "0.0.1@1.1", status: "SUCCESS" };
    }).settle();

    // The SDK nets the payer debit against the payee credit for the same account,
    // so what used to go on chain was a single {PAYER: "0"} adjustment: a real
    // transaction fee for a transfer that moved nothing, and a ledger row
    // claiming 1 500 µUSDC was paid by a transaction containing no such movement.
    expect(submits, "nothing to move, so nothing submitted and no fee spent").toBe(0);
    expect(out[0]!.total, "the obligation is still discharged").toBe(1_500);
    expect(out[0]!.moved, "but nothing moved, and the batch says which").toBe(0);
    expect(out[0]!.txId).toBe("");
    expect(l.payouts()[0]!.settled_batch_id).toBe(out[0]!.id);
    expect(batchRows(l)[0]!.status).toBe("SETTLED_NO_TRANSFER");
    expect(batchRows(l)[0]!.tx_id, "no transaction id is claimed for it").toBeNull();
  });

  it("a mixed batch still moves the real payee's money, and only that", async () => {
    const l = newLedger();
    l.accrue({ payee: "0.0.1111", amount: 9_500, reason: "author_royalty" });
    l.accrue({ payee: PAYER, amount: 500, reason: "tracker_fee" });
    let seen: Record<string, string> = {};
    const out = await settlerFor(l, async (tx) => {
      seen = wire(tx);
      return { txId: "0.0.1@1.1", status: "SUCCESS" };
    }).settle();
    // Identical on the wire to the old -10_000/+500 pair (the SDK aggregated
    // them), but now built that way on purpose rather than relying on it.
    expect(seen).toEqual({ "0.0.1111": "9500", [PAYER]: "-9500" });
    expect(out[0]).toMatchObject({ total: 10_000, moved: 9_500 });
    expect(l.unsettled(), "both rows settled by it").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F9  Sub-dust payees are carried forward indefinitely, by design.
// ---------------------------------------------------------------------------

describe("F9: sub-dust rows are dropped from every chunk and never reported", () => {
  it("a payee under DUST is never paid and appears in no batch, no log, no return value", async () => {
    const l = newLedger();
    const id = l.accrue({ payee: "0.0.5001", amount: 499, reason: "author_royalty" });
    const settler = settlerFor(l, async () => ({ txId: "0.0.1@1.1", status: "SUCCESS" }));
    for (let i = 0; i < 20; i++) {
      clock += 600;
      expect(await settler.settle()).toEqual([]);
    }
    expect(batchRows(l), "no batch is even created").toHaveLength(0);
    expect(l.unsettled().map((r) => r.id)).toEqual([id]);
    // Bounded: strictly less than DUST per payee, and it clears the moment they
    // earn again. `groupAndChunk` returns `dropped` and `run()` discards it.
    clock += 600;
    l.accrue({ payee: "0.0.5001", amount: 1, reason: "author_royalty" });
    expect((await settler.settle())[0]!.total).toBe(500);
  });
});
