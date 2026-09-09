import type Database from "better-sqlite3";
import { BATCH_STATUS, type SettlementLedger } from "./settler.js";

/**
 * Payout rows the settler pays out. The product writes them with its own
 * `reason` and an opaque `ref`; this package only needs payee, amount, and
 * when the row becomes payable.
 *
 * `available_at` is what makes a refund window possible at all: royalties
 * accrue at purchase but must not be paid until the buyer's window closes,
 * or a refund has nothing left to reverse.
 *
 * `attempts` and `parked_at` are the other half of `markFailed`. A cause that
 * will never clear on its own — an author whose account is deleted, or who is
 * not associated with the token — used to be retried every epoch forever
 * (144 real transactions a day at the 600 s default, each costing a fee), and
 * because `markFailed` releases the *whole* chunk, the eight payable authors
 * batched with the ninth were never paid either. So a released row now counts
 * its attempts, `groupAndChunk` isolates any payee with a previous failure into
 * a transfer of its own (see `settler.ts`), and a row that has failed
 * `maxAttempts` times is **parked**: excluded from `unsettled()`, still owed,
 * visible to an operator, and released again only by a deliberate `unpark`.
 */
export const PAYOUT_DDL = `
CREATE TABLE IF NOT EXISTS payout (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payee TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT,
  available_at INTEGER NOT NULL DEFAULT 0,
  voided_at INTEGER,
  settled_batch_id INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  parked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_payout_claimable
  ON payout(available_at)
  WHERE settled_batch_id IS NULL AND voided_at IS NULL AND parked_at IS NULL;
`;

/** One `payout` row, exactly as stored. Snake_case because that is the column. */
export interface PayoutRow {
  id: number;
  payee: string;
  amount: number;
  reason: string;
  ref: string | null;
  available_at: number;
  voided_at: number | null;
  settled_batch_id: number | null;
  /** Consensus-reached failures this row has been released from. */
  attempts: number;
  /** Unix seconds. Set once `attempts` reaches `maxAttempts`: owed, not retried. */
  parked_at: number | null;
}

/** One `batch` row, exactly as stored. `tx_id` is NULL until the transfer is recorded. */
export interface BatchRow {
  id: number;
  tx_id: string | null;
  status: string;
  ts: number;
  root: string;
  memo: string;
  /** Reconcile passes that could neither confirm nor release this batch. */
  reconcile_attempts: number;
}

/**
 * A write that was refused because the batch had already moved on, recorded
 * rather than dropped. `markSettled` used to be unconditional, which let a late
 * "it succeeded" overwrite a `FAILED:<code>` — erasing the only in-database
 * witness that the batch's rows had been released and re-paid by another batch.
 * Making it conditional without keeping the refused observation would trade that
 * for a silent no-op that discards a real transaction id, so both are kept: the
 * batch keeps its earlier truth and the later observation lands here.
 */
export interface BatchConflictRow {
  id: number;
  batch_id: number;
  ts: number;
  observed_tx_id: string | null;
  observed_status: string;
  had_tx_id: string | null;
  had_status: string;
}

export interface SqliteLedgerOptions {
  /** Injectable for tests; defaults to wall clock seconds. */
  now?: () => number;
  memoPrefix?: string;
  /**
   * Consensus-reached failures a payout row is retried through before it is
   * parked for an operator. Five at the 600 s epoch default is under an hour of
   * retrying before a permanently-failing payee stops costing transaction fees.
   */
  maxAttempts?: number;
}

/**
 * Reference SettlementLedger over SQLite. Ships with the package so it is
 * usable without a product ledger, and so the conditional-claim behaviour has
 * one canonical implementation rather than one per consumer.
 *
 * Every transaction here is `.immediate()`. A deferred transaction that reads
 * before it writes is refused with `SQLITE_BUSY_SNAPSHOT` the moment another
 * connection commits — immediately, without consulting `busy_timeout`, because
 * waiting cannot refresh a stale snapshot. Taking the write lock at `BEGIN`
 * moves that conflict onto the other writer, where the timeout does apply. See
 * `db.test.ts` for the mechanism.
 */
