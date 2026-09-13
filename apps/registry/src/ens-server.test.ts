/**
 * ENS authors through the REAL registry app: publish, purchase-time payout
 * resolution, rotation, every fallback, refund, delist, and the read routes.
 *
 * The ENS side is an in-memory `EnsRecordReader` injected with `setEnsReader`
 * (no Ethereum RPC in the suite). The live read against Sepolia is
 * `ens-live.test.ts`, which only runs when asked. The facilitator and mirror are
 * the shared stubs, as in server.test.ts, whose header explains why
 * `requireSignedTransaction` is off here.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrivateKey } from "@hiero-ledger/sdk";
import { sha256 } from "@carpool/hedera-x402";
import {
  ENS_KEY_RECORD,
  ENS_PAYOUT_SIG_RECORD,
  encodeHederaAddr,
  ensAuthorString,
  magnetOf,
  normalizeQuestion,
  signManifest,
  signPayoutAttestation,
  type EnsRecordReader,
  type Manifest,
} from "@carpool/core";
import { setEmbedder } from "./embedder.js";
import { clearIdentityMemo, setEnsReader } from "./ens.js";
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

const authorKey = PrivateKey.generateECDSA();
const AUTHOR_PRIV = authorKey.toStringRaw();
const AUTHOR_PUB = authorKey.publicKey.toStringRaw();
const NAME = "carpool-author.eth";
const FALLBACK = "0.0.1111";
const ENS_AUTHOR = ensAuthorString(NAME, FALLBACK, AUTHOR_PUB);

const buyer = PrivateKey.generateECDSA();
const BUYER_PUB = buyer.publicKey.toStringRaw();
const BUYER_ACCOUNT = "0.0.2222";

/** What the name's resolver holds right now. Tests mutate it between calls. */
type Records = { texts: Record<string, string>; hbar: string | null };
let records: Record<string, Records> = {};
let resolverDown = false;
let readCount = 0;

const reader: EnsRecordReader = {
  async text(name, key) {
    readCount++;
    if (resolverDown) throw new Error("rpc unreachable");
    return records[name]?.texts[key] ?? null;
  },
  async hederaAddr(name) {
    readCount++;
    if (resolverDown) throw new Error("rpc unreachable");
    const a = records[name]?.hbar;
    return a ? `0x${Buffer.from(encodeHederaAddr(a)).toString("hex")}` : null;
  },
};

function bindTo(account: string, signerPriv = AUTHOR_PRIV, extraTexts: Record<string, string> = {}) {
  records[NAME] = {
    texts: {
      [ENS_KEY_RECORD]: AUTHOR_PUB,
      [ENS_PAYOUT_SIG_RECORD]: signPayoutAttestation(signerPriv, NAME, account),
      ...extraTexts,
    },
    hbar: account,
  };
}

let facilitator: Server;
let mirror: Server;
let dataDir: string;
let fc: StubFacilitatorControls;
let app: import("express").Express;
let ledger: typeof import("./server.js")["ledger"];
let base: string;
let server: Server;

function signed(question: string, opts: { author?: string; priv?: string } = {}) {
  const body = `body for ${question}`;
  const m: Omit<Manifest, "magnet"> = {
    question,
    questionNorm: normalizeQuestion(question),
    scope: "ens-test",
    abstract: "An artifact by an ENS-named author.",
    sources: [{ url: "https://docs.ens.domains/ensv2/overview", fetchedAt: "2026-09-13T00:00:00Z" }],
    provenance: {
      model: "claude-opus-5",
      durationSeconds: 60,
      inputTokens: 1000,
      outputTokens: 500,
      estimatedCostUsd: 0.1,
      toolCalls: 2,
    },
    decay: { halfLifeDays: 1, producedAt: new Date().toISOString() },
    author: opts.author ?? ENS_AUTHOR,
    bodyHash: sha256(body),
    bodyBytes: Buffer.byteLength(body, "utf8"),
    redacted: false,
  };
  const magnet = magnetOf(m);
  const authorSig = signManifest(opts.priv ?? AUTHOR_PRIV, magnet.slice("swarm:".length));
  return { manifest: { ...m, magnet }, body, authorSig };
}

