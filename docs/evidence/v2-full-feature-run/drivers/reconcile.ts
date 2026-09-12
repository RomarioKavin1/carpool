/**
 * TEMPORARY driver: run the production `Settler.reconcile()` over the run's real
 * ledger, N times, against the real mirror node. Nothing is injected — this is
 * `createRegistrySettler`, the same factory `apps/registry/src/server.ts` uses,
 * so this is the same code path the server's boot reconcile takes.
 *
 *   npx tsx live/reconcile.ts [passes]
 */
import { openDb } from "../src/db/index.js";
import { loadConfig, REFUND_WINDOW_SECONDS } from "../src/config.js";
import { RegistryLedger } from "../src/ledger.js";
import { createRegistrySettler } from "../src/settlement.js";
import { makeClient } from "@carpool/hedera-x402";

const passes = Number(process.argv[2] ?? 1);
const cfg = loadConfig();
const { db, sqlite } = openDb(cfg.ledgerDbPath);
const ledger = new RegistryLedger(db, sqlite, {
  trackerFee: cfg.trackerFee,
  registryAccount: cfg.registryAccount,
  refundWindowSeconds: REFUND_WINDOW_SECONDS,
});
const client = makeClient();
if (!client) throw new Error("no Hedera client");
const settler = createRegistrySettler(cfg, ledger, client);

const log: unknown[] = [];
for (let i = 1; i <= passes; i++) {
  const pendingBefore = ledger.settlement.pending();
  await settler.reconcile();
  const batches = ledger.batches();
  log.push({
    pass: i,
    at: new Date().toISOString(),
    pendingBefore,
    pendingAfter: ledger.settlement.pending(),
    batches: batches.slice(0, 4),
  });
}
console.log(JSON.stringify({ passes, log }, null, 2));
sqlite.close();
client.close();
