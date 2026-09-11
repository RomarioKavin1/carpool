// Integration coverage for the real x402 buyer: makePayFetch + buyArtifact
// against the REAL registry, booted in-process by
// apps/registry/src/testing/harness.ts, with a stub x402 facilitator and a stub
// mirror node. No network — every server is 127.0.0.1 on an ephemeral port.
//
// ## Why this no longer drives a hand-written stand-in
//
// It used to run against `support/localRegistry.ts`: an Express app with a real
// `PaymentGate` in front of a `Map`. That stand-in's `publish()` did no
// `authorSig` verification, no `magnetOf` recomputation, no `bodyHash` check and
// no duplicate check — all four of which the real `POST /publish` enforces — and
// its `quote()` returned the test's own `priceNow` instead of computing through
// `priceAt()`. So bench's buyer was only ever tested against a registry that
// agreed with it by construction, and never against one that checks anything.
//
// That is not a hypothetical. The `signature`/`authorSig` field-name mismatch
// survived 238 green tests for exactly this reason, and was caught the day
// `apps/mcp/src/e2e.test.ts` started driving the real app. The stand-in has been
// deleted rather than hardened: hardening it would mean reimplementing the four
// checks a second time, and a second implementation is a second thing to drift.
//
// What is still stubbed is what cannot be real in a test: the facilitator (so
// nothing settles on a ledger) and the mirror node. `harness.facilitator` makes
// those two controllable, which is how the settlement-failure case below is
// exercised.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrivateKey } from "@hiero-ledger/sdk";
import {
  newAuthor,
  publishFixture,
  startRegistry,
  type AuthorKeypair,
  type RegistryHarness,
} from "../../registry/src/testing/harness.js";
import { buyArtifact, makePayFetch, MAX_AMOUNT_MICRO, type Account, type CatalogItem } from "./agent.js";
import { fetchCatalog } from "./load.js";

let harness: RegistryHarness;
let author: AuthorKeypair;

// The stub facilitator reports 0.0.2222 as the payer, and the registry records
// `purchase.buyer` from what the facilitator reports — so the buyer account id
// here matches what the registry will store.
const BUYER_ID = "0.0.2222";

beforeAll(async () => {
  // One registry for the file: `harness.startRegistry()` imports the real
  // server module, which reads its config and builds its payment gate at import
  // time, so a second call in the same process would hand back the first app.
  harness = await startRegistry();
  author = newAuthor("0.0.1111");
});

afterAll(() => harness?.close());

function buyerAccount(): Account {
  return { id: BUYER_ID, key: PrivateKey.generateECDSA().toStringRaw() };
}

/** Publishes through the real `POST /publish` and returns what `/search` says about it. */
async function publish(question: string, opts: { priceBase: number; priceFloor?: number; body: string }) {
  const published = await publishFixture(harness, author, {
    question,
    body: opts.body,
    priceBase: opts.priceBase,
    priceFloor: opts.priceFloor ?? 1_000,
  });
  expect(published.status, `real POST /publish rejected the fixture: ${JSON.stringify(published.json)}`).toBe(
    200,
  );
  const catalog = await fetchCatalog(harness.base);
  const item = catalog.find((c) => c.magnet === published.magnet);
  expect(item, "the real GET /search did not list the artifact that was just published").toBeDefined();
  return item!;
}

async function purchaseCount(): Promise<number> {
  const state = (await (await fetch(`${harness.base}/state`)).json()) as {
    purchases: Array<{ magnet: string; buyer: string }>;
  };
  return state.purchases.length;
}

