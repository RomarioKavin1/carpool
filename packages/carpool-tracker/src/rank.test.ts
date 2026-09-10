import { describe, it, expect } from "vitest";
import { freshness as coreFreshness, type Manifest } from "@carpool/core";
import { depth, rank, type Hit } from "./rank.js";

const NOW = Date.parse("2026-09-12T00:00:00Z");
const DAY_MS = 86_400_000;

function manifest(overrides: Partial<Manifest> & { magnet: string }): Manifest {
  return {
    question: "What happened?",
    questionNorm: "what happened",
    abstract: "An abstract.",
    sources: [{ url: "https://example.com/a", fetchedAt: "2026-09-01T00:00:00Z" }],
    provenance: {
      model: "claude-sonnet-5",
      durationSeconds: 300,
      inputTokens: 2000,
      outputTokens: 800,
      estimatedCostUsd: 0.1,
      toolCalls: 5,
    },
    decay: { halfLifeDays: 3, producedAt: "2026-09-11T00:00:00Z" }, // fresh at NOW
    author: "author-handle",
    bodyHash: "b".repeat(64),
    bodyBytes: 1000,
    redacted: false,
    ...overrides,
  };
}

function magnet(byte: string): string {
  return `swarm:${byte.repeat(64)}`;
}

describe("depth", () => {
  it("is 0 for a manifest with no output, no time, no tool calls, and one source", () => {
    const m = manifest({
      magnet: magnet("a"),
      provenance: { model: "x", durationSeconds: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, toolCalls: 0 },
      sources: [],
    });
    expect(depth(m)).toBe(0);
  });

  it("saturates at 1 once every signal clears its ceiling", () => {
    const m = manifest({
      magnet: magnet("a"),
      provenance: {
        model: "x",
        durationSeconds: 999_999,
        inputTokens: 0,
        outputTokens: 999_999,
        estimatedCostUsd: 0,
        toolCalls: 999_999,
      },
      sources: Array.from({ length: 50 }, (_, i) => ({ url: `https://example.com/${i}`, fetchedAt: "2026-09-01T00:00:00Z" })),
    });
    expect(depth(m)).toBe(1);
  });

  it("increases monotonically with outputTokens alone", () => {
    const baseProvenance = manifest({ magnet: magnet("a") }).provenance;
    const shallow = manifest({ magnet: magnet("a"), provenance: { ...baseProvenance, outputTokens: 100 } });
    const deep = manifest({ magnet: magnet("a"), provenance: { ...baseProvenance, outputTokens: 3000 } });
    expect(depth(deep)).toBeGreaterThan(depth(shallow));
  });

  it("a deep artifact by every signal scores higher than a shallow one by every signal", () => {
    const shallow = manifest({
      magnet: magnet("a"),
      provenance: { model: "x", durationSeconds: 30, inputTokens: 200, outputTokens: 150, estimatedCostUsd: 0.01, toolCalls: 1 },
      sources: [{ url: "https://example.com/only", fetchedAt: "2026-09-01T00:00:00Z" }],
    });
    const deep = manifest({
      magnet: magnet("a"),
      provenance: { model: "x", durationSeconds: 1200, inputTokens: 6000, outputTokens: 3500, estimatedCostUsd: 0.9, toolCalls: 30 },
      sources: Array.from({ length: 8 }, (_, i) => ({ url: `https://example.com/${i}`, fetchedAt: "2026-09-01T00:00:00Z" })),
    });
    expect(depth(deep)).toBeGreaterThan(depth(shallow));
  });
});

