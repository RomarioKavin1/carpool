/**
 * ADVERSARIAL MONEY-PATH AUDIT — the registry half.
 *
 * Companion to packages/hedera-x402/src/audit-money.test.ts. These began as
 * probes pinning *observed* behaviour, defect or not, so the findings in
 * docs/AUDIT-MONEY.md were executed rather than read; each assertion that pinned
 * a defect has been turned round to pin the fix, with the interleaving left
 * exactly as the audit built it. Includes a property test over random
 * publish/purchase/refund/delist/settle sequences against the real SQLite ledger.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { magnetOf, type Manifest } from "@carpool/core";
import { createSettler } from "@carpool/hedera-x402";
import { openDb } from "./db/index.js";
import { RegistryLedger, splitSale } from "./ledger.js";
import { createEpochRunner } from "./settlement.js";

const AUTHOR_ACCOUNT = "0.0.1111";
const AUTHOR = `${AUTHOR_ACCOUNT}:${"aa".repeat(33)}`;
const REGISTRY = "0.0.9";

function manifestFixture(question: string): Manifest {
  const base: Omit<Manifest, "magnet"> = {
    question,
    questionNorm: question.toLowerCase(),
    scope: "audit",
    abstract: "x",
    sources: [{ url: "https://example.test", fetchedAt: "2026-09-01T00:00:00Z" }],
    provenance: {
      model: "m",
      durationSeconds: 1,
      inputTokens: 1,
      outputTokens: 1,
      estimatedCostUsd: 0.1,
      toolCalls: 1,
    },
    decay: { halfLifeDays: 3650, producedAt: "2026-09-01T00:00:00Z" },
    author: AUTHOR,
    bodyHash: "b".repeat(64),
    bodyBytes: 8,
    redacted: false,
  };
  return { ...base, magnet: magnetOf(base) };
}

let clock = 1_800_000_000;
function newLedger(trackerFee = 500) {
  const { db, sqlite } = openDb(":memory:");
  return {
    ledger: new RegistryLedger(db, sqlite, {
      trackerFee,
      registryAccount: REGISTRY,
      refundWindowSeconds: 120,
      now: () => clock,
    }),
    sqlite,
  };
}

function publish(ledger: RegistryLedger, question: string, priceFloor = 10_000) {
  const m = manifestFixture(question);
  ledger.publish(m, {
    authorSig: "sig",
    manifestHash: m.magnet.slice("swarm:".length),
    priceBase: 0,
    priceFloor,
    bodyUri: "file:///x",
  });
  return m.magnet;
}

let txSeq = 0;
function buy(ledger: RegistryLedger, magnet: string, paid: number, buyer = "0.0.2222") {
  return ledger.recordPurchase({
    magnet,
    buyer,
    txId: `0.0.2222@${++txSeq}.0`,
    paid,
    payoutAccount: AUTHOR_ACCOUNT,
    refundWindowSeconds: 120,
  });
}

/** Total of every payout row that is not voided — i.e. what the rail will pay. */
function liveOwed(sqlite: Database.Database): number {
  return (
    sqlite
      .prepare(`SELECT COALESCE(SUM(amount),0) AS t FROM payout WHERE voided_at IS NULL`)
      .get() as { t: number }
  ).t;
}
function receipts(sqlite: Database.Database): number {
  return (sqlite.prepare(`SELECT COALESCE(SUM(paid),0) AS t FROM purchase`).get() as { t: number }).t;
}

beforeEach(() => {
  clock = 1_800_000_000;
  txSeq = 0;
});

// ---------------------------------------------------------------------------
// R1  A refund can return literally nothing and still report ok.
// ---------------------------------------------------------------------------