describe("buyArtifact against the real registry", () => {
  it("pays the price the real registry quoted and returns its body, recording price/tx/latency", async () => {
    const body = "the paid body, verbatim";
    const item = await publish("what did the first real purchase cost?", { priceBase: 12_000, body });
    const before = await purchaseCount();
    const acct = buyerAccount();
    const payFetch = makePayFetch(acct, "hedera:testnet");

    const line = await buyArtifact(payFetch, acct.id, item, harness.base);

    expect(line.status).toBe(200);
    // The price is `priceAt()`'s output for the published manifest, not a number
    // this test chose: the stand-in used to hand back whatever the test said.
    expect(line.priceMicroUsdc).toBe(item.priceNow);
    expect(item.priceNow).toBeGreaterThan(12_000); // floor + base, decayed a little
    expect(line.buyer).toBe(acct.id);
    expect(line.tx).toBeTruthy();
    expect(line.latencyMs).toBeGreaterThanOrEqual(0);
    expect(await purchaseCount()).toBe(before + 1);
  });

  it("carries the author's self-reported provenance through /search into the log line", async () => {
    // What the A/B comparison is built out of: `estimatedCostUsd` is the author's
    // claim inside the signed manifest, and it must survive the round trip
    // unaltered — the registry does not verify it and must not rewrite it.
    const item = await publish("does provenance survive the round trip?", {
      priceBase: 9_000,
      body: "provenance body",
    });
    const acct = buyerAccount();
    const line = await buyArtifact(makePayFetch(acct, "hedera:testnet"), acct.id, item, harness.base);
    expect(line.status).toBe(200);
    expect(line.inputTokens).toBe(item.provenance.inputTokens);
    expect(line.outputTokens).toBe(item.provenance.outputTokens);
    expect(line.estimatedCostUsd).toBe(item.provenance.estimatedCostUsd);
  });

  it("records a 404 without ever attempting payment for a magnet the registry never published", async () => {
    const before = await purchaseCount();
    const acct = buyerAccount();
    const payFetch = makePayFetch(acct, "hedera:testnet");
    const unknown: CatalogItem = {
      magnet: "swarm:never-published",
      priceNow: 1,
      provenance: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
    };

    const line = await buyArtifact(payFetch, acct.id, unknown, harness.base);

    expect(line.status).toBe(404);
    expect(line.priceMicroUsdc).toBe(0);
    expect(line.tx).toBeNull();
    expect(await purchaseCount()).toBe(before);
  });

  it("keeps the spend cap: refuses to pay above MAX_AMOUNT_MICRO rather than settling anyway", async () => {
    const item = await publish("what costs more than the buyer may spend?", {
      priceBase: MAX_AMOUNT_MICRO * 2,
      body: "should never be served",
    });
    expect(item.priceNow).toBeGreaterThan(MAX_AMOUNT_MICRO);
    const before = await purchaseCount();
    const acct = buyerAccount();
    const payFetch = makePayFetch(acct, "hedera:testnet"); // default cap

    const line = await buyArtifact(payFetch, acct.id, item, harness.base);

    expect(line.status).toBe(-1);
    expect(line.error).toBeTruthy();
    expect(await purchaseCount()).toBe(before);
  });

  it("surfaces a settlement failure as a non-200 status rather than a thrown error", async () => {
    const item = await publish("what happens when settlement fails?", {
      priceBase: 5_000,
      body: "unreachable",
    });
    const before = await purchaseCount();
    harness.facilitator.settleOk = false;
    try {
      const acct = buyerAccount();
      const line = await buyArtifact(
        makePayFetch(acct, "hedera:testnet"),
        acct.id,
        item,
        harness.base,
      );
      // The real gate re-issues a 402 carrying the failure reason rather than
      // serving the body — the same status the stand-in returned, now from the
      // code that actually runs in production.
      expect(line.status).toBe(402);
      expect(await purchaseCount()).toBe(before);
    } finally {
      harness.facilitator.settleOk = true;
    }
  });
});

describe("what the real publish route rejects, and the deleted stand-in did not", () => {
  // These are the four checks `support/localRegistry.ts` skipped. They are
  // asserted here, in bench, because bench's own coverage claimed to exercise a
  // publish path and did not: its stand-in accepted anything.
  it("rejects a manifest whose authorSig does not verify", async () => {
    const other = newAuthor("0.0.4242");
    const body = "a body with a mismatched signature";
    const res = await publishFixture(harness, { ...author, privateKeyHex: other.privateKeyHex }, {
      question: "is the signature checked?",
      body,
    });
    expect(res.status).toBe(401);
  });

  it("rejects a manifest whose questionNorm was not computed from its question", async () => {
    const res = await publishFixture(harness, author, {
      question: "Is the normalised question recomputed?",
      questionNorm: "something else entirely",
    });
    expect(res.status).toBe(400);
  });

  it("rejects an empty body", async () => {
    const res = await publishFixture(harness, author, { question: "is an empty body allowed?", body: "" });
    expect(res.status).toBe(400);
  });

  it("rejects a priceFloor below the registry's tracker fee", async () => {
    const res = await publishFixture(harness, author, {
      question: "can an author undercut the tracker fee?",
      priceFloor: 1,
      priceBase: 10_000,
    });
    expect(res.status).toBe(400);
  });
});