async function publish(p: ReturnType<typeof signed>) {
  return fetch(`${base}/publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...p, priceBase: 100_000, priceFloor: 10_000 }),
  });
}

async function quote(magnet: string) {
  return ((await (await fetch(`${base}/artifact/${magnet}`)).json()) as any).accepts[0];
}

async function buy(magnet: string, txId: string, accepted?: unknown) {
  const acc = accepted ?? (await quote(magnet));
  fc.payer = BUYER_ACCOUNT;
  fc.txId = txId;
  return fetch(`${base}/artifact/${magnet}`, {
    headers: {
      "PAYMENT-SIGNATURE": b64({ x402Version: 2, scheme: "exact", network: "hedera:testnet", accepted: acc, payload: { signature: "stub" } }),
    },
  });
}

function royaltyPayeeOf(txId: string) {
  const p = ledger.purchaseByTxId(txId)!;
  expect(p, `no purchase row for ${txId}`).toBeTruthy();
  const row = ledger.payouts().find((r) => r.id === p.authorRoyaltyPayoutId)!;
  return { purchase: p, payee: row.payee, amount: row.amount };
}

beforeAll(async () => {
  fc = defaultFacilitatorControls();
  fc.requireSignedTransaction = false;
  facilitator = (await startStubFacilitator(fc)).server;
  mirror = (await startStubMirror({ [BUYER_ACCOUNT]: BUYER_PUB })).server;
  dataDir = mkdtempSync(join(tmpdir(), "carpool-ens-test-"));
  process.env.LEDGER_DB = ":memory:";
  process.env.ARTIFACT_STORE = join(dataDir, "artifacts");
  process.env.CARPOOL_ACCOUNT_ID = "0.0.9999";
  process.env.CARPOOL_PRIVATE_KEY = "";
  process.env.HCS_TOPIC_ID = "";
  process.env.TRACKER_FEE_MICRO_USDC = "500";
  process.env.FACILITATOR_URL = `http://127.0.0.1:${port(facilitator)}`;
  process.env.MIRROR_NODE_URL = `http://127.0.0.1:${port(mirror)}`;
  process.env.HEDERA_NETWORK = "hedera:testnet";
  process.env.USDC_TOKEN_ID = "0.0.1";
  process.env.LEDGER_API_KEY = "b".repeat(32);
  process.env.NODE_ENV = "test";
  process.env.EMBEDDING_MODEL = TEST_EMBEDDING_MODEL;
  process.env.EMBEDDING_DIM = String(TEST_EMBEDDING_DIM);
  process.env.CARPOOL_ENS_CHAIN = "sepolia"; // never reached: the reader is injected
  process.env.CARPOOL_ENS_TIMEOUT_MS = "500";
  setEmbedder(hashedEmbedder());
  setEnsReader(reader);
  ({ app, ledger } = await import("./server.js"));
  server = await listen(app);
  base = `http://127.0.0.1:${port(server)}`;
});

afterAll(() => {
  server.close();
  facilitator.close();
  mirror.close();
  setEnsReader(null);
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  records = {};
  resolverDown = false;
  readCount = 0;
  clearIdentityMemo();
});

describe("POST /publish with an ENS author", () => {
  it("accepts a signed ens:<name>:<fallback>:<key> author without reading ENS at all", async () => {
    const r = await publish(signed("ens publish offline"));
    expect(r.status).toBe(200);
    expect(readCount).toBe(0);
  });

  it("rejects a name that is not ENSIP-15 normalised, since the name is inside the content address", async () => {
    // U+FF41 FULLWIDTH LATIN SMALL LETTER A normalises to "a".
    const author = `ens:ａlice.eth:${FALLBACK}:${AUTHOR_PUB}`;
    const r = await publish(signed("ens publish unnormalised", { author }));
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error).toMatch(/normalised/);
  });

  it("rejects a malformed ens: author with a readable error instead of a 500", async () => {
    const r = await publish(signed("ens publish malformed", { author: `ens:${NAME}:${AUTHOR_PUB}` }));
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error).toMatch(/ens:<name>/);
  });

  it("still rejects a signature by a different key", async () => {
    const r = await publish(signed("ens publish wrong key", { priv: PrivateKey.generateECDSA().toStringRaw() }));
    expect(r.status).toBe(401);
  });
});

