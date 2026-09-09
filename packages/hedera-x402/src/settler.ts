import { randomUUID } from "node:crypto";
import { Client, TransferTransaction } from "@hiero-ledger/sdk";
import { merkleRoot, payeeLeaves } from "./merkle.js";

export const MAX_PAYEES = 9; // 10 token-transfer entries incl. the payer debit
export const DUST = 500; // µUSDC; below this a payee carries to the next epoch

/**
 * How long a settle or reconcile run holds the cross-process lease.
 *
 * Longer than `execute` + `getReceipt` can plausibly take (seconds), short
 * enough that a process killed mid-run does not stop settlement for long. A
 * stale lease is stealable; see `SqliteSettlementLedger.acquireLease`.
 */
export const LEASE_TTL_SECONDS = 300;

/**
 * Reconcile passes a batch may go unconfirmed before it becomes an operator's
 * problem. Three at the 600 s epoch default is half an hour — well past
 * mirror-node ingestion lag (~2 s), and bounded, which "left pending" was not.
 */
export const RECONCILE_ATTEMPTS_BEFORE_OPERATOR = 3;

export type PayeeChunk = [payee: string, amount: number, ids: number[]][];

/**
 * The batch status vocabulary, in one place because two files write it and
 * every reader (`GET /batches`, an operator, a payee checking a transaction on a
 * mirror node) has to be able to tell these apart without knowing Hedera's
 * status names.
 */
export const BATCH_STATUS = {
  /** Claimed, submitted or about to be; the only status `pending()` returns. */
  pending: "pending",
  /** Nothing was won by the claim, so no transfer was built. */
  emptyClaim: "EMPTY_CLAIM",
  /**
   * Every payee in the batch is the payer, so there was nothing to move and no
   * transaction was submitted. Distinct from SUCCESS on purpose: a batch that
   * says SUCCESS with a transaction id whose transfer list contains no such
   * movement is a lie a payee can check and catch.
   */
  noTransfer: "SETTLED_NO_TRANSFER",
  /** Reached consensus and moved nothing; the rows are owed again. */
  failedPrefix: "FAILED:",
  /** Neither settled nor released, and an operator has to decide which. */
  needsOperatorPrefix: "NEEDS_OPERATOR:",
  /** An operator asserted nothing moved and handed the rows back. */
  releasedByOperatorPrefix: "RELEASED_BY_OPERATOR:",
  /** An operator asserted the transfer paid, naming the transaction. */
  settledByOperator: "SETTLED_BY_OPERATOR",
} as const;

/**
 * What the settler needs from whatever ledger it is settling.
 *
 * Defined here so the settler is not typed against a product's ledger class —
 * v1's was, which is why it could not be extracted without dragging the
 * lineage/consumer/rebate model with it.
 */
export interface SettlementLedger {
  /**
   * Rows owed and not yet claimed by a batch. `attempts` is how many
   * consensus-reached failures that row has already been released from; it is
   * what lets `groupAndChunk` isolate a payee that has failed before instead of
   * re-forming the identical chunk every epoch.
   */
  unsettled(): { id: number; payee: string; amount: number; attempts?: number }[];
  /**
   * Claim rows for a batch. MUST be conditional on the row still being
   * unclaimed, and MUST report which ids were actually won — two settlement
   * runs can read the same rows before either claims them.
   */
  claimBatch(root: string, ids: number[]): { id: number; memo: string; claimed: number[] };
  /** Total of the given ids. Used to rebuild a payout from the claimed set. */
  sum(ids: number[]): number;
  /**
   * The batch paid out. Only ever called for a result that actually moved
   * value on-ledger — see `classifyLedgerResult` — or for a batch that needed no
   * transfer at all (an empty claim, or a payee that is the payer).
   *
   * MUST be conditional on the batch not already having a recorded outcome, and
   * MUST NOT discard the observation it refuses: a late "it succeeded" that
   * overwrites a `FAILED:` erases the only record that the batch's rows were
   * released and paid by somebody else.
   *
   * @returns whether the batch was actually flipped.
   */
  markSettled(batchId: number, txId: string, status: string): boolean;
  /**
   * The batch's transaction reached consensus and FAILED, so nothing moved and
   * every payout in it is still owed. Records the failure against the batch and
   * returns its rows to claimable state so the next `settle()` retries them.
   *
   * MUST be conditional on the batch still being pending — releasing the rows
   * of a batch that in fact succeeded pays every payee in it twice — and MUST
   * NOT release a row that has since been voided.
   *
   * @returns the payout ids actually returned to claimable. An implementation
   * that parks a row after too many failures leaves it out of this list.
   */
  markFailed(batchId: number, txId: string, status: string): number[];
  /**
   * The result cannot be classified: neither settling nor releasing is safe.
   * Records an operator-visible state against the batch so the payees are not
   * silently stranded with nothing anywhere saying they were not paid.
   */
  markNeedsOperator(batchId: number, txId: string, status: string, reason: string): boolean;
  /** Count a reconcile pass that neither confirmed nor released. @returns the new count. */
  bumpReconcileAttempt(batchId: number): number;
  pending(): { id: number; memo: string }[];
  /**
   * Take the settlement lease across every process sharing this ledger, or
   * report that somebody else holds it. MUST be atomic.
   */
  acquireLease(token: string, ttlSeconds: number): boolean;
  /** Release the lease iff this token holds it. */
  releaseLease(token: string): void;
}

