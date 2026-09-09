import { openDb as railOpenDb, type OpenDb as RailOpenDb } from "@carpool/hedera-x402";
import { DDL, migrate, schema } from "./schema.js";

export type DB = RailOpenDb<typeof schema>["db"];
export type OpenDb = RailOpenDb<typeof schema>;

/**
 * Open (creating if absent) the registry DB with the rail's batch/payout tables
 * plus ours, and bring an existing file up to the current schema.
 *
 * `DDL` is `CREATE TABLE IF NOT EXISTS` throughout, so it can only ever create:
 * a column added later exists on new databases and is missing on every deployed
 * one. `migrate` is the other half. (The rail migrates its own `payout`/`batch`
 * columns in `SqliteSettlementLedger`'s constructor, for the same reason.)
 */
export function openDb(path?: string): OpenDb {
  const opened = railOpenDb({ path, ddl: DDL, schema });
  const applied = migrate(opened.sqlite);
  if (applied.length > 0) {
    console.log(`registry: migrated ledger schema — added ${applied.join(", ")}`);
  }
  return opened;
}

export * from "./schema.js";
