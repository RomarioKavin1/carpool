import { beforeEach, describe, expect, it } from "vitest";
import { magnetOf, type Manifest } from "@carpool/core";
import { openDb } from "./db/index.js";
import { RegistryLedger, splitSale } from "./ledger.js";

const AUTHOR_ACCOUNT = "0.0.1111";
const AUTHOR_PUBKEY = "aa".repeat(33); // shape only — never verified in these tests
const AUTHOR = `${AUTHOR_ACCOUNT}:${AUTHOR_PUBKEY}`;

function manifestFixture(overrides: Partial<Manifest> = {}): Manifest {
  const base: Omit<Manifest, "magnet"> = {
    question: "What is the ETHOnline 2026 prize pool?",
    questionNorm: "what is the ethonline 2026 prize pool",
    scope: "ethonline-2026",
    abstract: "Total prize pool across all sponsor tracks.",
    sources: [{ url: "https://ethglobal.com/events/ethonline2026", fetchedAt: "2026-09-01T00:00:00Z" }],
    provenance: {
      model: "claude-sonnet-5",
      durationSeconds: 120,
      inputTokens: 4000,
      outputTokens: 1200,
      estimatedCostUsd: 0.42,
      toolCalls: 6,
    },
    decay: { halfLifeDays: 3, producedAt: "2026-09-01T00:00:00Z" },
    author: AUTHOR,
    bodyHash: "b".repeat(64),
    bodyBytes: 2048,
    redacted: false,
    ...overrides,
  };
  return { ...base, magnet: magnetOf(base) };
}

let clock = 1_800_000_000; // unix seconds
function newLedger() {
  const { db, sqlite } = openDb(":memory:");
  return new RegistryLedger(db, sqlite, {
    trackerFee: 500,
    registryAccount: "0.0.9",
    now: () => clock,
  });
}

beforeEach(() => {
  clock = 1_800_000_000;
});

describe("RegistryLedger.publish", () => {
  it("creates a new artifact and bumps the author's peer.published once", () => {
    const ledger = newLedger();
    const m = manifestFixture();
    const { created } = ledger.publish(m, {
      authorSig: "sig",
      manifestHash: m.magnet.slice(7),
      priceBase: 100_000,
      priceFloor: 10_000,
      bodyUri: "file:///x",
    });
    expect(created).toBe(true);
    const row = ledger.getArtifact(m.magnet);
    expect(row?.priceBase).toBe(100_000);
  });

  it("republishing the same magnet reprices instead of duplicating, and does not double-count peer.published", () => {
    const ledger = newLedger();
    const m = manifestFixture();
    ledger.publish(m, { authorSig: "sig", manifestHash: m.magnet.slice(7), priceBase: 100_000, priceFloor: 10_000, bodyUri: "file:///x" });
    const second = ledger.publish(m, { authorSig: "sig", manifestHash: m.magnet.slice(7), priceBase: 50_000, priceFloor: 5_000, bodyUri: "file:///x" });
    expect(second.created).toBe(false);
    const row = ledger.getArtifact(m.magnet)!;
    expect(row.priceBase).toBe(50_000);
    const peerRow = ledger.state().peers.find((p) => p.account === AUTHOR);
    expect(peerRow?.published).toBe(1);
  });
});

describe("RegistryLedger.listLive", () => {
  it("excludes an expired artifact (freshness below 0.125) even though it isn't delisted", () => {
    const ledger = newLedger();
    const fresh = manifestFixture({ decay: { halfLifeDays: 3, producedAt: "2026-09-01T00:00:00Z" } });
    const stale = manifestFixture({
      question: "a much older question",
      decay: { halfLifeDays: 1, producedAt: "2020-01-01T00:00:00Z" },
    });
    for (const m of [fresh, stale]) {
      ledger.publish(m, { authorSig: "sig", manifestHash: m.magnet.slice(7), priceBase: 1, priceFloor: 1, bodyUri: "file:///x" });
    }
    const nowMs = Date.parse("2026-09-02T00:00:00Z");
    const magnets = ledger.listLive(20, nowMs).map((l) => l.manifest.magnet);
    expect(magnets).toContain(fresh.magnet);
    expect(magnets).not.toContain(stale.magnet);
  });
});