/**
 * What an on-ledger result tells us about whether the payees got paid.
 *
 * - `success` — value moved. The batch is settled and the rows stay claimed.
 * - `failed`  — the transaction reached consensus and moved nothing. The
 *   payouts are still owed and go back to claimable.
 * - `unknown` — we cannot tell. Neither settling nor releasing is safe, so the
 *   batch is flipped to `NEEDS_OPERATOR:<code>` (or, when no result came back at
 *   all, left pending for the next reconcile).
 *
 * The third case is not a formality. Settling an unknown result strands payees
 * silently; releasing one that actually paid double-pays every payee in the
 * batch. Only a recognised code earns either action.
 */
export type LedgerOutcome = "success" | "failed" | "unknown";

/** Results that moved value. Anything here means the payees were paid. */
const SUCCESS_RESULTS = new Set(["SUCCESS", "SUCCESS_BUT_MISSING_EXPECTED_OPERATION"]);

/**
 * Consensus-reached results that are known to have moved no value: the
 * transaction id is spent, the transfer list was not applied, and the payouts
 * are still owed. HAPI transactions are atomic, so in principle *every*
 * non-SUCCESS result belongs here — but this is an allow-list rather than a
 * `!== "SUCCESS"` test on purpose, because the cost of being wrong in this
 * direction is paying every payee in the batch a second time.
 *
 * `DUPLICATE_TRANSACTION` is deliberately NOT in this set. It means this
 * submission lost to a sibling carrying the same transaction id and memo — and
 * that sibling may have succeeded. The mirror-node page we search is finite, so
 * the successful sibling can be outside it while the duplicate is inside.
 * Treating it as a failure would release the payouts of a transfer that paid.
 *
 * ## Why each of the second group is here
 *
 * The audit (docs/AUDIT-MONEY.md H2) found the first 25 sound and the list
 * incomplete: the SDK defines ~357 status codes, so a real failure outside the
 * list left its payees claimed by a batch nothing could ever release —
 * permanently, and with no status anywhere saying they had not been paid. The
 * codes below are the reachable ones for a fungible-token `TransferTransaction`.
 * Each is value-neutral for exactly one of two reasons, and neither is a guess:
 *
 * - **Rejected before consensus** (`BUSY`, `PLATFORM_NOT_ACTIVE`,
 *   `PLATFORM_TRANSACTION_NOT_CREATED`, `THROTTLED_AT_CONSENSUS`,
 *   `TRANSACTION_OVERSIZE`, `MEMO_TOO_LONG`, `INVALID_PAYER_ACCOUNT_ID`,
 *   `INVALID_PAYER_SIGNATURE`, `PAYER_ACCOUNT_DELETED`): the network never
 *   handled the transfer list, so no account balance was touched.
 * - **Rejected at handle time** (the rest): a HAPI `CryptoTransfer` applies its
 *   transfer list atomically, so a non-SUCCESS handle result leaves every
 *   balance exactly where it was. `NO_REMAINING_AUTOMATIC_ASSOCIATIONS` and
 *   `RECEIVER_SIG_REQUIRED` are the two that matter in practice: they are what
 *   paying an author who is not associated with USDC, or who requires a receive
 *   signature, actually returns — the likeliest real payout failure for a
 *   marketplace paying arbitrary self-declared accounts.
 *
 * Neither reason is "probably fine": for any of these to double-pay, Hedera
 * would have to apply part of an atomic transfer list, which is the property the
 * whole batching design already rests on.
 */
