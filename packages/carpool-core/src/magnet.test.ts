import { describe, it, expect } from "vitest";
import { canonicalHash, magnetOf } from "./magnet.js";
import type { Manifest } from "./manifest.js";

function base(): Omit<Manifest, "magnet"> {
  return {
    question: "What is the ETHOnline 2026 prize pool?",
    questionNorm: "what is the ethonline 2026 prize pool",
    scope: "ethonline-2026",
    abstract: "Total prize pool across all sponsor tracks.",
    sources: [
      { url: "https://a.example", fetchedAt: "2026-09-01T00:00:00Z" },
      { url: "https://b.example", fetchedAt: "2026-09-02T00:00:00Z" },
    ],
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

describe("canonicalHash", () => {
  it("is stable across top-level key insertion order", () => {
    const a = { x: 1, y: 2, z: { p: 1, q: 2 } };
    const b = { z: { q: 2, p: 1 }, y: 2, x: 1 };
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  it("is stable across nested-object key order inside arrays of objects", () => {
    const a = { items: [{ url: "u1", fetchedAt: "t1" }, { url: "u2", fetchedAt: "t2" }] };
    const b = { items: [{ fetchedAt: "t1", url: "u1" }, { fetchedAt: "t2", url: "u2" }] };
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  it("changes when a value changes", () => {
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }));
  });

  it("does not conflate array order with object key order (order within an array still matters)", () => {
    const a = { items: ["x", "y"] };
    const b = { items: ["y", "x"] };
    expect(canonicalHash(a)).not.toBe(canonicalHash(b));
  });

  it("returns a 64-char hex sha256 digest", () => {
    expect(canonicalHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("magnetOf", () => {
  it("returns swarm:<64 hex>", () => {
    expect(magnetOf(base())).toMatch(/^swarm:[0-9a-f]{64}$/);
  });

  it("is deterministic for the same manifest content", () => {
    expect(magnetOf(base())).toBe(magnetOf(base()));
  });

  it("is stable across reordered top-level keys of the manifest object", () => {
    const m = base();
    const reordered = {
      redacted: m.redacted,
      bodyBytes: m.bodyBytes,
      bodyHash: m.bodyHash,
      author: m.author,
      decay: m.decay,
      provenance: m.provenance,
      sources: m.sources,
      abstract: m.abstract,
      scope: m.scope,
      questionNorm: m.questionNorm,
      question: m.question,
    };
    expect(magnetOf(reordered)).toBe(magnetOf(m));
  });

  it("differs when the question changes (content-addressed, not question-addressed)", () => {
    const m1 = base();
    const m2 = { ...base(), question: "A different question entirely" };
    expect(magnetOf(m1)).not.toBe(magnetOf(m2));
  });

  it("ignores an already-set magnet field — m.magnet === magnetOf(m) is a real fixed point", () => {
    // This is the property the registry's integrity check depends on
    // (Phase D verifies a published artifact with m.magnet === magnetOf(m)).
    // A full Manifest is structurally assignable to Omit<Manifest,"magnet">,
    // so the type alone can't stop a caller from passing one in with
    // `magnet` already populated — it must be stripped at runtime.
    const withoutMagnet = base();
    const computed = magnetOf(withoutMagnet);
    const withMagnet: Manifest = { ...withoutMagnet, magnet: computed };
    expect(magnetOf(withMagnet)).toBe(computed);

    // And a stale/wrong magnet must not leak into the hash either.
    const withWrongMagnet: Manifest = { ...withoutMagnet, magnet: `swarm:${"f".repeat(64)}` };
    expect(magnetOf(withWrongMagnet)).toBe(computed);
  });

  it("two artifacts answering the same question get different magnets when their content differs", () => {
    // Same question, different abstract/body — must NOT collide, since the
    // tracker (not the id space) is what ranks between competing artifacts.
    const m1 = base();
    const m2 = { ...base(), abstract: "A completely different abstract.", bodyHash: "c".repeat(64) };
    expect(magnetOf(m1)).not.toBe(magnetOf(m2));
  });
});