describe("RegistryLedger.recordPurchase", () => {
  it("accrues author_royalty (paid − trackerFee, held back the refund window) and tracker_fee (payable now)", () => {
    const ledger = newLedger();
    const { purchaseId, authorRoyaltyPayoutId, trackerFeePayoutId } = ledger.recordPurchase({
      magnet: "swarm:" + "a".repeat(64),
      buyer: "0.0.2222",
      txId: "0.0.2222@123-456",
      paid: 50_000,
      payoutAccount: AUTHOR_ACCOUNT,
      refundWindowSeconds: 120,
    });
    expect(purchaseId).toBeGreaterThan(0);

    const unsettledNow = ledger.settlement.unsettled();
    // Only the tracker_fee row is payable at `clock` — the royalty is held back.
    expect(unsettledNow.map((r) => r.id)).toEqual([trackerFeePayoutId]);
    expect(unsettledNow[0]!.amount).toBe(500);
    expect(unsettledNow[0]!.payee).toBe("0.0.9");

    clock += 121;
    const unsettledLater = ledger.settlement.unsettled();
    const royaltyRow = unsettledLater.find((r) => r.id === authorRoyaltyPayoutId);
    expect(royaltyRow?.amount).toBe(49_500);
    expect(royaltyRow?.payee).toBe(AUTHOR_ACCOUNT);
  });

  it("is idempotent on txId: a retried onPaid does not open a second purchase or accrue a second set of payouts", () => {
    const ledger = newLedger();
    const args = {
      magnet: "swarm:" + "a".repeat(64),
      buyer: "0.0.2222",
      txId: "0.0.2222@123-456",
      paid: 50_000,
      payoutAccount: AUTHOR_ACCOUNT,
      refundWindowSeconds: 120,
    };
    const first = ledger.recordPurchase(args);
    const second = ledger.recordPurchase(args);
    expect(second).toEqual(first);
    expect(ledger.state().purchases.length).toBe(1);
    clock += 121;
    expect(ledger.settlement.unsettled().reduce((s, r) => s + r.amount, 0)).toBe(50_000);
  });
});

describe("RegistryLedger.refundPurchase", () => {
  function purchaseNow(ledger: RegistryLedger, overrides: Partial<Parameters<RegistryLedger["recordPurchase"]>[0]> = {}) {
    return ledger.recordPurchase({
      magnet: "swarm:" + "a".repeat(64),
      buyer: "0.0.2222",
      txId: "0.0.2222@1-1",
      paid: 50_000,
      payoutAccount: AUTHOR_ACCOUNT,
      refundWindowSeconds: 120,
      ...overrides,
    });
  }

  it("inside the window: voids author_royalty and pays the buyer paid − trackerFee immediately", () => {
    const ledger = newLedger();
    const { purchaseId } = purchaseNow(ledger);
    const p = ledger.getPurchase(purchaseId)!;
    const result = ledger.refundPurchase(p);
    expect(result.ok).toBe(true);

    // The voided royalty must never become claimable, even once its availableAt passes.
    clock += 121;
    const unsettled = ledger.settlement.unsettled();
    expect(unsettled.some((r) => r.payee === AUTHOR_ACCOUNT)).toBe(false);
    const refundRow = unsettled.find((r) => r.payee === "0.0.2222");
    expect(refundRow?.amount).toBe(49_500);
  });

  it("refuses a second refund on the same purchase", () => {
    const ledger = newLedger();
    const { purchaseId } = purchaseNow(ledger);
    const p = ledger.getPurchase(purchaseId)!;
    expect(ledger.refundPurchase(p).ok).toBe(true);
    const again = ledger.refundPurchase(ledger.getPurchase(purchaseId)!);
    expect(again).toEqual({ ok: false, reason: "already refunded" });
  });

  it("refuses a refund once the window has closed", () => {
    const ledger = newLedger();
    const { purchaseId } = purchaseNow(ledger);
    clock += 121;
    const p = ledger.getPurchase(purchaseId)!;
    const result = ledger.refundPurchase(p);
    expect(result).toEqual({ ok: false, reason: "refund window has closed" });
  });

  it("does not refund tracker_fee — only author_royalty is reversed", () => {
    const ledger = newLedger();
    const { purchaseId, trackerFeePayoutId } = purchaseNow(ledger);
    ledger.refundPurchase(ledger.getPurchase(purchaseId)!);
    const trackerRow = ledger.settlement.unsettled().find((r) => r.id === trackerFeePayoutId);
    expect(trackerRow?.amount).toBe(500); // untouched, still payable
  });

  // The royalty's available_at is exactly refundDeadline, and refundPurchase
  // allows `now <= refundDeadline` — so at now == deadline both the settler
  // and a refund are legal simultaneously, and the conditional `void()` is
  // the only thing that decides which one wins.
  describe("racing the settler at exactly the refund deadline", () => {
    it("a claim that lands first wins: refundPurchase then reports failure and accrues no refund row", () => {
      const ledger = newLedger();
      const { purchaseId, authorRoyaltyPayoutId } = purchaseNow(ledger);
      clock += 120; // now == refundDeadline: both paths are legal
      const claim = ledger.settlement.claimBatch("root", [authorRoyaltyPayoutId]);
      expect(claim.claimed).toEqual([authorRoyaltyPayoutId]);

      const before = ledger.sqlite.prepare(`SELECT COUNT(*) AS c FROM payout WHERE reason = 'refund'`).get() as { c: number };
      const result = ledger.refundPurchase(ledger.getPurchase(purchaseId)!);
      // The reason names the batch that won, rather than saying "a settlement
      // batch" for both this and a concurrent refund that had already voided the
      // row — which sent an operator to the batch table for a race that had
      // happened in the refund route (docs/AUDIT-MONEY.md L2).
      expect(result).toEqual({
        ok: false,
        reason: `royalty already claimed by settlement batch ${claim.id}`,
      });
      const after = ledger.sqlite.prepare(`SELECT COUNT(*) AS c FROM payout WHERE reason = 'refund'`).get() as { c: number };
      expect(after.c).toBe(before.c); // no refund row was written
    });

    it("a refund that lands first wins: the royalty is excluded from a subsequent claimBatch", () => {
      const ledger = newLedger();
      const { purchaseId, authorRoyaltyPayoutId } = purchaseNow(ledger);
      clock += 120; // now == refundDeadline: both paths are legal
      const result = ledger.refundPurchase(ledger.getPurchase(purchaseId)!);
      expect(result.ok).toBe(true);

      const claim = ledger.settlement.claimBatch("root", [authorRoyaltyPayoutId]);
      expect(claim.claimed).toEqual([]); // already voided — the settler cannot win it
    });
  });
});

