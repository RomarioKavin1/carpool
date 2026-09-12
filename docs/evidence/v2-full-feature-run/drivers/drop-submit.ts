/**
 * TEMPORARY driver: produce a genuinely AMBIGUOUS settlement submit, so
 * `Settler.reconcile()` has something real to recover.
 *
 * It uses the production `Settler` and the production `SqliteSettlementLedger`
 * over the run's real ledger, and injects only `SettlerDeps.submit` — the seam
 * the shipped code already has for exactly this ("A rejection means 'we do not
 * know whether this reached consensus'"). Two modes:
 *
 *   drop      — `tx.execute(client)` really runs, so the transfer reaches
 *               consensus and the payees are really paid; the response is then
 *               thrown away WITHOUT reading the receipt. This is the crash
 *               window: the batch keeps a NULL tx_id and stays `pending`, and
 *               the money has moved.
 *   nosubmit  — throws before `execute`, so nothing is submitted and the mirror
 *               node will never hold a record. This is the branch that has to
 *               escalate to an operator instead of being silently stranded.
 *
 * No production file is modified.
 */
import { openDb } from "../src/db/index.js";
import { loadConfig, REFUND_WINDOW_SECONDS } from "../src/config.js";
import { RegistryLedger } from "../src/ledger.js";
import { createSettler, type TransferOutcome } from "@carpool/hedera-x402";
import { makeClient } from "@carpool/hedera-x402";
import type { Client, TransferTransaction } from "@hiero-ledger/sdk";

const mode = process.argv[2];
if (mode !== "drop" && mode !== "nosubmit") throw new Error("usage: drop-submit.ts drop|nosubmit");

const cfg = loadConfig();
const { db, sqlite } = openDb(cfg.ledgerDbPath);
const ledger = new RegistryLedger(db, sqlite, {
  trackerFee: cfg.trackerFee,
  registryAccount: cfg.registryAccount,
  refundWindowSeconds: REFUND_WINDOW_SECONDS,
});
const client = makeClient();
if (!client) throw new Error("no Hedera client");

let submittedTxId = "";

const settler = createSettler({
  ledger: ledger.settlement,
  client,
  token: cfg.asset,
  payer: cfg.registryAccount,
  mirrorUrl: cfg.mirrorNodeUrl,
  memoPrefix: cfg.memoPrefix,
  submit: async (tx: TransferTransaction, c: Client): Promise<TransferOutcome> => {
    if (mode === "nosubmit") {
      throw new Error(
        "injected: the node was unreachable, so the transfer was never submitted (nothing on chain)",
      );
    }
    const resp = await tx.execute(c);
    submittedTxId = resp.transactionId?.toString() ?? "";
    // The receipt is deliberately never read. Everything the caller can learn
    // about this transfer from here is nothing, which is the definition of the
    // ambiguous case.
    throw new Error(
      `injected: the process lost the response before the receipt was read (submitted ${submittedTxId})`,
    );
  },
});

const before = ledger.batches().map((b) => b.id);
const out = await settler.settle();
const after = ledger.batches();
const created = after.filter((b) => !before.includes(b.id));

/**
 * Optional: reconcile immediately, in the same process, with no pause.
 *
 * For `drop` this deliberately RACES the mirror node's ingestion (a couple of
 * seconds): three passes that each find no record escalate the batch to
 * `NEEDS_OPERATOR:UNCONFIRMED` while the transfer has in fact paid — which is
 * precisely the situation `POST /batches/:id/resolve { action: "paid" }` exists
 * for, and the only honest way to reach it.
 */
const thenReconcile = Number(process.argv[3] ?? 0);
const reconcilePasses: unknown[] = [];
if (thenReconcile > 0) {
  const plain = createSettler({
    ledger: ledger.settlement,
    client,
    token: cfg.asset,
    payer: cfg.registryAccount,
    mirrorUrl: cfg.mirrorNodeUrl,
    memoPrefix: cfg.memoPrefix,
  });
  for (let i = 1; i <= thenReconcile; i++) {
    const t0 = Date.now();
    await plain.reconcile();
    reconcilePasses.push({
      pass: i,
      at: new Date().toISOString(),
      ms: Date.now() - t0,
      batches: ledger.batches().slice(0, 2),
      pending: ledger.settlement.pending(),
    });
  }
}

console.log(
  JSON.stringify(
    {
      mode,
      settleReturned: out,
      submittedTxIdTheDriverSaw: submittedTxId || null,
      batchesCreated: created,
      pendingAfter: ledger.settlement.pending(),
      lease: ledger.settlement.lease(),
      reconcilePasses,
      batchesFinal: ledger.batches().slice(0, 3),
    },
    null,
    2,
  ),
);
sqlite.close();
client.close();