const FAILED_RESULTS = new Set([
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

  // --- added after the H2 audit; see the justification above ---
  "NO_REMAINING_AUTOMATIC_ASSOCIATIONS", // 262 payee has no free auto-assoc slot
  "RECEIVER_SIG_REQUIRED", // 113 payee requires a receive signature
  "ACCOUNT_EXPIRED_AND_PENDING_REMOVAL", // 223 payee account expired
  "ACCOUNT_ID_DOES_NOT_EXIST", // 60
  "ACCOUNT_IS_TREASURY", // 196
  "PAYER_ACCOUNT_DELETED", // 256 precheck: the payer itself is gone
  "INVALID_PAYER_ACCOUNT_ID", // 71  precheck
  "INVALID_PAYER_SIGNATURE", // 43  precheck
  "TRANSFER_LIST_SIZE_LIMIT_EXCEEDED", // 92  sibling of the token-specific 198
  "TOKENS_PER_ACCOUNT_LIMIT_EXCEEDED", // 166
  "TOKEN_ID_REPEATED_IN_TOKEN_LIST", // 197
  "INVALID_ACCOUNT_AMOUNTS", // 48
  "SETTING_NEGATIVE_ACCOUNT_BALANCE", // 75
  "INSUFFICIENT_SENDER_ACCOUNT_BALANCE_FOR_CUSTOM_FEE", // 259
  "INSUFFICIENT_PAYER_BALANCE_FOR_CUSTOM_FEE", // 231
  "MAX_CHILD_RECORDS_EXCEEDED", // 328 parent fails, children roll back with it
  "THROTTLED_AT_CONSENSUS", // 366 dropped at consensus, never handled
  "BUSY", // 12  precheck: never submitted
  "PLATFORM_NOT_ACTIVE", // 67  precheck
  "PLATFORM_TRANSACTION_NOT_CREATED", // 69  precheck
  "TRANSACTION_OVERSIZE", // 64  precheck
  "MEMO_TOO_LONG", // 8   precheck; reachable via a long SETTLE_MEMO_PREFIX
  // FAIL_INVALID (23) is a node-internal error raised during handle. It is here
  // for the atomicity reason and no other: whatever went wrong, a CryptoTransfer
  // that did not return SUCCESS did not move part of its transfer list. It is
  // the only entry justified by the invariant alone rather than by a documented
  // stage, and it is the one to revisit first if this list is ever wrong.
  "FAIL_INVALID",
]);

/**
 * Codes that, at **precheck**, still do not tell us whether value moved.
 *
 * A precheck rejection means the node refused the transaction before submitting
 * it for consensus, so nothing moved — with one exception. `DUPLICATE_TRANSACTION`
 * says the network has already seen this transaction id: the submission that got
 * there first may have paid, and it is not in our hands. Releasing on it would
 * pay the batch twice.
 */
const AMBIGUOUS_AT_PRECHECK = new Set(["DUPLICATE_TRANSACTION"]);

/** Classify a receipt status or mirror-node `result` string. Pure. */
export function classifyLedgerResult(result: string | null | undefined): LedgerOutcome {
  if (!result) return "unknown";
  if (SUCCESS_RESULTS.has(result)) return "success";
  if (FAILED_RESULTS.has(result)) return "failed";
  return "unknown";
}