describe("rank", () => {
  it("drops hits below the similarity threshold", () => {
    const m = manifest({ magnet: magnet("a") });
    const hits: Hit[] = [{ magnet: m.magnet, score: 0.4 }];
    const out = rank(hits, [m], { threshold: 0.5, nowMs: NOW });
    expect(out).toHaveLength(0);
  });

  it("keeps hits at or above the threshold", () => {
    const m = manifest({ magnet: magnet("a") });
    const hits: Hit[] = [{ magnet: m.magnet, score: 0.5 }];
    const out = rank(hits, [m], { threshold: 0.5, nowMs: NOW });
    expect(out).toHaveLength(1);
  });

  it("drops an expired artifact (freshness < 0.125, three half-lives) even above threshold", () => {
    const m = manifest({ magnet: magnet("a"), decay: { halfLifeDays: 1, producedAt: "2026-09-01T00:00:00Z" } }); // 11 days ago, halfLife=1 → far past 3 half-lives
    const hits: Hit[] = [{ magnet: m.magnet, score: 0.99 }];
    const out = rank(hits, [m], { threshold: 0.1, nowMs: NOW });
    expect(out).toHaveLength(0);
  });

  it("silently skips a hit whose manifest is not supplied", () => {
    const hits: Hit[] = [{ magnet: magnet("a"), score: 0.9 }];
    const out = rank(hits, [], { threshold: 0.1, nowMs: NOW });
    expect(out).toHaveLength(0);
  });

  it("two artifacts with identical similarity and freshness order by depth — the deeper one wins", () => {
    const shallow = manifest({
      magnet: magnet("a"),
      provenance: { model: "x", durationSeconds: 60, inputTokens: 300, outputTokens: 200, estimatedCostUsd: 0.02, toolCalls: 2 },
      sources: [{ url: "https://example.com/only", fetchedAt: "2026-09-01T00:00:00Z" }],
    });
    const deep = manifest({
      magnet: magnet("b"),
      provenance: { model: "x", durationSeconds: 1500, inputTokens: 6000, outputTokens: 3800, estimatedCostUsd: 0.8, toolCalls: 35 },
      sources: Array.from({ length: 9 }, (_, i) => ({ url: `https://example.com/${i}`, fetchedAt: "2026-09-01T00:00:00Z" })),
    });
    // Same producedAt/halfLife → identical freshness. Same hit.score → identical similarity.
    const hits: Hit[] = [
      { magnet: shallow.magnet, score: 0.8 },
      { magnet: deep.magnet, score: 0.8 },
    ];
    const out = rank(hits, [shallow, deep], { threshold: 0.1, nowMs: NOW });
    expect(out).toHaveLength(2);
    expect(out[0]!.magnet).toBe(deep.magnet);
    expect(out[0]!.score).toBeGreaterThan(out[1]!.score);
  });

  it("a shallow but very fresh artifact can still outrank a deep but far staler one", () => {
    const deepButStale = manifest({
      magnet: magnet("a"),
      decay: { halfLifeDays: 1, producedAt: new Date(NOW - 2 * DAY_MS).toISOString() }, // 2 half-lives → freshness 0.25
      provenance: { model: "x", durationSeconds: 1500, inputTokens: 6000, outputTokens: 3800, estimatedCostUsd: 0.8, toolCalls: 35 },
      sources: Array.from({ length: 9 }, (_, i) => ({ url: `https://example.com/${i}`, fetchedAt: "2026-09-01T00:00:00Z" })),
    });
    const shallowButFresh = manifest({
      magnet: magnet("b"),
      decay: { halfLifeDays: 3, producedAt: new Date(NOW).toISOString() }, // freshness 1
      provenance: { model: "x", durationSeconds: 60, inputTokens: 300, outputTokens: 200, estimatedCostUsd: 0.02, toolCalls: 2 },
      sources: [{ url: "https://example.com/only", fetchedAt: "2026-09-01T00:00:00Z" }],
    });
    const hits: Hit[] = [
      { magnet: deepButStale.magnet, score: 0.8 },
      { magnet: shallowButFresh.magnet, score: 0.8 },
    ];
    const out = rank(hits, [deepButStale, shallowButFresh], { threshold: 0.1, nowMs: NOW });
    expect(out[0]!.magnet).toBe(shallowButFresh.magnet);
  });

  it("orders by the final weighted score, not raw similarity — a deep artifact can outrank a more-similar shallow one", () => {
    const lowSimDeep = manifest({
      magnet: magnet("a"),
      provenance: { model: "x", durationSeconds: 1500, inputTokens: 6000, outputTokens: 3800, estimatedCostUsd: 0.8, toolCalls: 35 },
      sources: Array.from({ length: 9 }, (_, i) => ({ url: `https://example.com/${i}`, fetchedAt: "2026-09-01T00:00:00Z" })),
    });
    const highSimShallow = manifest({
      magnet: magnet("b"),
      provenance: { model: "x", durationSeconds: 10, inputTokens: 50, outputTokens: 20, estimatedCostUsd: 0.001, toolCalls: 0 },
      sources: [],
    });
    const hits: Hit[] = [
      { magnet: lowSimDeep.magnet, score: 0.55 },
      { magnet: highSimShallow.magnet, score: 0.95 },
    ];
    const out = rank(hits, [lowSimDeep, highSimShallow], { threshold: 0.1, nowMs: NOW });

    // Both share the same decay (neither overrides it), so freshness is
    // identical for both and the ordering is decided by similarity * depth-weight
    // alone — computed here from the real `freshness`/`depth` under test, not a
    // re-derived formula, since this test's job is rank()'s multiply-and-sort,
    // not depth()'s or freshness()'s own correctness (covered elsewhere).
    const fresh = coreFreshness(lowSimDeep, NOW);
    const expectedLow = 0.55 * fresh * (0.5 + 0.5 * depth(lowSimDeep));
    const expectedHigh = 0.95 * fresh * (0.5 + 0.5 * depth(highSimShallow));
    expect(expectedLow).toBeGreaterThan(expectedHigh); // sanity: the flip is real, not a test bug

    expect(out.map((r) => r.magnet)).toEqual([lowSimDeep.magnet, highSimShallow.magnet]);
    expect(out[0]!.score).toBeCloseTo(expectedLow, 10);
    expect(out[1]!.score).toBeCloseTo(expectedHigh, 10);
  });

  it("sorts strictly descending by score across more than two candidates", () => {
    const m1 = manifest({ magnet: magnet("1") });
    const m2 = manifest({ magnet: magnet("2") });
    const m3 = manifest({ magnet: magnet("3") });
    const hits: Hit[] = [
      { magnet: m1.magnet, score: 0.6 },
      { magnet: m2.magnet, score: 0.9 },
      { magnet: m3.magnet, score: 0.75 },
    ];
    const out = rank(hits, [m1, m2, m3], { threshold: 0.1, nowMs: NOW });
    expect(out.map((r) => r.magnet)).toEqual([m2.magnet, m3.magnet, m1.magnet]);
  });
});
