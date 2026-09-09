import type { Client } from "@hiero-ledger/sdk";
import {
  anchorEpoch,
  createSettler,
  payeeLeaves,
  type AnchorResult,
  type Settler,
  type SettledBatch,
} from "@carpool/hedera-x402";
import type { Config } from "./config.js";
import type { RegistryLedger } from "./ledger.js";

/**
 * One `Settler` per process, shared by the epoch timer and `POST /settle`
 * (see `server.ts`). `Settler`'s concurrency guard is instance state — two
 * `Settler`s over the same ledger would each read the same unclaimed rows
 * and could build two batches before either claimed them, so there must be
 * exactly one of these per registry process, constructed once here.
 */
export function createRegistrySettler(cfg: Config, ledger: RegistryLedger, client: Client): Settler {
  return createSettler({
    ledger: ledger.settlement,
    client,
    token: cfg.asset,
    payer: cfg.registryAccount,
    mirrorUrl: cfg.mirrorNodeUrl,
    memoPrefix: cfg.memoPrefix,
  });
}

export interface SettleEpochResult {
  batches: SettledBatch[];
  anchor: AnchorResult;
  /** What the pre-settle `owed_failure` replay did. See `runSettleEpochOnce`. */
  replayed: { replayed: number; failed: number; unresolvable: number };
}

export interface SettleEpochDeps {
  settler: Settler;
  ledger: RegistryLedger;
  client: Client | null;
  topicId?: string;
  now?: () => number;
}

/**
 * Settle everything owed, then anchor the epoch — in that order, and only
 * from here, never inside `Settler` itself.
 *
 * v1 called `anchorEpoch` at the end of every settle run regardless of
 * whether anything settled, rooted over every accrual ever, so the live
 * testnet topic carries 13 anchors for 1 batch, all with an identical root.
 * An anchor that says nothing changed is not evidence — `anchorEpoch` itself
 * refuses an empty epoch by default, but that only holds if the caller
 * builds a payload that is actually empty when nothing happened, which is
 * what this function does.
 *
 * The anchor's leaves are manifest hashes of artifacts never yet anchored
 * (`RegistryLedger.unanchoredManifests`) plus this epoch's payout rows
 * (`payeeLeaves` over every batch's `leaves`, matching the v1 encoding so
 * existing roots still reproduce). This is deliberately broader than v1's
 * "receipt a payment batch": it timestamps that an artifact existed,
 * unmodified, at a consensus time, which is what makes "I published this
 * first" checkable by anyone with a mirror node — and it means an epoch with
 * new publishes but no sales still anchors (leaves is non-empty even with
 * `batchTxIds: []`), while a genuinely idle epoch (nothing published, nothing
 * settled) still anchors nothing.
 */