/**
 * Classify a **precheck** rejection, which is a stronger statement than a
 * receipt status: the node did not submit the transaction for consensus, so the
 * transfer list was never applied whether or not we recognise the code.
 *
 * This is why it exists. `defaultSubmit` never inspected `tx.execute`'s
 * rejection at all, so a precheck `INSUFFICIENT_PAYER_BALANCE` threw out of the
 * whole epoch even though that exact code is allow-listed — and a precheck
 * rejection of any other code stranded its payees in a batch nothing could
 * release, because the mirror node will never hold a record for a transaction
 * that was never submitted (docs/AUDIT-MONEY.md H3). Pure.
 */
export function classifyPrecheckResult(result: string | null | undefined): LedgerOutcome {
  if (!result) return "unknown";
  if (AMBIGUOUS_AT_PRECHECK.has(result)) return "unknown";
  if (SUCCESS_RESULTS.has(result)) return "unknown"; // a successful precheck is not an error
  return "failed";
}

/** The outcome of submitting one batch transfer. */
export interface TransferOutcome {
  /** "" when the submit produced no transaction id. */
  txId: string;
  /** The on-ledger result code, e.g. "SUCCESS" or "INSUFFICIENT_TOKEN_BALANCE". */
  status: string;
}

/** The status string out of a thrown SDK error, or null if it carries none. */
function statusOf(e: unknown): string | null {
  const raw = (e as { status?: unknown })?.status;
  const status = typeof raw === "string" ? raw : (raw as { toString?: () => string })?.toString?.();
  return typeof status === "string" && status !== "" ? status : null;
}

/**
 * Pull a consensus-reached failure code out of a thrown SDK error.
 *
 * `getReceipt` rejects with a ReceiptStatusError when the transaction reached
 * consensus and failed — that is a *known* outcome, not an ambiguous one, and
 * throwing it away is what left the batch pending for `reconcile` to mis-handle.
 * Duck-typed rather than `instanceof` so a fake submit path behaves the same;
 * only a code the allow-list recognises is accepted, so an unrelated error
 * carrying a `status` property cannot be mistaken for a ledger result.
 */
function consensusFailure(e: unknown): string | null {
  const status = statusOf(e);
  if (status === null) return null;
  return classifyLedgerResult(status) === "failed" ? status : null;
}

/**
 * Pull a precheck rejection code out of a thrown SDK error.
 *
 * Duck-typed on the shape `PrecheckStatusError` has and `ReceiptStatusError`
 * does not: a precheck error names the node that refused it and carries no
 * receipt. Getting that distinction wrong in the permissive direction would be
 * expensive — a receipt error read as a precheck rejection would release the
 * rows of a transfer that may have paid — so anything ambiguous returns null and
 * the caller leaves the batch pending.
 */
function precheckFailure(e: unknown): string | null {
  const err = e as { name?: string; nodeId?: unknown; transactionReceipt?: unknown };
  const looksPrecheck =
    err?.name === "PrecheckStatusError" ||
    (err?.nodeId !== undefined && err?.transactionReceipt === undefined);
  if (!looksPrecheck) return null;
  const status = statusOf(e);
  if (status === null) return null;
  return classifyPrecheckResult(status) === "failed" ? status : null;
}

/**
 * Group by payee, drop sub-dust (carried forward), chunk by MAX_PAYEES. Pure.
 *
 * A payee with `attempts > 0` — one whose last transfer reached consensus and
 * failed — is put in a chunk **of its own**. `markFailed` releases the whole
 * chunk, so without this the identical group of nine re-forms every epoch and
 * one un-payable account holds the other eight hostage indefinitely
 * (docs/AUDIT-MONEY.md M5, verified: nine payees, one bad, all nine unpaid after
 * five epochs). Isolating retries costs one transaction per previously-failed
 * payee for as long as they keep failing, which the park-after-`maxAttempts` rule
 * in `markFailed` bounds.
 */
