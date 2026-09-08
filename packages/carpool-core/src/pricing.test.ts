import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAP_MICRO_USDC,
  DEFAULT_MAX_REDO_COST_USD,
  MIN_PRICE_MICRO_USDC,
  PRICE_SHARE_OF_REDO_COST,
  capMicroUsdc,
  floorForPrice,
  maxBuyableRedoCostUsd,
  priceForRedoCost,
} from "./pricing.js";

/**
 * I4 — the shipped price rule and the shipped spend cap were mutually exclusive.
 *
 * `carpool_publish` priced at 15% of the production cost; `carpool_fetch` capped
 * a payment at 20,000 µUSDC. Break-even: 20,000 / 0.15 / 1e6 = **$0.1333**, so
 * out of the box any artifact that cost more than thirteen cents to produce was
 * unbuyable — including the A/B document's own $2.14 example, priced at 321,000
 * µUSDC, 16× the cap. The failure surfaced as an opaque client-side throw,
 * because the x402 spend control rejects before the request is sent.
 *
 * These assertions are the relationship itself, so the two constants cannot drift
 * apart again without a red test.
 */
describe("the default price rule and the default spend cap are one decision", () => {
  it("the cap is derived from the share and the most-expensive-run, not chosen separately", () => {
    expect(DEFAULT_CAP_MICRO_USDC).toBe(
      Math.round(DEFAULT_MAX_REDO_COST_USD * 1e6 * PRICE_SHARE_OF_REDO_COST),
    );
  });

  it("an artifact priced by the default rule at the stated ceiling is buyable under the default cap", () => {
    expect(priceForRedoCost(DEFAULT_MAX_REDO_COST_USD)).toBeLessThanOrEqual(DEFAULT_CAP_MICRO_USDC);
  });

  it("buys the A/B document's own worked example — the one artifact this repo has measured", () => {
    // $3.97 by the producing session's own transcript, and that is a floor.
    expect(priceForRedoCost(3.9704)).toBeLessThanOrEqual(DEFAULT_CAP_MICRO_USDC);
    // The retracted document's $2.14 example, which the 20,000 µUSDC cap made
    // unbuyable by 16×. Under the resolved share it prices at 214,000 (it was
    // 321,000 at 0.15) and both are inside the derived cap — the regression is
    // that this is comfortably buyable, not the specific integer.
    expect(priceForRedoCost(2.14)).toBe(214_000);
    expect(priceForRedoCost(2.14)).toBeLessThanOrEqual(DEFAULT_CAP_MICRO_USDC);
    expect(321_000).toBeLessThanOrEqual(DEFAULT_CAP_MICRO_USDC);
  });

  it("pins the resolved share, so a silent return to 0.15 is a red test", () => {
    // docs/AUDIT-CLAIMS.md M4: this constant said 0.15 while apps/bench listed at
    // 0.10. Resolved to 0.10; the reasoning, and why 0.15 was rejected, is the
    // block comment on PRICE_SHARE_OF_REDO_COST in pricing.ts. Asserted as a
    // literal because a policy decision nothing pins is a preference.
    expect(PRICE_SHARE_OF_REDO_COST).toBe(0.1);
    expect(DEFAULT_CAP_MICRO_USDC).toBe(500_000);
    // The guard the share exists to be: price is a *fraction* of a number the
    // author reports about themselves, so an inflated self-report is scaled down
    // rather than trusted. Doubling the claim doubles the price and no more.
    expect(priceForRedoCost(2)).toBe(2 * priceForRedoCost(1));
    expect(priceForRedoCost(1)).toBeLessThan(1e6 * 0.5);
  });

  it("the two express the same ceiling, read from either end", () => {
    expect(maxBuyableRedoCostUsd(DEFAULT_CAP_MICRO_USDC)).toBeCloseTo(DEFAULT_MAX_REDO_COST_USD, 9);
  });

  it("still refuses something genuinely expensive, so the cap is a cap and not decoration", () => {
    expect(priceForRedoCost(DEFAULT_MAX_REDO_COST_USD * 3)).toBeGreaterThan(DEFAULT_CAP_MICRO_USDC);
  });

  it("prices cheap research at the floor, never below the registry's tracker fee", () => {
    expect(priceForRedoCost(0.000_001)).toBe(MIN_PRICE_MICRO_USDC);
    expect(floorForPrice(MIN_PRICE_MICRO_USDC)).toBeGreaterThanOrEqual(500); // TRACKER_FEE_MICRO_USDC default
  });

  it("honours CARPOOL_MAX_MICRO_USDC, and falls back rather than producing NaN", () => {
    expect(capMicroUsdc({ CARPOOL_MAX_MICRO_USDC: "1234567" })).toBe(1_234_567);
    expect(capMicroUsdc({ CARPOOL_MAX_MICRO_USDC: "" })).toBe(DEFAULT_CAP_MICRO_USDC);
    expect(capMicroUsdc({ CARPOOL_MAX_MICRO_USDC: "not a number" })).toBe(DEFAULT_CAP_MICRO_USDC);
    expect(capMicroUsdc({})).toBe(DEFAULT_CAP_MICRO_USDC);
  });
});
