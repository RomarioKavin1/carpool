import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrivateKey } from "@hiero-ledger/sdk";
import { sha256 } from "@carpool/hedera-x402";
import { magnetOf, normalizeQuestion, signManifest, type Manifest } from "@carpool/core";
import { setEmbedder } from "./embedder.js";
import { hashedEmbedder, TEST_EMBEDDING_DIM, TEST_EMBEDDING_MODEL } from "./testing/hashedEmbedder.js";
import {
  defaultFacilitatorControls,
  listen,
  portOf as port,
  startStubFacilitator,
  startStubMirror,
  type StubFacilitatorControls,
} from "./testing/stubFacilitator.js";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8").toString("base64");

const author = { priv: PrivateKey.generateECDSA() };
const authorPubHex = author.priv.publicKey.toStringRaw();
const AUTHOR_ACCOUNT = "0.0.1111";
const AUTHOR = `${AUTHOR_ACCOUNT}:${authorPubHex}`;

const buyer = { priv: PrivateKey.generateECDSA() };
const buyerPubHex = buyer.priv.publicKey.toStringRaw();
const BUYER_ACCOUNT = "0.0.2222";

let facilitator: Server;
let mirror: Server;
let dataDir: string;

/**
 * Mutable per-test facilitator behaviour. Backed by the shared stub's controls
 * object, so the tests below read and write the same state the stub serves from
 * rather than a private copy of it.
 */
let facilitatorControls: StubFacilitatorControls;

let app: import("express").Express;
let LEDGER_API_KEY: string;

/**
 * `questionNorm` is derived, never hand-written: it is part of the signed,
 * content-addressed manifest and `POST /publish` now recomputes it and rejects
 * a mismatch. A helper that let a caller override `question` while leaving a
 * stale `questionNorm` behind (as this one used to) builds manifests no honest
 * client would ever produce.
 */
function signedManifest(overrides: Partial<Omit<Manifest, "magnet">> = {}, body = "the body content") {
  const bodyHash = sha256(body);
  const bodyBytes = Buffer.byteLength(body, "utf8");
  const question = overrides.question ?? "What is the ETHOnline 2026 prize pool?";
  const base: Omit<Manifest, "magnet"> = {
    question,
    questionNorm: normalizeQuestion(question),
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
    decay: { halfLifeDays: 30, producedAt: new Date().toISOString() },
    author: AUTHOR,
    bodyHash,
    bodyBytes,
    redacted: false,
    ...overrides,
  };
  const magnet = magnetOf(base);
  const manifestHash = magnet.slice("swarm:".length);
  const authorSig = signManifest(author.priv.toStringRaw(), manifestHash);
  return { manifest: { ...base, magnet }, body, authorSig };
}