describe("purchase-time payout for an ENS author", () => {
  it("pays the name's attested Hedera account and pins it, with its source, into the purchase", async () => {
    bindTo("0.0.7777");
    const p = signed("ens pays attested account");
    await publish(p);
    const res = await buy(p.manifest.magnet, "0.0.2222@ens-1");
    expect(res.status).toBe(200);
    const { purchase, payee, amount } = royaltyPayeeOf("0.0.2222@ens-1");
    expect(payee).toBe("0.0.7777");
    expect(amount).toBeGreaterThan(0);
    expect(purchase.payoutVia).toBe(`ens:${NAME}`);
  });

  it("rotation: a new attested account is paid from the next sale on, and the earlier sale keeps its payee", async () => {
    bindTo("0.0.7777");
    const p = signed("ens rotation");
    await publish(p);
    await buy(p.manifest.magnet, "0.0.2222@rot-1");
    bindTo("0.0.8888"); // owner updates addr(3030) and the attestation; nothing is republished
    await buy(p.manifest.magnet, "0.0.2222@rot-2");
    expect(royaltyPayeeOf("0.0.2222@rot-1").payee).toBe("0.0.7777");
    expect(royaltyPayeeOf("0.0.2222@rot-2").payee).toBe("0.0.8888");
  });

  it("records changed between the 402 quote and settlement: the account current at settlement is paid", async () => {
    bindTo("0.0.7777");
    const p = signed("ens change between quote and settle");
    await publish(p);
    const accepted = await quote(p.manifest.magnet);
    bindTo("0.0.8888");
    const res = await buy(p.manifest.magnet, "0.0.2222@qs-1", accepted);
    expect(res.status).toBe(200);
    expect(royaltyPayeeOf("0.0.2222@qs-1").payee).toBe("0.0.8888");
  });

  it("resolver down: the sale still records, pays the author-signed fallback, and says so", async () => {
    bindTo("0.0.7777");
    const p = signed("ens resolver down");
    await publish(p);
    resolverDown = true;
    const res = await buy(p.manifest.magnet, "0.0.2222@down-1");
    expect(res.status).toBe(200);
    const { purchase, payee } = royaltyPayeeOf("0.0.2222@down-1");
    expect(payee).toBe(FALLBACK);
    expect(purchase.payoutVia).toBe(`ens-fallback:${NAME}`);
    expect(ledger.owedFailures({ open: true }).filter((o) => o.txId === "0.0.2222@down-1")).toEqual([]);
  });

  it("no Hedera record: pays the fallback", async () => {
    bindTo("0.0.7777");
    records[NAME]!.hbar = null;
    const p = signed("ens no hbar record");
    await publish(p);
    await buy(p.manifest.magnet, "0.0.2222@nohbar-1");
    expect(royaltyPayeeOf("0.0.2222@nohbar-1").payee).toBe(FALLBACK);
  });

  it("a name taken over by someone who copies the public key cannot redirect the royalty", async () => {
    const mallory = PrivateKey.generateECDSA().toStringRaw();
    bindTo("0.0.6666", mallory);
    const p = signed("ens takeover");
    await publish(p);
    await buy(p.manifest.magnet, "0.0.2222@takeover-1");
    expect(royaltyPayeeOf("0.0.2222@takeover-1").payee).toBe(FALLBACK);
  });

  it("a Hedera author's purchase is untouched: payee from the author string, payoutVia null, no ENS read", async () => {
    const hederaAuthor = `0.0.4444:${AUTHOR_PUB}`;
    const p = signed("hedera author unchanged", { author: hederaAuthor });
    await publish(p);
    await buy(p.manifest.magnet, "0.0.2222@hedera-1");
    const { purchase, payee } = royaltyPayeeOf("0.0.2222@hedera-1");
    expect(payee).toBe("0.0.4444");
    expect(purchase.payoutVia).toBeNull();
    expect(readCount).toBe(0);
  });

  it("a refund voids the royalty pinned to the ENS account, whatever the name says now", async () => {
    bindTo("0.0.7777");
    const p = signed("ens refund");
    await publish(p);
    await buy(p.manifest.magnet, "0.0.2222@refund-ens-1");
    bindTo("0.0.8888");
    const txId = "0.0.2222@refund-ens-1";
    const messageHashHex = sha256(`${txId}:${p.manifest.magnet}:refund`);
    const signature = Buffer.from(buyer.sign(Buffer.from(messageHashHex, "hex"))).toString("hex");
    const r = await fetch(`${base}/refund`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ txId, magnet: p.manifest.magnet, signature, buyerPublicKey: BUYER_PUB }),
    });
    expect(r.status).toBe(200);
    const { purchase } = royaltyPayeeOf(txId);
    const royalty = ledger.payouts().find((x) => x.id === purchase.authorRoyaltyPayoutId)!;
    expect(royalty.payee).toBe("0.0.7777");
    expect(royalty.state).toBe("voided");
    expect(ledger.payouts({ payee: "0.0.8888" }).filter((x) => x.ref === String(purchase.id))).toEqual([]);
  });
});

