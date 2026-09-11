// The load driver, against the REAL registry for the catalog half (see
// agent.test.ts's header for why the hand-written stand-in was deleted) and
// against an injected fake `payFetch` for the fan-out half, which is about the
// driver's own wiring rather than the x402 handshake.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { zipfPicks, fetchCatalog, driveLoad } from "./load.js";
import type { Account, CatalogItem } from "./agent.js";
import {
  newAuthor,
  publishFixture,
  startRegistry,
  type AuthorKeypair,
  type RegistryHarness,
} from "../../registry/src/testing/harness.js";

let harness: RegistryHarness;
let author: AuthorKeypair;

beforeAll(async () => {
  harness = await startRegistry();
  author = newAuthor("0.0.1111");
});

afterAll(() => harness?.close());

describe("zipfPicks", () => {
  it("is deterministic given seed", () => {
    const a = zipfPicks(7, 50, 10);
    const b = zipfPicks(7, 50, 10);
    expect(a).toEqual(b);
    expect(zipfPicks(8, 50, 10)).not.toEqual(a);
  });

  it("produces exactly `count` picks, every one a valid index into the catalog", () => {
    const picks = zipfPicks(42, 100, 13);
    expect(picks).toHaveLength(100);
    for (const p of picks) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(13);
    }
  });

  it("favours low-rank (popular) indices under alpha=1", () => {
    const picks = zipfPicks(1, 2000, 20, 1.0);
    const counts = new Array(20).fill(0);
    for (const p of picks) counts[p]++;
    // index 0 should be drawn far more than the least-popular tail index.
    expect(counts[0]).toBeGreaterThan(counts[19]! * 5);
  });

  it("rejects an empty catalog rather than silently returning nothing", () => {
    expect(() => zipfPicks(1, 10, 0)).toThrow(/empty/);
  });
});

describe("fetchCatalog", () => {
  it("maps the real GET /search listings to CatalogItems, priced by priceAt()", async () => {
    const a = await publishFixture(harness, author, {
      question: "what is in the catalog, first artifact?",
      body: "body-a",
      priceBase: 12_000,
      priceFloor: 1_000,
    });
    const b = await publishFixture(harness, author, {
      question: "what is in the catalog, second artifact?",
      body: "body-b",
      priceBase: 8_000,
      priceFloor: 1_000,
    });
    expect([a.status, b.status]).toEqual([200, 200]);

    const catalog = await fetchCatalog(harness.base);
    expect(catalog.map((c) => c.magnet).sort()).toEqual([a.magnet, b.magnet].sort());
    const first = catalog.find((c) => c.magnet === a.magnet)!;
    // The stand-in this replaced echoed whatever `priceNow` the test handed it,
    // so this assertion used to prove nothing about pricing. Against the real
    // registry it is `priceFloor + round(priceBase × freshness)`.
    expect(first.priceNow).toBeGreaterThan(12_000);
    expect(first.priceNow).toBeLessThanOrEqual(13_000);
    expect(first.provenance.inputTokens).toBeGreaterThan(0);
  });

  it("throws when the connection is refused, rather than returning an empty catalog", async () => {
    // Renamed: this exercises the connection-refused path, NOT `load.ts`'s
    // `if (!res.ok) throw` branch — nothing listens on port 1, so `fetch` itself
    // rejects and no HTTP response ever exists. The old name claimed the non-ok
    // branch, which this test never reaches. The next test covers that branch.
    await expect(fetchCatalog("http://127.0.0.1:1")).rejects.toThrow();
  });

  it("throws on a non-ok HTTP response, naming the status", async () => {
    // The branch the test above does not reach. `?limit=` is clamped rather than
    // rejected by the real registry, so a bad status has to come from a route
    // that does not exist.
    await expect(fetchCatalog(`${harness.base}/no-such-route`)).rejects.toThrow(
      /GET \/search failed: 404/,
    );
  });
});

describe("driveLoad", () => {
  it("issues buyerCount*requestsPerBuyer requests, tagged with the right buyer, via an injected payFetch", async () => {
    const catalog: CatalogItem[] = [
      { magnet: "m1", priceNow: 1000, provenance: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.001 } },
      { magnet: "m2", priceNow: 1000, provenance: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.001 } },
    ];
    const accounts: Account[] = [
      { id: "0.0.1", key: "unused" },
      { id: "0.0.2", key: "unused" },
    ];
    // Fake payFetch: never touches the network or real crypto — this test is
    // about the driver's wiring (fan-out, tagging, concurrency), not the
    // x402 handshake, which agent.test.ts covers against the real registry.
    // `base` points at a port nothing listens on, so buyArtifact's unpaid probe
    // fails before payFetch is ever invoked — exercising the driver's error path.
    const neverCalled = (async () => {
      throw new Error("payFetch should never be reached: the probe fails first");
    }) as unknown as ReturnType<typeof import("./agent.js").makePayFetch>;

    const lines = await driveLoad({
      base: "http://127.0.0.1:1",
      network: "hedera:testnet",
      catalog,
      accounts,
      buyerCount: 2,
      requestsPerBuyer: 3,
      seed: 1,
      jitterMs: () => 0,
      makePayFetch: () => neverCalled,
    });

    expect(lines).toHaveLength(6);
    expect(lines.filter((l) => l.buyer === "0.0.1")).toHaveLength(3);
    expect(lines.filter((l) => l.buyer === "0.0.2")).toHaveLength(3);
    // http://127.0.0.1:1 refuses connections, so every probe fails — this
    // exercises the error path, proving the driver surfaces failures rather
    // than swallowing them.
    for (const l of lines) {
      expect(l.status).toBe(-1);
      expect(l.error).toBeTruthy();
    }
  });

  it("drives real purchases against the real registry when given the real buyer", async () => {
    // One small end-to-end pass so the driver is not only ever exercised against
    // a fake that cannot pay: two buys of one artifact, through the real gate.
    const published = await publishFixture(harness, author, {
      question: "does the load driver actually buy anything?",
      body: "load-driver body",
      priceBase: 6_000,
      priceFloor: 1_000,
    });
    expect(published.status).toBe(200);
    const catalog = (await fetchCatalog(harness.base)).filter((c) => c.magnet === published.magnet);
    expect(catalog).toHaveLength(1);

    const lines = await driveLoad({
      base: harness.base,
      network: "hedera:testnet",
      catalog,
      // The stub facilitator reports 0.0.2222 as the payer whatever key signs.
      accounts: [{ id: "0.0.2222", key: (await import("@hiero-ledger/sdk")).PrivateKey.generateECDSA().toStringRaw() }],
      buyerCount: 1,
      requestsPerBuyer: 2,
      seed: 3,
      jitterMs: () => 0,
    });

    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(l.status).toBe(200);
      expect(l.priceMicroUsdc).toBe(catalog[0]!.priceNow);
      expect(l.tx).toBeTruthy();
    }
  });

  it("rejects a buyerCount larger than the accounts available", async () => {
    await expect(
      driveLoad({
        base: "http://127.0.0.1:1",
        network: "hedera:testnet",
        catalog: [{ magnet: "m1", priceNow: 1, provenance: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 } }],
        accounts: [{ id: "0.0.1", key: "unused" }],
        buyerCount: 5,
        requestsPerBuyer: 1,
        seed: 1,
      }),
    ).rejects.toThrow(/accounts\.json has only/);
  });
});
