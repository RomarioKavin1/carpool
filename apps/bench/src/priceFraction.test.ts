/**
 * M4, closed: one price fraction, asserted across the two places that had two.
 *
 * ## What was wrong
 *
 * `docs/AUDIT-CLAIMS.md` M4: `@carpool/core`'s `PRICE_SHARE_OF_REDO_COST` was
 * **0.15** — the share `carpool_publish` prices at, and the share the buyer's
 * default spend cap is *derived* from — while this package's
 * `PRICE_BASE_FRACTION_OF_REDO` was **0.10**, and the A/B runner said so in the
 * published document as a stated policy choice. Two numbers for one decision, in
 * one repo, both presented as the default, neither file noting that the other
 * existed. The consequence was not cosmetic: the only executed measurement in
 * this tree (`ab-measured.json`, `docs/AB-MEASUREMENT.md`) listed the artifact at
 * a price the shipped product would not have charged for it — 397,041 µUSDC
 * against the 595,562 µUSDC `priceForRedoCost()` would have quoted.
 *
 * ## What resolved it
 *
 * 0.10, everywhere. The reasoning — the Phase 0 algebra both values imply, why
 * 0.15 was rejected, what it costs authors, and which measurement would flip the
 * decision back — is the block comment on `PRICE_SHARE_OF_REDO_COST` in
 * `packages/carpool-core/src/pricing.ts`. This file is the enforcement, not the
 * argument.
 *
 * It is deliberately not only an identity check on two constants. A policy that
 * lives in one constant can still be *applied* by two formulas, which is how the
 * repo got here; so the assertions below run from the constant through the price
 * rule, the derived spend cap, the floor, and the recorded measurement, and
 * check that every one of them is the same decision read from a different end.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAP_MICRO_USDC,
  DEFAULT_MAX_REDO_COST_USD,
  MIN_PRICE_MICRO_USDC,
  PRICE_FLOOR_SHARE,
  PRICE_SHARE_OF_REDO_COST,
  floorForPrice,
  maxBuyableRedoCostUsd,
  priceForRedoCost,
} from "@carpool/core";
import { PRICE_BASE_FRACTION_OF_REDO, floorFor, redoCostUsd } from "./docFigures.js";
import { PUBLISHED_OPUS_5_RATES } from "./provenance.js";
import redoMeasured from "./redo-measured.json" with { type: "json" };
import abMeasured from "./ab-measured.json" with { type: "json" };

const redoUsd = redoCostUsd(redoMeasured, PUBLISHED_OPUS_5_RATES);

describe("the price fraction is one number", () => {
  it("the A/B runner's fraction IS the shipped price rule's share", () => {
    expect(
      PRICE_BASE_FRACTION_OF_REDO,
      "apps/bench listed at one fraction of the redo cost while carpool_publish priced at " +
        "another, and the buyer's spend cap was derived from the second — see M4",
    ).toBe(PRICE_SHARE_OF_REDO_COST);
    // Pinned to the resolved value too, so agreeing on the *wrong* number is
    // still red. Changing it is meant to require reading the reasoning.
    expect(PRICE_SHARE_OF_REDO_COST).toBe(0.1);
  });

  it("the runner's floor is the shipped floor rule, not a copy of its arithmetic", () => {
    for (const base of [0, 1, 999, 1_000, 9_999, 10_000, 397_041, 1_000_000, 123_457]) {
      expect(floorFor(base)).toBe(floorForPrice(base));
      expect(floorFor(base)).toBe(Math.max(MIN_PRICE_MICRO_USDC, Math.round(base * PRICE_FLOOR_SHARE)));
    }
  });

  it("the recorded measurement was published at the price the shipped rule quotes", () => {
    // The assertion M4 made impossible. `priceForRedoCost` is what
    // `carpool_publish` charges; `ab-measured.json` is what the run published at.
    // They have to be the same integer or the repo's own worked example is
    // demonstrating a policy it does not ship.
    expect(redoUsd).toBeGreaterThan(0);
    expect(priceForRedoCost(redoUsd)).toBe(abMeasured.buy.priceBaseMicroUsdc);
    expect(floorForPrice(abMeasured.buy.priceBaseMicroUsdc)).toBe(abMeasured.buy.priceFloorMicroUsdc);
  });

  it("a default buyer can buy the repo's own measured artifact, cap and share being one decision", () => {
    // The cap moves with the share (0.10 × $5 = 500,000 µUSDC, was 750,000 at
    // 0.15), so this is the check that the two ends still meet after the change.
    expect(DEFAULT_CAP_MICRO_USDC).toBe(
      Math.round(DEFAULT_MAX_REDO_COST_USD * 1e6 * PRICE_SHARE_OF_REDO_COST),
    );
    expect(abMeasured.buy.paidMicroUsdc).toBeLessThanOrEqual(DEFAULT_CAP_MICRO_USDC);
    expect(priceForRedoCost(redoUsd)).toBeLessThanOrEqual(DEFAULT_CAP_MICRO_USDC);
    expect(maxBuyableRedoCostUsd(DEFAULT_CAP_MICRO_USDC)).toBeCloseTo(DEFAULT_MAX_REDO_COST_USD, 9);
  });

  it("the share is still a cap on a SELF-REPORTED number, which is why it is a fraction", () => {
    // `estimatedCostUsd` comes from the author. The rule never trusts it; it
    // takes a fraction of it, so the leverage of an inflated claim is exactly the
    // share. This is the property the resolution had to preserve, and the reason
    // the lower of the two candidate values is the safer one.
    const honest = 4;
    const inflated = honest * 2;
    expect(priceForRedoCost(inflated) - priceForRedoCost(honest)).toBe(
      Math.round(honest * 1e6 * PRICE_SHARE_OF_REDO_COST),
    );
    // Even a wildly inflated self-report cannot make the price exceed the
    // claimed cost — buying beats redoing by construction, not by hope.
    for (const claim of [0.01, 0.5, 4, 40, 400]) {
      expect(priceForRedoCost(claim)).toBeLessThan(claim * 1e6);
    }
  });

  it("the document's stated policy percentage is the constant, not a typed number", () => {
    // `ab-run.test.ts` prints `${(PRICE_BASE_FRACTION_OF_REDO * 100).toFixed(0)}%`
    // into the block the document carries verbatim, so this is the string a
    // reader sees. It has to be derivable from the one constant.
    expect(`${(PRICE_BASE_FRACTION_OF_REDO * 100).toFixed(0)}%`).toBe("10%");
  });
});