describe("RegistryLedger.refundUndelivered", () => {
  function purchaseNow(ledger: RegistryLedger) {
    return ledger.recordPurchase({
      magnet: "swarm:" + "a".repeat(64),
      buyer: "0.0.2222",
      txId: "0.0.2222@1-1",
      paid: 50_000,
      payoutAccount: AUTHOR_ACCOUNT,
      refundWindowSeconds: 120,
    });
  }

  it("reverses both payouts and refunds the full amount paid", () => {
    const ledger = newLedger();
    const { purchaseId } = purchaseNow(ledger);
    const result = ledger.refundUndelivered(ledger.getPurchase(purchaseId)!);
    // The amount is reported, so a caller can say what came back instead of
    // relaying an `ok` that was also true when the refund was 0 µUSDC.
    expect(result).toEqual({ ok: true, refunded: 50_000 });
    clock += 121;
    const unsettled = ledger.settlement.unsettled();
    expect(unsettled.some((r) => r.payee === AUTHOR_ACCOUNT)).toBe(false);
    expect(unsettled.some((r) => r.payee === "0.0.9")).toBe(false);
    const refundRow = unsettled.find((r) => r.payee === "0.0.2222");
    expect(refundRow?.amount).toBe(50_000);
    expect(ledger.getPurchase(purchaseId)!.refundState).toBe("refunded");
  });

  it("is idempotent: a replay after the first call does nothing and accrues no second refund_due", () => {
    const ledger = newLedger();
    const { purchaseId } = purchaseNow(ledger);
    ledger.refundUndelivered(ledger.getPurchase(purchaseId)!);
    const before = ledger.sqlite.prepare(`SELECT COUNT(*) AS c FROM payout WHERE reason = 'refund_due'`).get() as { c: number };
    const replay = ledger.refundUndelivered(ledger.getPurchase(purchaseId)!);
    expect(replay).toEqual({ ok: false, reason: "already refunded" });
    const after = ledger.sqlite.prepare(`SELECT COUNT(*) AS c FROM payout WHERE reason = 'refund_due'`).get() as { c: number };
    expect(after.c).toBe(before.c);
  });

  it("only refunds what it can still void: a royalty already voided by a prior buyer-initiated refund is not double-counted", () => {
    const ledger = newLedger();
    const { purchaseId, trackerFeePayoutId } = purchaseNow(ledger);
    const p = ledger.getPurchase(purchaseId)!;
    // Simulate a `/refund` having already voided the royalty and marked the
    // purchase refunded, then a later delivery attempt (Task E replay) finds
    // the stored body corrupted. refundUndelivered must not re-derive its
    // own "already refunded" guard from a stale in-memory row and skip the
    // still-payable tracker_fee reversal silently — it should still refuse
    // once refundState is already 'refunded'.
    ledger.refundPurchase(p);
    const staleRow = { ...p }; // as if the caller still held the pre-refund row
    const result = ledger.refundUndelivered(staleRow);
    expect(result).toEqual({ ok: false, reason: "already refunded" });
    // tracker_fee must still be intact — refundUndelivered did nothing.
    const trackerRow = ledger.sqlite.prepare(`SELECT voided_at FROM payout WHERE id = ?`).get(trackerFeePayoutId) as { voided_at: number | null };
    expect(trackerRow.voided_at).toBeNull();
  });
});