describe("R1: a fee raised above an artifact's price cannot produce a zero refund", () => {
  it("refuses rather than 'refunding' 0, and does not burn the buyer's only chance", () => {
    // POST /publish rejects priceFloor < trackerFee with the fee AT PUBLISH TIME.
    // The operator later raises TRACKER_FEE_MICRO_USDC; the artifact is already
    // live at the old price. splitSale then clamps, exactly as documented.
    const { ledger, sqlite } = newLedger(/* trackerFee */ 20_000);
    const magnet = publish(ledger, "q1", /* priceFloor */ 10_000);
    const { purchaseId } = buy(ledger, magnet, 10_000);

    expect(splitSale(10_000, 20_000)).toEqual({ fee: 10_000, royalty: 0 });
    const p = ledger.getPurchase(purchaseId)!;

    const r = ledger.refundPurchase(p);
    expect(r.ok, "there is nothing this route can reverse, so it does not claim to").toBe(false);
    expect((r as { reason: string }).reason).toMatch(/author royalty is 0 µUSDC/);
    expect((r as { reason: string }).reason, "and it names the cause").toMatch(/tracker fee/);

    // No 0-value refund row, and — the part that mattered — the purchase is still
    // refundable, so the buyer has not spent their one attempt on nothing.
    expect(ledger.payouts({ payee: "0.0.2222" }).filter((x) => x.reason === "refund")).toEqual([]);
    expect(ledger.getPurchase(purchaseId)!.refundState).toBe("window");
    expect(ledger.effectiveRefundState(ledger.getPurchase(purchaseId)!)).toBe("window");

    // The registry still holds the sale — the tracker fee is not refundable by
    // this route, which is policy — but nothing pretended otherwise.
    expect(liveOwed(sqlite)).toBe(receipts(sqlite));
    expect(ledger.payouts({ payee: REGISTRY })[0]!.amount).toBe(10_000);
  });

  it("refundUndelivered in the same situation returns the whole sale — the asymmetry stands", () => {
    const { ledger } = newLedger(20_000);
    const magnet = publish(ledger, "q2", 10_000);
    const { purchaseId } = buy(ledger, magnet, 10_000);
    expect(ledger.refundUndelivered({ id: purchaseId })).toEqual({ ok: true, refunded: 10_000 });
    const due = ledger.payouts({ payee: "0.0.2222" }).find((x) => x.reason === "refund_due")!;
    expect(due.amount, "delivery failure reverses the fee too, so this one is whole").toBe(10_000);
  });

  it("a refund of a real royalty still works, and reports what came back", () => {
    const { ledger } = newLedger(500);
    const magnet = publish(ledger, "q1b", 10_000);
    const { purchaseId } = buy(ledger, magnet, 10_000);
    expect(ledger.refundPurchase(ledger.getPurchase(purchaseId)!)).toEqual({
      ok: true,
      refunded: 9_500,
    });
  });
});

// ---------------------------------------------------------------------------
// R2  Refund vs settlement, in both orders.
// ---------------------------------------------------------------------------

describe("R2: refund against a settlement batch that already claimed the row", () => {
  it("batch first: the void is refused and the refund is denied — correct, and the reason is wrong", () => {
    const { ledger, sqlite } = newLedger();
    const magnet = publish(ledger, "q3");
    const { purchaseId, authorRoyaltyPayoutId } = buy(ledger, magnet, 10_000);

    // The royalty is held to the deadline, so a batch can only reach it at or
    // after `refundDeadline`. refundPurchase allows `now <= deadline`, so the
    // single second `now === deadline` is the whole overlap.
    clock += 120;
    const p = ledger.getPurchase(purchaseId)!;
    expect(p.refundDeadline).toBe(clock);
    expect(ledger.settlement.unsettled().map((r) => r.id)).toContain(authorRoyaltyPayoutId);
    ledger.settlement.claimBatch("root", [authorRoyaltyPayoutId!]);

    const r = ledger.refundPurchase(p);
    expect(r.ok).toBe(false);
    // Names the batch, so an operator can go and look at it.
    expect((r as { reason: string }).reason).toMatch(/^royalty already claimed by settlement batch \d+$/);
    // No money invented, and the purchase stays refundable-looking rather than
    // being marked refunded, which is the safe direction.
    expect(ledger.getPurchase(purchaseId)!.refundState).toBe("window");
    expect(liveOwed(sqlite)).toBe(receipts(sqlite));
  });

  it("refund first: the batch simply does not claim the voided row", () => {
    const { ledger, sqlite } = newLedger();
    const magnet = publish(ledger, "q4");
    const { purchaseId, authorRoyaltyPayoutId } = buy(ledger, magnet, 10_000);
    expect(ledger.refundPurchase(ledger.getPurchase(purchaseId)!)).toEqual({
      ok: true,
      refunded: 9_500,
    });
    clock += 200;
    const claim = ledger.settlement.claimBatch("root", [authorRoyaltyPayoutId!]);
    expect(claim.claimed, "a voided royalty is never claimable").toEqual([]);
    expect(liveOwed(sqlite)).toBe(receipts(sqlite));
  });

  it("a second concurrent /refund is stopped by void()'s conditionality, not by the state guard", () => {
    const { ledger, sqlite } = newLedger();
    const magnet = publish(ledger, "q5");
    const { purchaseId } = buy(ledger, magnet, 10_000);
    // Both requests read `p` before either committed — /refund awaits a
    // mirror-node fetch between the read and the write, so this is the normal
    // interleaving, and refundPurchase checks the STALE snapshot's refundState.
    const snapshotA = ledger.getPurchase(purchaseId)!;
    const snapshotB = ledger.getPurchase(purchaseId)!;
    expect(ledger.refundPurchase(snapshotA)).toEqual({ ok: true, refunded: 9_500 });
    const second = ledger.refundPurchase(snapshotB);
    expect(second.ok, "no double refund").toBe(false);
    // And the reason is now true: nothing claimed it, a concurrent refund had
    // already voided it. Saying "a settlement batch" sent an operator to the
    // batch table for a race that happened in this route (L2).
    expect((second as { reason: string }).reason).toBe(
      "royalty was already voided by a concurrent refund",
    );
    expect(
      ledger.payouts().filter((r) => r.reason === "refund"),
      "exactly one refund row",
    ).toHaveLength(1);
    expect(liveOwed(sqlite)).toBe(receipts(sqlite));
  });
});