describe("POST /delist by an ENS author", () => {
  it("verifies against the key inside the ENS author string, with ENS unreachable", async () => {
    const p = signed("ens delist");
    await publish(p);
    resolverDown = true;
    const authorSig = signManifest(AUTHOR_PRIV, sha256(`${p.manifest.magnet}:delist`));
    const r = await fetch(`${base}/delist`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ magnet: p.manifest.magnet, authorSig }),
    });
    expect(r.status).toBe(200);
  });
});

describe("GET /identity", () => {
  it("reports a verified ENS author, where the next sale would pay, and the ENSIP-5 profile", async () => {
    bindTo("0.0.7777", AUTHOR_PRIV, { description: "Writes about ENS and Hedera", keywords: "ens,hedera", url: "https://example.org" });
    const r = await fetch(`${base}/identity?author=${encodeURIComponent(ENS_AUTHOR)}`);
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    expect(j.kind).toBe("ens");
    expect(j.name).toBe(NAME);
    expect(j.binding.status).toBe("verified");
    expect(j.payoutNow).toEqual({ account: "0.0.7777", source: "ens" });
    expect(j.profile).toMatchObject({ description: "Writes about ENS and Hedera", keywords: "ens,hedera" });
    expect(j.fallbackAccount).toBe(FALLBACK);
  });

  it("reports unbound with the failing checks named", async () => {
    const r = await fetch(`${base}/identity?author=${encodeURIComponent(ENS_AUTHOR)}`);
    const j = (await r.json()) as any;
    expect(j.binding.status).toBe("unbound");
    expect(j.binding.problems.length).toBe(3);
    expect(j.payoutNow).toEqual({ account: FALLBACK, source: "fallback" });
  });

  it("describes a Hedera author without touching ENS", async () => {
    const r = await fetch(`${base}/identity?author=${encodeURIComponent(`0.0.4444:${AUTHOR_PUB}`)}`);
    const j = (await r.json()) as any;
    expect(j).toMatchObject({ kind: "hedera", payoutAccount: "0.0.4444" });
    expect(readCount).toBe(0);
  });

  it("400s without an author", async () => {
    expect((await fetch(`${base}/identity`)).status).toBe(400);
  });
});

describe("GET /ens/:name", () => {
  it("lists the live artifacts signed by the key the name's io.carpool.key record names", async () => {
    bindTo("0.0.7777");
    const p = signed("ens profile listing");
    await publish(p);
    // An impersonator publishes under the same name with their own key: it must not be listed.
    const other = PrivateKey.generateECDSA();
    const fake = signed("ens profile impostor", {
      author: ensAuthorString(NAME, "0.0.6666", other.publicKey.toStringRaw()),
      priv: other.toStringRaw(),
    });
    expect((await publish(fake)).status).toBe(200);

    const j = (await (await fetch(`${base}/ens/${NAME}`)).json()) as any;
    expect(j.name).toBe(NAME);
    expect(j.binding.status).toBe("verified");
    const magnets = j.artifacts.map((a: any) => a.magnet);
    expect(magnets).toContain(p.manifest.magnet);
    expect(magnets).not.toContain(fake.manifest.magnet);
    expect(j.unverifiedClaims).toBe(1);
  });

  it("lists nothing when the name has no key record", async () => {
    const j = (await (await fetch(`${base}/ens/${NAME}`)).json()) as any;
    expect(j.artifacts).toEqual([]);
    expect(j.binding).toBeNull();
  });
});
