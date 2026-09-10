/**
 * apps/mcp driving the REAL apps/registry, in-process.
 *
 * This file exists because the MCP surface — the part a judge actually touches
 * — was non-functional while both sides' own suites were green. Every defect it
 * covers was a *disagreement between* the two apps, which is precisely what
 * per-app tests and hand-written stand-ins cannot see:
 *
 *   C2  `publishArtifact` posted `signature` where `PublishBody` requires
 *       `authorSig`, and `author: "0.0.1234"` where `parseHederaAuthor`
 *       requires `"<accountId>:<publicKeyHex>"`. Two independent 400s.
 *   C3  `renderCandidate` called `.toFixed(1)` on `ageDays`, which `/search`
 *       never sent. A TypeError on every search that found something.
 *   I5  `pay.ts` compared the body against `x-carpool-body-hash`, which the
 *       registry never set, so the check no-oped — while the tool printed
 *       "(verified against the manifest)".
 *
 * No network: the registry runs against a stub facilitator and stub mirror node
 * on 127.0.0.1, and the embedder is injected (no ONNX, no model download). The
 * x402 client, payment gate, ledger, body store and signature verification are
 * all the real ones.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
// From @x402/hedera, not @hiero-ledger/sdk: that is the SDK copy apps/mcp
// actually depends on (see pay.ts's note on the dual-SDK trap).
import { PrivateKey } from "@x402/hedera";
import { normalizeQuestion } from "@carpool/core";
import {
  newAuthor,
  startRegistry,
  type AuthorKeypair,
  type RegistryHarness,
} from "../../registry/src/testing/harness.js";
import { hashedEmbedder } from "../../registry/src/testing/hashedEmbedder.js";
import { RegistryClient, type ManifestSummary } from "./client.js";
import { publishArtifact } from "./publish.js";
import { delistArtifact } from "./delist.js";
import { payFetch } from "./pay.js";
import { renderCandidate, renderIntegrity } from "./render.js";
import type { Embedder } from "./embed.js";

let harness: RegistryHarness;
let author: AuthorKeypair;
let client: RegistryClient;

const QUESTION = "What is the ETHOnline 2026 prize pool across sponsor tracks?";
const BODY = "# Prize pool\n\n$80,000 across 11 sponsors. Full breakdown follows.\n";

/** The registry's injected embedder, wearing apps/mcp's Embedder shape. */
function localLikeEmbedder(): Embedder {
  const e = hashedEmbedder();
  return { mode: "local", model: e.model, dim: e.dim, embed: (t) => e.embed(t) };
}

beforeAll(async () => {
  harness = await startRegistry({ similarityThreshold: 0.5 });
  author = newAuthor("0.0.1111");
  client = new RegistryClient(harness.base);

  const buyerKey = PrivateKey.generateECDSA();
  process.env.CARPOOL_AUTHOR_ACCOUNT_ID = author.accountId;
  process.env.CARPOOL_AUTHOR_PRIVATE_KEY = author.privateKeyHex;
  // The stub facilitator reports 0.0.2222 as the payer, so the buyer's own
  // account id matches what the registry records as `purchase.buyer`.
  process.env.CARPOOL_BUYER_ACCOUNT_ID = "0.0.2222";
  process.env.CARPOOL_BUYER_PRIVATE_KEY = buyerKey.toStringRaw();
  process.env.HEDERA_NETWORK = "hedera:testnet";
  process.env.USDC_TOKEN_ID = "0.0.429274";
});

afterAll(() => harness?.close());

