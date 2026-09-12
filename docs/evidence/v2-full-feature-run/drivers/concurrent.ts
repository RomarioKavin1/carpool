/**
 * TEMPORARY driver: the cross-process settlement test.
 *
 * Two separate OS processes, one `ledger.sqlite`, one epoch, one synchronised
 * start. The in-process guards (`Settler.settle()`'s running promise,
 * `EpochRunner`'s) cannot see across a process boundary, so the only thing
 * standing between this and paying the same royalty twice is the `settle_lease`
 * row. This is the defect that double-paid 8,500 µUSDC in simulation
 * (docs/AUDIT-MONEY.md H4), checked against the real network: the mirror node is
 * asked how many transfers actually exist.
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { api, save, sleep, tx, usdcBalance } from "./lib.js";

const OUT = process.env.OUT_DIR!;
const payee = process.argv[2]!;
const LEAD_MS = 6000;

const startAt = Date.now() + LEAD_MS;

function child(tag: string): Promise<{ tag: string; stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const p = spawn(
      process.execPath,
      ["--import", "tsx", join(import.meta.dirname, "concurrent-child.ts"), String(startAt), tag],
      { cwd: join(import.meta.dirname, ".."), env: process.env },
    );
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (code) => resolve({ tag, stdout, stderr, code }));
  });
}

const balanceBefore = await usdcBalance(payee);
const batchesBefore = (await api("/batches")).body;
const payoutsBefore = (await api("/payouts", { operator: true })).body;

console.log(`starting two processes, both entering settle() at ${new Date(startAt).toISOString()}`);
const [a, b] = await Promise.all([child("A"), child("B")]);

const parse = (r: { tag: string; stdout: string; stderr: string; code: number | null }) => {
  const line = r.stdout.split("\n").find((l) => l.startsWith("RESULT "));
  return {
    tag: r.tag,
    exitCode: r.code,
    result: line ? JSON.parse(line.slice("RESULT ".length)) : null,
    stderrTail: r.stderr.split("\n").slice(-25).join("\n"),
  };
};

const A = parse(a);
const B = parse(b);
console.log(`A returned ${A.result?.settleReturned?.length ?? "?"} batch(es), B ${B.result?.settleReturned?.length ?? "?"}`);

// Give the mirror node time to ingest anything that was submitted, then ask it
// how many transfers carry each new batch's memo. One transfer per memo, and one
// credit to the payee, is the whole claim.
await sleep(8000);

const batchesAfter = (await api("/batches")).body;
const newBatches = batchesAfter.batches.filter(
  (x: any) => !batchesBefore.batches.some((y: any) => y.id === x.id),
);

const payerTxs = await (
  await fetch(
    `${process.env.MIRROR_NODE_URL}/api/v1/transactions?account.id=0.0.10475802&limit=100&order=desc`,
  )
).json();

const memoIndex: Record<string, unknown[]> = {};
for (const nb of newBatches) {
  memoIndex[nb.memo] = (payerTxs.transactions ?? [])
    .filter((t: any) => t.memo_base64 && Buffer.from(t.memo_base64, "base64").toString("utf8") === nb.memo)
    .map((t: any) => ({
      transaction_id: t.transaction_id,
      result: t.result,
      consensus_timestamp: t.consensus_timestamp,
      token_transfers: t.token_transfers,
    }));
}

/** Every transfer to this payee the mirror node knows about, ever. */
const creditsToPayee = (payerTxs.transactions ?? [])
  .filter((t: any) => (t.token_transfers ?? []).some((e: any) => e.account === payee && e.amount > 0))
  .map((t: any) => ({
    transaction_id: t.transaction_id,
    result: t.result,
    memo: t.memo_base64 ? Buffer.from(t.memo_base64, "base64").toString("utf8") : null,
    amount: (t.token_transfers ?? []).filter((e: any) => e.account === payee).reduce((s: number, e: any) => s + e.amount, 0),
  }));

const balanceAfter = await usdcBalance(payee);
const txs: Record<string, unknown> = {};
for (const nb of newBatches) if (nb.txId) txs[nb.txId] = await tx(nb.txId);

save("50-concurrent-settle.json", {
  _what:
    "Two OS processes, one ledger.sqlite, one epoch, both entering Settler.settle() at the same " +
    "millisecond. Only the settle_lease row is cross-process, so this is the only thing that stops " +
    "the same royalty being paid twice.",
  payee,
  synchronisedStartAt: new Date(startAt).toISOString(),
  processA: A,
  processB: B,
  batchesBefore: batchesBefore.batches.slice(0, 3),
  newBatches,
  transfersPerNewBatchMemoOnTheMirrorNode: memoIndex,
  everyCreditToThisPayeeOnTheMirrorNode: creditsToPayee,
  payeeUsdcBalanceBefore: balanceBefore,
  payeeUsdcBalanceAfter: balanceAfter,
  payoutsBefore: payoutsBefore.payouts.filter((p: any) => p.payee === payee),
  payoutsAfter: (await api("/payouts", { operator: true })).body.payouts.filter((p: any) => p.payee === payee),
  mirrorTxs: txs,
});

writeFileSync(
  join(OUT, "50-concurrent-console.txt"),
  [
    `synchronised start: ${new Date(startAt).toISOString()}`,
    "",
    `--- process A (pid ${A.result?.pid}) ---`,
    ...(A.result?.consoleLines ?? []),
    A.stderrTail,
    "",
    `--- process B (pid ${B.result?.pid}) ---`,
    ...(B.result?.consoleLines ?? []),
    B.stderrTail,
  ].join("\n") + "\n",
);

console.log(
  JSON.stringify(
    {
      newBatchCount: newBatches.length,
      transfersPerMemo: Object.fromEntries(Object.entries(memoIndex).map(([k, v]) => [k, (v as unknown[]).length])),
      payeeDelta: balanceAfter - balanceBefore,
    },
    null,
    2,
  ),
);
