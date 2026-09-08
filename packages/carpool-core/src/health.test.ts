import { describe, it, expect } from "vitest";
import { health } from "./health.js";

describe("health", () => {
  it("a fresh artifact with zero buyers and zero refunds scores 0.4 (the floor), not 0", () => {
    expect(health({ freshness: 1, refundRate: 0, distinctBuyers: 0 })).toBeCloseTo(0.4, 10);
  });

  it("reaches full buyer credit (1.0 term) at 5 distinct buyers", () => {
    expect(health({ freshness: 1, refundRate: 0, distinctBuyers: 5 })).toBeCloseTo(1, 10);
  });

  it("caps the buyer term at 5+ buyers — more buyers past 5 doesn't push health past freshness*(1-refund)", () => {
    const at5 = health({ freshness: 1, refundRate: 0, distinctBuyers: 5 });
    const at50 = health({ freshness: 1, refundRate: 0, distinctBuyers: 50 });
    expect(at50).toBeCloseTo(at5, 10);
  });

  it("a full refund rate drives health to 0 regardless of freshness or buyers", () => {
    expect(health({ freshness: 1, refundRate: 1, distinctBuyers: 5 })).toBe(0);
  });

  it("scales linearly with freshness", () => {
    const full = health({ freshness: 1, refundRate: 0.2, distinctBuyers: 3 });
    const half = health({ freshness: 0.5, refundRate: 0.2, distinctBuyers: 3 });
    expect(half).toBeCloseTo(full / 2, 10);
  });

  it("more buyers strictly increases health below the cap, all else equal", () => {
    const fewer = health({ freshness: 0.8, refundRate: 0.1, distinctBuyers: 1 });
    const more = health({ freshness: 0.8, refundRate: 0.1, distinctBuyers: 4 });
    expect(more).toBeGreaterThan(fewer);
  });
});
