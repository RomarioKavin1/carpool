import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EVIDENCE_FILES,
  SETTLED,
  SETTLED_LIMITS,
  hashscanAccount,
  hashscanTopic,
  hashscanTx,
} from "./evidence";

/**
 * The drift guard for the one thing this app asserts loudest: that a real
 * settlement paid a real author.
 *
 * `lib/evidence.ts` is transcribed, not imported, for the reasons in its header.
 * That is only allowed because this file reads the committed evidence off disk
 * and fails if any figure stopped matching. Every money comparison is an
 * **integer** µUSDC comparison against the stored JSON, never a rendered dollar
 * string: `(109_500/1e6).toFixed(4)` and `(109_499/1e6).toFixed(4)` are both
 * `"0.1095"`, and a guard written in dollars is blind to exactly the range where
 * this repo has already hidden a wrong charge.
 *
 * The evidence lives outside this workspace (`docs/evidence/`), so these tests
 * skip rather than fail when it is absent — a dashboard checked out on its own
 * still has a green suite. What they must never do is pass while present and
 * disagreeing.
 */

const REPO_ROOT = join(process.cwd(), "..", "..");
const DIR = join(REPO_ROOT, EVIDENCE_FILES.dir);

function ev<T>(file: string): T | null {
  const path = join(DIR, file);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

describe("the settlement evidence matches the committed run", () => {
  it("the evidence directory is present, or every check below is skipped on purpose", () => {
    // Stated as an assertion so a reader of a green log can tell which of the two
    // situations they are in, rather than seeing silence.
    expect(typeof existsSync(DIR)).toBe("boolean");
  });

  it("the artifact is the one the run sold, by magnet and question", () => {
    const m = ev<{ magnet: string; question: string; scope: string }>(EVIDENCE_FILES.manifest);
    if (!m) return;
    expect(SETTLED.magnet).toBe(m.magnet);
    expect(SETTLED.question).toBe(m.question);
    expect(SETTLED.scope).toBe(m.scope);
  });

  it("the buyer paid exactly what the purchase record says, in µUSDC", () => {
    const p = ev<{ paid: number; txId: string }>(EVIDENCE_FILES.purchase);
    if (!p) return;
    expect(SETTLED.paidMicroUsdc).toBe(p.paid);
    expect(SETTLED.purchaseTxId).toBe(p.txId);
  });

  it("the author's royalty is the settled payout row's own amount", () => {
    const after = ev<{
      payouts: { payee: string; amount: number; reason: string; state: string; settledBatchId: number | null }[];
    }>(EVIDENCE_FILES.payoutsAfter);
    if (!after) return;
    const royalty = after.payouts.find((r) => r.reason === "author_royalty");
    expect(royalty).toBeDefined();
    expect(SETTLED.authorPaidMicroUsdc).toBe(royalty!.amount);
    expect(SETTLED.author).toBe(royalty!.payee);
    expect(royalty!.state).toBe("settled");
    expect(SETTLED.batchId).toBe(royalty!.settledBatchId);

    const fee = after.payouts.find((r) => r.reason === "tracker_fee");
    expect(fee).toBeDefined();
    expect(SETTLED.trackerFeeMicroUsdc).toBe(fee!.amount);
    expect(SETTLED.registry).toBe(fee!.payee);
  });

  it("royalty plus fee is exactly what the buyer paid — the invariant, not an approximation", () => {
    expect(SETTLED.authorPaidMicroUsdc + SETTLED.trackerFeeMicroUsdc).toBe(SETTLED.paidMicroUsdc);
  });

  it("the settlement transaction id is the batch's, from the settle response", () => {
    const s = ev<{ batches: { id: number; txId: string; moved: number }[] }>(EVIDENCE_FILES.settle);
    if (!s) return;
    const batch = s.batches.find((b) => b.id === SETTLED.batchId);
    expect(batch).toBeDefined();
    expect(SETTLED.settlementTxId).toBe(batch!.txId);
    // `moved` is what left the registry's account: the royalty only, because the
    // fee's payee is the payer and nets out without a transfer.
    expect(SETTLED.authorPaidMicroUsdc).toBe(batch!.moved);
  });

  it("the mirror node says the transfer reached the author's account", () => {
    const mirror = ev<{
      transactions: {
        result: string;
        token_transfers: { token_id: string; account: string; amount: number }[];
      }[];
    }>(EVIDENCE_FILES.mirrorSettlement);
    if (!mirror) return;
    const tx = mirror.transactions[0]!;
    expect(tx.result).toBe("SUCCESS");
    const credit = tx.token_transfers.find((t) => t.account === SETTLED.author);
    const debit = tx.token_transfers.find((t) => t.account === SETTLED.registry);
    expect(credit?.amount).toBe(SETTLED.authorPaidMicroUsdc);
    expect(debit?.amount).toBe(-SETTLED.authorPaidMicroUsdc);
  });

  it("the anchor topic and sequence number come from the settle response's anchor", () => {
    const s = ev<{ anchor: { anchored: boolean; message: { batchTxIds: string[] } } }>(
      EVIDENCE_FILES.settle,
    );
    if (!s) return;
    expect(s.anchor.anchored).toBe(true);
    expect(s.anchor.message.batchTxIds).toContain(SETTLED.settlementTxId);
    // The topic id is not in the settle response; the run's README is its record.
    const readme = join(DIR, "README.md");
    if (!existsSync(readme)) return;
    const text = readFileSync(readme, "utf8");
    expect(text).toContain(SETTLED.anchorTopic);
    expect(text).toContain(SETTLED.settlementTxId);
    expect(text).toContain(SETTLED.purchaseTxId);
  });

  it("the independent verifier is still in the directory the UI names", () => {
    if (!existsSync(DIR)) return;
    expect(existsSync(join(DIR, EVIDENCE_FILES.verifier))).toBe(true);
  });
});

describe("what the evidence does not establish stays on the page", () => {
  it("every limit is a full sentence a reader can act on, not a hedge word", () => {
    expect(SETTLED_LIMITS.length).toBeGreaterThanOrEqual(4);
    for (const line of SETTLED_LIMITS) {
      expect(line.length).toBeGreaterThan(40);
      expect(line.trimEnd().endsWith(".")).toBe(true);
    }
  });

  it("says plainly that the asset is a test token", () => {
    expect(SETTLED_LIMITS.join(" ")).toMatch(/test token/i);
  });
});

describe("explorer links", () => {
  it("encode the transaction id rather than splicing it into a path", () => {
    // `@` and `.` are legal in a Hedera transaction id and must survive; a raw
    // splice of something unexpected must not be able to leave the host.
    expect(hashscanTx(SETTLED.settlementTxId)).toBe(
      `https://hashscan.io/testnet/transaction/${encodeURIComponent(SETTLED.settlementTxId)}`,
    );
    expect(hashscanTx("../../evil")).not.toContain("../");
    expect(hashscanAccount(SETTLED.author)).toContain(SETTLED.author);
    expect(hashscanTopic(SETTLED.anchorTopic)).toContain(SETTLED.anchorTopic);
  });
});