describe("RegistryLedger.recordOwedFailure / eventsSince", () => {
  it("durably records a failure even when nothing else about the purchase could be written", () => {
    const ledger = newLedger();
    const ok = ledger.recordOwedFailure({
      op: "onPaid",
      txId: "0.0.1@1-1",
      payer: null,
      paid: 1000,
      resourceKey: "swarm:" + "a".repeat(64),
      reason: "no payer",
    });
    expect(ok).toBe(true);
  });

  it("eventsSince reports a purchase, then a separate refund event once refunded", () => {
    const ledger = newLedger();
    const { purchaseId } = ledger.recordPurchase({
      magnet: "swarm:" + "a".repeat(64),
      buyer: "0.0.2222",
      txId: "0.0.2222@1-1",
      paid: 50_000,
      payoutAccount: AUTHOR_ACCOUNT,
      refundWindowSeconds: 120,
    });
    const before = ledger.eventsSince(0);
    expect(before).toHaveLength(1);
    expect(before[0]!.type).toBe("purchase");

    // A refund reuses the purchase's row but must not reuse its `ts` — a
    // client polling `since = lastPurchaseTs` would otherwise never observe
    // it, since the purchase event's own ts never changes.
    clock += 30;
    ledger.refundPurchase(ledger.getPurchase(purchaseId)!);
    const after = ledger.eventsSince(0);
    expect(after.map((e) => e.type)).toEqual(["purchase", "refund"]);
    expect(after[1]!.ts).toBeGreaterThan(after[0]!.ts);

    // Polling from just after the purchase must still surface the refund.
    const sincePurchase = ledger.eventsSince(before[0]!.ts);
    expect(sincePurchase.map((e) => e.type)).toEqual(["refund"]);

    expect(ledger.eventsSince(clock)).toHaveLength(0);
  });
});

