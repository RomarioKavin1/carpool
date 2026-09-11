/**
 * Unit tests for the A/B arithmetic.
 *
 * EVERY NUMBER IN THIS FILE IS AN INVENTED TEST INPUT. None of it is a finding,
 * none of it describes any artifact, and nothing in the repo may quote it.
 *
 * That warning is here because the first version of this file was the source of
 * `docs/AB-MEASUREMENT.md`'s entire results table: `computeAb` had no caller
 * outside this file, so the fixture's `durationSeconds: 412` / `$2.14` /
 * `195,524 tokens` were transcribed into the doc and the README as measurements
 * of a real artifact. They measured nothing. The values below are deliberately
 * round and obviously synthetic so that they cannot be mistaken for a result,
 * and the real measurement lives in `ab-run.test.ts`, which runs the registry.
 */
import { describe, expect, it } from "vitest";
import { approxTokens, computeAb, renderAb, type BuyCost, type RedoCost } from "./ab.js";

/** Synthetic. Round numbers, chosen to make the ratios easy to check by hand. */
const redo: RedoCost = {
  model: "test/fixture-model",
  inputTokens: 1_000,
  outputTokens: 9_000,
  cacheWriteTokens: 10_000,
  cacheReadTokens: 80_000,
  activeSeconds: 1_000,
  elapsedSeconds: 5_000,
  estimatedCostUsd: 10,
  rates: { input: 1, output: 1, cacheWrite: 1, cacheRead: 1 },
  toolCalls: 20,
  subagentCalls: 2,
  sources: 7,
  alsoProduced: ["a-second-file.html"],
  segment: { transcript: "/dev/null", fromRow: 0, toRow: 1 },
};

const buy: Omit<BuyCost, "bodyBytes" | "tokensIfFullyRead" | "tokensForSummary" | "latencyMs"> = {
  quotedMicroUsdc: 1_000_000, // $1.00
  paidMicroUsdc: 1_000_000,
  priceBaseMicroUsdc: 900_000,
  priceFloorMicroUsdc: 90_000,
  searchLatencyMs: 1_000,
  fetchLatencyMs: 4_000,
  verification: "verified",
  latencyIsLocalFloor: true,
};

const base = {
  magnet: "swarm:abc",
  question: "a synthetic question",
  redo,
  buy,
  body: "x".repeat(40_000),
  summary: "Bought. Written to /tmp/abc.md",
};

describe("A/B arithmetic", () => {
  it("reports both a cost ratio and a time ratio", () => {
    const r = computeAb(base);
    expect(r.savings.usd).toBe(10 - 1);
    expect(r.savings.costRatio).toBe(10);
    // 5s round trip against 1,000s of machine time.
    expect(r.savings.secondsSaved).toBe(995);
    expect(r.savings.timeRatio).toBe(200);
  });

  it("measures time against machine time, not the author's elapsed afternoon", () => {
    // elapsedSeconds includes the human reading their own screen. A buyer does
    // not inherit that wait, so counting it would flatter the ratio 5x here.
    const r = computeAb(base);
    expect(r.savings.timeRatio).toBe(redo.activeSeconds / 5);
    expect(r.savings.timeRatio).not.toBe(redo.elapsedSeconds / 5);
  });

  it("sums the round trip from its two measured halves", () => {
    const r = computeAb(base);
    expect(r.buy.latencyMs).toBe(5_000);
  });

  it("counts cache traffic in the redo total, because the bill does", () => {
    const r = computeAb(base);
    // 1,000 + 9,000 + 10,000 + 80,000 = 100,000, against 10,000 read tokens.
    expect(r.savings.tokensSavedFullRead).toBe(100_000 - 10_000);
  });

  it("separates summary tokens from whole-artifact tokens", () => {
    // This distinction is the product's own claim: fetch writes a file so the
    // buyer chooses how much context to spend. Collapsing the two would hide
    // the case where an agent reads everything and saves almost nothing.
    const r = computeAb(base);
    expect(r.buy.tokensForSummary).toBeLessThan(r.buy.tokensIfFullyRead / 100);
  });

  it("shows a negative token saving when the buyer reads the whole thing", () => {
    const r = computeAb({ ...base, body: "x".repeat(500_000) }); // 125k tokens > 100k redo
    expect(
      r.savings.tokensSavedFullRead,
      "reading a bigger artifact than the research produced is a token LOSS",
    ).toBeLessThan(0);
  });

  it("does not divide by zero on a free artifact", () => {
    const r = computeAb({
      ...base,
      buy: { ...buy, paidMicroUsdc: 0, searchLatencyMs: 0, fetchLatencyMs: 0 },
    });
    expect(r.savings.costRatio).toBe(Infinity);
    expect(r.savings.timeRatio).toBe(Infinity);
  });

  it("approxTokens is roughly 4 characters per token", () => {
    expect(approxTokens("a".repeat(400))).toBe(100);
    expect(approxTokens("")).toBe(0);
    // Characters, not bytes — a multi-byte character is one character. This is
    // why the real artifact reads 11,355 and not the 11,474 `wc -c` implies.
    expect(approxTokens("—".repeat(400))).toBe(100);
    expect(Buffer.byteLength("—".repeat(400), "utf8")).toBe(1_200);
  });
});