export function groupAndChunk(
  rows: { id: number; payee: string; amount: number; attempts?: number }[],
  dust = DUST,
  max = MAX_PAYEES,
): { chunks: PayeeChunk[]; dropped: PayeeChunk } {
  const byPayee = new Map<string, { amount: number; ids: number[]; attempts: number }>();
  for (const r of rows) {
    const e = byPayee.get(r.payee) ?? { amount: 0, ids: [], attempts: 0 };
    e.amount += r.amount;
    e.ids.push(r.id);
    e.attempts = Math.max(e.attempts, r.attempts ?? 0);
    byPayee.set(r.payee, e);
  }
  const fresh: PayeeChunk = [];
  const retried: PayeeChunk = [];
  const dropped: PayeeChunk = [];
  for (const [payee, e] of byPayee) {
    if (e.amount < dust) dropped.push([payee, e.amount, e.ids]);
    else (e.attempts > 0 ? retried : fresh).push([payee, e.amount, e.ids]);
  }
  const chunks: PayeeChunk[] = [];
  for (let i = 0; i < fresh.length; i += max) chunks.push(fresh.slice(i, i + max));
  for (const one of retried) chunks.push([one]);
  return { chunks, dropped };
}

export interface SettledBatch {
  id: number;
  /** "" when no transfer was needed — see `SettledBatch.moved`. */
  txId: string;
  payees: number;
  /** Every payout µUSDC this batch discharged, moved on chain or not. */
  total: number;
  /**
   * What the transfer actually moved. Below `total` exactly when some payee in
   * the batch *is* the payer, whose payout is a self-transfer that nets to zero
   * and is therefore not submitted at all.
   */
  moved: number;
  /** Leaves that went into this batch's merkle root. */
  leaves: [string, number][];
}

export interface SettlerDeps {
  ledger: SettlementLedger;
  client: Client;
  token: string;
  /** Account debited for every payout. */
  payer: string;
  /** v1 hard-coded the testnet URL. */
  mirrorUrl?: string;
  /** v1 hard-coded "carpool:batch:". */
  memoPrefix?: string;
  /** Seconds a settle/reconcile run holds the cross-process lease. */
  leaseTtlSeconds?: number;
  /**
   * Submit one batch transfer and report its on-ledger outcome. Defaults to
   * executing against `client` and reading the receipt.
   *
   * Injectable because the outcome classification — the code that decides
   * whether the payees were actually paid — otherwise has no test seam at all,
   * and it is the part whose failure costs money.
   *
   * A rejection means "we do not know whether this reached consensus"; that
   * batch is then left pending for `reconcile` **and the rest of the epoch still
   * runs**. A consensus-reached failure must be *returned*, not thrown.
   */
  submit?: (tx: TransferTransaction, client: Client) => Promise<TransferOutcome>;
}

/**
 * One settler per deps. The in-process concurrency guard is instance state, not
 * a module singleton — v1's was global, which meant two ledgers in one process
 * shared a lock they had no reason to share. Across processes the guard is a
 * lease row in the ledger itself (see `acquireLease`), because "one Settler per
 * process" is an invariant nothing could enforce and two processes over one
 * `ledger.sqlite` could pay a royalty twice.
 *
 * Anchoring is NOT done here. v1 called anchorEpoch at the end of every run,
 * which is why the live database holds 13 anchors for 1 batch. The caller
 * anchors, and decides whether an epoch is worth anchoring.
 */
export class Settler {
  private running: Promise<SettledBatch[]> | null = null;

  constructor(private readonly deps: SettlerDeps) {}

  get mirrorUrl(): string {
    return this.deps.mirrorUrl ?? "https://testnet.mirrornode.hedera.com";
  }

  private get leaseTtl(): number {
    return this.deps.leaseTtlSeconds ?? LEASE_TTL_SECONDS;
  }

  /** A token no other acquisition can collide with, so nothing renews implicitly. */
  private newLeaseToken(op: string): string {
    return `${op}:${process.pid}:${randomUUID()}`;
  }