describe("RegistryLedger.state — the dashboard's only artifact-level read", () => {
  it("carries the full manifest plus freshness/health/priceNow/distinctBuyers per artifact, for a live artifact", () => {
    const ledger = newLedger();
    const m = manifestFixture({ decay: { halfLifeDays: 3, producedAt: new Date().toISOString() } });
    ledger.publish(m, { authorSig: "sig", manifestHash: m.magnet.slice(7), priceBase: 100_000, priceFloor: 10_000, bodyUri: "file:///x" });

    const row = ledger.state().artifacts.find((a) => a.manifest.magnet === m.magnet);
    expect(row).toBeDefined();
    expect(row!.manifest.question).toBe(m.question);
    expect(row!.manifest.sources).toEqual(m.sources);
    expect(row!.manifest.bodyBytes).toBe(m.bodyBytes);
    expect(row!.manifest.author).toBe(m.author);
    expect(row!.live).toBe(true);
    // Fresh (age 0), no buyers yet: freshness == 1, health floors at 0.4 (the
    // new-artifact floor from docs/RESTRUCTURE.md §4 — zero buyers must not
    // read as dead).
    expect(row!.freshness).toBeCloseTo(1, 5);
    expect(row!.health).toBeCloseTo(0.4, 5);
    expect(row!.distinctBuyers).toBe(0);
    expect(row!.refundRate).toBe(0);
    expect(row!.priceBase).toBe(100_000);
    expect(row!.priceFloor).toBe(10_000);
    expect(row!.priceNow).toBe(110_000); // priceFloor + priceBase * freshness(1)
  });

  it("still reports an expired (dead) artifact rather than omitting it — a torrent view shows dead torrents too", () => {
    const ledger = newLedger();
    const m = manifestFixture({ decay: { halfLifeDays: 1, producedAt: new Date(Date.now() - 10 * 86_400_000).toISOString() } });
    ledger.publish(m, { authorSig: "sig", manifestHash: m.magnet.slice(7), priceBase: 100_000, priceFloor: 10_000, bodyUri: "file:///x" });

    const row = ledger.state().artifacts.find((a) => a.manifest.magnet === m.magnet)!;
    expect(row.live).toBe(false);
    expect(row.freshness).toBeLessThan(0.125);
  });

  it("counts distinctBuyers and refundRate from purchase rows, per magnet", () => {
    const ledger = newLedger();
    const m = manifestFixture();
    ledger.publish(m, { authorSig: "sig", manifestHash: m.magnet.slice(7), priceBase: 100_000, priceFloor: 10_000, bodyUri: "file:///x" });

    ledger.recordPurchase({ magnet: m.magnet, buyer: "0.0.3001", txId: "tx1", paid: 50_000, payoutAccount: AUTHOR_ACCOUNT, refundWindowSeconds: 120 });
    const { purchaseId } = ledger.recordPurchase({ magnet: m.magnet, buyer: "0.0.3002", txId: "tx2", paid: 50_000, payoutAccount: AUTHOR_ACCOUNT, refundWindowSeconds: 120 });
    ledger.refundPurchase(ledger.getPurchase(purchaseId)!);

    const row = ledger.state().artifacts.find((a) => a.manifest.magnet === m.magnet)!;
    expect(row.distinctBuyers).toBe(2);
    expect(row.refundRate).toBeCloseTo(0.5, 5);
  });

  // The three cases above only pinned `artifacts[]`. apps/dashboard's own
  // lib/api.ts now type-derives from RegistryLedger's real return types
  // (import type { RegistryLedger } ... ReturnType<...>), which catches a
  // rename at compile time everywhere the dashboard reads a field — but
  // that guarantee is only as good as these fields actually being pinned
  // here too, since a TS structural type still lines up even if the
  // *runtime* key changes without a matching rename elsewhere in this
  // file. Each assertion below reads one field by its literal name.
  it("pins summary.{artifactCount,purchaseCount,gross,refunded}", () => {
    const ledger = newLedger();
    const m = manifestFixture();
    ledger.publish(m, { authorSig: "sig", manifestHash: m.magnet.slice(7), priceBase: 100_000, priceFloor: 10_000, bodyUri: "file:///x" });
    const { purchaseId } = ledger.recordPurchase({ magnet: m.magnet, buyer: "0.0.3001", txId: "tx1", paid: 50_000, payoutAccount: AUTHOR_ACCOUNT, refundWindowSeconds: 120 });
    ledger.refundPurchase(ledger.getPurchase(purchaseId)!);

    const { summary } = ledger.state();
    expect(summary.artifactCount).toBe(1);
    expect(summary.purchaseCount).toBe(1);
    expect(summary.gross).toBe(50_000);
    expect(summary.refunded).toBe(1);
  });

  it("pins purchases[].{id,magnet,buyer,txId,paid,ts,refundState}", () => {
    const ledger = newLedger();
    const m = manifestFixture();
    ledger.publish(m, { authorSig: "sig", manifestHash: m.magnet.slice(7), priceBase: 100_000, priceFloor: 10_000, bodyUri: "file:///x" });
    ledger.recordPurchase({ magnet: m.magnet, buyer: "0.0.3001", txId: "tx1", paid: 50_000, payoutAccount: AUTHOR_ACCOUNT, refundWindowSeconds: 120 });

    const [p] = ledger.state().purchases;
    expect(p).toBeDefined();
    expect(p!.magnet).toBe(m.magnet);
    expect(p!.buyer).toBe("0.0.3001");
    expect(p!.txId).toBe("tx1");
    expect(p!.paid).toBe(50_000);
    expect(p!.ts).toBe(clock);
    expect(p!.refundState).toBe("window");
    expect(typeof p!.id).toBe("number");
  });

  it("pins peers[].{account,published,purchased,refundsReceived,refundsIssued}", () => {
    const ledger = newLedger();
    const m = manifestFixture();
    ledger.publish(m, { authorSig: "sig", manifestHash: m.magnet.slice(7), priceBase: 100_000, priceFloor: 10_000, bodyUri: "file:///x" });
    const { purchaseId } = ledger.recordPurchase({ magnet: m.magnet, buyer: "0.0.3001", txId: "tx1", paid: 50_000, payoutAccount: AUTHOR_ACCOUNT, refundWindowSeconds: 120 });
    ledger.refundPurchase(ledger.getPurchase(purchaseId)!);

    const buyerPeer = ledger.state().peers.find((p) => p.account === "0.0.3001")!;
    expect(buyerPeer).toBeDefined();
    expect(buyerPeer.purchased).toBe(1);
    expect(buyerPeer.refundsReceived).toBe(1);
    expect(buyerPeer.published).toBe(0);
    // The buyer *received* a refund; they did not issue one.
    expect(buyerPeer.refundsIssued).toBe(0);

    const authorPeer = ledger.state().peers.find((p) => p.account === AUTHOR)!;
    expect(authorPeer.published).toBe(1);
    // And the author did: `refunds_issued` was in the schema, served on /state,
    // and written by nothing, so it was always 0 and this test pinned that 0 as
    // if it meant something (docs/AUDIT-TESTS.md). It is now the count of this
    // author's sales that were reversed.
    expect(authorPeer.refundsIssued, "the author whose royalty was reversed").toBe(1);
    expect(authorPeer.refundsReceived, "and they received nothing").toBe(0);
  });

  it("pins GET /events' data.{magnet,buyer,txId,paid} for both purchase and refund events", () => {
    const ledger = newLedger();
    const m = manifestFixture();
    ledger.publish(m, { authorSig: "sig", manifestHash: m.magnet.slice(7), priceBase: 100_000, priceFloor: 10_000, bodyUri: "file:///x" });
    const { purchaseId } = ledger.recordPurchase({ magnet: m.magnet, buyer: "0.0.3001", txId: "tx1", paid: 50_000, payoutAccount: AUTHOR_ACCOUNT, refundWindowSeconds: 120 });
    clock += 10;
    ledger.refundPurchase(ledger.getPurchase(purchaseId)!);

    const [purchaseEvent, refundEvent] = ledger.eventsSince(0);
    expect(purchaseEvent!.type).toBe("purchase");
    expect(purchaseEvent!.data.magnet).toBe(m.magnet);
    expect(purchaseEvent!.data.buyer).toBe("0.0.3001");
    expect(purchaseEvent!.data.txId).toBe("tx1");
    expect(purchaseEvent!.data.paid).toBe(50_000);

    expect(refundEvent!.type).toBe("refund");
    expect(refundEvent!.data.magnet).toBe(m.magnet);
    expect(refundEvent!.data.buyer).toBe("0.0.3001");
    expect(refundEvent!.data.txId).toBe("tx1");
    expect(refundEvent!.data.paid).toBe(50_000);
  });
});

