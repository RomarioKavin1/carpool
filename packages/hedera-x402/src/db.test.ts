/**
 * `openDb`'s pragmas, and what concurrency they actually buy.
 *
 * docs/AUDIT-MONEY.md H1 names "`journal_mode = WAL` with no `busy_timeout`" as
 * the likeliest trigger of a settled payment that records nothing: a concurrent
 * writer makes the `recordPurchase` write throw straight into
 * `PaymentGate.handle`'s `onPaid` catch. **Half of that is wrong, and the tests
 * below are why it matters which half.**
 *
 *  - better-sqlite3 already applies `busy_timeout = 5000` to every connection it
 *    opens (its `timeout` option's default), so a plain contended write *does*
 *    wait, across processes, and never threw. `openDb` now sets the pragma
 *    explicitly anyway — a money database should not inherit its only
 *    concurrency guarantee from a driver default nobody can see, and the
 *    explicit pragma is what makes it tunable.
 *  - What genuinely does throw immediately, with no busy handler and no timeout
 *    that can help, is `SQLITE_BUSY_SNAPSHOT`: a *deferred* transaction that has
 *    already read cannot be upgraded to a writer once another connection has
 *    committed. That is the real version of the audit's finding, and the only fix
 *    is to take the write lock up front — `BEGIN IMMEDIATE`. See the third test
 *    here for the mechanism and `apps/registry/src/ledger.test.ts`
 *    ("a concurrent writer") for the money path it was reachable on.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { openDb, BATCH_DDL } from "./db.js";

const DDL = `${BATCH_DDL}\nCREATE TABLE IF NOT EXISTS thing (id INTEGER PRIMARY KEY, v TEXT);`;

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "carpool-db-pragma-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("openDb pragmas", () => {
  it("sets WAL and a non-zero busy_timeout", () => {
    const { sqlite } = openDb({ path: join(dir, "pragmas.sqlite"), ddl: DDL, schema: {} });
    try {
      expect(String(sqlite.pragma("journal_mode", { simple: true })).toLowerCase()).toBe("wal");
      expect(
        Number(sqlite.pragma("busy_timeout", { simple: true })),
        "a contended write must wait for the other writer, not throw at it",
      ).toBeGreaterThanOrEqual(1_000);
    } finally {
      sqlite.close();
    }
  });

  it("honours an explicit busyTimeoutMs, so an operator can tune it", () => {
    const { sqlite } = openDb({
      path: join(dir, "explicit.sqlite"),
      ddl: DDL,
      schema: {},
      busyTimeoutMs: 250,
    });
    try {
      expect(Number(sqlite.pragma("busy_timeout", { simple: true }))).toBe(250);
    } finally {
      sqlite.close();
    }
  });

  /**
   * The interleaving H1 describes, across two OS processes over one file — which
   * is what a rolling restart, `docker compose up` over a draining container, or
   * an operator's `sqlite3` session actually is. The child holds the write lock
   * for 400 ms and this process must wait it out.
   *
   * Cross-process on purpose: better-sqlite3 is synchronous, so a second
   * connection in *this* process could never release a lock while we block on it.
   */
  it("waits out another process's write lock instead of throwing", async () => {
    const path = join(dir, "contended.sqlite");
    const { sqlite: setup } = openDb({ path, ddl: DDL, schema: {} });
    setup.close();

    // Control: with the timeout explicitly disabled, a contended write throws
    // the instant another connection holds the lock. This is the *only* shape in
    // which the audit's "no busy_timeout" claim is true, and it takes an explicit
    // `busy_timeout = 0` to reach.
    const holder = new Database(path);
    holder.exec("BEGIN IMMEDIATE; INSERT INTO thing (v) VALUES ('holder');");
    const impatient = new Database(path);
    impatient.pragma("busy_timeout = 0");
    try {
      expect(() => impatient.prepare(`INSERT INTO thing (v) VALUES ('x')`).run()).toThrow(
        /database is locked/,
      );
    } finally {
      holder.exec("COMMIT");
      holder.close();
      impatient.close();
    }

    const child = spawn(
      process.execPath,
      [
        "-e",
        `const D=require("better-sqlite3");const db=new D(${JSON.stringify(path)});` +
          `db.pragma("journal_mode = WAL");` +
          `db.exec("BEGIN IMMEDIATE; INSERT INTO thing (v) VALUES ('child');");` +
          `process.stdout.write("locked\\n");` +
          `const t=Date.now();while(Date.now()-t<400){}db.exec("COMMIT");db.close();`,
      ],
      { cwd: new URL("..", import.meta.url).pathname },
    );
    let stderr = "";
    child.stderr.on("data", (b: Buffer) => {
      stderr += b.toString();
    });
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.on("data", (b: Buffer) => {
          if (b.toString().includes("locked")) resolve();
        });
        child.on("error", reject);
        // Loud rather than skipped: if the child cannot open the database, this
        // test has measured nothing and must say so.
        child.on("exit", (c) =>
          reject(new Error(`child exited early (${c}): ${stderr.trim() || "no stderr"}`)),
        );
      });

      const { sqlite } = openDb({ path, ddl: DDL, schema: {} });
      try {
        // Synchronous, so this genuinely blocks here until the child commits.
        expect(() => sqlite.prepare(`INSERT INTO thing (v) VALUES ('parent')`).run()).not.toThrow();
        expect(
          (sqlite.prepare(`SELECT COUNT(*) AS n FROM thing`).get() as { n: number }).n,
          "both writers' rows are present: the second waited rather than failing",
        ).toBeGreaterThanOrEqual(3);
      } finally {
        sqlite.close();
      }
    } finally {
      child.kill();
    }
  });

  /**
   * The failure `busy_timeout` cannot fix, and therefore the one that matters.
   *
   * A `BEGIN` (deferred) transaction that reads first takes only a read snapshot.
   * If another connection commits before it writes, the upgrade to a writer is
   * refused with `SQLITE_BUSY_SNAPSHOT` **immediately** — SQLite does not invoke
   * the busy handler for it, because waiting cannot help: the snapshot this
   * transaction has already read from is stale and the transaction must be
   * retried from the start. Any read-then-write money transaction is therefore
   * one concurrent commit away from throwing, whatever the timeout says.
   *
   * `BEGIN IMMEDIATE` takes the write lock at the start, so the conflict lands on
   * the *other* writer (where `busy_timeout` does apply and does wait) instead of
   * on the transaction that is recording money.
   */
  it("a deferred read-then-write transaction throws SQLITE_BUSY_SNAPSHOT, timeout or not", () => {
    const path = join(dir, "snapshot.sqlite");
    const { sqlite: a } = openDb({ path, ddl: DDL, schema: {} });
    const other = new Database(path);
    try {
      a.prepare(`INSERT INTO thing (v) VALUES ('seed')`).run();
      expect(Number(a.pragma("busy_timeout", { simple: true }))).toBeGreaterThan(0);

      // Deferred: read, then somebody else commits, then write.
      a.exec("BEGIN");
      a.prepare(`SELECT COUNT(*) AS n FROM thing`).get();
      other.prepare(`INSERT INTO thing (v) VALUES ('other')`).run();
      let code: string | undefined;
      try {
        a.prepare(`INSERT INTO thing (v) VALUES ('mine')`).run();
      } catch (e) {
        code = (e as { code?: string }).code;
      }
      expect(code, "the busy handler is never consulted for a stale snapshot").toBe(
        "SQLITE_BUSY_SNAPSHOT",
      );
      a.exec("ROLLBACK");

      // Immediate: the write lock is held from the start, so our write cannot be
      // refused — the other connection is the one that has to wait.
      a.exec("BEGIN IMMEDIATE");
      a.prepare(`SELECT COUNT(*) AS n FROM thing`).get();
      other.pragma("busy_timeout = 0");
      expect(() => other.prepare(`INSERT INTO thing (v) VALUES ('other2')`).run()).toThrow(
        /database is locked/,
      );
      expect(() => a.prepare(`INSERT INTO thing (v) VALUES ('mine2')`).run()).not.toThrow();
      a.exec("COMMIT");
    } finally {
      other.close();
      a.close();
    }
  });
});
