import { describe, expect, it } from "vitest";
import { summarize } from "./report.js";
import type { BuyLogLine } from "./agent.js";

function line(overrides: Partial<BuyLogLine> = {}): BuyLogLine {
  return {
    ts: 0,
    buyer: "0.0.1",
    magnet: "swarm:x",
    status: 200,
    priceMicroUsdc: 0,
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    tx: null,
    ...overrides,
  };
}

describe("summarize", () => {
  it("computes hit rate, spend, and token/cost totals from a fixture", () => {
    const lines = [
      line({ status: 200, priceMicroUsdc: 10_000, inputTokens: 100, outputTokens: 20, estimatedCostUsd: 0.05, latencyMs: 100 }),
      line({ status: 200, priceMicroUsdc: 8_000, inputTokens: 50, outputTokens: 10, estimatedCostUsd: 0.02, latencyMs: 200 }),
      line({ status: 404, priceMicroUsdc: 0, latencyMs: 50 }),
      line({ status: -1, priceMicroUsdc: 0, latencyMs: 10 }),
    ];
    const s = summarize(lines);
    expect(s.requests).toBe(4);
    expect(s.purchases).toBe(2);
    expect(s.hitRatePct).toBe(50);
    expect(s.spendMicroUsdc).toBe(18_000);
    expect(s.totalInputTokens).toBe(150);
    expect(s.totalOutputTokens).toBe(30);
    expect(s.totalEstimatedCostUsd).toBeCloseTo(0.07);
    expect(s.statusCounts).toEqual({ "200": 2, "404": 1, "-1": 1 });
    expect(s.latency.maxMs).toBe(200);
    expect(s.latency.meanMs).toBeCloseTo((100 + 200 + 50 + 10) / 4);
  });

  it("does not count a request that failed before payment (e.g. spend cap) toward purchases or spend", () => {
    const lines = [line({ status: -1, priceMicroUsdc: 50_000, error: "spend control exceeded" })];
    const s = summarize(lines);
    expect(s.purchases).toBe(0);
    expect(s.spendMicroUsdc).toBe(0);
    expect(s.hitRatePct).toBe(0);
  });

  it("handles an empty run", () => {
    const s = summarize([]);
    expect(s.requests).toBe(0);
    expect(s.hitRatePct).toBe(0);
    expect(s.latency).toEqual({ meanMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 });
  });
});
