import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXPIRY_FRESHNESS,
  HALF_LIVES_TO_EXPIRY,
  daysToExpiry,
  decayStage,
  halfLivesElapsed,
  priceAtFreshness,
} from "./decay";

describe("EXPIRY_FRESHNESS", () => {
  it("still matches @carpool/core's isExpired threshold", () => {
    // The constant is duplicated rather than imported (importing @carpool/core
    // drags better-sqlite3 and an ONNX runtime into a browser bundle), so the
    // source of truth is checked from disk instead.
    const core = readFileSync(
      join(process.cwd(), "..", "..", "packages", "carpool-core", "src", "decay.ts"),
      "utf8",
    );
    expect(core, "core's isExpired no longer compares against 0.125").toContain("< 0.125");
    expect(EXPIRY_FRESHNESS).toBe(0.125);
  });
});

describe("halfLivesElapsed", () => {
  it("reads half-lives off freshness rather than off a clock", () => {
    expect(halfLivesElapsed(1)).toBeCloseTo(0, 10);
    expect(halfLivesElapsed(0.5)).toBeCloseTo(1, 10);
    expect(halfLivesElapsed(0.25)).toBeCloseTo(2, 10);
    expect(halfLivesElapsed(0.125)).toBeCloseTo(3, 10);
  });
  it("clamps freshness above 1 (clock skew) to zero half-lives", () => {
    expect(halfLivesElapsed(1.4)).toBeCloseTo(0, 10);
  });
  it("returns Infinity at zero rather than -0 or NaN", () => {
    expect(halfLivesElapsed(0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("daysToExpiry", () => {
  it("is three half-lives minus the age the registry served", () => {
    expect(daysToExpiry(0, 2)).toBe(6);
    expect(daysToExpiry(6, 2)).toBe(0);
    expect(daysToExpiry(7, 2)).toBe(-1);
  });

  it("uses only server-side quantities — no clock is read here", () => {
    // `ageDays` comes off /state and /search (registry clock) and
    // `halfLifeDays` is inside the signed manifest, so this cannot drift from
    // the freshness or the price printed beside it. The previous version
    // parsed producedAt and compared it against Date.now().
    const before = daysToExpiry(1.5, 1);
    const after = daysToExpiry(1.5, 1);
    expect(before).toBe(after);
  });

  it("agrees with the freshness threshold it claims to predict", () => {
    // At the instant it reports zero, freshness is exactly EXPIRY_FRESHNESS.
    const halfLifeDays = 3;
    const ageAtExpiry = HALF_LIVES_TO_EXPIRY * halfLifeDays;
    expect(daysToExpiry(ageAtExpiry, halfLifeDays)).toBe(0);
    expect(Math.pow(0.5, ageAtExpiry / halfLifeDays)).toBeCloseTo(EXPIRY_FRESHNESS, 12);
  });

  it("agrees with halfLivesElapsed on the same artifact", () => {
    // Two readings of one decay: elapsed half-lives off freshness, remaining
    // days off ageDays. They must describe the same point.
    const halfLifeDays = 4;
    const ageDays = 6;
    const freshness = Math.pow(0.5, ageDays / halfLifeDays);
    expect(halfLivesElapsed(freshness)).toBeCloseTo(ageDays / halfLifeDays, 10);
    expect(daysToExpiry(ageDays, halfLifeDays)).toBeCloseTo(
      (HALF_LIVES_TO_EXPIRY - halfLivesElapsed(freshness)) * halfLifeDays,
      10,
    );
  });
});

describe("decayStage", () => {
  it("bands on the half-life boundaries, and a boundary belongs to the fresher band", () => {
    // Strictly-less-than throughout, matching @carpool/core's isExpired: an
    // artifact sitting exactly on a half-life has not yet passed it.
    expect(decayStage(1)).toBe("fresh");
    expect(decayStage(0.5)).toBe("fresh");
    expect(decayStage(0.4999)).toBe("halved");
    expect(decayStage(0.25)).toBe("halved");
    expect(decayStage(0.2499)).toBe("dying");
    expect(decayStage(EXPIRY_FRESHNESS)).toBe("dying");
    expect(decayStage(0.1249)).toBe("expired");
  });
});

describe("priceAtFreshness", () => {
  it("reproduces priceAt(): floor + round(base × freshness)", () => {
    expect(priceAtFreshness({ priceBase: 397_041, priceFloor: 39_704 }, 1)).toBe(436_745);
    expect(priceAtFreshness({ priceBase: 100_000, priceFloor: 10_000 }, 0.5)).toBe(60_000);
  });
  it("never returns less than the floor", () => {
    expect(priceAtFreshness({ priceBase: 100_000, priceFloor: 10_000 }, 0)).toBe(10_000);
    expect(priceAtFreshness({ priceBase: 100_000, priceFloor: 10_000 }, -1)).toBe(10_000);
  });
});