export class SqliteSettlementLedger implements SettlementLedger {
  private readonly now: () => number;
  private readonly memoPrefix: string;
  private readonly maxAttempts: number;

  constructor(
    private readonly db: Database.Database,
    opts: SqliteLedgerOptions = {},
  ) {
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
    this.memoPrefix = opts.memoPrefix ?? "carpool:batch:";
    this.maxAttempts = Math.max(1, Math.trunc(opts.maxAttempts ?? 5));
    this.ensureSchema();
  }

  /**
   * Bring an existing database up to the columns this class needs.
   *
   * `PAYOUT_DDL` and `BATCH_DDL` are both `CREATE TABLE IF NOT EXISTS`, so a
   * database created before `attempts`/`parked_at`/`reconcile_attempts` existed
   * would silently keep its old shape and every statement touching them would
   * throw at runtime — schema drift instead of a migration. This runs on every
   * construction (one `PRAGMA table_info` per table), adds only what is missing,
   * and is safe to run concurrently: `ALTER TABLE ADD COLUMN` on a column that
   * now exists raises "duplicate column name", which is caught.
   *
   * Tables are created here only if the owning DDL has not already been applied
   * (the settle lease and the conflict log post-date `BATCH_DDL`'s first
   * release), never dropped and never altered destructively.
   */
  private ensureSchema(): void {
    const columns = (table: string): string[] => {
      try {
        return (this.db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
      } catch {
        return [];
      }
    };
    const add = (table: string, column: string, decl: string) => {
      try {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
      } catch (e) {
        if (!/duplicate column name/i.test((e as Error).message)) throw e;
      }
    };

    const payout = columns("payout");
    if (payout.length > 0) {
      let migrated = false;
      if (!payout.includes("attempts")) {
        add("payout", "attempts", "INTEGER NOT NULL DEFAULT 0");
        migrated = true;
      }
      if (!payout.includes("parked_at")) {
        add("payout", "parked_at", "INTEGER");
        migrated = true;
      }
      if (migrated) {
        // The partial index has to learn about parked rows, and IF NOT EXISTS
        // would leave the old predicate in place on a migrated database.
        this.db.exec(`DROP INDEX IF EXISTS idx_payout_claimable`);
        this.db.exec(
          `CREATE INDEX IF NOT EXISTS idx_payout_claimable ON payout(available_at)
             WHERE settled_batch_id IS NULL AND voided_at IS NULL AND parked_at IS NULL`,
        );
      }
    }

    const batch = columns("batch");
    if (batch.length > 0 && !batch.includes("reconcile_attempts")) {
      add("batch", "reconcile_attempts", "INTEGER NOT NULL DEFAULT 0");
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS batch_conflict (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL,
        ts INTEGER NOT NULL,
        observed_tx_id TEXT,
        observed_status TEXT NOT NULL,
        had_tx_id TEXT,
        had_status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settle_lease (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        token TEXT NOT NULL,
        acquired_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
  }

  // ------------------------------------------------------------- cross-process

  /**
   * Take the settlement lease, or report that somebody else holds it.
   *
   * The in-process guards (`Settler.settle()`'s running promise, `EpochRunner`'s)
   * only serialise callers inside one Node process. Two registry processes over
   * one `ledger.sqlite` — a rolling restart, `docker compose up` over a draining
   * container, an operator running a script — could have one process's
   * `reconcile()` release the rows of a transfer the *other* process was still
   * submitting, whose transfer then landed SUCCESS, and the next epoch paid the
   * same royalty a second time (docs/AUDIT-MONEY.md H4, verified). A comment
   * saying "one Settler per process" cannot stop that; a row that only one
   * process can hold can.
   *
   * One statement, so the check and the take cannot be interleaved. A stale
   * lease (`expires_at` passed) is stealable, which is what stops a crashed
   * process from stopping settlement forever; the TTL is therefore chosen to be
   * comfortably longer than a submit plus its receipt.
   *
   * `token` must be unique per acquisition — a holder never renews implicitly,
   * so a `settle()` holding the lease refuses its own process's `reconcile()`
   * rather than letting it in under the same name.
   */
  acquireLease(token: string, ttlSeconds: number): boolean {
    const now = this.now();
    return (
      this.db
        .prepare(
          `INSERT INTO settle_lease (id, token, acquired_at, expires_at) VALUES (1,?,?,?)
             ON CONFLICT(id) DO UPDATE SET
               token = excluded.token,
               acquired_at = excluded.acquired_at,
               expires_at = excluded.expires_at
             WHERE settle_lease.expires_at <= excluded.acquired_at`,
        )
        .run(token, now, now + Math.max(1, Math.trunc(ttlSeconds))).changes > 0
    );
  }

  /** Release the lease, but only if this token still holds it. */
  releaseLease(token: string): void {
    this.db.prepare(`DELETE FROM settle_lease WHERE id = 1 AND token = ?`).run(token);
  }

  /** Who holds the lease and until when, for diagnostics. */
  lease(): { token: string; acquiredAt: number; expiresAt: number } | null {
    const r = this.db
      .prepare(`SELECT token, acquired_at, expires_at FROM settle_lease WHERE id = 1`)
      .get() as { token: string; acquired_at: number; expires_at: number } | undefined;
    return r ? { token: r.token, acquiredAt: r.acquired_at, expiresAt: r.expires_at } : null;
  }

  // ----------------------------------------------------------------- work queue

  unsettled(): { id: number; payee: string; amount: number; attempts: number }[] {
    return this.db
      .prepare(
        `SELECT id, payee, amount, attempts FROM payout
          WHERE settled_batch_id IS NULL AND voided_at IS NULL AND parked_at IS NULL
            AND available_at <= ?`,
      )
      .all(this.now()) as { id: number; payee: string; amount: number; attempts: number }[];
  }

  sum(ids: number[]): number {
    if (ids.length === 0) return 0;
    const q = ids.map(() => "?").join(",");
    const r = this.db
      .prepare(`SELECT COALESCE(SUM(amount),0) AS t FROM payout WHERE id IN (${q})`)
      .get(...ids) as { t: number };
    return r.t;
  }

  claimBatch(root: string, ids: number[]) {
    const tx = this.db.transaction((rows: number[]) => {
      const ins = this.db
        .prepare(`INSERT INTO batch (tx_id, status, ts, root, memo) VALUES (NULL,'pending',?,?,'')`)
        .run(this.now(), root);
      const id = Number(ins.lastInsertRowid);
      const memo = `${this.memoPrefix}${id}:${root.slice(0, 8)}`;
      this.db.prepare(`UPDATE batch SET memo = ? WHERE id = ?`).run(memo, id);

      const claim = this.db.prepare(
        // Conditional: two runs can read the same rows before either claims.
        `UPDATE payout SET settled_batch_id = ?
          WHERE id = ? AND settled_batch_id IS NULL AND voided_at IS NULL AND parked_at IS NULL`,
      );
      const claimed: number[] = [];
      for (const rowId of rows) {
        if (claim.run(id, rowId).changes > 0) claimed.push(rowId);
      }
      return { id, memo, claimed };
    });
    return tx.immediate(ids);
  }

  /**
   * The batch paid out. Conditional, like every other write here.
   *
   * It used to be the one unconditional write in this class, which meant a late
   * "it succeeded" could overwrite a `FAILED:<code>` whose rows had already been
   * released, re-claimed and paid by a second batch: both batches then claimed to
   * have paid the same payee the same amount, the payout row pointed only at the
   * second, and the failure — the only in-database witness that a release had
   * happened — was gone (docs/AUDIT-MONEY.md M4, verified). The money was already
   * lost by then; this is the record that makes it reconcilable.
   *
   * A refused write is **not** discarded: the observation lands in
   * `batch_conflict` with both what was seen and what the batch already held, so
   * a real transaction id is never thrown away to keep a status intact.
   *
   * @returns whether the batch was actually flipped.
   */
  markSettled(batchId: number, txId: string, status: string): boolean {
    const tx = this.db.transaction((): boolean => {
      const flipped = this.db
        .prepare(
          `UPDATE batch SET tx_id = ?, status = ? WHERE id = ?
             AND (status = 'pending' OR status LIKE '${BATCH_STATUS.needsOperatorPrefix}%')`,
        )
        .run(txId || null, status, batchId);
      if (flipped.changes > 0) return true;
      this.recordConflict(batchId, txId, status);
      return false;
    });
    return tx.immediate();
  }

  /** Log an observation a conditional write refused. Called inside a transaction. */
  private recordConflict(batchId: number, txId: string, status: string): void {
    const had = this.db.prepare(`SELECT tx_id, status FROM batch WHERE id = ?`).get(batchId) as
      | { tx_id: string | null; status: string }
      | undefined;
    this.db
      .prepare(
        `INSERT INTO batch_conflict (batch_id, ts, observed_tx_id, observed_status, had_tx_id, had_status)
           VALUES (?,?,?,?,?,?)`,
      )
      .run(batchId, this.now(), txId || null, status, had?.tx_id ?? null, had?.status ?? "missing");
    console.error(
      `markSettled refused for batch ${batchId}: it is ${had?.status ?? "missing"} ` +
        `(${had?.tx_id ?? "no tx id"}), not pending. Observed ${status} as ${txId || "no tx id"}; ` +
        `recorded in batch_conflict — two transfers may exist for one batch, reconcile by hand`,
    );
  }

  /**
   * The batch's transfer reached consensus and failed. Nothing moved, so the
   * rows it claimed are still owed and go back to claimable.
   *
   * Both halves are conditional, and in one transaction:
   *
   * - the batch flips only `WHERE status = 'pending'`, so a batch already
   *   recorded as paid can never have its rows released — that would pay every
   *   payee in it twice, which is the expensive direction to be wrong in;
   * - rows are released only `WHERE voided_at IS NULL`, so a refund that landed
   *   against this batch is not resurrected as an owed payout.
   *
   * The failure is stored as `FAILED:<result>` rather than the bare result code
   * so no reader has to know Hedera's status names to tell a paid batch from a
   * failed one.
   *
   * Each released row's `attempts` is incremented first, and a row that reaches
   * `maxAttempts` is parked instead of released: still owed, no longer retried,
   * and waiting for an operator (`parked()` / `unpark()`). Without it a single
   * un-payable payee re-submits the same transfer every epoch forever.
   *
   * @returns the payout ids actually returned to claimable — parked ids are not
   * among them.
   */
  markFailed(batchId: number, txId: string, status: string): number[] {
    const tx = this.db.transaction((): number[] => {
      const flipped = this.db
        .prepare(`UPDATE batch SET tx_id = ?, status = ? WHERE id = ? AND status = 'pending'`)
        .run(txId || null, `${BATCH_STATUS.failedPrefix}${status}`, batchId);
      if (flipped.changes === 0) return [];

      const rows = this.db
        .prepare(
          `SELECT id, payee, amount, attempts FROM payout
             WHERE settled_batch_id = ? AND voided_at IS NULL`,
        )
        .all(batchId) as { id: number; payee: string; amount: number; attempts: number }[];

      const bump = this.db.prepare(`UPDATE payout SET attempts = attempts + 1 WHERE id = ?`);
      const park = this.db.prepare(
        `UPDATE payout SET settled_batch_id = NULL, parked_at = ? WHERE id = ?`,
      );
      const release = this.db.prepare(`UPDATE payout SET settled_batch_id = NULL WHERE id = ?`);

      const released: number[] = [];
      const parked: { id: number; payee: string; amount: number }[] = [];
      for (const r of rows) {
        bump.run(r.id);
        if (r.attempts + 1 >= this.maxAttempts) {
          park.run(this.now(), r.id);
          parked.push(r);
        } else {
          release.run(r.id);
          released.push(r.id);
        }
      }
      if (parked.length > 0) {
        console.error(
          `markFailed: parked ${parked.length} payout(s) after ${this.maxAttempts} failed ` +
            `attempt(s) — still owed, no longer retried, needs an operator: ` +
            parked.map((p) => `#${p.id} ${p.payee} ${p.amount}`).join(", "),
        );
      }
      return released;
    });
    return tx.immediate();
  }

  /**
   * The transfer produced a result we cannot classify. Neither settling nor
   * releasing is safe, so the batch is flipped to `NEEDS_OPERATOR:<code>` — the
   * state H2 said the system did not have.
   *
   * The previous behaviour was to leave it `pending` with a NULL `tx_id` "for an
   * operator", which named a role the system gave no tools to: `unsettled()`
   * never returned the rows again, `reconcile()` read the same unrecognised code
   * on every pass, no route reported it and no status anywhere said the payees
   * had not been paid. This status is visible on `GET /batches`, and
   * `operatorRelease` / `operatorMarkPaid` / `operatorRecheck` are the ways out.
   *
   * The transaction id is recorded, unlike before: it is how an operator looks
   * the transfer up on a mirror node and decides which of the two it was.
   */
  markNeedsOperator(batchId: number, txId: string, status: string, reason: string): boolean {
    const tx = this.db.transaction((): boolean => {
      const flipped = this.db
        .prepare(`UPDATE batch SET tx_id = ?, status = ? WHERE id = ? AND status = 'pending'`)
        .run(txId || null, `${BATCH_STATUS.needsOperatorPrefix}${status || "no-result"}`, batchId);
      return flipped.changes > 0;
    });
    const ok = tx.immediate();
    if (ok) {
      console.error(
        `batch ${batchId} needs an operator: ${reason} (result ${JSON.stringify(status)}, ` +
          `${txId || "no tx id"}). Nothing was settled and nothing released; see GET /batches`,
      );
    }
    return ok;
  }

  /**
   * Count one reconcile pass that could neither confirm nor release this batch.
   *
   * @returns the new count, so the caller can escalate at a threshold rather than
   * logging the same "unconfirmed — left pending" line forever.
   */
  bumpReconcileAttempt(batchId: number): number {
    const tx = this.db.transaction((): number => {
      this.db
        .prepare(`UPDATE batch SET reconcile_attempts = reconcile_attempts + 1 WHERE id = ?`)
        .run(batchId);
      const r = this.db.prepare(`SELECT reconcile_attempts AS n FROM batch WHERE id = ?`).get(batchId) as
        | { n: number }
        | undefined;
      return r?.n ?? 0;
    });
    return tx.immediate();
  }

  pending(): { id: number; memo: string }[] {
    return this.db
      .prepare(`SELECT id, memo FROM batch WHERE tx_id IS NULL AND status = 'pending'`)
      .all() as { id: number; memo: string }[];
  }

  // -------------------------------------------------------- operator escapes

  /** Batches waiting on a human decision, newest first. */
  needsOperator(): BatchRow[] {
    return this.db
      .prepare(
        `SELECT id, tx_id, status, ts, root, memo, reconcile_attempts FROM batch
           WHERE status LIKE '${BATCH_STATUS.needsOperatorPrefix}%' ORDER BY id DESC`,
      )
      .all() as BatchRow[];
  }

  /**
   * An operator asserts this batch's transfer moved nothing: hand its rows back.
   *
   * Only a `NEEDS_OPERATOR:` batch can be released this way, so it can never be
   * pointed at a pending batch whose transfer is still in the air or at one
   * already recorded as paid. Attempts are **not** incremented: the operator has
   * looked, so this is not another blind retry, and parking the rows here would
   * hide them again straight after a human freed them.
   */
  operatorRelease(batchId: number): { ok: boolean; released: number[]; reason?: string } {
    const tx = this.db.transaction((): { ok: boolean; released: number[]; reason?: string } => {
      const row = this.db.prepare(`SELECT status FROM batch WHERE id = ?`).get(batchId) as
        | { status: string }
        | undefined;
      if (!row) return { ok: false, released: [], reason: `no batch ${batchId}` };
      if (!row.status.startsWith(BATCH_STATUS.needsOperatorPrefix)) {
        return {
          ok: false,
          released: [],
          reason: `batch ${batchId} is ${row.status}, not ${BATCH_STATUS.needsOperatorPrefix}*`,
        };
      }
      this.db
        .prepare(`UPDATE batch SET status = ? WHERE id = ?`)
        .run(`${BATCH_STATUS.releasedByOperatorPrefix}${row.status}`, batchId);
      const ids = (
        this.db
          .prepare(`SELECT id FROM payout WHERE settled_batch_id = ? AND voided_at IS NULL`)
          .all(batchId) as { id: number }[]
      ).map((r) => r.id);
      this.db
        .prepare(
          `UPDATE payout SET settled_batch_id = NULL, parked_at = NULL
             WHERE settled_batch_id = ? AND voided_at IS NULL`,
        )
        .run(batchId);
      return { ok: true, released: ids };
    });
    return tx.immediate();
  }

  /** An operator asserts this batch's transfer paid, naming the transaction. */
  operatorMarkPaid(batchId: number, txId: string): { ok: boolean; reason?: string } {
    if (!txId) return { ok: false, reason: "a transaction id is required to record a batch as paid" };
    const tx = this.db.transaction((): { ok: boolean; reason?: string } => {
      const row = this.db.prepare(`SELECT status FROM batch WHERE id = ?`).get(batchId) as
        | { status: string }
        | undefined;
      if (!row) return { ok: false, reason: `no batch ${batchId}` };
      if (!row.status.startsWith(BATCH_STATUS.needsOperatorPrefix)) {
        return { ok: false, reason: `batch ${batchId} is ${row.status}, not ${BATCH_STATUS.needsOperatorPrefix}*` };
      }
      this.db
        .prepare(`UPDATE batch SET tx_id = ?, status = ? WHERE id = ?`)
        .run(txId, BATCH_STATUS.settledByOperator, batchId);
      return { ok: true };
    });
    return tx.immediate();
  }

  /**
   * Put a `NEEDS_OPERATOR:` batch back in front of `reconcile()`.
   *
   * The honest answer when the mirror node simply had not caught up, or when the
   * batch's own record had scrolled off the page reconcile reads: clear the
   * recorded result and let the next pass look again.
   */
  operatorRecheck(batchId: number): { ok: boolean; reason?: string } {
    const tx = this.db.transaction((): { ok: boolean; reason?: string } => {
      const changed = this.db
        .prepare(
          `UPDATE batch SET tx_id = NULL, status = 'pending', reconcile_attempts = 0
             WHERE id = ? AND status LIKE '${BATCH_STATUS.needsOperatorPrefix}%'`,
        )
        .run(batchId);
      return changed.changes > 0
        ? { ok: true }
        : { ok: false, reason: `batch ${batchId} is not ${BATCH_STATUS.needsOperatorPrefix}*` };
    });
    return tx.immediate();
  }

  /** Payout rows retired from the retry loop, still owed. */
  parked(): PayoutRow[] {
    return this.db
      .prepare(
        `SELECT id, payee, amount, reason, ref, available_at, voided_at, settled_batch_id,
                attempts, parked_at
           FROM payout WHERE parked_at IS NOT NULL ORDER BY id DESC`,
      )
      .all() as PayoutRow[];
  }

  /**
   * Return a parked row to the work queue, attempts reset.
   *
   * The operator's half of the park: the cause (an unassociated token, a deleted
   * account) is outside this system, so only a human can say it is fixed.
   */
  unpark(payoutId: number): boolean {
    const tx = this.db.transaction(
      () =>
        this.db
          .prepare(
            `UPDATE payout SET parked_at = NULL, attempts = 0
               WHERE id = ? AND parked_at IS NOT NULL AND voided_at IS NULL`,
          )
          .run(payoutId).changes > 0,
    );
    return tx.immediate();
  }

  /** Writes a conditional guard refused, newest first. */
  conflicts(): BatchConflictRow[] {
    return this.db
      .prepare(
        `SELECT id, batch_id, ts, observed_tx_id, observed_status, had_tx_id, had_status
           FROM batch_conflict ORDER BY id DESC`,
      )
      .all() as BatchConflictRow[];
  }

  // --- helpers for the product side ---

  /**
   * Every payout row, or one payee's, newest first — the read side of `accrue`.
   *
   * The rail had no read at all beyond `unsettled()` (which is a *work queue*:
   * it filters to unclaimed, unvoided, already-available rows). So a product
   * could accrue money and never show a payee what they were owed, whether it
   * had been paid, or which batch paid it. `apps/dashboard` had to stamp
   * "settled → not observable" in place of an author's earnings, which for a
   * product whose claim is that authors get paid is the hole worth closing.
   *
   * Returns the raw column values, `state` deliberately not computed here: what
   * "claimable" means depends on the caller's clock, and a rail that guessed at
   * one would put a second clock in the system (see `Payout.state` in the
   * registry's `ledger.ts`, which derives it from `now()` once).
   */
  payouts(filter: { payee?: string } = {}): PayoutRow[] {
    const where = filter.payee ? `WHERE payee = ?` : ``;
    const args = filter.payee ? [filter.payee] : [];
    return this.db
      .prepare(
        `SELECT id, payee, amount, reason, ref, available_at, voided_at, settled_batch_id,
                attempts, parked_at
           FROM payout ${where} ORDER BY id DESC`,
      )
      .all(...args) as PayoutRow[];
  }

  /**
   * Every batch, newest first. `tx_id` is a public Hedera transaction id — the
   * thing that makes "your royalty was paid in batch X" checkable on a mirror
   * node — and nothing served it.
   */
  batches(): BatchRow[] {
    return this.db
      .prepare(
        `SELECT id, tx_id, status, ts, root, memo, reconcile_attempts FROM batch ORDER BY id DESC`,
      )
      .all() as BatchRow[];
  }

  /** Accrue a payout. `availableAt` defers it past a refund window. */
  accrue(row: {
    payee: string;
    amount: number;
    reason: string;
    ref?: string;
    availableAt?: number;
  }): number {
    const r = this.db
      .prepare(
        `INSERT INTO payout (payee, amount, reason, ref, available_at) VALUES (?,?,?,?,?)`,
      )
      .run(row.payee, row.amount, row.reason, row.ref ?? null, row.availableAt ?? 0);
    return Number(r.lastInsertRowid);
  }

  /**
   * The amount a payout row holds, or null if there is no such row.
   *
   * Exists so a product's refund path can reverse **what was actually accrued**
   * rather than recomputing it from today's configuration. The registry used to
   * derive a refund as `paid − trackerFee` with `trackerFee` read from the
   * environment at refund time: raise the fee between a purchase and its refund
   * and the buyer was credited less than the royalty that was voided (the
   * registry silently kept the difference), lower it and they were credited
   * more than the sale received. The row is the record; read the row.
   *
   * Reads the amount whether or not the row is voided or claimed — the caller
   * has just voided it and needs to know what it was worth.
   */
  amountOf(id: number): number | null {
    const r = this.db.prepare(`SELECT amount FROM payout WHERE id = ?`).get(id) as
      | { amount: number }
      | undefined;
    return r ? r.amount : null;
  }

  /** The payee a payout row is owed to, or null if there is no such row. */
  payeeOf(id: number): string | null {
    const r = this.db.prepare(`SELECT payee FROM payout WHERE id = ?`).get(id) as
      | { payee: string }
      | undefined;
    return r ? r.payee : null;
  }

  /**
   * Void an unsettled payout — a refund reversing a royalty. Conditional on the
   * row not already being claimed, so a refund landing while the settler runs
   * cannot double-spend.
   */
  void(id: number): boolean {
    return (
      this.db
        .prepare(
          `UPDATE payout SET voided_at = ?
            WHERE id = ? AND settled_batch_id IS NULL AND voided_at IS NULL`,
        )
        .run(this.now(), id).changes > 0
    );
  }
}
