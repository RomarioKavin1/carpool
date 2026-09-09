// Test-only support (excluded from the build — see tsconfig.json): boots the
// REAL registry app in-process, against a stub x402 facilitator and a stub
// mirror node on 127.0.0.1. No network, no ONNX, no deployed service.
//
// "The real app" is the point. apps/bench used to carry a hand-written registry
// stand-in (`src/support/localRegistry.ts`, since DELETED in favour of this
// harness) which accepted publishes with no authorSig verification, no magnetOf
// recomputation, no bodyHash check and no duplicate check — all four of which
// the real POST /publish enforces. A stub written alongside its client agrees
// with it by construction, which is useless for catching a wire-shape
// disagreement. The publish field name mismatch (`signature` vs `authorSig`)
// and the author-format rejection both survived a full test suite for exactly
// that reason. Anything asserting how apps/mcp and apps/registry talk to each
// other has to drive this.
//
// The facilitator and mirror node come from `./stubFacilitator.ts`, which is
// shared with `server.test.ts` and `audit-onpaid-throw.test.ts` (there used to be
// a separate hand-written copy in each) and which — unlike the copies it
// replaced — actually inspects the payload it is handed. Read that file's header
// before assuming a paid test here proves the client can pay.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Express } from "express";
import { magnetOf, normalizeQuestion, signManifest, type Manifest } from "@carpool/core";
import { sha256 } from "@carpool/hedera-x402";
import { PrivateKey } from "@hiero-ledger/sdk";
import { setEmbedder, type Embedder } from "../embedder.js";
import { hashedEmbedder, TEST_EMBEDDING_DIM, TEST_EMBEDDING_MODEL } from "./hashedEmbedder.js";
import {
  defaultFacilitatorControls,
  listen,
  portOf,
  startStubFacilitator,
  startStubMirror,
  type StubFacilitatorControls,
} from "./stubFacilitator.js";

/**
 * What the stub facilitator will do, and what it refuses.
 *
 * See `stubFacilitator.ts`: it enforces the requirements/payload equality the
 * real facilitator enforces and requires a genuinely signed transaction, so a
 * test that hand-rolls its `PAYMENT-SIGNATURE` header has to turn
 * `requireSignedTransaction` off and say why.
 */
export type FacilitatorControls = StubFacilitatorControls;

export interface RegistryHarness {
  /** Base URL of the real registry app. */
  base: string;
  /** Mutable stub-facilitator behaviour, read per request. */
  facilitator: FacilitatorControls;
  /** Accounts the stub mirror node will report a key for (buyer refund checks). */
  mirrorKeys: Record<string, string>;
  registryAccount: string;
  embedding: { model: string; dim: number };
  close(): void;
}

export interface HarnessOptions {
  registryAccount?: string;
  trackerFeeMicroUsdc?: number;
  /** Cosine similarity floor for the ranked search path. */
  similarityThreshold?: number;
  /** Defaults to the network-free hashed embedder. */
  embedder?: Embedder;
}

/**
 * Boots the registry. Call inside a test's `beforeAll`/`beforeEach` and close it
 * afterwards.
 *
 * Environment is set before `./server.js` is imported, because that module
 * reads its config, opens its database and constructs its payment gate at
 * import time. `CARPOOL_PRIVATE_KEY` and `HCS_TOPIC_ID` are explicitly blanked
 * rather than left unset: dotenv only fills gaps, so on a developer machine
 * with a real repo-root `.env` the registry would otherwise build a live Hedera
 * client and `POST /settle` would fire a real network call.
 */
