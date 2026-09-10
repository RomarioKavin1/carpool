/**
 * What a buyer is told when the *registry* is the thing that is broken.
 *
 * This file exists because of one sentence a new buyer read. A registry started
 * with an unreachable `FACILITATOR_URL` answers every artifact request with
 * `503 {"error":"facilitator unavailable: …"}`, and `payFetch` reported that to
 * the buyer as `unexpected status 503` with nothing else. Following
 * `docs/GETTING-STARTED.md` for the first time, that sends you to check your
 * account id, your key type and your USDC balance, none of which can be the
 * cause: **the registry, not the buyer, chooses the facilitator.**
 *
 * A misdirecting diagnostic is a real defect on an onboarding path, so the
 * properties below are asserted rather than left to a comment:
 *
 * 1. the registry's own body reaches the buyer;
 * 2. the sentence says whose end is broken;
 * 3. nothing was charged, and the result says so;
 * 4. the two statuses that have a precise meaning (404, 410) keep their precise
 *    messages instead of being swallowed by the general case.
 *
 * The credentials here are set explicitly and restored afterwards.
 * `docs/RUNBOOK.md` records why: dotenv fills gaps rather than clearing them, so
 * a test that relies on a variable being unset once inherited the repo-root
 * operator key and fired a real testnet precheck on every run.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrivateKey } from "@x402/hedera";
import { payFetch } from "./pay.js";

const MAGNET = "swarm:" + "a".repeat(64);

/** Every route answers the same status and body, which is what a dead dependency looks like. */
function stubRegistry(status: number, body: string): Promise<{ base: string; server: Server }> {
  const server = createServer((_req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ base: `http://127.0.0.1:${port}`, server });
    });
  });
}

const saved = {
  id: process.env.CARPOOL_BUYER_ACCOUNT_ID,
  key: process.env.CARPOOL_BUYER_PRIVATE_KEY,
};

beforeAll(() => {
  process.env.CARPOOL_BUYER_ACCOUNT_ID = "0.0.4242";
  process.env.CARPOOL_BUYER_PRIVATE_KEY = PrivateKey.generateECDSA().toStringRaw();
});

afterAll(() => {
  if (saved.id === undefined) delete process.env.CARPOOL_BUYER_ACCOUNT_ID;
  else process.env.CARPOOL_BUYER_ACCOUNT_ID = saved.id;
  if (saved.key === undefined) delete process.env.CARPOOL_BUYER_PRIVATE_KEY;
  else process.env.CARPOOL_BUYER_PRIVATE_KEY = saved.key;
});

describe("a registry that cannot quote a price says so as the registry's fault", () => {
  const FACILITATOR_DOWN =
    '{"error":"facilitator unavailable: Failed to initialize: no supported payment kinds loaded from any facilitator."}';
  let base: string;
  let server: Server;

  beforeAll(async () => {
    ({ base, server } = await stubRegistry(503, FACILITATOR_DOWN));
  });
  afterAll(() => server.close());

  it("passes the registry's own message through instead of only the status", async () => {
    const result = await payFetch(base, MAGNET);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("503");
    expect(result.error).toContain("facilitator unavailable");
    expect(result.error).toContain("no supported payment kinds");
  });

  it("tells the buyer it is not their credentials, because it is not", async () => {
    const result = await payFetch(base, MAGNET);
    expect(result.error).toMatch(/registry's end rather than your credentials/);
  });

  it("charges nothing and reports nothing verified", async () => {
    const result = await payFetch(base, MAGNET);
    expect(result.paid).toBe(0);
    expect(result.txId).toBe("");
    expect(result.verification).toEqual({ state: "unverified", reason: "nothing was bought" });
  });
});

describe("the statuses that mean something specific keep their specific message", () => {
  it("410 is delisted or expired, not a generic registry fault", async () => {
    const { base, server } = await stubRegistry(410, '{"error":"gone"}');
    try {
      const result = await payFetch(base, MAGNET);
      // The free manifest read happens first and a 410 there resolves to `null`,
      // so this arrives by the earlier branch. Either wording is about the
      // artifact; neither may blame the buyer's setup.
      expect(result.error).toMatch(/delisted or expired/);
      expect(result.error).not.toMatch(/credentials/);
    } finally {
      server.close();
    }
  });

  it("404 is a wrong magnet", async () => {
    const { base, server } = await stubRegistry(404, '{"error":"not found"}');
    try {
      const result = await payFetch(base, MAGNET);
      // The manifest read is attempted first and 404s into `null`, which is the
      // same conclusion by a different route; either wording must name the
      // artifact rather than the buyer's setup.
      expect(result.error).toMatch(/no such artifact/);
    } finally {
      server.close();
    }
  });
});

describe("missing credentials are still reported before any network call", () => {
  it("names both variables and says search does not need them", async () => {
    const id = process.env.CARPOOL_BUYER_ACCOUNT_ID;
    delete process.env.CARPOOL_BUYER_ACCOUNT_ID;
    try {
      // No server: reaching the network at all would fail this differently.
      const result = await payFetch("http://127.0.0.1:1", MAGNET);
      expect(result.error).toContain("CARPOOL_BUYER_ACCOUNT_ID");
      expect(result.error).toContain("CARPOOL_BUYER_PRIVATE_KEY");
      expect(result.error).toContain("carpool_search works without them");
    } finally {
      process.env.CARPOOL_BUYER_ACCOUNT_ID = id;
    }
  });
});
