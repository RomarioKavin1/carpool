import { describe, it, expect } from "vitest";
import { ManifestSchema, normalizeQuestion, parseManifest, type Manifest } from "./manifest.js";

function valid(): Manifest {
  return {
    magnet: `swarm:${"a".repeat(64)}`,
    question: "What is the ETHOnline 2026 prize pool?",
    questionNorm: "what is the ethonline 2026 prize pool",
    scope: "ethonline-2026",
    abstract: "Total prize pool across all sponsor tracks.",
    sources: [{ url: "https://ethglobal.com/events/ethonline2026", fetchedAt: "2026-09-01T00:00:00Z" }],
    provenance: {
      model: "claude-sonnet-5",
      durationSeconds: 120,
      inputTokens: 4000,
      outputTokens: 1200,
      estimatedCostUsd: 0.42,
      toolCalls: 6,
    },
    decay: { halfLifeDays: 3, producedAt: "2026-09-01T00:00:00Z" },
    author: "opaque-author-handle",
    bodyHash: "b".repeat(64),
    bodyBytes: 2048,
    redacted: false,
  };
}

describe("ManifestSchema / parseManifest", () => {
  it("accepts a well-formed manifest", () => {
    const m = parseManifest(valid());
    expect(m.question).toBe(valid().question);
  });

  it("accepts a manifest with no scope (optional)", () => {
    const { scope, ...rest } = valid();
    expect(() => parseManifest(rest)).not.toThrow();
  });

  it("rejects a magnet that isn't swarm:<64 hex>", () => {
    expect(() => parseManifest({ ...valid(), magnet: "not-a-magnet" })).toThrow(/invalid manifest/);
  });

  it("rejects a zero half-life", () => {
    const bad = { ...valid(), decay: { ...valid().decay, halfLifeDays: 0 } };
    expect(() => parseManifest(bad)).toThrow();
  });

  it("rejects a negative half-life", () => {
    const bad = { ...valid(), decay: { ...valid().decay, halfLifeDays: -1 } };
    expect(() => parseManifest(bad)).toThrow();
  });

  it("rejects a bodyHash that isn't sha256 hex", () => {
    expect(() => parseManifest({ ...valid(), bodyHash: "xyz" })).toThrow();
  });

  it("rejects a non-ISO-8601 fetchedAt", () => {
    const bad = { ...valid(), sources: [{ url: "https://x.example", fetchedAt: "yesterday" }] };
    expect(() => parseManifest(bad)).toThrow();
  });

  it("throws a message naming the offending field, not just 'invalid'", () => {
    let message = "";
    try {
      parseManifest({ ...valid(), bodyBytes: -1 });
    } catch (err) {
      message = String(err);
    }
    expect(message).toMatch(/bodyBytes/);
  });

  it("round-trips through ManifestSchema.parse directly", () => {
    expect(() => ManifestSchema.parse(valid())).not.toThrow();
  });
});

describe("normalizeQuestion", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeQuestion("What   Is\n\tThe Prize Pool?")).toBe("what is the prize pool");
  });

  it("strips trailing punctuation, including the quotes and brackets the MCP's old copy left behind", () => {
    // The divergence that mattered: apps/mcp's private normaliser stripped
    // only [.?!,;:], so a question ending in a quote or a bracket produced a
    // different questionNorm — and therefore a different magnet — than the
    // registry would compute for the same question.
    expect(normalizeQuestion('is it "the prize pool"?')).toBe('is it "the prize pool');
    expect(normalizeQuestion("the pool (2026)")).toBe("the pool (2026");
    expect(normalizeQuestion("the pool!!!")).toBe("the pool");
  });

  it("never touches interior punctuation, where meaning lives", () => {
    expect(normalizeQuestion("What's the pool, e.g. for sponsors?")).toBe("what's the pool, e.g. for sponsors");
  });

  it("is idempotent — questionNorm is a fixed point, since the registry recomputes it", () => {
    const once = normalizeQuestion("What is the pool?  ");
    expect(normalizeQuestion(once)).toBe(once);
  });
});