describe("rendering cannot drop a caveat the result carries", () => {
  it("prints time before cost", () => {
    const out = renderAb(computeAb(base));
    expect(out.indexOf("  wall clock")).toBeLessThan(out.indexOf("  cost  "));
  });

  it("marks the time ratio itself as local, not just in a caveat below it", () => {
    // A ratio is what gets copied out of a report, so the marker has to travel
    // with the number rather than sit four lines away from it.
    expect(renderAb(computeAb(base))).toMatch(/200x faster \(LOCAL, not a wire time\)/);
    const wire = computeAb({ ...base, buy: { ...buy, latencyIsLocalFloor: false } });
    expect(renderAb(wire)).toMatch(/200x faster,?/);
    expect(renderAb(wire)).not.toMatch(/LOCAL/);
  });

  it("states both floors and the segment boundary when the flags are set", () => {
    const out = renderAb(computeAb(base));
    expect(out).toMatch(/REDO IS A FLOOR: 2 subagent dispatches/);
    expect(out).toMatch(/BUY IS A FLOOR TOO/);
    expect(out).toMatch(/SEGMENT BOUNDARY: the same span also produced a-second-file\.html/);
    expect(out).toMatch(/a price list, not a fact/);
    expect(out).toMatch(/not a population estimate/);
  });

  it("prints the rates the dollar figure was computed at", () => {
    const out = renderAb(computeAb(base));
    expect(out).toMatch(/priced at \$\/MTok: in 1 · out 1 · cache write 1 · cache read 1/);
  });

  it("drops the floor caveats only when the result genuinely has none", () => {
    const clean = computeAb({
      ...base,
      redo: { ...redo, subagentCalls: 0, alsoProduced: [] },
      buy: { ...buy, latencyIsLocalFloor: false },
    });
    const out = renderAb(clean);
    expect(out).not.toMatch(/REDO IS A FLOOR/);
    expect(out).not.toMatch(/SEGMENT BOUNDARY/);
    expect(out).not.toMatch(/BUY IS A FLOOR TOO/);
    // The rate caveat is unconditional: a dollar figure always has a price list.
    expect(out).toMatch(/a price list, not a fact/);
    // And a latency that is NOT a floor still has to say what it covers: a wire
    // number with no statement of scope is the overclaim in the other direction,
    // because the first thing anybody does with a latency is extrapolate it.
    expect(out).toMatch(/WIRE MEASUREMENT: real network, real facilitator, real Hedera settlement/);
    expect(out).toMatch(/EXCLUDES the settlement epoch/);
  });

  it("reports the integrity state of the purchase it describes", () => {
    expect(renderAb(computeAb(base))).toMatch(/integrity verified/);
    expect(
      renderAb(computeAb({ ...base, buy: { ...buy, verification: "unverified" } })),
    ).toMatch(/integrity unverified/);
  });
});