  /**
   * Settle everything currently owed. Concurrent calls in this process share one
   * run; a concurrent run in *another* process is refused by the lease, and this
   * call returns empty rather than building a second batch over the same rows.
   */
  async settle(): Promise<SettledBatch[]> {
    if (this.running) return this.running;
    this.running = this.settleLeased().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async settleLeased(): Promise<SettledBatch[]> {
    const token = this.newLeaseToken("settle");
    if (!this.deps.ledger.acquireLease(token, this.leaseTtl)) {
      console.warn(
        "settle: another process holds the settlement lease; skipping this epoch. " +
          "Nothing is lost — the payouts stay owed and the next epoch picks them up.",
      );
      return [];
    }
    try {
      return await this.run();
    } finally {
      this.deps.ledger.releaseLease(token);
    }
  }

  private async run(): Promise<SettledBatch[]> {
    const { ledger, client, token, payer } = this.deps;
    const { chunks } = groupAndChunk(ledger.unsettled());
    const out: SettledBatch[] = [];

    for (const chunk of chunks) {
      // Per chunk, so one batch's failure cannot cost the epoch its other
      // batches. `submit` throwing used to reject out of settle(), which meant
      // chunk 2 was never attempted and chunk 1's payees were left claimed by a
      // pending batch with no route able to release them (H3, verified).
      try {
        const settled = await this.settleChunk(chunk, { ledger, client, token, payer });
        if (settled) out.push(settled);
      } catch (e) {
        // Ambiguous: the batch keeps its NULL tx_id and stays pending, which is
        // exactly what reconcile() looks for. Its rows stay claimed, because
        // releasing a transfer that may have landed pays every payee twice.
        console.error(
          `settle: batch for payees ${chunk.map(([p]) => p).join(", ")} failed with an ` +
            `ambiguous error (${(e as Error).message}); left pending for reconcile. ` +
            "Continuing with the rest of the epoch.",
        );
      }
    }
    return out;
  }

  /** One chunk: claim, rebuild from what was won, submit, classify. */
  private async settleChunk(
    chunk: PayeeChunk,
    deps: { ledger: SettlementLedger; client: Client; token: string; payer: string },
  ): Promise<SettledBatch | null> {
    const { ledger, client, token, payer } = deps;
    const requested = chunk.flatMap(([, , i]) => i);
    const provisional = chunk.map(([p, a]) => [p, a] as [string, number]);
    const { id, memo, claimed } = ledger.claimBatch(
      merkleRoot(payeeLeaves(provisional)),
      requested,
    );

    if (claimed.length === 0) {
      ledger.markSettled(id, "", BATCH_STATUS.emptyClaim);
      return null;
    }

    // Rebuild from what we won, never from what we read.
    const claimedSet = new Set(claimed);
    const leaves: [string, number][] = [];
    for (const [payee, , ids] of chunk) {
      const amt = ledger.sum(ids.filter((i) => claimedSet.has(i)));
      if (amt > 0) leaves.push([payee, amt]);
    }
    if (leaves.length === 0) {
      ledger.markSettled(id, "", BATCH_STATUS.emptyClaim);
      return null;
    }

    const total = leaves.reduce((s, [, a]) => s + a, 0);

    // A payee that IS the payer is paying itself: the SDK nets the two entries
    // into a single 0-amount adjustment, so the transaction moves nothing, costs
    // a fee, and leaves the ledger claiming the row was paid by a transaction id
    // whose transfer list contains no such movement (docs/AUDIT-MONEY.md L1 —
    // and for the registry, whose tracker_fee payee *is* the batch payer, a
    // fee-only epoch is the ordinary case right after a sale). Net them out
    // here: the obligation is discharged by construction, and no transfer is
    // built for it.
    const toMove = leaves.filter(([p]) => p !== payer);
    const moved = toMove.reduce((s, [, a]) => s + a, 0);
    if (toMove.length === 0) {
      ledger.markSettled(id, "", BATCH_STATUS.noTransfer);
      return { id, txId: "", payees: leaves.length, total, moved: 0, leaves };
    }

    const tx = new TransferTransaction().setTransactionMemo(memo);
    for (const [acct, amt] of toMove) tx.addTokenTransfer(token, acct, amt);
    tx.addTokenTransfer(token, payer, -moved);

    const submit = this.deps.submit ?? defaultSubmit;
    const { txId, status } = await submit(tx, client);

    switch (classifyLedgerResult(status)) {
      case "success": {
        if (!ledger.markSettled(id, txId, status)) {
          // The batch was no longer pending, so something else already decided
          // its outcome while this transfer was in the air. The observation is
          // kept (see markSettled) rather than overwriting what is there.
          console.error(
            `settle: batch ${id} paid as ${txId} but was no longer pending — recorded as a ` +
              "conflict, NOT as this batch's outcome. Its rows may have been paid twice.",
          );
          return null;
        }
        return { id, txId, payees: leaves.length, total, moved, leaves };
      }
      case "failed": {
        // Reached consensus, moved nothing. The payees are still owed, so the
        // rows go back to claimable and the next run retries them — one at a
        // time per payee that has failed before, and not forever (see markFailed).
        const released = ledger.markFailed(id, txId, status);
        console.error(
          `settle: batch ${id} failed on-ledger as ${status} (${txId || "no tx id"}); ` +
            `${released.length} payout(s) returned to claimable`,
        );
        return null;
      }
      default:
        if (status) {
          // The ledger answered with a code we do not recognise. A reconcile
          // pass would read the same code off the mirror node and reach the same
          // verdict, so there is nothing to wait for: make it an operator's
          // problem now, with the transaction id they need to look it up.
          ledger.markNeedsOperator(
            id,
            txId,
            status,
            "the transfer returned a result this build cannot classify, so neither settling " +
              "(which strands the payees) nor releasing (which risks paying them twice) is safe",
          );
        } else {
          // No result at all: we genuinely do not know whether it reached
          // consensus. Leave it pending with a NULL tx_id, which is what
          // reconcile() selects on.
          console.error(
            `settle: batch ${id} returned no result (${txId || "no tx id"}); left pending for ` +
              "reconcile, NOT settled",
          );
        }
        return null;
    }
  }

  /**
   * Restart reconcile: pending batches with no txId are matched against the
   * mirror node by memo. Best-effort; an unconfirmed batch is left pending
   * rather than given a fabricated transaction id — but not forever: after
   * `RECONCILE_ATTEMPTS_BEFORE_OPERATOR` fruitless passes it is escalated to
   * `NEEDS_OPERATOR:` so a batch that can never be confirmed stops being an
   * invisible strand.
   *
   * A mirror-node record proves consensus, NOT payment. A transfer that reached
   * consensus and then failed — `INSUFFICIENT_TOKEN_BALANCE`,
   * `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT` — is recorded exactly like one that paid,
   * so the `result` field is the only thing that separates them and is checked
   * before anything is marked settled.
   *
   * Holds the same lease `settle()` does. Without it, a reconcile in one process
   * could read a failed sibling record for a batch whose transfer another
   * process had not finished submitting, release its rows, and have the transfer
   * then land SUCCESS — paying the same royalty twice on the next epoch (H4,
   * verified).
   */
  async reconcile(): Promise<void> {
    const token = this.newLeaseToken("reconcile");
    if (!this.deps.ledger.acquireLease(token, this.leaseTtl)) {
      console.warn(
        "reconcile: the settlement lease is held (a settle run, or another process); " +
          "skipping. Releasing a batch whose transfer is still in the air pays its payees twice.",
      );
      return;
    }
    try {
      await this.reconcileHeld();
    } finally {
      this.deps.ledger.releaseLease(token);
    }
  }

  private async reconcileHeld(): Promise<void> {
    const pending = this.deps.ledger.pending();
    if (pending.length === 0) return;

    // v1 queried the mirror node network-wide — the last 100 transactions span
    // about five seconds, so our batch was never in them and reconcile could
    // not work. Query by the account that actually pays.
    const url = `${this.mirrorUrl}/api/v1/transactions?account.id=${this.deps.payer}&limit=100&order=desc`;
    let txs: any[] = [];
    try {
      const res = await fetch(url);
      txs = ((await res.json()) as any)?.transactions ?? [];
    } catch (e) {
      console.warn(
        `reconcile: mirror node unreachable (${(e as Error).message}); batches left pending`,
      );
      return;
    }

    for (const b of pending) {
      // ALL records carrying this memo, not the first. A submission retried with
      // the same transaction id produces a sibling record, and a batch whose
      // sibling succeeded must never be read off the one that lost.
      const matches = txs.filter(
        (t) =>
          t.memo_base64 && Buffer.from(t.memo_base64, "base64").toString("utf8") === b.memo,
      );
      if (matches.length === 0) {
        this.countAndMaybeEscalate(
          b,
          "",
          "UNCONFIRMED",
          "no mirror-node record carries this batch's memo. Either the transfer was never " +
            "submitted (a precheck rejection leaves no record) or its record has scrolled " +
            "off the 100-transaction page this reads",
        );
        continue;
      }

      const paid = matches.find((m) => classifyLedgerResult(m.result) === "success");
      if (paid) {
        this.deps.ledger.markSettled(b.id, paid.transaction_id, paid.result);
        console.log(`reconcile: batch ${b.id} confirmed paid as ${paid.transaction_id}`);
        continue;
      }

      if (matches.every((m) => classifyLedgerResult(m.result) === "failed")) {
        // Every record for this memo reached consensus and moved nothing. The
        // money never left, so the payouts are still owed — hand them back.
        const m = matches[0];
        const released = this.deps.ledger.markFailed(b.id, m.transaction_id, m.result);
        console.error(
          `reconcile: batch ${b.id} (${b.memo}) FAILED on-ledger as ${m.result} ` +
            `(${m.transaction_id}); ${released.length} payout(s) returned to claimable for retry`,
        );
        continue;
      }

      // At least one record we cannot classify — e.g. DUPLICATE_TRANSACTION,
      // whose winning sibling may be outside the page we fetched. Settling it
      // would strand the payees; releasing it could pay them twice. Neither —
      // but count the pass, because reading the same unclassifiable record on
      // every future pass is a permanent strand dressed as a retry.
      const unclassified = matches.find((m) => classifyLedgerResult(m.result) === "unknown");
      this.countAndMaybeEscalate(
        b,
        unclassified?.transaction_id ?? "",
        String(unclassified?.result ?? ""),
        `matched ${matches.length} record(s) with unrecognised result(s) ` +
          matches.map((m) => JSON.stringify(m.result)).join(", "),
      );
    }
  }

  /** Count a fruitless reconcile pass, and escalate once there have been enough. */
  private countAndMaybeEscalate(
    b: { id: number; memo: string },
    txId: string,
    status: string,
    why: string,
  ): void {
    const n = this.deps.ledger.bumpReconcileAttempt(b.id);
    if (n >= RECONCILE_ATTEMPTS_BEFORE_OPERATOR) {
      this.deps.ledger.markNeedsOperator(
        b.id,
        txId,
        status,
        `${n} reconcile passes could neither confirm nor refute it: ${why}`,
      );
      return;
    }
    console.warn(
      `reconcile: batch ${b.id} (${b.memo}) unresolved on pass ${n} of ` +
        `${RECONCILE_ATTEMPTS_BEFORE_OPERATOR} — ${why}; left pending`,
    );
  }
}

/**
 * Execute the transfer and read its receipt.
 *
 * Separated from `run()` so the ambiguous case has exactly one definition: this
 * function returns a `TransferOutcome` whenever the ledger told us what
 * happened — a success, a consensus-reached failure, or a precheck rejection
 * (which is the network telling us it never submitted the transfer at all) — and
 * throws only when it did not.
 */
export async function defaultSubmit(
  tx: TransferTransaction,
  client: Client,
): Promise<TransferOutcome> {
  let resp: Awaited<ReturnType<TransferTransaction["execute"]>>;
  try {
    resp = await tx.execute(client);
  } catch (e) {
    // A precheck rejection was never inspected here, so even an allow-listed
    // code like INSUFFICIENT_PAYER_BALANCE threw out of the entire epoch, and
    // the batch it left behind could never be reconciled: the mirror node holds
    // no record for a transaction that was not submitted.
    const status = precheckFailure(e);
    if (status) return { txId: "", status };
    throw e;
  }
  const txId = resp.transactionId?.toString() ?? "";
  try {
    const rcpt = await resp.getReceipt(client);
    return { txId, status: rcpt.status.toString() };
  } catch (e) {
    const status = consensusFailure(e);
    if (status) return { txId, status };
    throw e; // genuinely ambiguous — the caller leaves the batch pending
  }
}

export function createSettler(deps: SettlerDeps): Settler {
  return new Settler(deps);
}