beforeAll(async () => {
  // The shared stub facilitator (testing/stubFacilitator.ts). This file used to
  // carry its own copy — one of four in the tree, each an independent guess at
  // Blocky402's behaviour, none of which looked at the payload it was handed.
  //
  // `requireSignedTransaction` is off because every paid request below hand-rolls
  // its `PAYMENT-SIGNATURE` header with `payload: { signature: "stub" }` so that
  // it can choose the transaction id it later refunds against. That is a payload
  // the real facilitator refuses, so **nothing in this file is evidence that a
  // buyer's client can pay**: that is `apps/mcp/src/e2e.test.ts` and
  // `apps/bench/src/agent.test.ts`, which drive the real x402 client with this
  // check on. What this file does prove is what the registry's own routes do with
  // a settlement once one has happened.
  //
  // `strictAccepted` stays ON: these headers echo the issued `accepts[0]`
  // verbatim, exactly as an honest client does, and the requirements/payload
  // equality the real facilitator applies is therefore exercised here too.
  facilitatorControls = defaultFacilitatorControls();
  facilitatorControls.requireSignedTransaction = false;
  const fac = await startStubFacilitator(facilitatorControls);
  facilitator = fac.server;

  const mir = await startStubMirror({ [BUYER_ACCOUNT]: buyerPubHex });
  mirror = mir.server;

  dataDir = mkdtempSync(join(tmpdir(), "carpool-registry-test-"));
  LEDGER_API_KEY = "a".repeat(32);

  process.env.LEDGER_DB = ":memory:";
  process.env.ARTIFACT_STORE = join(dataDir, "artifacts");
  process.env.CARPOOL_ACCOUNT_ID = "0.0.9999";
  // Explicitly blanked, not merely left unset: dotenv only fills gaps in
  // process.env, so on a machine with a real repo-root .env (any dev who has
  // run the live testnet scripts) this suite would otherwise pick up a real
  // operator key, build a real Client, and POST /settle would fire an actual
  // Hedera network call — exactly what "no network in tests" forbids. This
  // makes "this suite never sets it" true regardless of the local .env.
  process.env.CARPOOL_PRIVATE_KEY = "";
  process.env.HCS_TOPIC_ID = "";
  process.env.TRACKER_FEE_MICRO_USDC = "500";
  process.env.FACILITATOR_URL = `http://127.0.0.1:${port(facilitator)}`;
  process.env.MIRROR_NODE_URL = `http://127.0.0.1:${port(mirror)}`;
  process.env.HEDERA_NETWORK = "hedera:testnet";
  process.env.USDC_TOKEN_ID = "0.0.1";
  process.env.LEDGER_API_KEY = LEDGER_API_KEY;
  process.env.NODE_ENV = "test";
  // The vector index is fixed-dimension and the tuple it is opened with must
  // match the one this registry declares, so the declared tuple and the
  // injected embedder are set together. The injected one never loads ONNX and
  // never reaches the network — see testing/hashedEmbedder.ts.
  process.env.EMBEDDING_MODEL = TEST_EMBEDDING_MODEL;
  process.env.EMBEDDING_DIM = String(TEST_EMBEDDING_DIM);
  setEmbedder(hashedEmbedder());

  ({ app } = await import("./server.js"));
});

