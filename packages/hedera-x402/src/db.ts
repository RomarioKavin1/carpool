import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Open a SQLite database and apply a schema.
 *
 * Unlike the settlement app's version this takes its DDL as an argument rather
 * than importing a specific `schema.ts`. The package ships the `batch` table
 * that settlement needs (see `BATCH_DDL`) and knows nothing about whatever
 * product tables sit alongside it.
 */
export type DB<S extends Record<string, unknown>> = BetterSQLite3Database<S>;

export interface OpenDb<S extends Record<string, unknown>> {
  db: DB<S>;
  sqlite: Database.Database;
}

/**
 * How long a contended write waits for the other writer before giving up.
 *
 * Set explicitly rather than inherited. better-sqlite3 does apply 5 s of its own
 * (its `timeout` option's default), so this is not a behaviour change — it is the
 * difference between a money database whose only concurrency guarantee is a
 * driver default nobody can see and one that states it, can be tuned, and has a
 * test pinning it (`db.test.ts`).
 *
 * Note what a timeout cannot buy, since it is the half of docs/AUDIT-MONEY.md H1
 * that is real: a *deferred* transaction that reads before it writes is refused
 * with `SQLITE_BUSY_SNAPSHOT` the moment another connection commits, immediately
 * and without consulting the busy handler. Every read-then-write transaction that
 * moves money therefore has to take the write lock up front — see
 * `.immediate()` in `sqlite-ledger.ts` and `apps/registry/src/ledger.ts`.
 */
export const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

export function openDb<S extends Record<string, unknown>>(opts: {
  path?: string;
  ddl: string;
  schema: S;
  /** Defaults to `DEFAULT_BUSY_TIMEOUT_MS`. */
  busyTimeoutMs?: number;
}): OpenDb<S> {
  const path = opts.path ?? process.env.LEDGER_DB ?? "./data/ledger.sqlite";
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma(`busy_timeout = ${Math.max(0, Math.trunc(opts.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS))}`);
  // `synchronous` is deliberately left at SQLite's default (FULL). WAL + NORMAL
  // is the usual recommendation and would be faster, but it trades a lost
  // transaction on OS crash for throughput, and the rows in here are payments.
  // `foreign_keys` is likewise left alone: no table here declares one, so
  // turning it on would assert nothing.
  sqlite.exec(opts.ddl);
  return { db: drizzle(sqlite, { schema: opts.schema }), sqlite };
}

/**
 * The settlement batch table. Owned by this package because `createSettler`
 * writes it; product tables live in the consuming app's own schema.
 *
 * `reconcile_attempts` bounds the strand: a batch the mirror node can neither
 * confirm nor refute is escalated to `NEEDS_OPERATOR:` after a few passes rather
 * than logged "unconfirmed — left pending" forever. Added after the first
 * release, so `SqliteSettlementLedger`'s constructor migrates databases created
 * without it — this DDL is `IF NOT EXISTS` and would otherwise leave them alone.
 */
export const BATCH_DDL = `
CREATE TABLE IF NOT EXISTS batch (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_id TEXT, status TEXT NOT NULL, ts INTEGER NOT NULL,
  root TEXT NOT NULL, memo TEXT NOT NULL,
  reconcile_attempts INTEGER NOT NULL DEFAULT 0
);
`;
