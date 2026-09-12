/**
 * TEMPORARY driver: one of two PROCESSES that try to settle the same epoch over
 * the same `ledger.sqlite` at the same instant.
 *
 * Nothing is injected. It builds the ledger and the settler exactly the way
 * `apps/registry/src/server.ts` does (`openDb` + `RegistryLedger` +
 * `createRegistrySettler`) and calls `settle()`. The only cross-process guard in
 * the system is the `settle_lease` row, so whatever this pair produces is what
 * that row is worth.
 *
 *   npx tsx live/concurrent-child.ts <startAtEpochMs> <tag>
 */
import { openDb } from "../src/db/index.js";
import { loadConfig, REFUND_WINDOW_SECONDS } from "../src/config.js";
import { RegistryLedger } from "../src/ledger.js";
import { createRegistrySettler } from "../src/settlement.js";
import { makeClient } from "@carpool/hedera-x402";

const startAt = Number(process.argv[2]);
const tag = process.argv[3] ?? "child";

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

// Everything the settler writes to the console is part of the evidence — the
// loser's "another process holds the settlement lease" line is the only direct
// witness that the two runs actually collided.
const lines: string[] = [];
for (const level of ["log", "warn", "error"] as const) {
  const orig = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    lines.push(`[${level}] ${args.map(String).join(" ")}`);
    orig(...args);
  };
}

// Spin, do not sleep: both processes must enter `settle()` in the same
// millisecond band, and a timer would add its own jitter.
while (Date.now() < startAt) {
  /* spin */
}

const enteredAt = Date.now();
const unsettledSeen = ledger.settlement.unsettled();
const result = await settler.settle();
const leftAt = Date.now();

process.stdout.write(
  `RESULT ${JSON.stringify({
    tag,
    pid: process.pid,
    enteredAt,
    leftAt,
    unsettledSeenAtEntry: unsettledSeen,
    settleReturned: result,
    consoleLines: lines,
    leaseAfter: ledger.settlement.lease(),
  })}\n`,
);
sqlite.close();
client.close();