describe("carpool_publish → carpool_search → carpool_fetch, against the real registry", () => {
  let magnet: string;
  let summary: ManifestSummary;

  it("publishes (C2: this used to 400 twice over)", async () => {
    const out = await publishArtifact(harness.base, {
      question: QUESTION,
      abstract: "Total prize pool across all sponsor tracks for ETHOnline 2026.",
      body: BODY,
      sources: [{ url: "https://ethglobal.com/events/ethonline2026", fetchedAt: "2026-09-01T00:00:00Z" }],
      provenance: {
        model: "claude-sonnet-5",
        durationSeconds: 900,
        inputTokens: 42_000,
        outputTokens: 5_200,
        estimatedCostUsd: 0.42,
        toolCalls: 31,
      },
      scope: "ethonline-2026",
      halfLifeDays: 14,
      priceMicroUsdc: 10_000,
      redacted: false,
    });

    expect(out).toMatchObject({ ok: true });
    if (!out.ok) throw new Error(out.error);
    magnet = out.magnet;
    expect(magnet).toMatch(/^swarm:[0-9a-f]{64}$/);
    expect(out.duplicateOf).toBeNull();
  });

  it("sends an author the registry can verify, and a questionNorm it recomputes to the same string", async () => {
    const m = await client.manifest(magnet);
    expect(m).not.toBeNull();
    // The registry stored it, which means `parseHederaAuthor` accepted the
    // "<accountId>:<publicKeyHex>" form AND `verify()` checked the signature
    // against that public key. Assert the shape too, so a regression to the
    // bare account id is named rather than showing up as a generic 400.
    const stored = await fetch(`${harness.base}/state`).then((r) => r.json() as Promise<any>);
    const row = stored.artifacts.find((a: any) => a.manifest.magnet === magnet);
    expect(row.manifest.author).toBe(`${author.accountId}:${author.publicKeyHex}`);

    expect(m!.questionNorm).toBe(normalizeQuestion(QUESTION));
    expect(m!.bodyHash).toBe(createHash("sha256").update(BODY).digest("hex"));
    expect(m!.bodyBytes).toBe(Buffer.byteLength(BODY, "utf8"));
  });

  it("searches and renders every candidate without throwing (C3: ageDays was never sent)", async () => {
    const { results, sentText } = await client.search("ETHOnline 2026 prize pool sponsor tracks", 5, null);
    expect(sentText).toBe(true); // no local embedder → text path, and it says so
    expect(results.length).toBeGreaterThan(0);
    summary = results.find((r) => r.magnet === magnet)!;
    expect(summary).toBeDefined();

    expect(typeof summary.ageDays).toBe("number");
    expect(Number.isFinite(summary.ageDays)).toBe(true);

    // The exact call that used to throw `TypeError: Cannot read properties of
    // undefined (reading 'toFixed')`.
    const rendered = results.map((m, i) => renderCandidate(m, i)).join("\n\n");
    expect(rendered).toContain(magnet);
    expect(rendered).toMatch(/0\.0d old/);
    expect(rendered).toMatch(/match: similarity/); // ranked, not browsed
  });

  it("searches by client-embedded vector without sending the question text", async () => {
    const { results, sentText } = await client.search(
      "ETHOnline 2026 prize pool sponsor tracks",
      5,
      localLikeEmbedder(),
    );
    expect(sentText).toBe(false);
    expect(results.map((r) => r.magnet)).toContain(magnet);
  });

  it("buys it, and the integrity check actually runs (I5)", async () => {
    const result = await payFetch(harness.base, magnet);
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.body).toBe(BODY);
    expect(result.paid).toBeGreaterThan(0);
    // Decoded out of PAYMENT-RESPONSE, not the raw base64 blob the tool used
    // to print as the transaction id.
    expect(result.txId).toBe(harness.facilitator.txId);

    expect(result.verification).toEqual({
      state: "verified",
      source: "manifest",
      bodyHash: summary.bodyHash,
    });
    expect(renderIntegrity(result, summary.bodyHash)).toMatch(
      /verified: matches the bodyHash in the manifest read before paying/,
    );
  });

});

/**
 * What the facilitator was actually handed.
 *
 * Until this branch the stub facilitator answered `{ isValid: true }` and
 * `{ success: true }` without looking at the payload, so `pay.ts` could have sent
 * anything — `{ signature: "stub" }`, an unsigned transaction, a payload naming a
 * different asset or a re-quoted amount — and every test in the repo would still
 * have been green. The stub now applies the two checks the real facilitator
 * applies that can be checked offline (`testing/stubFacilitator.ts`); these tests
 * assert that what the shipped client sends passes them, and name the fields, so
 * a regression is reported as the specific disagreement it is rather than as a
 * 402 somewhere downstream.
 */