export async function startRegistry(opts: HarnessOptions = {}): Promise<RegistryHarness> {
  const facilitatorControls: FacilitatorControls = defaultFacilitatorControls();
  const mirrorKeys: Record<string, string> = {};

  const fac = await startStubFacilitator(facilitatorControls);
  const mir = await startStubMirror(mirrorKeys);

  const dataDir = mkdtempSync(join(tmpdir(), "carpool-harness-"));
  const registryAccount = opts.registryAccount ?? "0.0.9999";

  process.env.LEDGER_DB = ":memory:";
  process.env.ARTIFACT_STORE = join(dataDir, "artifacts");
  process.env.CARPOOL_ACCOUNT_ID = registryAccount;
  process.env.CARPOOL_PRIVATE_KEY = "";
  process.env.HCS_TOPIC_ID = "";
  process.env.TRACKER_FEE_MICRO_USDC = String(opts.trackerFeeMicroUsdc ?? 500);
  process.env.FACILITATOR_URL = fac.url;
  process.env.MIRROR_NODE_URL = mir.url;
  process.env.HEDERA_NETWORK = "hedera:testnet";
  process.env.USDC_TOKEN_ID = "0.0.429274";
  process.env.LEDGER_API_KEY = "a".repeat(32);
  process.env.NODE_ENV = "test";
  process.env.EMBEDDING_MODEL = opts.embedder?.model ?? TEST_EMBEDDING_MODEL;
  process.env.EMBEDDING_DIM = String(opts.embedder?.dim ?? TEST_EMBEDDING_DIM);
  if (opts.similarityThreshold !== undefined) {
    process.env.SEARCH_SIMILARITY_THRESHOLD = String(opts.similarityThreshold);
  }
  setEmbedder(opts.embedder ?? hashedEmbedder());

  const { app } = await import("../server.js");
  const registry = await listen(app as Express);

  return {
    base: `http://127.0.0.1:${portOf(registry)}`,
    facilitator: facilitatorControls,
    mirrorKeys,
    registryAccount,
    embedding: {
      model: process.env.EMBEDDING_MODEL,
      dim: Number(process.env.EMBEDDING_DIM),
    },
    close() {
      registry.close();
      fac.server.close();
      mir.server.close();
    },
  };
}

export interface AuthorKeypair {
  accountId: string;
  privateKeyHex: string;
  publicKeyHex: string;
  /** The registry's `"<accountId>:<publicKeyHex>"` author convention. */
  author: string;
}

export function newAuthor(accountId = "0.0.1111"): AuthorKeypair {
  const priv = PrivateKey.generateECDSA();
  const publicKeyHex = priv.publicKey.toStringRaw();
  return {
    accountId,
    privateKeyHex: priv.toStringRaw(),
    publicKeyHex,
    author: `${accountId}:${publicKeyHex}`,
  };
}

export interface PublishFixture {
  question: string;
  body?: string;
  abstract?: string;
  scope?: string;
  sources?: { url: string; fetchedAt: string }[];
  provenance?: Partial<Manifest["provenance"]>;
  producedAt?: string;
  halfLifeDays?: number;
  priceBase?: number;
  priceFloor?: number;
  /** Deliberately wrong values, to test the registry's own recomputation. */
  questionNorm?: string;
}

/**
 * Publishes one artifact through the real `POST /publish`, building the
 * manifest the way an honest client must: `questionNorm` from
 * `normalizeQuestion`, `author` as `"<accountId>:<publicKeyHex>"`, and
 * `authorSig` over the manifest hash.
 */
export async function publishFixture(
  harness: RegistryHarness,
  author: AuthorKeypair,
  fx: PublishFixture,
): Promise<{ status: number; magnet: string; json: unknown }> {
  const body = fx.body ?? `the body for: ${fx.question}`;
  const withoutMagnet: Omit<Manifest, "magnet"> = {
    question: fx.question,
    questionNorm: fx.questionNorm ?? normalizeQuestion(fx.question),
    scope: fx.scope,
    abstract: fx.abstract ?? `An abstract for ${fx.question}`,
    sources: fx.sources ?? [{ url: "https://example.com/a", fetchedAt: "2026-09-01T00:00:00Z" }],
    provenance: {
      model: "claude-sonnet-5",
      durationSeconds: 120,
      inputTokens: 4000,
      outputTokens: 1200,
      estimatedCostUsd: 0.42,
      toolCalls: 6,
      ...fx.provenance,
    },
    decay: {
      halfLifeDays: fx.halfLifeDays ?? 30,
      producedAt: fx.producedAt ?? new Date().toISOString(),
    },
    author: author.author,
    bodyHash: sha256(body),
    bodyBytes: Buffer.byteLength(body, "utf8"),
    redacted: false,
  };
  const magnet = magnetOf(withoutMagnet);
  const manifest = { ...withoutMagnet, magnet };
  const authorSig = signManifest(author.privateKeyHex, magnet.slice("swarm:".length));

  const res = await fetch(`${harness.base}/publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      manifest,
      body,
      authorSig,
      priceBase: fx.priceBase ?? 10_000,
      priceFloor: fx.priceFloor ?? 1_000,
    }),
  });
  return { status: res.status, magnet, json: await res.json().catch(() => null) };
}

/** base64 little-endian float32 — the `?vector=` encoding. */
export function encodeVector(v: Float32Array): string {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");
}
