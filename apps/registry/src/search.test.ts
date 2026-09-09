/**
 * `GET /search` — the ranked path.
 *
 * Every test here is written so that the *previous* implementation (return
 * every live artifact, newest first, ignore `vector` and `q`) fails it. That is
 * the bar a test for this defect has to clear: the stub would have satisfied
 * "returns results", "returns the published artifact", and "returns manifests
 * only" without ranking anything, which is why a 52-test registry suite never
 * noticed the tracker was on no execution path at all.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeVector, loadSearchOptions } from "./search.js";
import {
  encodeVector,
  newAuthor,
  publishFixture,
  startRegistry,
  type AuthorKeypair,
  type RegistryHarness,
} from "./testing/harness.js";
import { hashedEmbedder } from "./testing/hashedEmbedder.js";

let harness: RegistryHarness;
let author: AuthorKeypair;

const DAY_MS = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

interface Result {
  magnet: string;
  question: string;
  ageDays: number;
  priceNow: number;
  freshness: number;
  health: number;
  score?: number;
  similarity?: number;
  depth?: number;
}

const search = async (params: Record<string, string>): Promise<Result[]> => {
  const res = await fetch(`${harness.base}/search?${new URLSearchParams(params)}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Result[];
};

beforeAll(async () => {
  harness = await startRegistry({ similarityThreshold: 0.5 });
  author = newAuthor();

  // Three unrelated topics. The vector-space distance between them is what the
  // ranking has to see; a recency ranker cannot.
  //
  // `producedAt` is staggered so that the semantically correct answer is also
  // the OLDEST artifact in the corpus. Newest-first would put it last.
  const published = await Promise.all([
    publishFixture(harness, author, {
      question: "What is the ETHOnline 2026 prize pool across sponsor tracks?",
      producedAt: ago(3),
    }),
    publishFixture(harness, author, {
      question: "How do I associate a Hedera account with a USDC token id?",
      producedAt: ago(2),
    }),
    publishFixture(harness, author, {
      question: "Which Postgres index type suits a trigram similarity search?",
      producedAt: ago(1),
    }),
  ]);
  for (const p of published) expect(p.status).toBe(200);
});

afterAll(() => harness?.close());

describe("loadSearchOptions", () => {
  it("defaults to the precision-biased threshold the tracker bench selected", () => {
    expect(loadSearchOptions({}).threshold).toBe(0.55);
  });

  it("rejects a threshold that is not a cosine similarity", () => {
    expect(() => loadSearchOptions({ SEARCH_SIMILARITY_THRESHOLD: "7" })).toThrow(/cosine similarity/);
    expect(() => loadSearchOptions({ SEARCH_SIMILARITY_THRESHOLD: "high" })).toThrow(/cosine similarity/);
  });
});

describe("decodeVector", () => {
  it("round-trips a base64 float32le vector", () => {
    const v = Float32Array.from([0.5, -0.25, 1, 0]);
    expect([...decodeVector(encodeVector(v), 4)]).toEqual([...v]);
  });

  it("refuses a vector of the wrong dimension rather than zero-padding it into a meaningless ranking", () => {
    const v = Float32Array.from([1, 2, 3]);
    expect(() => decodeVector(encodeVector(v), 64)).toThrow(/3 dimensions but this registry declares dim=64/);
  });

  it("refuses bytes that are not a whole number of float32s", () => {
    expect(() => decodeVector(Buffer.from([1, 2, 3]).toString("base64"), 64)).toThrow(/whole number of float32/);
  });
});

describe("GET /search — semantic ranking", () => {
  it("ranks the matching artifact first even though it is the OLDEST in the corpus", async () => {
    const results = await search({ q: "ETHOnline 2026 prize pool sponsor tracks", limit: "10" });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.question).toMatch(/ETHOnline 2026 prize pool/);
    // The stub returned newest-first: the Postgres artifact would have led.
    expect(results[0]!.question).not.toMatch(/Postgres/);
  });

  it("excludes artifacts below the similarity threshold instead of listing the whole corpus", async () => {
    const results = await search({ q: "ETHOnline 2026 prize pool sponsor tracks", limit: "10" });
    expect(results.length).toBeLessThan(3);
    expect(results.some((r) => /Postgres/.test(r.question))).toBe(false);
    expect(results.some((r) => /Hedera account/.test(r.question))).toBe(false);
  });

  it("returns nothing for a question the corpus does not answer", async () => {
    const results = await search({ q: "how do I bleed a radiator valve", limit: "10" });
    expect(results).toEqual([]);
  });

  it("ranks a client-supplied vector identically to the same question sent as text", async () => {
    const question = "ETHOnline 2026 prize pool sponsor tracks";
    const viaText = await search({ q: question, limit: "10" });
    const vector = encodeVector(await hashedEmbedder().embed(question));
    const viaVector = await search({ vector, limit: "10" });
    expect(viaVector.map((r) => r.magnet)).toEqual(viaText.map((r) => r.magnet));
    // Not exact: `freshness` (and so `score`) is recomputed against the server
    // clock on each request, and the two requests are milliseconds apart.
    expect(viaVector[0]!.score).toBeCloseTo(viaText[0]!.score!, 6);
    expect(viaVector[0]!.similarity).toBeCloseTo(viaText[0]!.similarity!, 10);
  });

  it("400s a vector whose dimension does not match the registry's declared tuple", async () => {
    const wrong = encodeVector(Float32Array.from([1, 0, 0, 0]));
    const res = await fetch(`${harness.base}/search?vector=${encodeURIComponent(wrong)}`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/dimensions but this registry declares/);
  });

  it("reports the ranking evidence — score, similarity and depth — so a buyer can disagree with the order", async () => {
    const results = await search({ q: "ETHOnline 2026 prize pool sponsor tracks", limit: "10" });
    const top = results[0]!;
    expect(top.similarity).toBeGreaterThan(0.5);
    expect(top.depth).toBeGreaterThan(0);
    expect(top.depth).toBeLessThanOrEqual(1);
    // score === similarity * freshness * (0.5 + 0.5 * depth) — @carpool/tracker's rank()
    expect(top.score).toBeCloseTo(top.similarity! * top.freshness * (0.5 + 0.5 * top.depth!), 6);
  });

  it("serves ageDays, the field apps/mcp renders and no server ever sent", async () => {
    const results = await search({ q: "ETHOnline 2026 prize pool sponsor tracks", limit: "10" });
    expect(typeof results[0]!.ageDays).toBe("number");
    expect(results[0]!.ageDays).toBeGreaterThan(2.9);
    expect(results[0]!.ageDays).toBeLessThan(3.1);
  });

  it("never returns a body — manifests only", async () => {
    const results = await search({ q: "ETHOnline 2026 prize pool sponsor tracks", limit: "10" });
    for (const r of results) {
      expect(r).not.toHaveProperty("body");
      expect(r).toHaveProperty("bodyHash");
    }
  });
});

describe("GET /search — browse mode", () => {
  it("with neither vector nor q, returns every live artifact newest first and claims no ranking", async () => {
    const results = await search({ limit: "10" });
    expect(results).toHaveLength(3);
    expect(results[0]!.question).toMatch(/Postgres/); // newest
    for (const r of results) {
      expect(r.score).toBeUndefined();
      expect(r.similarity).toBeUndefined();
      expect(typeof r.ageDays).toBe("number");
    }
  });
});

describe("GET /search — depth is what separates two equally-similar artifacts", () => {
  it("orders a sourced deep-dive above a shallow brief on the identical question", async () => {
    // Same question, same producedAt → identical similarity and identical
    // freshness. Only `depth` (provenance + source count) can order these, and
    // the brief requires it be provable on its own.
    const producedAt = ago(1);
    const question = "What changed in the Hedera consensus node 0.58 release?";
    const shallow = await publishFixture(harness, newAuthor("0.0.3001"), {
      question,
      body: "shallow brief",
      producedAt,
      sources: [{ url: "https://example.com/one", fetchedAt: "2026-09-01T00:00:00Z" }],
      provenance: { outputTokens: 200, durationSeconds: 20, toolCalls: 1 },
    });
    const deep = await publishFixture(harness, newAuthor("0.0.3002"), {
      question,
      body: "the sourced deep dive",
      producedAt,
      sources: Array.from({ length: 12 }, (_, i) => ({
        url: `https://example.com/deep-${i}`,
        fetchedAt: "2026-09-01T00:00:00Z",
      })),
      provenance: { outputTokens: 6000, durationSeconds: 2400, toolCalls: 60 },
    });
    expect(shallow.status).toBe(200);
    expect(deep.status).toBe(200);

    const results = await search({ q: question, limit: "10" });
    const magnets = results.map((r) => r.magnet);
    expect(magnets).toContain(deep.magnet);
    expect(magnets).toContain(shallow.magnet);
    expect(magnets.indexOf(deep.magnet)).toBeLessThan(magnets.indexOf(shallow.magnet));

    const deepResult = results.find((r) => r.magnet === deep.magnet)!;
    const shallowResult = results.find((r) => r.magnet === shallow.magnet)!;
    expect(deepResult.similarity).toBeCloseTo(shallowResult.similarity!, 6);
    expect(deepResult.freshness).toBeCloseTo(shallowResult.freshness, 6);
    expect(deepResult.depth).toBeGreaterThan(shallowResult.depth!);
  });
});
