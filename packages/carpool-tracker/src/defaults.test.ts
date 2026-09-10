import { describe, it, expect } from "vitest";
import { DEFAULT_HALF_LIFE_DAYS, MAX_HALF_LIFE_DAYS } from "./defaults.js";

describe("half-life defaults", () => {
  it("DEFAULT_HALF_LIFE_DAYS is positive and short — hours to a few days, not a month", () => {
    expect(DEFAULT_HALF_LIFE_DAYS).toBeGreaterThan(0);
    expect(DEFAULT_HALF_LIFE_DAYS).toBeLessThanOrEqual(3);
  });

  it("MAX_HALF_LIFE_DAYS matches Phase 0's 14-day observation window", () => {
    expect(MAX_HALF_LIFE_DAYS).toBe(14);
  });

  it("the default sits at or below the cap", () => {
    expect(DEFAULT_HALF_LIFE_DAYS).toBeLessThanOrEqual(MAX_HALF_LIFE_DAYS);
  });
});