describe("the payload apps/mcp sends is one a facilitator would accept", () => {
  let magnet: string;
  const bodyText = "GET /api/v1/transactions/{id} — what the facilitator was handed";

  beforeAll(async () => {
    harness.facilitator.calls.length = 0;
    const out = await publishArtifact(harness.base, {
      question: "Which mirror node path returns one transaction by id?",
      abstract: "The transactions-by-id path and the fields it returns.",
      body: bodyText,
      sources: [{ url: "https://docs.hedera.com/mirror/tx", fetchedAt: "2026-09-01T00:00:00Z" }],
      provenance: {
        model: "claude-sonnet-5",
        durationSeconds: 30,
        inputTokens: 500,
        outputTokens: 200,
        estimatedCostUsd: 0.01,
        toolCalls: 2,
      },
      halfLifeDays: 30,
      priceMicroUsdc: 9_000,
      redacted: false,
    });
    if (!out.ok) throw new Error(out.error);
    magnet = out.magnet;
    const paid = await payFetch(harness.base, magnet);
    expect(paid.ok, paid.error).toBe(true);
  });

  it("was accepted: neither /verify nor /settle refused anything on the paid path", () => {
    const refusals = harness.facilitator.calls.filter((c) => c.rejected !== null);
    expect(
      refusals.map((c) => `${c.op}: ${c.rejected}`),
      "the shipped client produced a payload the stub would not submit",
    ).toEqual([]);
    // Both halves ran. A file that only ever reached /verify is how four
    // settlement mutants survived a green suite (docs/AUDIT-TESTS.md).
    expect(harness.facilitator.calls.map((c) => c.op)).toEqual(["verify", "settle"]);
  });

  it("carries a signed Hedera transaction, not a placeholder", () => {
    const verify = harness.facilitator.calls.find((c) => c.op === "verify")!;
    const payload = verify.payload as { payload?: { transaction?: string; signature?: string } };
    // `payload.signature` is what every hand-rolled test header in this repo
    // sends. The exact/hedera client scheme sends `payload.transaction`: base64
    // protobuf, a SignedTransaction list, hundreds of bytes of it.
    expect(payload.payload?.signature).toBeUndefined();
    expect(typeof payload.payload?.transaction).toBe("string");
    expect(Buffer.from(payload.payload!.transaction!, "base64").byteLength).toBeGreaterThan(200);
  });

  it("echoes back exactly the requirements the 402 issued, field by field", () => {
    const verify = harness.facilitator.calls.find((c) => c.op === "verify")!;
    const accepted = (verify.payload as { accepted: Record<string, unknown> }).accepted;
    const reqs = verify.requirements as Record<string, unknown>;
    // The facilitator compares these by strict equality, which is the whole
    // reason PaymentGate replays its issued quote instead of re-pricing.
    for (const field of ["scheme", "network", "asset", "amount", "payTo"]) {
      expect(accepted[field], `accepted.${field} must equal the requirements`).toEqual(reqs[field]);
    }
    expect(accepted.network).toBe("hedera:testnet");
    expect(accepted.asset).toBe("0.0.429274");
    expect(accepted.payTo).toBe(harness.registryAccount);
    // From the hedera kind of the real /supported response, which lists three
    // networks with hedera third — never solana's fee payer.
    expect((accepted.extra as { feePayer?: string } | undefined)?.feePayer).toBe("0.0.7162784");
    // And the same payload reached /settle, unmodified.
    const settle = harness.facilitator.calls.find((c) => c.op === "settle")!;
    expect(settle.payload).toEqual(verify.payload);
    expect(settle.requirements).toEqual(verify.requirements);
  });

  it("records the buyer the facilitator reported, not the account inside the transaction id", async () => {
    // The real facilitator submits the buyer's signed transfer itself, so the
    // transaction belongs to its fee payer while the money is the buyer's:
    // `docs/evidence/v2-first-testnet-run/` has payer `0.0.10477413` against tx
    // `0.0.7162784@1789202339.427560739`. The stub's defaults now differ the same
    // way (they used to agree, which is a coincidence production never has), so a
    // `purchase.buyer` taken from the transaction id fails here.
    const account = harness.facilitator.txId.split("@")[0];
    expect(account, "the stub must not make payer and txId agree").not.toBe(harness.facilitator.payer);

    const state = (await fetch(`${harness.base}/state`).then((r) => r.json())) as {
      purchases: { txId: string; buyer: string }[];
    };
    const row = state.purchases.find((p) => p.txId === harness.facilitator.txId);
    expect(row, "the purchase was recorded").toBeDefined();
    expect(row!.buyer).toBe(harness.facilitator.payer);
    expect(row!.buyer).not.toBe(account);
  });
});