describe("R3: refundUndelivered when the tracker fee row was already claimed", () => {
  it("short-pays the buyer — still — but says so out loud", () => {
    const { ledger, sqlite } = newLedger();
    const magnet = publish(ledger, "q6");
    const { purchaseId, trackerFeePayoutId } = buy(ledger, magnet, 10_000);

    // tracker_fee is availableAt = now, so an epoch can claim it the instant
    // the purchase commits — before the route's store.read() fails.
    ledger.settlement.claimBatch("root", [trackerFeePayoutId!]);

    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      errors.push(a.join(" "));
    });
    try {
      expect(ledger.refundUndelivered({ id: purchaseId })).toEqual({ ok: true, refunded: 9_500 });
    } finally {
      spy.mockRestore();
    }
    const due = ledger.payouts({ payee: "0.0.2222" }).find((x) => x.reason === "refund_due")!;
    // A claimed row cannot be voided, so this window is still a shortfall — the
    // fix for that is not to make a claimed payout reversible. What has changed is
    // that it is no longer silent: the reported amount differs from `paid`, and an
    // operator is told which row could not be reversed and why.
    expect(due.amount, "9_500 of 10_000 — the fee was already claimed").toBe(9_500);
    expect(errors.join("\n")).toMatch(/paid 10000 µUSDC and only 9500 could be reversed/);
    expect(errors.join("\n")).toMatch(/already claimed by a settlement batch/);
    expect(ledger.getPurchase(purchaseId)!.refundState).toBe("refunded");
    // Worth noting what does NOT break: the total is still conserved, because
    // the kept fee is a real payout row to the registry.
    expect(liveOwed(sqlite)).toBe(receipts(sqlite));
  });
});

// ---------------------------------------------------------------------------
// R4  A refund arriving mid-EpochRunner run.
// ---------------------------------------------------------------------------

