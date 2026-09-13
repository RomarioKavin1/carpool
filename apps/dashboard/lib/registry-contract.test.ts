/**
 * The dashboard against what the live registry actually serves.
 *
 * ## The failure this exists for
 *
 * A money-path change turned `GET /payouts` from an array into
 * `{ payouts, parked }` after the dashboard was written. Every other test here
 * uses hand-built fixtures, and a hand-built fixture is shaped like whatever its
 * author believed the response was, so a drift like that passes every one of
 * them. Passing the real envelope where an array was expected throws
 * `TypeError: payouts.map is not a function`.
 *
 * So this file reads **verbatim responses captured from the Railway registry**
 * (`__fixtures__/railway-registry.captured.json`), serves them through a stubbed
 * `fetch`, and runs the real fetchers and the real derivations over them. If the
 * registry's shape moves again, re-capture the file and this suite says which
 * consumer broke instead of the page quietly rendering $0.
 *
 * To re-capture: fetch each path listed under `responses` from the registry and
 * write the JSON bodies back unchanged. Never hand-edit a captured body.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, getBatches, getHealth, getPayouts, getState, getWellKnown } from "./api";
import { buildFooter, buildRows } from "./derive";
import { AUTHOR_ROYALTY, buildSeeders, findSeeder, totalPayouts } from "./seeding";

interface Captured {
  capturedFrom: string;
  capturedAt: string;
  responses: Record<string, { status: number; body: unknown }>;
}

const CAPTURED = JSON.parse(
  readFileSync(join(__dirname, "__fixtures__", "railway-registry.captured.json"), "utf8"),
) as Captured;

const AUTHOR = "0.0.10475801";
const BUYER = "0.0.10477413";
const SETTLEMENT = "0.0.10513939";

/** Serve captured bodies by path; anything not captured is a 404 like the registry's. */
function serve(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const key = `${url.pathname}${url.search}`;
    if (key in overrides) return Response.json(overrides[key]);
    const hit = CAPTURED.responses[key];
    if (!hit) return Response.json({ error: `not captured: ${key}` }, { status: 404 });
    return Response.json(hit.body, { status: hit.status });
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", serve());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the captured responses are what the dashboard reads", () => {
  it("is a real capture, not an empty stand-in", () => {
    expect(CAPTURED.capturedFrom).toMatch(/^https:\/\/carpool-registry-production\.up\.railway\.app$/);
    const state = CAPTURED.responses["/state"]!.body as { artifacts: unknown[]; purchases: unknown[] };
    expect(state.artifacts.length).toBe(14);
    expect(state.purchases.length).toBe(1);
  });

  it("GET /payouts is an envelope with `payouts` and `parked`, not a bare array", () => {
    const body = CAPTURED.responses[`/payouts?payee=${AUTHOR}`]!.body;
    expect(Array.isArray(body)).toBe(false);
    expect(body).toMatchObject({ payouts: expect.any(Array), parked: expect.any(Array) });
  });

  it("getPayouts unwraps the envelope into rows", async () => {
    const rows = await getPayouts(AUTHOR);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      payee: AUTHOR,
      amount: 3778,
      reason: AUTHOR_ROYALTY,
      state: "settled",
      settledBatchId: 1,
    });
  });

  it("getBatches unwraps its envelope and keeps the transaction id", async () => {
    const batches = await getBatches();
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ id: 1, status: "SUCCESS" });
    expect(batches[0]!.txId).toMatch(/^0\.0\.\d+@\d+\.\d+$/);
  });

  it("getState, getWellKnown and getHealth parse without loss", async () => {
    const state = await getState();
    expect(state.summary.purchaseCount).toBe(1);
    expect((await getWellKnown()).network).toBe("hedera:testnet");
    expect((await getHealth()).ok).toBe(true);
  });
});

describe("the derivations over the live shapes", () => {
  it("buildSeeders over the real /state and real /payouts rows credits the author", async () => {
    const state = await getState();
    const payouts = await getPayouts(AUTHOR);
    const seeders = buildSeeders(state, payouts);
    const author = findSeeder(seeders, AUTHOR)!;
    expect(author).not.toBeNull();
    expect(author.artifacts).toHaveLength(14);
    expect(author.sales).toBe(1);
    expect(author.grossUusdc).toBe(4278);
    expect(author.saleRows[0]!.royalty).toMatchObject({ amount: 3778, state: "settled" });
    const totals = totalPayouts(payouts, AUTHOR_ROYALTY);
    expect(totals).toMatchObject({ settled: 3778, earned: 3778, rows: 1 });
  });

  it("buildRows and buildFooter accept the real /state", async () => {
    const state = await getState();
    const rows = buildRows(state, 1789280000);
    expect(rows).toHaveLength(14);
    expect(buildFooter(state)).toBeTruthy();
  });

  it("a payee that holds only fee rows gets them, and none of them as royalty", async () => {
    const rows = await getPayouts(SETTLEMENT);
    expect(totalPayouts(rows, AUTHOR_ROYALTY).rows).toBe(0);
    expect(totalPayouts(rows, "tracker_fee").settled).toBe(500);
  });

  it("a buyer with no rows gets an empty list, not an error", async () => {
    expect(await getPayouts(BUYER)).toEqual([]);
  });
});

describe("shape drift fails loudly at the fetcher, never as a crash downstream", () => {
  it("rejects a bare-array /payouts with an ApiError naming the route", async () => {
    vi.stubGlobal("fetch", serve({ [`/payouts?payee=${AUTHOR}`]: [] }));
    await expect(getPayouts(AUTHOR)).rejects.toBeInstanceOf(ApiError);
    await expect(getPayouts(AUTHOR)).rejects.toMatchObject({ path: "/payouts" });
  });

  it("rejects a /payouts envelope whose rows moved to another key", async () => {
    vi.stubGlobal("fetch", serve({ [`/payouts?payee=${AUTHOR}`]: { rows: [], parked: [] } }));
    await expect(getPayouts(AUTHOR)).rejects.toThrow(/unexpected shape/);
  });

  it("rejects a bare-array /batches", async () => {
    vi.stubGlobal("fetch", serve({ "/batches": [] }));
    await expect(getBatches()).rejects.toThrow(/unexpected shape/);
  });

  it("rejects a /state without artifacts or purchases arrays", async () => {
    vi.stubGlobal("fetch", serve({ "/state": { artifacts: {}, purchases: [] } }));
    await expect(getState()).rejects.toThrow(/unexpected shape/);
  });
});