async function runSettleEpochOnce(deps: SettleEpochDeps): Promise<SettleEpochResult> {
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));

  // Before settling, turn any settled-but-unrecorded payment into a real
  // purchase, so its royalty is accrued in time to be paid by *this* epoch.
  //
  // `owe()` wrote those rows and nothing read them: a sale whose `onPaid` threw
  // left the buyer with the goods, the author owed nothing and `POST /refund`
  // returning 404, for ever, with recovery meaning "open ledger.sqlite by hand"
  // (docs/AUDIT-MONEY.md H1). `recordPurchase` is idempotent on txId, so this is
  // safe to run every epoch, and it is what makes the durable record a queue
  // rather than a dead letter.
  const replay = deps.ledger.replayOwedFailures();
  if (replay.replayed > 0 || replay.failed > 0 || replay.unresolvable > 0) {
    console.log(
      `registry: owed_failure replay — ${replay.replayed} recorded, ${replay.failed} retryable, ` +
        `${replay.unresolvable} need an operator (GET /owed)`,
    );
  }

  const batches = await deps.settler.settle();
  const unanchored = deps.ledger.unanchoredManifests();

  const leaves = [
    ...unanchored.map((a) => a.manifestHash),
    ...payeeLeaves(batches.flatMap((b) => b.leaves)),
  ];

  const anchor = await anchorEpoch(
    {
      leaves,
      // Only real transactions. A batch whose every payee was the payer moves
      // nothing and is settled without a transfer, so it has no id to anchor —
      // and an empty string in this list would be a transaction nobody can look
      // up (see `SettledBatch.moved`).
      batchTxIds: batches.map((b) => b.txId).filter((t) => t !== ""),
      extra: {
        artifactCount: unanchored.length,
        payeeCount: batches.reduce((s, b) => s + b.payees, 0),
      },
    },
    { client: deps.client, topicId: deps.topicId },
  );

  // Only mark anchored on actual success — a skip (empty/no-topic/no-client)
  // must leave these artifacts NULL so the next epoch retries them rather
  // than treating "not anchored" as "already covered".
  if (anchor.anchored && unanchored.length > 0) {
    deps.ledger.markAnchored(
      unanchored.map((a) => a.magnet),
      now(),
    );
  } else if (!anchor.anchored) {
    // A skip is routine (most epochs are idle), not a failure — log it at
    // debug so an operator watching for real problems isn't trained to
    // ignore this logger.
    console.debug(
      `registry: epoch anchor skipped (${anchor.skipped}) — ${batches.length} batch(es), ${unanchored.length} unanchored artifact(s)`,
    );
  }

  return { batches, anchor, replayed: replay };
}

/**
 * The epoch loop, single-flight.
 *
 * `Settler.settle()` already de-duplicates concurrent callers — but by handing
 * every caller the *same* `batches` array, which is exactly right for the
 * transfer and exactly wrong for the anchor. Both callers then read the same
 * `unanchoredManifests()` (nothing is marked until `anchorEpoch` has resolved),
 * built the same leaves, and each submitted its own HCS message: **two
 * consensus messages and two fees for one epoch**, from a timer tick colliding
 * with a `POST /settle`. Settling twice was impossible; anchoring twice was
 * free to do and cost real HBAR, and it is the same class of paid leak as v1's
 * thirteen-anchors-for-one-batch incident that `anchorEpoch`'s empty-epoch skip
 * exists to prevent.
 *
 * So the guard belongs one level up from `Settler`, around settle *and* anchor
 * together. It is the same shape as `Settler`'s: a running promise, cleared in
 * `finally`, shared by every caller that arrives while a run is in flight.
 * Concurrent callers therefore see one identical `SettleEpochResult` — one
 * batch list, one anchor, one root — rather than one real result and one
 * phantom skip.
 *
 * Instance state, not a module singleton, for the reason `createRegistrySettler`
 * gives: there must be exactly one of these per registry process, constructed
 * once beside the `Settler` it wraps (see `server.ts`). A second runner over the
 * same settler would share nothing and re-open the race.
 *
 * A caller that arrives mid-run does *not* get its own pass over rows that
 * became payable in the meantime — the same trade `Settler.settle()` already
 * makes. The next tick (or the next click) picks them up, and payouts are
 * durable until then, so the cost of the trade is latency, never money.
 */
export class EpochRunner {
  private running: Promise<SettleEpochResult> | null = null;

  constructor(private readonly deps: SettleEpochDeps) {}

  /** Settle and anchor one epoch. Concurrent calls share one run. */
  run(): Promise<SettleEpochResult> {
    if (this.running) return this.running;
    const started = runSettleEpochOnce(this.deps).finally(() => {
      if (this.running === started) this.running = null;
    });
    this.running = started;
    return started;
  }
}

export function createEpochRunner(deps: SettleEpochDeps): EpochRunner {
  return new EpochRunner(deps);
}

/**
 * One unguarded pass of the epoch loop.
 *
 * Exported for tests and one-shot scripts that own the whole process. Anything
 * that can be entered twice concurrently — the epoch timer, `POST /settle` —
 * must go through an `EpochRunner` instead, or it anchors the same epoch twice.
 */
export { runSettleEpochOnce as runSettleEpoch };
