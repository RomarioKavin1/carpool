import { describe, it, expect } from "vitest";
import { freshness, priceAt, isExpired } from "./decay.js";

const HALF_LIFE_DAYS = 4;
const PRODUCED_AT = "2026-01-01T00:00:00Z";
const producedMs = Date.parse(PRODUCED_AT);
const DAY_MS = 86_400_000;

function atHalfLives(n: number): number {
  return producedMs + n * HALF_LIFE_DAYS * DAY_MS;
}

const decay = { halfLifeDays: HALF_LIFE_DAYS, producedAt: PRODUCED_AT };

describe("freshness", () => {
  it("is 1 at zero half-lives (just produced)", () => {
    expect(freshness({ decay }, atHalfLives(0))).toBeCloseTo(1, 10);
  });

  it("is 0.5 at exactly one half-life", () => {
    expect(freshness({ decay }, atHalfLives(1))).toBeCloseTo(0.5, 10);
  });

  it("is 0.25 at exactly two half-lives", () => {
    expect(freshness({ decay }, atHalfLives(2))).toBeCloseTo(0.25, 10);
  });

  it("is 0.125 at exactly three half-lives", () => {
    expect(freshness({ decay }, atHalfLives(3))).toBeCloseTo(0.125, 10);
  });

  it("stays in (0,1] and never reaches exactly 0", () => {
    const far = freshness({ decay }, atHalfLives(50));
    expect(far).toBeGreaterThan(0);
    expect(far).toBeLessThanOrEqual(1);
  });

  it("clamps at 1 for a producedAt in the future (clock skew) rather than exceeding 1", () => {
    expect(freshness({ decay }, producedMs - DAY_MS)).toBe(1);
  });
});

describe("priceAt", () => {
  const priceBase = 10_000;
  const priceFloor = 500;

  it("returns priceBase + priceFloor at zero half-lives", () => {
    expect(priceAt({ priceBase, priceFloor, decay }, atHalfLives(0))).toBe(priceFloor + priceBase);
  });

  it("rounds to the nearest integer µUSDC — a non-dyadic point where round() isn't a no-op", () => {
    // At exactly one half-life, base*freshness = 5000 exactly, so a missing
    // Math.round would pass unnoticed. At 0.5 half-lives, freshness is
    // 0.5**0.5 = 0.70710678..., so base*freshness = 7071.067811865476:
    // rounding is genuinely exercised, and floor()/ceil()/truncation would
    // each give a different, wrong answer.
    const p = priceAt({ priceBase, priceFloor, decay }, atHalfLives(0.5));
    expect(Number.isInteger(p)).toBe(true);
    expect(p).toBe(priceFloor + 7071);
  });

  it("never falls below priceFloor, even long after expiry — converges exactly to the floor", () => {
    const p = priceAt({ priceBase, priceFloor, decay }, atHalfLives(100));
    expect(p).toBe(priceFloor);
  });

  it("decreases monotonically as the artifact ages", () => {
    const p0 = priceAt({ priceBase, priceFloor, decay }, atHalfLives(0));
    const p1 = priceAt({ priceBase, priceFloor, decay }, atHalfLives(1));
    const p2 = priceAt({ priceBase, priceFloor, decay }, atHalfLives(2));
    expect(p0).toBeGreaterThan(p1);
    expect(p1).toBeGreaterThan(p2);
  });
});

describe("isExpired", () => {
  it("is false before three half-lives", () => {
    expect(isExpired({ decay }, atHalfLives(2))).toBe(false);
  });

  it("is false at exactly three half-lives (boundary is strictly less-than)", () => {
    expect(isExpired({ decay }, atHalfLives(3))).toBe(false);
  });

  it("is true just past three half-lives", () => {
    expect(isExpired({ decay }, atHalfLives(3) + 1)).toBe(true);
  });
});
