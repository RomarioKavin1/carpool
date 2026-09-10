import { describe, expect, it } from "vitest";
import { normaliseSummary, type ManifestSummary } from "./client.js";
import { renderCandidate, renderIntegrity } from "./render.js";
import type { BuyResult } from "./pay.js";

const PRODUCED = "2026-09-10T00:00:00Z";
const NOW = Date.parse("2026-09-12T12:00:00Z"); // 2.5 days later

function summary(over: Partial<ManifestSummary> = {}): ManifestSummary {
  return {
    magnet: `swarm:${"a".repeat(64)}`,
    question: "What is the ETHOnline 2026 prize pool?",
    questionNorm: "what is the ethonline 2026 prize pool",
    abstract: "Total prize pool across all sponsor tracks.",
    sources: [{ url: "https://ethglobal.com/e", fetchedAt: PRODUCED }],
    provenance: {
      model: "claude-sonnet-5",
      durationSeconds: 900,
      inputTokens: 42_000,
      outputTokens: 5_200,
      estimatedCostUsd: 0.42,
      toolCalls: 31,
    },
    decay: { halfLifeDays: 14, producedAt: PRODUCED },
    bodyHash: "b".repeat(64),
    bodyBytes: 1234,
    priceNow: 10_600,
    freshness: 0.88,
    health: 0.5,
    ageDays: 2.5,
    ...over,
  };
}

describe("normaliseSummary", () => {
  it("derives ageDays when a registry did not send it, instead of leaving undefined to reach .toFixed", () => {
    const { ageDays: _drop, ...withoutAge } = summary();
    const out = normaliseSummary(withoutAge, NOW);
    expect(out.ageDays).toBeCloseTo(2.5, 6);
    // The call that used to throw on every non-empty search.
    expect(() => renderCandidate(out, 0)).not.toThrow();
  });

  it("keeps the registry's own ageDays when present — one clock for age, freshness and price", () => {
    expect(normaliseSummary(summary({ ageDays: 7 }), NOW).ageDays).toBe(7);
  });

  it("does not invent an age from an unparseable producedAt", () => {
    const { ageDays: _drop, ...raw } = summary();
    const out = normaliseSummary({ ...raw, decay: { halfLifeDays: 1, producedAt: "not a date" } }, NOW);
    expect(out.ageDays).toBe(0);
  });
});

describe("renderCandidate", () => {
  it("shows the ranking evidence when the registry ranked", () => {
    const line = renderCandidate(summary({ score: 0.412, similarity: 0.83, depth: 0.62 }), 0);
    expect(line).toContain("match: similarity 0.83 · depth 0.62 · score 0.412");
  });

  it("claims no ranking for a browse result that carries no score", () => {
    expect(renderCandidate(summary(), 0)).not.toContain("match:");
  });

  it("flags a candidate the buy tool would refuse, rather than letting the agent pick it blind", () => {
    const line = renderCandidate(summary({ priceNow: 40_000 }), 0, 20_000);
    expect(line).toMatch(/OVER your \$0\.0200 spend cap/);
    expect(renderCandidate(summary({ priceNow: 10_000 }), 0, 20_000)).not.toMatch(/OVER your/);
  });
});

describe("renderIntegrity", () => {
  const digest = "c".repeat(64);

  it("claims verification only when a comparison succeeded", () => {
    const ok: BuyResult = {
      ok: true,
      body: "x",
      paid: 1,
      txId: "t",
      verification: { state: "verified", source: "manifest", bodyHash: digest },
    };
    expect(renderIntegrity(ok, digest)).toMatch(/verified: matches the bodyHash in the manifest/);
  });

  it("names what could not be checked instead of claiming a verification that never ran", () => {
    const unchecked: BuyResult = {
      ok: true,
      body: "x",
      paid: 1,
      txId: "t",
      verification: { state: "unverified", reason: "the registry returned 500 for the manifest" },
    };
    const line = renderIntegrity(unchecked, digest);
    expect(line).toContain("NOT VERIFIED (the registry returned 500 for the manifest)");
    expect(line).not.toMatch(/verified: matches/);
  });
});