/**
 * I3 — "the payout table can never exceed receipts" is enforced where the
 * payout rows are actually written, not only at publish time.
 *
 * `POST /publish` rejects `priceFloor < trackerFee`, which is a real guard and
 * the wrong place for this invariant to live alone: `trackerFee` is env
 * (`TRACKER_FEE_MICRO_USDC`), so an operator can raise it *after* artifacts are
 * live and priced. Every sale of those artifacts then accrued `tracker_fee` in
 * full while `royalty = max(0, paid − fee)` clamped to zero, and the two payout
 * rows for one sale summed to **more than the sale received**. Nothing anywhere
 * compared the two.
 */
describe("the payout table can never exceed what the sale received", () => {
  function ledgerWithFee(fee: number) {
    const { db, sqlite } = openDb(":memory:");
    return new RegistryLedger(db, sqlite, { trackerFee: fee, registryAccount: "0.0.9", now: () => clock });
  }

  function payoutsFor(ledger: RegistryLedger, purchaseId: number) {
    return ledger.sqlite
      .prepare(`SELECT id, payee, amount, reason FROM payout WHERE ref = ? ORDER BY id`)
      .all(String(purchaseId)) as { id: number; payee: string; amount: number; reason: string }[];
  }

  it("accrues at most `paid` when the tracker fee was raised above an artifact's price", () => {
    // Published while the fee was 500 (priceFloor >= 500 passed at publish),
    // then the operator set TRACKER_FEE_MICRO_USDC=20000 and restarted.
    const ledger = ledgerWithFee(20_000);
    const { purchaseId } = ledger.recordPurchase({
      magnet: "swarm:" + "a".repeat(64),
      buyer: "0.0.2222",
      txId: "0.0.2222@1-1",
      paid: 10_000, // what the buyer actually paid, at the old price
      payoutAccount: AUTHOR_ACCOUNT,
      refundWindowSeconds: 120,
    });

    const rows = payoutsFor(ledger, purchaseId);
    const total = rows.reduce((s, r) => s + r.amount, 0);
    expect(total).toBe(10_000); // was 20_000: fee in full + royalty clamped to 0
    expect(rows.find((r) => r.reason === "tracker_fee")!.amount).toBe(10_000);
    expect(rows.find((r) => r.reason === "author_royalty")!.amount).toBe(0);
  });

  it("splits an ordinary sale exactly, with no rounding gap", () => {
    const ledger = ledgerWithFee(500);
    const { purchaseId } = ledger.recordPurchase({
      magnet: "swarm:" + "b".repeat(64),
      buyer: "0.0.2222",
      txId: "0.0.2222@2-1",
      paid: 50_000,
      payoutAccount: AUTHOR_ACCOUNT,
      refundWindowSeconds: 120,
    });
    const rows = payoutsFor(ledger, purchaseId);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(50_000);
    expect(rows.find((r) => r.reason === "author_royalty")!.amount).toBe(49_500);
  });

  it("refunds the royalty that was actually accrued, not one re-derived from today's fee", () => {
    // Purchase at fee 500 → royalty 49_500. The operator then raises the fee to
    // 60_000 and restarts. A refund inside the window used to compute
    // `max(0, paid − trackerFee)` = 0 and accrue a refund of nothing, while
    // still voiding the author's 49_500 — the registry silently kept the money.
    const { db, sqlite } = openDb(":memory:");
    const atPurchase = new RegistryLedger(db, sqlite, { trackerFee: 500, registryAccount: "0.0.9", now: () => clock });
    const { purchaseId } = atPurchase.recordPurchase({
      magnet: "swarm:" + "c".repeat(64),
      buyer: "0.0.2222",
      txId: "0.0.2222@3-1",
      paid: 50_000,
      payoutAccount: AUTHOR_ACCOUNT,
      refundWindowSeconds: 120,
    });

    const afterFeeRaise = new RegistryLedger(db, sqlite, { trackerFee: 60_000, registryAccount: "0.0.9", now: () => clock });
    expect(afterFeeRaise.refundPurchase(afterFeeRaise.getPurchase(purchaseId)!)).toEqual({
      ok: true,
      refunded: 49_500,
    });

    const refund = sqlite
      .prepare(`SELECT amount FROM payout WHERE reason = 'refund' AND ref = ?`)
      .get(String(purchaseId)) as { amount: number };
    expect(refund.amount).toBe(49_500);
  });

  it("refundUndelivered reverses exactly the rows it voided, at the amounts they hold", () => {
    const { db, sqlite } = openDb(":memory:");
    const atPurchase = new RegistryLedger(db, sqlite, { trackerFee: 500, registryAccount: "0.0.9", now: () => clock });
    const { purchaseId } = atPurchase.recordPurchase({
      magnet: "swarm:" + "d".repeat(64),
      buyer: "0.0.2222",
      txId: "0.0.2222@4-1",
      paid: 50_000,
      payoutAccount: AUTHOR_ACCOUNT,
      refundWindowSeconds: 120,
    });

    const afterFeeRaise = new RegistryLedger(db, sqlite, { trackerFee: 60_000, registryAccount: "0.0.9", now: () => clock });
    expect(afterFeeRaise.refundUndelivered({ id: purchaseId })).toEqual({
      ok: true,
      refunded: 50_000,
    });

    const refund = sqlite
      .prepare(`SELECT amount FROM payout WHERE reason = 'refund_due' AND ref = ?`)
      .get(String(purchaseId)) as { amount: number };
    // Nothing was delivered, so the whole sale comes back — 49_500 + 500.
    expect(refund.amount).toBe(50_000);
  });
});