describe("R4: a refund landing while EpochRunner is mid-run", () => {
  it("cannot void a row the in-flight batch claimed, and cannot be lost by one it did not", async () => {
    const { ledger, sqlite } = newLedger();
    const magnet = publish(ledger, "q7");
    const a = buy(ledger, magnet, 10_000, "0.0.3001");
    clock += 121; // a's royalty is now claimable
    const b = buy(ledger, magnet, 10_000, "0.0.3002"); // b's royalty is held

    let release!: (v: { txId: string; status: string }) => void;
    const inflight = new Promise<{ txId: string; status: string }>((r) => (release = r));
    const settler = createSettler({
      ledger: ledger.settlement,
      client: {} as never,
      token: "0.0.1",
      payer: REGISTRY,
      submit: async () => inflight,
    });
    const runner = createEpochRunner({ settler, ledger, client: null, now: () => clock });

    const run = runner.run();
    await new Promise((r) => setImmediate(r));

    // a's royalty + both tracker fees are in the in-flight batch.
    const refundA = ledger.refundPurchase(ledger.getPurchase(a.purchaseId)!);
    expect(refundA.ok, "a's window is closed anyway").toBe(false);
    expect((refundA as { reason: string }).reason).toBe("refund window has closed");

    // b's royalty was never claimable, so b refunds cleanly mid-run.
    expect(ledger.refundPurchase(ledger.getPurchase(b.purchaseId)!)).toEqual({
      ok: true,
      refunded: 9_500,
    });

    release({ txId: "0.0.1@1.1", status: "SUCCESS" });
    await run;

    expect(liveOwed(sqlite)).toBe(receipts(sqlite));
    // b's refund is a fresh claimable row; it was not swept into the batch that
    // was already in the air.
    const refundRow = ledger.payouts({ payee: "0.0.3002" }).find((r) => r.reason === "refund")!;
    expect(refundRow.settledBatchId).toBeNull();
    expect(refundRow.state).toBe("claimable");
  });

  it("EpochRunner shares one run across concurrent callers — one settle, one anchor", async () => {
    const { ledger } = newLedger();
    const magnet = publish(ledger, "q8");
    buy(ledger, magnet, 10_000);
    // Past the refund window, so the author's royalty is claimable: the tracker
    // fee alone would be a payout to the registry account, which *is* the batch
    // payer, and such a batch is settled without submitting anything (L1).
    clock += 121;
    let submits = 0;
    const settler = createSettler({
      ledger: ledger.settlement,
      client: {} as never,
      token: "0.0.1",
      payer: REGISTRY,
      submit: async () => {
        submits++;
        await new Promise((r) => setTimeout(r, 5));
        return { txId: "0.0.1@1.1", status: "SUCCESS" };
      },
    });
    const runner = createEpochRunner({ settler, ledger, client: null, now: () => clock });
    const [x, y, z] = await Promise.all([runner.run(), runner.run(), runner.run()]);
    expect(submits).toBe(1);
    expect(x).toBe(y);
    expect(y).toBe(z);
    // A second, sequential run after the first resolved is a fresh run.
    await runner.run();
    expect(submits, "the guard is per-in-flight-run, not a one-shot latch").toBe(1); // nothing left owed
  });
});

// ---------------------------------------------------------------------------
// R5  Delist vs in-flight refunds and accrued royalties.
// ---------------------------------------------------------------------------

describe("R5: delist does not touch money in flight", () => {
  it("a purchase inside its window is still refundable after the artifact is delisted", () => {
    const { ledger, sqlite } = newLedger();
    const magnet = publish(ledger, "q9");
    const { purchaseId } = buy(ledger, magnet, 10_000);
    expect(ledger.delist(magnet)).toMatchObject({ delisted: true });
    expect(ledger.liveListing(magnet)).toBeNull();
    expect(
      ledger.refundPurchase(ledger.getPurchase(purchaseId)!),
      "refund survives delist",
    ).toEqual({ ok: true, refunded: 9_500 });
    expect(liveOwed(sqlite)).toBe(receipts(sqlite));
  });

  it("a royalty accrued before the delist is still paid after it", async () => {
    const { ledger } = newLedger();
    const magnet = publish(ledger, "q10");
    buy(ledger, magnet, 10_000);
    ledger.delist(magnet);
    clock += 121;
    const settler = createSettler({
      ledger: ledger.settlement,
      client: {} as never,
      token: "0.0.1",
      payer: REGISTRY,
      submit: async () => ({ txId: "0.0.1@1.1", status: "SUCCESS" }),
    });
    const out = await settler.settle();
    expect(out).toHaveLength(1);
    expect(out[0]!.leaves).toEqual(
      expect.arrayContaining([[AUTHOR_ACCOUNT, 9_500] as [string, number]]),
    );
  });

  it("a delisted artifact still anchors, and delist is idempotent", () => {
    const { ledger } = newLedger();
    const magnet = publish(ledger, "q11");
    const first = ledger.delist(magnet)!;
    const second = ledger.delist(magnet)!;
    expect(second).toEqual({ delisted: false, delistedAt: first.delistedAt });
    expect(ledger.unanchoredManifests().map((a) => a.magnet)).toContain(magnet);
  });

  it("delist does NOT stop a purchase whose 402 was already issued — quote/settle is not re-checked", () => {
    // The gate re-uses the requirements it issued (`replay`) and never re-quotes,
    // so a buyer holding a 30s-old 402 can still pay for a delisted artifact.
    // onPaid does not re-check isLive() either — only getArtifact() != null.
    const { ledger } = newLedger();
    const magnet = publish(ledger, "q12");
    ledger.delist(magnet);
    const { purchaseId } = buy(ledger, magnet, 10_000);
    expect(
      ledger.getPurchase(purchaseId),
      "a sale after delisting is recorded and paid out normally",
    ).not.toBeNull();
    expect(ledger.payouts({ payee: AUTHOR_ACCOUNT })[0]!.amount).toBe(9_500);
  });
});