afterAll(() => {
  facilitator.close();
  mirror.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("GET /.well-known/carpool", () => {
  it("serves the embedding tuple, refund window, and settlement account", async () => {
    const server = await listen(app);
    const base = `http://127.0.0.1:${port(server)}`;
    const r = await fetch(`${base}/.well-known/carpool`);
    const body = (await r.json()) as any;
    expect(body.settlementAccount).toBe("0.0.9999");
    expect(body.refundWindowSeconds).toBe(120);
    expect(body.embedding.model).toBeTruthy();
    expect(typeof body.embedding.dim).toBe("number");
    server.close();
  });
});

describe("GET /health", () => {
  it("reports whether auth is enforced", async () => {
    const server = await listen(app);
    const base = `http://127.0.0.1:${port(server)}`;
    const r = await fetch(`${base}/health`);
    const body = (await r.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.authEnforced).toBe(true); // LEDGER_API_KEY is set
    server.close();
  });
});

describe("POST /publish", () => {
  it("rejects a priceFloor below the tracker fee — it would let trackerFee exceed paid and zero the royalty", async () => {
    const server = await listen(app);
    const base = `http://127.0.0.1:${port(server)}`;
    const { manifest, body, authorSig } = signedManifest({ question: "unique-low-floor" });
    const r = await fetch(`${base}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest, body, authorSig, priceBase: 100_000, priceFloor: 499 }),
    });
    expect(r.status).toBe(400);
    const j = (await r.json()) as any;
    expect(j.error).toMatch(/priceFloor.*tracker fee/);
    server.close();
  });

  it("rejects a manifest whose magnet does not equal magnetOf(manifest)", async () => {
    const server = await listen(app);
    const base = `http://127.0.0.1:${port(server)}`;
    const { manifest, body, authorSig } = signedManifest({ question: "unique-a" });
    const tampered = { ...manifest, magnet: `swarm:${"f".repeat(64)}` };
    const r = await fetch(`${base}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest: tampered, body, authorSig, priceBase: 100000, priceFloor: 10000 }),
    });
    expect(r.status).toBe(400);
    const j = (await r.json()) as any;
    expect(j.error).toMatch(/magnet mismatch/);
    server.close();
  });

  it("rejects an author_sig that does not verify", async () => {
    const server = await listen(app);
    const base = `http://127.0.0.1:${port(server)}`;
    const { manifest, body } = signedManifest({ question: "unique-b" });
    const r = await fetch(`${base}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest, body, authorSig: "00".repeat(64), priceBase: 100000, priceFloor: 10000 }),
    });
    expect(r.status).toBe(401);
    server.close();
  });

  it("rejects a body that doesn't hash to manifest.bodyHash", async () => {
    const server = await listen(app);
    const base = `http://127.0.0.1:${port(server)}`;
    const { manifest, authorSig } = signedManifest({ question: "unique-c" });
    const r = await fetch(`${base}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest, body: "a different body entirely", authorSig, priceBase: 100000, priceFloor: 10000 }),
    });
    expect(r.status).toBe(400);
    const j = (await r.json()) as any;
    expect(j.error).toMatch(/bodyHash mismatch/);
    server.close();
  });

  it("rejects a questionNorm the client did not compute with normalizeQuestion", async () => {
    const server = await listen(app);
    const base = `http://127.0.0.1:${port(server)}`;
    // A hand-crafted questionNorm: plausible-looking, but not what
    // normalizeQuestion produces. It is inside the signed, content-addressed
    // manifest, so the registry cannot correct it — it has to refuse. Left
    // unchecked, the content address was computed over whatever the client
    // called normalised, and the vector index would file this artifact under a
    // topic it does not answer.
    const { manifest, body, authorSig } = signedManifest({
      question: "unique-norm — What is the prize pool?",
      questionNorm: "something else entirely",
    });
    const r = await fetch(`${base}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest, body, authorSig, priceBase: 100_000, priceFloor: 10_000 }),
    });
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error).toMatch(/questionNorm mismatch/);
    server.close();
  });

  it("accepts the questionNorm normalizeQuestion produces for the same question", async () => {
    const server = await listen(app);
    const base = `http://127.0.0.1:${port(server)}`;
    // Trailing quote + bracket: exactly where the MCP's old private normaliser
    // (which stripped only [.?!,;:]) disagreed with the shared one.
    const { manifest, body, authorSig } = signedManifest({
      question: 'unique-norm-2 — is it "the prize pool"?',
    });
    expect(manifest.questionNorm).toBe('unique-norm-2 — is it "the prize pool');
    const r = await fetch(`${base}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest, body, authorSig, priceBase: 100_000, priceFloor: 10_000 }),
    });
    expect(r.status).toBe(200);
    server.close();
  });

  it("accepts a valid publish and the artifact then appears in GET /search", async () => {
    const server = await listen(app);
    const base = `http://127.0.0.1:${port(server)}`;
    const { manifest, body, authorSig } = signedManifest({ question: "unique-d — searchable" });
    const pub = await fetch(`${base}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest, body, authorSig, priceBase: 100_000, priceFloor: 10_000 }),
    });
    expect(pub.status).toBe(200);
    expect((await pub.json()).magnet).toBe(manifest.magnet);

    const search = await fetch(`${base}/search?limit=50`);
    const listings = (await search.json()) as any[];
    expect(listings.some((l) => l.magnet === manifest.magnet)).toBe(true);
    const mine = listings.find((l) => l.magnet === manifest.magnet)!;
    expect(mine.priceNow).toBeGreaterThanOrEqual(10_000);
    expect(typeof mine.health).toBe("number");
    server.close();
  });
});

describe("GET /artifact/:magnet — x402 flow", () => {
  it("404s a magnet that was never published, without building payment requirements", async () => {
    const server = await listen(app);
    const base = `http://127.0.0.1:${port(server)}`;
    const r = await fetch(`${base}/artifact/swarm:${"0".repeat(64)}`);
    expect(r.status).toBe(404);
    server.close();
  });

  it("quotes a 402, then serves the exact body once payment settles", async () => {
    const server = await listen(app);
    const base = `http://127.0.0.1:${port(server)}`;
    const { manifest, body, authorSig } = signedManifest({ question: "unique-e — paid" }, "the paid body, verbatim");
    await fetch(`${base}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest, body, authorSig, priceBase: 100_000, priceFloor: 10_000 }),
    });

    const quoteRes = await fetch(`${base}/artifact/${manifest.magnet}`);
    expect(quoteRes.status).toBe(402);
    const quoted = (await quoteRes.json()) as any;
    expect(quoted.accepts[0].payTo).toBe("0.0.9999");

    facilitatorControls.payer = BUYER_ACCOUNT;
    facilitatorControls.txId = "0.0.2222@paid-1";
    facilitatorControls.verifyOk = true;
    facilitatorControls.settleOk = true;
    const paidRes = await fetch(`${base}/artifact/${manifest.magnet}`, {
      headers: {
        "PAYMENT-SIGNATURE": b64({
          x402Version: 2,
          scheme: "exact",
          network: "hedera:testnet",
          accepted: quoted.accepts[0],
          payload: { signature: "stub" },
        }),
      },
    });
    expect(paidRes.status).toBe(200);
    // CONTRACT.md has promised this header since it was written and nothing
    // set it, so apps/mcp's integrity check read null and no-oped while the
    // tool printed "(verified against the manifest)".
    expect(paidRes.headers.get("x-carpool-body-hash")).toBe(manifest.bodyHash);
    expect(await paidRes.text()).toBe("the paid body, verbatim");
    server.close();
  });

  /**
   * The hole the stub used to leave open.
   *
   * `PaymentGate` looks its issued quote up by `(resourceKey, amount, payTo)`, so
   * a retry that tampers with the *amount* or the *payTo* simply misses the cache
   * and gets a fresh 402. `asset`, `scheme` and `network` are in the payload and
   * in **no** part of that key — the gate passes them to the facilitator and
   * trusts the answer. The real facilitator compares all five to the requirements
   * by strict equality (`gate.ts`, and it is why the paid retry must never
   * re-quote); the old stub compared nothing, and answered `isValid: true`.
   *
   * So before this test the registry would serve a paid body, record a purchase
   * and accrue a royalty for a payment **denominated in a token it does not
   * accept** — 110,000 units of `0.0.1` instead of USDC — and the suite stayed
   * green, because the only participant that would have caught it was a stub that
   * did not look.
   */
  it("refuses a payment whose payload names a different asset than the 402 issued", async () => {
    const server = await listen(app);
    const base = `http://127.0.0.1:${port(server)}`;
    const { manifest, body, authorSig } = signedManifest({ question: "unique-e2 — wrong asset" });
    await fetch(`${base}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest, body, authorSig, priceBase: 100_000, priceFloor: 10_000 }),
    });
    const quoted = (await (await fetch(`${base}/artifact/${manifest.magnet}`)).json()) as any;
    const accepted = quoted.accepts[0];

    facilitatorControls.payer = BUYER_ACCOUNT;
    facilitatorControls.txId = "0.0.2222@wrong-asset-1";
    facilitatorControls.calls.length = 0;

    const res = await fetch(`${base}/artifact/${manifest.magnet}`, {
      headers: {
        "PAYMENT-SIGNATURE": b64({
          x402Version: 2,
          scheme: "exact",
          network: "hedera:testnet",
          // Same amount and payTo, so the gate finds the quote it issued; a
          // different token, which is the part nothing checked. (This suite's
          // configured asset is 0.0.1, so the tampered value has to be something
          // else — 0.0.429274 is real testnet USDC, which this registry is not
          // configured to price in.)
          accepted: { ...accepted, asset: "0.0.429274" },
          payload: { signature: "stub" },
        }),
      },
    });

    // Refused at verify, so the gate re-issues the 402 carrying the reason.
    expect(res.status).toBe(402);
    expect(String((await res.json()).error)).toMatch(/accepted\.asset/);
    // And it never reached settlement, so no money and no rows.
    expect(facilitatorControls.calls.map((c) => c.op)).toEqual(["verify"]);
    const { ledger } = await import("./server.js");
    expect(ledger.purchaseByTxId("0.0.2222@wrong-asset-1")).toBeNull();
    server.close();
  });

  it("502s and never invents a buyer when the facilitator settles with no payer", async () => {
    const server = await listen(app);
    const base = `http://127.0.0.1:${port(server)}`;
    const { manifest, body, authorSig } = signedManifest({ question: "unique-f — no payer" });
    await fetch(`${base}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest, body, authorSig, priceBase: 100_000, priceFloor: 10_000 }),
    });
    const quoteRes = await fetch(`${base}/artifact/${manifest.magnet}`);
    const quoted = (await quoteRes.json()) as any;

    facilitatorControls.payer = null;
    facilitatorControls.txId = "0.0.0@no-payer-1";
    try {
      const paidRes = await fetch(`${base}/artifact/${manifest.magnet}`, {
        headers: {
          "PAYMENT-SIGNATURE": b64({
            x402Version: 2,
            scheme: "exact",
            network: "hedera:testnet",
            accepted: quoted.accepts[0],
            payload: { signature: "stub" },
          }),
        },
      });
      expect(paidRes.status).toBe(502);
    } finally {
      facilitatorControls.payer = BUYER_ACCOUNT;
    }
    server.close();
  });
});

describe("POST /refund", () => {
  it("refunds paid − trackerFee when the buyer's signature checks out, and refuses a second attempt", async () => {
    const server = await listen(app);
    const base = `http://127.0.0.1:${port(server)}`;
    const { manifest, body, authorSig } = signedManifest({ question: "unique-g — refundable" });
    await fetch(`${base}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest, body, authorSig, priceBase: 100_000, priceFloor: 10_000 }),
    });
    const quoteRes = await fetch(`${base}/artifact/${manifest.magnet}`);
    const quoted = (await quoteRes.json()) as any;

    facilitatorControls.payer = BUYER_ACCOUNT;
    facilitatorControls.txId = "0.0.2222@refund-1";
    await fetch(`${base}/artifact/${manifest.magnet}`, {
      headers: {
        "PAYMENT-SIGNATURE": b64({
          x402Version: 2,
          scheme: "exact",
          network: "hedera:testnet",
          accepted: quoted.accepts[0],
          payload: { signature: "stub" },
        }),
      },
    });

    const messageHashHex = sha256(`${facilitatorControls.txId}:${manifest.magnet}:refund`);
    const signature = Buffer.from(buyer.priv.sign(Buffer.from(messageHashHex, "hex"))).toString("hex");

    const refundRes = await fetch(`${base}/refund`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ txId: facilitatorControls.txId, magnet: manifest.magnet, signature, buyerPublicKey: buyerPubHex }),
    });
    expect(refundRes.status).toBe(200);

    const again = await fetch(`${base}/refund`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ txId: facilitatorControls.txId, magnet: manifest.magnet, signature, buyerPublicKey: buyerPubHex }),
    });
    expect(again.status).toBe(409);
    server.close();
  });

  it("rejects a signature that does not verify as the purchase's buyer", async () => {
    const server = await listen(app);
    const base = `http://127.0.0.1:${port(server)}`;
    const { manifest, body, authorSig } = signedManifest({ question: "unique-h — bad refund sig" });
    await fetch(`${base}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest, body, authorSig, priceBase: 100_000, priceFloor: 10_000 }),
    });
    const quoteRes = await fetch(`${base}/artifact/${manifest.magnet}`);
    const quoted = (await quoteRes.json()) as any;
    facilitatorControls.payer = BUYER_ACCOUNT;
    facilitatorControls.txId = "0.0.2222@refund-2";
    await fetch(`${base}/artifact/${manifest.magnet}`, {
      headers: {
        "PAYMENT-SIGNATURE": b64({
          x402Version: 2,
          scheme: "exact",
          network: "hedera:testnet",
          accepted: quoted.accepts[0],
          payload: { signature: "stub" },
        }),
      },
    });

    const impostor = PrivateKey.generateECDSA();
    const messageHashHex = sha256(`${facilitatorControls.txId}:${manifest.magnet}:refund`);
    const signature = Buffer.from(impostor.sign(Buffer.from(messageHashHex, "hex"))).toString("hex");
    const refundRes = await fetch(`${base}/refund`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ txId: facilitatorControls.txId, magnet: manifest.magnet, signature, buyerPublicKey: impostor.publicKey.toStringRaw() }),
    });
    expect(refundRes.status).toBe(401);
    server.close();
  });
});

describe("GET /manifest/:magnet", () => {
  it("serves one manifest free, with the bodyHash a buyer must fix before paying", async () => {
    const server = await listen(app);
    const base = `http://127.0.0.1:${port(server)}`;
    const { manifest, body, authorSig } = signedManifest({ question: "unique-i — manifest by magnet" }, "body i");
    const pub = await fetch(`${base}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest, body, authorSig, priceBase: 100_000, priceFloor: 10_000 }),
    });
    expect(pub.status).toBe(200);

    const r = await fetch(`${base}/manifest/${manifest.magnet}`);
    expect(r.status).toBe(200);
    const m = (await r.json()) as any;
    expect(m.magnet).toBe(manifest.magnet);
    expect(m.bodyHash).toBe(manifest.bodyHash);
    expect(typeof m.ageDays).toBe("number");
    expect(typeof m.priceNow).toBe("number");
    expect(m).not.toHaveProperty("body"); // manifests only, same as /search
    server.close();
  });

  it("404s a magnet that was never published", async () => {
    const server = await listen(app);
    const base = `http://127.0.0.1:${port(server)}`;
    const r = await fetch(`${base}/manifest/swarm:${"0".repeat(64)}`);
    expect(r.status).toBe(404);
    server.close();
  });

  it("410s an expired artifact rather than handing out a manifest nothing will sell", async () => {
    const server = await listen(app);
    const base = `http://127.0.0.1:${port(server)}`;
    const { manifest, body, authorSig } = signedManifest({
      question: "unique-j — long expired",
      // 40 half-lives old: freshness far below the 0.125 expiry floor.
      decay: { halfLifeDays: 1, producedAt: new Date(Date.now() - 40 * 86_400_000).toISOString() },
    });
    const pub = await fetch(`${base}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest, body, authorSig, priceBase: 100_000, priceFloor: 10_000 }),
    });
    expect(pub.status).toBe(200);
    const r = await fetch(`${base}/manifest/${manifest.magnet}`);
    expect(r.status).toBe(410);
    server.close();
  });
});

describe("POST /settle", () => {
  it("requires the shared secret", async () => {
    const server = await listen(app);
    const base = `http://127.0.0.1:${port(server)}`;
    const r = await fetch(`${base}/settle`, { method: "POST" });
    expect(r.status).toBe(401);
    server.close();
  });

  it("no-ops without CARPOOL_PRIVATE_KEY, once authenticated — this suite never sets it", async () => {
    const server = await listen(app);
    const base = `http://127.0.0.1:${port(server)}`;
    const r = await fetch(`${base}/settle`, { method: "POST", headers: { "x-carpool-key": LEDGER_API_KEY } });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toEqual({
      batches: [],
      anchor: { anchored: false, skipped: "no-client" },
      // Nothing can be paid without a client, but the owed-failure queue needs
      // no Hedera client and is still drained — see POST /owed/replay. The one
      // unresolvable row is the no-payer settlement earlier in this file: it is
      // durably recorded (which is why that request got a 502 and not the body)
      // and no replay can ever fix it, because there is no account to open a
      // purchase row for. Reported rather than retried silently for ever.
      replayed: { replayed: 0, failed: 0, unresolvable: 1 },
    });
    server.close();
  });
});
