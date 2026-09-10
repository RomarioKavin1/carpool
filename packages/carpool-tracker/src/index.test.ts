import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { TrackerIndex } from "./index.js";

const DIM = 4;
const MODEL = "test-model";

function newDb(): Database.Database {
  return new Database(":memory:");
}

function vec(...xs: number[]): Float32Array {
  return Float32Array.from(xs);
}

describe("TrackerIndex", () => {
  it("upserts and finds an exact match as the top hit", () => {
    const idx = new TrackerIndex(newDb(), { model: MODEL, dim: DIM });
    idx.upsert("swarm:a", vec(1, 0, 0, 0));
    idx.upsert("swarm:b", vec(0, 1, 0, 0));

    const hits = idx.search(vec(1, 0, 0, 0), 5);
    expect(hits[0]!.magnet).toBe("swarm:a");
    expect(hits[0]!.score).toBeCloseTo(1, 6); // cosine similarity to itself is 1
  });

  it("reports whether a magnet is indexed, so a caller can re-embed only what is missing", () => {
    const idx = new TrackerIndex(newDb(), { model: MODEL, dim: DIM });
    expect(idx.has("swarm:a")).toBe(false);
    idx.upsert("swarm:a", vec(1, 0, 0, 0));
    expect(idx.has("swarm:a")).toBe(true);
    idx.remove("swarm:a");
    expect(idx.has("swarm:a")).toBe(false);
  });

  it("orders hits by descending similarity", () => {
    const idx = new TrackerIndex(newDb(), { model: MODEL, dim: DIM });
    idx.upsert("swarm:close", vec(1, 0.1, 0, 0));
    idx.upsert("swarm:far", vec(0, 0, 1, 0));
    idx.upsert("swarm:exact", vec(1, 0, 0, 0));

    const hits = idx.search(vec(1, 0, 0, 0), 3);
    expect(hits.map((h) => h.magnet)).toEqual(["swarm:exact", "swarm:close", "swarm:far"]);
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
    expect(hits[1]!.score).toBeGreaterThan(hits[2]!.score);
  });

  it("respects k, returning no more than k hits", () => {
    const idx = new TrackerIndex(newDb(), { model: MODEL, dim: DIM });
    for (let i = 0; i < 10; i++) idx.upsert(`swarm:${i}`, vec(Math.random(), Math.random(), Math.random(), Math.random()));
    expect(idx.search(vec(1, 0, 0, 0), 3)).toHaveLength(3);
  });

  it("upsert on an existing magnet replaces its vector rather than duplicating it", () => {
    const idx = new TrackerIndex(newDb(), { model: MODEL, dim: DIM });
    idx.upsert("swarm:a", vec(0, 0, 1, 0));
    idx.upsert("swarm:a", vec(1, 0, 0, 0)); // replace

    const hits = idx.search(vec(1, 0, 0, 0), 10);
    const aHits = hits.filter((h) => h.magnet === "swarm:a");
    expect(aHits).toHaveLength(1);
    expect(aHits[0]!.score).toBeCloseTo(1, 6);
  });

  it("remove drops a magnet from search results", () => {
    const idx = new TrackerIndex(newDb(), { model: MODEL, dim: DIM });
    idx.upsert("swarm:a", vec(1, 0, 0, 0));
    idx.upsert("swarm:b", vec(0, 1, 0, 0));
    idx.remove("swarm:a");

    const hits = idx.search(vec(1, 0, 0, 0), 10);
    expect(hits.map((h) => h.magnet)).toEqual(["swarm:b"]);
  });

  it("remove is a no-op for a magnet that was never indexed", () => {
    const idx = new TrackerIndex(newDb(), { model: MODEL, dim: DIM });
    idx.upsert("swarm:a", vec(1, 0, 0, 0));
    expect(() => idx.remove("swarm:never-indexed")).not.toThrow();
    expect(idx.search(vec(1, 0, 0, 0), 10)).toHaveLength(1);
  });

  it("upsert rejects a vector of the wrong dimension", () => {
    const idx = new TrackerIndex(newDb(), { model: MODEL, dim: DIM });
    expect(() => idx.upsert("swarm:a", vec(1, 0, 0))).toThrow(/dim/);
  });

  it("search rejects a query vector of the wrong dimension", () => {
    const idx = new TrackerIndex(newDb(), { model: MODEL, dim: DIM });
    idx.upsert("swarm:a", vec(1, 0, 0, 0));
    expect(() => idx.search(vec(1, 0), 5)).toThrow(/dim/);
  });

  it("re-opening the same database with the same tuple succeeds and preserves the data", () => {
    const db = newDb();
    const first = new TrackerIndex(db, { model: MODEL, dim: DIM });
    first.upsert("swarm:a", vec(1, 0, 0, 0));

    const second = new TrackerIndex(db, { model: MODEL, dim: DIM });
    expect(second.search(vec(1, 0, 0, 0), 5).map((h) => h.magnet)).toEqual(["swarm:a"]);
  });

  it("re-opening with a different model throws, naming both tuples", () => {
    const db = newDb();
    new TrackerIndex(db, { model: "model-a", dim: DIM });

    expect(() => new TrackerIndex(db, { model: "model-b", dim: DIM })).toThrow(/model-a/);
    expect(() => new TrackerIndex(db, { model: "model-b", dim: DIM })).toThrow(/model-b/);
  });

  it("re-opening with a different dimension throws, naming both tuples", () => {
    const db = newDb();
    new TrackerIndex(db, { model: MODEL, dim: 4 });

    expect(() => new TrackerIndex(db, { model: MODEL, dim: 8 })).toThrow(/dim=4/);
    expect(() => new TrackerIndex(db, { model: MODEL, dim: 8 })).toThrow(/dim=8/);
  });
});