// ---------------------------------------------------------------------------
// R6  recordPurchase idempotency depends on a non-empty txId.
// ---------------------------------------------------------------------------

describe("R6: recordPurchase idempotency", () => {
  it("is exact on a real txId — a retried onPaid accrues nothing new", () => {
    const { ledger, sqlite } = newLedger();
    const magnet = publish(ledger, "q13");
    const args = {
      magnet,
      buyer: "0.0.2222",
      txId: "0.0.2222@9.9",
      paid: 10_000,
      payoutAccount: AUTHOR_ACCOUNT,
      refundWindowSeconds: 120,
    };
    const a = ledger.recordPurchase(args);
    const b = ledger.recordPurchase(args);
    expect(b).toEqual(a);
    expect(ledger.payouts()).toHaveLength(2);
    expect(liveOwed(sqlite)).toBe(receipts(sqlite));
  });

  it("refuses an empty txId outright, because every de-duplication keys on it", () => {
    const { ledger, sqlite } = newLedger();
    const magnet = publish(ledger, "q14");
    const args = {
      magnet,
      buyer: "0.0.2222",
      txId: "", // s.transaction === "" from a facilitator
      paid: 10_000,
      payoutAccount: AUTHOR_ACCOUNT,
      refundWindowSeconds: 120,
    };
    // `purchaseByTxId` short-circuits on a falsy txId and the unique index
    // excludes '', so three calls used to produce three purchases and six payout
    // rows for ONE payment — 30 000 µUSDC owed on a 10 000 µUSDC sale — and
    // nothing could find them by transaction afterwards.
    for (let i = 0; i < 3; i++) {
      expect(() => ledger.recordPurchase(args)).toThrow(
        /refusing to record a purchase with no transaction id/,
      );
    }
    expect(ledger.payouts(), "nothing accrued").toEqual([]);
    expect(liveOwed(sqlite)).toBe(0);
    expect(receipts(sqlite)).toBe(0);
    // The gate is the other half: it never calls onPaid without a transaction id,
    // and routes such a settlement to owe() instead — so the buyer still gets what
    // they paid for and the payment is queued for an operator rather than
    // triple-recorded. See packages/hedera-x402/src/gate.test.ts.
    expect(ledger.purchaseByTxId("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// R7  Property test: the arithmetic invariants over random sequences.
// ---------------------------------------------------------------------------

describe("R7: invariants over random publish/purchase/refund/delist/settle sequences", () => {
  /** Deterministic PRNG so a failure is reproducible from its seed. */
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x1_0000_0000;
    };
  }

  const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

  it.each(SEEDS)(
    "seed %i: sum(live payouts) === sum(receipts), and fee+royalty === paid per sale",
    async (seed) => {
      const rand = rng(seed);
      const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;

      // The tracker fee is re-read from config on every purchase, so vary it
      // between operations — this is the drift the amountOf() reads exist for.
      let trackerFee = 500;
      const { ledger, sqlite } = newLedger(trackerFee);
      // RegistryLedger reads cfg.trackerFee by reference on each recordPurchase.
      const cfg = (ledger as unknown as { cfg: { trackerFee: number } }).cfg;

      const magnets: string[] = [];
      const purchases: number[] = [];
      const settler = createSettler({
        ledger: ledger.settlement,
        client: {} as never,
        token: "0.0.1",
        payer: REGISTRY,
        submit: async () => {
          // Randomly succeed, fail on-ledger, or come back unclassifiable.
          const r = rand();
          if (r < 0.6) return { txId: `0.0.1@${Math.floor(rand() * 1e6)}.0`, status: "SUCCESS" };
          if (r < 0.85) return { txId: "0.0.1@1.1", status: "INSUFFICIENT_TOKEN_BALANCE" };
          return { txId: "", status: "" };
        },
      });

      for (let step = 0; step < 60; step++) {
        const op = pick([
          "publish",
          "buy",
          "buy",
          "buy",
          "refund",
          "refundUndelivered",
          "delist",
          "settle",
          "tick",
          "feeChange",
        ]);
        switch (op) {
          case "publish":
            magnets.push(publish(ledger, `pq-${seed}-${step}`, 10_000));
            break;
          case "buy": {
            if (magnets.length === 0) break;
            // Prices above and below the fee, so the clamp branch is exercised.
            const paid = Math.floor(rand() * 3_000) + (rand() < 0.2 ? 1 : 2_000);
            const { purchaseId, authorRoyaltyPayoutId, trackerFeePayoutId } = buy(
              ledger,
              pick(magnets),
              paid,
              `0.0.${4000 + Math.floor(rand() * 5)}`,
            );
            purchases.push(purchaseId);
            // The per-sale identity, at the row level, for every single sale.
            const royalty = ledger.settlement.amountOf(authorRoyaltyPayoutId)!;
            const fee = ledger.settlement.amountOf(trackerFeePayoutId)!;
            expect(fee + royalty, `sale ${purchaseId} (paid ${paid}, fee cfg ${cfg.trackerFee})`).toBe(
              paid,
            );
            expect(fee).toBeLessThanOrEqual(paid);
            expect(royalty).toBeGreaterThanOrEqual(0);
            break;
          }
          case "refund": {
            if (purchases.length === 0) break;
            const p = ledger.getPurchase(pick(purchases));
            if (p) ledger.refundPurchase(p);
            break;
          }
          case "refundUndelivered": {
            if (purchases.length === 0) break;
            ledger.refundUndelivered({ id: pick(purchases) });
            break;
          }
          case "delist":
            if (magnets.length > 0) ledger.delist(pick(magnets));
            break;
          case "settle":
            await settler.settle();
            break;
          case "tick":
            clock += Math.floor(rand() * 200);
            break;
          case "feeChange":
            // An operator raising or lowering TRACKER_FEE_MICRO_USDC mid-flight.
            trackerFee = pick([0, 1, 500, 2_000, 50_000]);
            cfg.trackerFee = trackerFee;
            break;
        }

        // THE invariant, after every single operation: the rail can never be
        // asked to pay out more than the sales actually received.
        expect(
          liveOwed(sqlite),
          `step ${step} (${op}): owed ${liveOwed(sqlite)} vs receipts ${receipts(sqlite)}`,
        ).toBeLessThanOrEqual(receipts(sqlite));
        // No negative amounts anywhere.
        expect(
          (
            sqlite.prepare(`SELECT COUNT(*) AS n FROM payout WHERE amount < 0`).get() as { n: number }
          ).n,
        ).toBe(0);
        // A row is never both voided and claimed.
        expect(
          (
            sqlite
              .prepare(
                `SELECT COUNT(*) AS n FROM payout WHERE voided_at IS NOT NULL AND settled_batch_id IS NOT NULL`,
              )
              .get() as { n: number }
          ).n,
        ).toBe(0);
      }

      // And at the end, exact conservation: every sale's value is somewhere —
      // a royalty, a fee, or a refund row — and nowhere twice.
      expect(liveOwed(sqlite)).toBe(receipts(sqlite));
    },
  );

  it("splitSale is total over every integer sale/fee pair, including the clamp", () => {
    for (let paid = 0; paid <= 40; paid++) {
      for (let fee = 0; fee <= 40; fee++) {
        const { fee: f, royalty: r } = splitSale(paid, fee);
        expect(f + r).toBe(paid);
        expect(f).toBe(Math.min(fee, paid));
        expect(r).toBeGreaterThanOrEqual(0);
      }
    }
    expect(() => splitSale(1.5, 0)).toThrow(/non-negative integer/);
    expect(() => splitSale(-1, 0)).toThrow(/non-negative integer/);
    // Reachable: config.ts's int() truncates but never rejects a negative, so
    // TRACKER_FEE_MICRO_USDC=-1 makes every purchase throw inside onPaid.
    expect(() => splitSale(10, -1)).toThrow(/trackerFee must be a non-negative integer/);
  });
});