describe("the integrity check is real, not decorative", () => {
  it("refuses the body when it does not match the hash the buyer held before paying", async () => {
    const out = await publishArtifact(harness.base, {
      question: "Which Hedera mirror node endpoint returns an account's key?",
      abstract: "The accounts endpoint and the shape of its key field.",
      body: "GET /api/v1/accounts/{id}",
      sources: [{ url: "https://docs.hedera.com/mirror", fetchedAt: "2026-09-01T00:00:00Z" }],
      provenance: {
        model: "claude-sonnet-5",
        durationSeconds: 60,
        inputTokens: 1_000,
        outputTokens: 400,
        estimatedCostUsd: 0.02,
        toolCalls: 3,
      },
      halfLifeDays: 14,
      priceMicroUsdc: 5_000,
      redacted: false,
    });
    if (!out.ok) throw new Error(out.error);

    // Stand in for a registry that served different bytes than it advertised:
    // hand the buyer the hash of something else. A dead check passes this; a
    // live one fails it, and the money is reported as spent either way.
    const wrongHash = "f".repeat(64);
    const result = await payFetch(harness.base, out.magnet, wrongHash);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/body hash mismatch/);
    expect(result.error).toMatch(/request a refund/);
    expect(result.verification.state).toBe("unverified");
    expect(result.paid).toBeGreaterThan(0); // it did pay — that is the point
    expect(renderIntegrity(result, wrongHash)).toMatch(/NOT VERIFIED/);
  });

  it("says so plainly when there is nothing to verify against, rather than claiming verification", () => {
    const unchecked = {
      ok: true,
      body: "x",
      paid: 1,
      txId: "0.0.1@1-1",
      verification: { state: "unverified" as const, reason: "no manifest bodyHash was available" },
    };
    const line = renderIntegrity(unchecked, "a".repeat(64));
    expect(line).toMatch(/NOT VERIFIED/);
    expect(line).not.toMatch(/verified: matches/);
    expect(line).toMatch(/unchecked/);
  });
});

