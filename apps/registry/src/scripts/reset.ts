import { config as _dotenvConfig } from "dotenv";
import { resolve as _dotenvResolve } from "node:path";
_dotenvConfig({ path: [_dotenvResolve(process.cwd(), ".env"), _dotenvResolve(process.cwd(), "../../.env")] });
import { openDb } from "../db/index.js";

// Wipe registry tables so a demo starts from zero artifacts. Rewritten for
// the v2 schema (artifact/purchase/peer/owed_failure, plus the rail's
// payout/batch) — v1's reset targeted lineage/consumer/accrual/batch/event,
// none of which exist here.
function main() {
  const { sqlite } = openDb();
  for (const t of ["purchase", "artifact", "peer", "owed_failure", "payout", "batch"]) {
    sqlite.exec(`DELETE FROM ${t}; DELETE FROM sqlite_sequence WHERE name='${t}';`);
  }
  sqlite.close();
  console.log("registry reset — zero artifacts");
}

main();