describe("splitSale — the invariant itself", () => {
  it("fee + royalty is exactly `paid` at every relation between price and fee", () => {
    for (const [paid, fee] of [
      [50_000, 500],
      [1_000, 500],
      [500, 500],
      [499, 500],
      [0, 500],
      [10_000, 20_000],
      [10_000, 0],
    ] as const) {
      const { fee: f, royalty } = splitSale(paid, fee);
      expect(f + royalty, `paid=${paid} fee=${fee}`).toBe(paid);
      expect(f).toBeLessThanOrEqual(paid);
      expect(royalty).toBeGreaterThanOrEqual(0);
    }
  });

  it("refuses a non-integer or negative amount rather than accruing a fractional µUSDC", () => {
    expect(() => splitSale(10.5, 500)).toThrow(/non-negative integer/);
    expect(() => splitSale(-1, 500)).toThrow(/non-negative integer/);
    expect(() => splitSale(1_000, 0.5)).toThrow(/non-negative integer/);
  });
});

// ---------------------------------------------------------------------------
// H1's real trigger: a money transaction that reads before it writes.
// ---------------------------------------------------------------------------

describe("a concurrent writer cannot make a money transaction fail", () => {
  /**
   * docs/AUDIT-MONEY.md H1 names "WAL with no `busy_timeout`" as the likeliest
   * way a settled payment goes unrecorded. That part is wrong — better-sqlite3
   * already applies a 5 s busy timeout to every connection, and a plain contended
   * write waits (see packages/hedera-x402/src/db.test.ts) — but the conclusion is
   * right for a different reason.
   *
   * A **deferred** transaction that reads before it writes cannot be upgraded to a
   * writer once another connection has committed: SQLite returns
   * `SQLITE_BUSY_SNAPSHOT` *immediately*, without consulting the busy handler,
   * because waiting cannot refresh a stale snapshot. Both refund paths read first
   * (`amountOf`, then the purchase row), so both were one concurrent commit away
   * from throwing — and in `recordPurchase`'s case that throw lands in the gate's
   * `onPaid` catch, which is the defect.
   *
   * `.immediate()` takes the write lock at BEGIN, so the conflict lands on the
   * *other* writer (where the timeout applies) instead of on the transaction that
   * is moving money. This drives that interleaving: a second connection to the
   * same file commits between the first read and the first write.
   */
  it("refundUndelivered survives a commit that lands between its read and its write", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const Database = (await import("better-sqlite3")).default;

    const dir = mkdtempSync(join(tmpdir(), "carpool-snapshot-"));
    const path = join(dir, "ledger.sqlite");
    try {
      const { db, sqlite } = openDb(path);
      const ledger = new RegistryLedger(db, sqlite, {
        trackerFee: 500,
        registryAccount: "0.0.9",
        now: () => clock,
      });
      const { purchaseId } = ledger.recordPurchase({
        magnet: "swarm:" + "f".repeat(64),
        buyer: "0.0.2222",
        txId: "0.0.2222@snapshot-1",
        paid: 10_000,
        payoutAccount: AUTHOR_ACCOUNT,
        refundWindowSeconds: 120,
      });

      // Another process, writing to the same file. Its own timeout is disabled so
      // it fails fast when it is the one that has to wait.
      const other = new Database(path);
      other.pragma("busy_timeout = 0");
      let otherWrote: string | null = null;

      // `amountOf` is called after the purchase row is read and before anything is
      // written, which is exactly the window a deferred transaction cannot survive.
      const realAmountOf = ledger.settlement.amountOf.bind(ledger.settlement);
      let injected = false;
      ledger.settlement.amountOf = (id: number) => {
        if (!injected) {
          injected = true;
          try {
            other.prepare(`INSERT INTO peer (account, published) VALUES ('0.0.999', 1)`).run();
            otherWrote = "committed";
          } catch (e) {
            otherWrote = (e as { code?: string }).code ?? "failed";
          }
        }
        return realAmountOf(id);
      };

      try {
        // The assertion: OUR transaction is the one that must not fail. Whether
        // the other writer got in is its own business (with `.immediate()` it is
        // the one refused, and a real process would retry).
        const result = ledger.refundUndelivered({ id: purchaseId });
        expect(result, "the money transaction wins the race").toEqual({
          ok: true,
          refunded: 10_000,
        });
        expect(injected, "the interleaving actually happened").toBe(true);
        expect(otherWrote, "and the other writer is the one that had to give way").toBe(
          "SQLITE_BUSY",
        );
      } finally {
        ledger.settlement.amountOf = realAmountOf;
        other.close();
        sqlite.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