describe("the wire shapes the MCP was written against", () => {
  it("GET /.well-known/carpool nests the tracker fee under prices, as the client now types it", async () => {
    const wk = await client.wellKnown();
    expect(typeof wk.prices.trackerFeeMicroUsdc).toBe("number");
    expect(wk).not.toHaveProperty("trackerFee");
    expect(wk.embedding).toEqual(harness.embedding);
    expect(wk.settlementAccount).toBe(harness.registryAccount);
    expect(typeof wk.refundWindowSeconds).toBe("number");
    expect(typeof wk.asset).toBe("string");
    expect(typeof wk.network).toBe("string");
  });

  it("POST /publish rejects the pre-fix payload — proving this test would have caught C2", async () => {
    const legacy = {
      manifest: {
        magnet: `swarm:${"a".repeat(64)}`,
        question: "legacy shape",
        questionNorm: "legacy shape",
        abstract: "x",
        sources: [],
        provenance: {
          model: "m",
          durationSeconds: 1,
          inputTokens: 1,
          outputTokens: 1,
          estimatedCostUsd: 0.01,
          toolCalls: 1,
        },
        decay: { halfLifeDays: 1, producedAt: new Date().toISOString() },
        author: "0.0.1234", // bare account id — the old publish.ts
        bodyHash: "0".repeat(64),
        bodyBytes: 1,
        redacted: false,
      },
      body: "x",
      signature: "deadbeef", // the old field name
      priceBase: 10_000,
      priceFloor: 1_000,
    };
    const res = await fetch(`${harness.base}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(legacy),
    });
    expect(res.status).toBe(400);
    // zod rejects on the missing `authorSig` before any cryptography runs.
    expect(((await res.json()) as { error: string }).error).toMatch(/authorSig/);
  });
});

/**
 * I8 — the author-side withdrawal, end to end through the real registry.
 *
 * `carpool_publish`'s own description, the consent prompt and three READMEs said
 * "delisting stops new sales". There was no route and no client path:
 * `artifact.delisted_at` had four readers and no writer. An affordance promised
 * in the sentence that asks for consent has to exist.
 */
describe("carpool_delist, against the real registry", () => {
  const QUESTION_D = "Which Hedera mirror node path lists a topic's messages?";
  const BODY_D = "GET /api/v1/topics/{topicId}/messages";
  let magnet: string;

  it("publishes something to withdraw", async () => {
    const out = await publishArtifact(harness.base, {
      question: QUESTION_D,
      abstract: "The mirror node path for reading HCS topic messages, with paging.",
      body: BODY_D,
      sources: [{ url: "https://docs.hedera.com/mirror/topics", fetchedAt: "2026-09-01T00:00:00Z" }],
      provenance: {
        model: "claude-sonnet-5",
        durationSeconds: 90,
        inputTokens: 2_000,
        outputTokens: 600,
        estimatedCostUsd: 0.05,
        toolCalls: 4,
      },
      halfLifeDays: 14,
      priceMicroUsdc: 7_500,
      redacted: false,
    });
    if (!out.ok) throw new Error(out.error);
    magnet = out.magnet;
    // It is on sale: findable and quotable.
    expect(await client.manifest(magnet)).not.toBeNull();
  });

  it("refuses a withdrawal signed by anyone but the author", async () => {
    const notTheAuthor = PrivateKey.generateECDSA().toStringRaw();
    const saved = process.env.CARPOOL_AUTHOR_PRIVATE_KEY;
    process.env.CARPOOL_AUTHOR_PRIVATE_KEY = notTheAuthor;
    try {
      const out = await delistArtifact(harness.base, magnet);
      expect(out.ok).toBe(false);
      if (out.ok) throw new Error("expected a refusal");
      expect(out.error).toMatch(/does not accept this key as/);
    } finally {
      process.env.CARPOOL_AUTHOR_PRIVATE_KEY = saved;
    }
    // Unchanged: a rejected withdrawal must not half-apply.
    expect(await client.manifest(magnet)).not.toBeNull();
  });

  it("withdraws it, and says what withdrawal does not undo", async () => {
    const out = await delistArtifact(harness.base, magnet);
    if (!out.ok) throw new Error(out.error);
    expect(out.alreadyDelisted).toBe(false);
    expect(out.note).toMatch(/refund window remain refundable/);
    expect(out.note).toMatch(/keeps their copy/);
  });

  it("stops new sales: search drops it, the manifest is gone, and a buy is refused before any payment", async () => {
    const { results } = await client.search(QUESTION_D, 5, null);
    expect(results.map((r) => r.magnet)).not.toContain(magnet);
    expect(await client.manifest(magnet)).toBeNull();

    const attempt = await payFetch(harness.base, magnet);
    expect(attempt.ok).toBe(false);
    expect(attempt.paid).toBe(0); // nothing was spent finding out
    expect(attempt.error).toMatch(/delisted or expired/);
  });

  it("is idempotent for the author who retries", async () => {
    const again = await delistArtifact(harness.base, magnet);
    if (!again.ok) throw new Error(again.error);
    expect(again.alreadyDelisted).toBe(true);
  });
});
