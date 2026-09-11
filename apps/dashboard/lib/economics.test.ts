import { describe, expect, it } from "vitest";
import { buildReuseTotals, claimedSavingUsd } from "./economics";
import {
  FIXTURE_MAGNET_A,
  FIXTURE_MAGNET_B,
  fixtureArtifact,
  fixtureManifest,
  fixturePurchase,
  fixtureState,
} from "./fixtures.testonly";

const FEE = 500;

function stateWith() {
  return fixtureState({
    artifacts: [
      fixtureArtifact({
        manifest: fixtureManifest({
          magnet: FIXTURE_MAGNET_A,
          provenance: {
            model: "fixture-model",
            durationSeconds: 60,
            inputTokens: 1000,
            outputTokens: 200,
            estimatedCostUsd: 2,
            toolCalls: 1,
          },
        }),
      }),
      fixtureArtifact({
        manifest: fixtureManifest({
          magnet: FIXTURE_MAGNET_B,
          provenance: {
            model: "fixture-model",
            durationSeconds: 60,
            inputTokens: 500,
            outputTokens: 100,
            estimatedCostUsd: 1,
            toolCalls: 1,
          },
        }),
      }),
    ],
    purchases: [
      fixturePurchase({ id: 1, magnet: FIXTURE_MAGNET_A, paid: 100_000 }),
      fixturePurchase({ id: 2, magnet: FIXTURE_MAGNET_A, paid: 100_000 }),
      fixturePurchase({ id: 3, magnet: FIXTURE_MAGNET_B, paid: 50_000 }),
      fixturePurchase({ id: 4, magnet: FIXTURE_MAGNET_B, paid: 50_000, refundState: "refunded" }),
      // a sale whose artifact is gone from /state
      fixturePurchase({ id: 5, magnet: `swarm:${"f".repeat(64)}`, paid: 70_000 }),
    ],
  });
}

describe("buildReuseTotals", () => {
  const totals = buildReuseTotals(stateWith(), { trackerFeeMicroUsdc: FEE });

  it("counts one avoided redo per kept sale and excludes refunds", () => {
    expect(totals.keptSales).toBe(3);
    expect(totals.refundedSales).toBe(1);
    expect(totals.artifactsSold).toBe(2);
  });

  it("never attributes a production cost to a sale whose artifact is gone", () => {
    expect(totals.salesUnmatched).toBe(1);
    expect(totals.salesCounted).toBe(4);
    // 2 × artifact A ($2, 1200 tokens) + 1 × artifact B ($1, 600 tokens)
    expect(totals.authorClaimedUsd).toBeCloseTo(5, 10);
    expect(totals.authorClaimedTokens).toBe(3000);
  });

  it("sums what buyers paid on kept sales, and nets the fee back on refunds", () => {
    expect(totals.paidUusdc).toBe(250_000);
    // a refund returns paid − fee, so the buyer is still out the fee
    expect(totals.netPaidUusdc).toBe(250_000 + FEE);
  });

  it("leaves the net null rather than guessing the fee", () => {
    const unknown = buildReuseTotals(stateWith(), { trackerFeeMicroUsdc: null });
    expect(unknown.netPaidUusdc).toBeNull();
    expect(unknown.paidUusdc).toBe(250_000);
  });

  it("names the most reused artifact", () => {
    expect(totals.mostReused?.magnet).toBe(FIXTURE_MAGNET_A);
    expect(totals.mostReused?.sales).toBe(2);
  });

  it("is all zeros and nulls for an empty registry — never a seeded figure", () => {
    const empty = buildReuseTotals(fixtureState({ artifacts: [], purchases: [] }), {
      trackerFeeMicroUsdc: FEE,
    });
    expect(empty.keptSales).toBe(0);
    expect(empty.authorClaimedUsd).toBe(0);
    expect(empty.mostReused).toBeNull();
    expect(claimedSavingUsd(empty)).toBeNull();
  });

  it("counts a refunded sale of a missing artifact once, not twice", () => {
    const state = fixtureState({
      artifacts: [],
      purchases: [fixturePurchase({ id: 1, magnet: FIXTURE_MAGNET_A, refundState: "refunded" })],
    });
    const t = buildReuseTotals(state, { trackerFeeMicroUsdc: FEE });
    expect(t.salesUnmatched).toBe(1);
    expect(t.refundedSales).toBe(1);
    expect(t.keptSales).toBe(0);
  });
});

describe("claimedSavingUsd", () => {
  it("reports the difference and the ratio with both operands available", () => {
    const totals = buildReuseTotals(stateWith(), { trackerFeeMicroUsdc: FEE });
    const claimed = claimedSavingUsd(totals)!;
    expect(claimed.savedUsd).toBeCloseTo(5 - 0.25, 10);
    expect(claimed.ratio).toBeCloseTo(5 / 0.25, 10);
  });

  it("refuses a ratio when a side is zero instead of reporting infinity", () => {
    const state = fixtureState({
      artifacts: [
        fixtureArtifact({
          manifest: fixtureManifest({
            magnet: FIXTURE_MAGNET_A,
            provenance: {
              model: "fixture-model",
              durationSeconds: 1,
              inputTokens: 0,
              outputTokens: 0,
              estimatedCostUsd: 0,
              toolCalls: 0,
            },
          }),
        }),
      ],
      purchases: [fixturePurchase({ id: 1, magnet: FIXTURE_MAGNET_A, paid: 0 })],
    });
    const claimed = claimedSavingUsd(buildReuseTotals(state, { trackerFeeMicroUsdc: FEE }))!;
    expect(claimed.ratio).toBeNull();
    expect(Number.isFinite(claimed.savedUsd)).toBe(true);
  });
});
