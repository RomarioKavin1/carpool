/**
 * TEMPORARY driver: dump the run's ledger tables as text, for the evidence
 * directory. Read-only; opens the same `ledger.sqlite` the server is using
 * (WAL allows concurrent readers).
 */
import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const db = new Database(process.env.LEDGER_DB!, { readonly: true });
const OUT = process.env.OUT_DIR!;

const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all() as { name: string }[])
  .map((r) => r.name)
  .filter((n) => !n.startsWith("sqlite_") && !n.startsWith("vec_") && !n.includes("_chunks") && !n.includes("_rowids") && !n.includes("_vector"));

const lines: string[] = [
  "carpool v2 full-feature testnet run — ledger rows, verbatim",
  `dumped ${new Date().toISOString()} from ${process.env.LEDGER_DB}`,
  "",
  "The vector-index tables (sqlite-vec shadow tables) are omitted: they hold",
  "float32 blobs, not money. Every other table in the run's database is here.",
  "",
];

for (const t of tables) {
  let rows: Record<string, unknown>[];
  try {
    rows = db.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[];
  } catch (e) {
    lines.push(`## ${t}  (unreadable: ${(e as Error).message})`, "");
    continue;
  }
  lines.push(`## ${t}  (${rows.length} row${rows.length === 1 ? "" : "s"})`, "");
  if (rows.length === 0) {
    lines.push("  (empty)", "");
    continue;
  }
  const cols = Object.keys(rows[0]!);
  const shorten = (v: unknown) => {
    const s = v === null ? "NULL" : String(v);
    // The artifact table holds whole manifests; the money columns are the point.
    return s.length > 120 ? `${s.slice(0, 117)}...` : s;
  };
  for (const r of rows) {
    lines.push(`  ${cols.map((c) => `${c}=${shorten(r[c])}`).join("  ")}`);
  }
  lines.push("");
}

writeFileSync(join(OUT, "91-ledger-rows.txt"), `${lines.join("\n")}\n`);
console.log(`-> 91-ledger-rows.txt (${tables.length} tables)`);
db.close();
