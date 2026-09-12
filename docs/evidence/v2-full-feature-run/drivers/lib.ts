/**
 * TEMPORARY shared helpers for the v2 full-feature testnet run.
 * Not part of the product; archived into docs/evidence/v2-full-feature-run/.
 *
 * Every payment, publish, refund and settle below goes through the SHIPPED code
 * paths: `publishArtifact` / `payFetch` / `delistArtifact` from apps/mcp, and the
 * registry's own HTTP routes. Nothing here reimplements a money path.
 */
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { publicKeyHexOf, sha256, signManifest } from "@carpool/core";

export const BASE = process.env.CARPOOL_BASE ?? "http://127.0.0.1:8403";
export const KEY = process.env.LEDGER_API_KEY!;
export const MIRROR = process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com";
export const TOKEN = process.env.USDC_TOKEN_ID ?? "0.0.429274";
export const OUT = process.env.OUT_DIR!;
if (!OUT) throw new Error("OUT_DIR is required");
mkdirSync(OUT, { recursive: true });

export interface Acct {
  id: string;
  key: string;
  publicKey: string;
  label: string;
}
export const accounts: Record<string, Acct> = JSON.parse(
  readFileSync(process.env.ACCOUNTS_JSON!, "utf8"),
);

/** Everything this run recorded, appended as it happens. */
const LOG = join(OUT, "timeline.jsonl");
export function note(step: string, data: unknown): void {
  appendFileSync(LOG, `${JSON.stringify({ at: new Date().toISOString(), step, data })}\n`);
  console.log(`[${step}] ${JSON.stringify(data)}`.slice(0, 400));
}

export function save(name: string, obj: unknown): void {
  writeFileSync(join(OUT, name), `${JSON.stringify(obj, null, 2)}\n`);
  console.log(`  -> ${name}`);
}

export async function api(
  path: string,
  init: RequestInit & { operator?: boolean } = {},
): Promise<{ status: number; body: any; headers: Record<string, string> }> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.operator) headers["x-carpool-key"] = KEY;
  if (init.body) headers["content-type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* text/plain body */
  }
  return {
    status: res.status,
    body,
    headers: Object.fromEntries([...res.headers.entries()]),
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ----------------------------------------------------------------- publishing

const SOURCES = [
  { url: "https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/transfer-tokens", fetchedAt: "2026-09-12T00:00:00Z" },
  { url: "https://hips.hedera.com/hip/hip-904", fetchedAt: "2026-09-12T00:00:00Z" },
  { url: "https://docs.hedera.com/hedera/core-concepts/transactions-and-queries", fetchedAt: "2026-09-12T00:00:00Z" },
];

/**
 * One run fixture. These are deliberately small, synthetic artifacts: this run
 * measures the payment rail, not the research market, and 20 real research
 * artifacts would not make a settlement transfer any more real. Said out loud
 * here so nobody reads them as a corpus.
 */
export function fixture(i: number, topic: string): { question: string; abstract: string; body: string } {
  const question = `Run fixture ${i}: ${topic}?`;
  return {
    question,
    abstract:
      `Synthetic fixture ${i} for carpool's full-feature testnet run, on ${topic}. Written to ` +
      `exercise publish, x402 purchase, refund and batched settlement against real Hedera ` +
      `testnet; not a research artifact.`,
    body:
      `# ${topic}\n\nFixture ${i} of the carpool v2 full-feature testnet run.\n\n` +
      `This body exists so that a real x402 purchase has real bytes to deliver and a real\n` +
      `sha256 to verify against the manifest. The payment, the payout row, the batched\n` +
      `TransferTransaction and the HCS anchor it participates in are all real; the prose is\n` +
      `not research and is not offered as such.\n\n` +
      `- token: ${TOKEN}\n- fixture index: ${i}\n- topic: ${topic}\n`,
  };
}

export interface Published {
  magnet: string;
  author: Acct;
  priceBase: number;
  priceFloor: number;
  bodyHash: string;
  body: string;
}

export async function publish(
  authorLabel: string,
  i: number,
  topic: string,
  priceBase = 2000,
  priceFloor = 1000,
): Promise<Published> {
  const { publishArtifact } = await import("../../mcp/src/publish.js");
  const author = accounts[authorLabel]!;
  process.env.CARPOOL_AUTHOR_ACCOUNT_ID = author.id;
  process.env.CARPOOL_AUTHOR_PRIVATE_KEY = author.key;
  const f = fixture(i, topic);
  const out = await publishArtifact(BASE, {
    ...f,
    sources: SOURCES,
    provenance: {
      model: "claude-opus-5",
      durationSeconds: 60,
      inputTokens: 1000,
      outputTokens: 200,
      estimatedCostUsd: 0.02,
      toolCalls: 3,
    },
    scope: "carpool-full-feature-run",
    halfLifeDays: 365,
    priceMicroUsdc: priceBase,
    redacted: false,
  });
  if (!out.ok) throw new Error(`publish ${authorLabel}: ${out.error}`);
  note("publish", { authorLabel, author: author.id, magnet: out.magnet, duplicateOf: out.duplicateOf });
  return {
    magnet: out.magnet,
    author,
    priceBase,
    priceFloor,
    bodyHash: createHash("sha256").update(f.body).digest("hex"),
    body: f.body,
  };
}

// -------------------------------------------------------------------- buying

export async function buy(magnet: string, expectedBodyHash?: string) {
  const { payFetch } = await import("../../mcp/src/pay.js");
  const buyer = accounts.buyer!;
  process.env.CARPOOL_BUYER_ACCOUNT_ID = buyer.id;
  process.env.CARPOOL_BUYER_PRIVATE_KEY = buyer.key;
  const t0 = performance.now();
  const res = await payFetch(BASE, magnet, expectedBodyHash);
  const ms = performance.now() - t0;
  note("buy", {
    magnet,
    ok: res.ok,
    paid: res.paid,
    txId: res.txId,
    verification: res.verification,
    error: res.error,
    latencyMs: Math.round(ms),
  });
  return { ...res, latencyMs: ms, bodyBytes: Buffer.byteLength(res.body, "utf8") };
}

/** The unpaid 402 quote, for the record. */
export async function quote(magnet: string) {
  const res = await fetch(`${BASE}/artifact/${encodeURIComponent(magnet)}`);
  const body = await res.json();
  return { status: res.status, paymentRequiredHeader: res.headers.get("PAYMENT-REQUIRED"), body };
}

// ------------------------------------------------------------------- refunds

export async function refund(txId: string, magnet: string) {
  const buyer = accounts.buyer!;
  const messageHash = sha256(`${txId}:${magnet}:refund`);
  const signature = signManifest(buyer.key, messageHash);
  const out = await api("/refund", {
    method: "POST",
    body: JSON.stringify({
      txId,
      magnet,
      signature,
      buyerPublicKey: publicKeyHexOf(buyer.key),
    }),
  });
  note("refund", { txId, magnet, status: out.status, body: out.body });
  return out;
}

// ------------------------------------------------------------------ settling

export async function settle(label: string) {
  const out = await api("/settle", { method: "POST", operator: true });
  note("settle", { label, status: out.status, body: out.body });
  return out;
}

// -------------------------------------------------------------- mirror node

export async function mirror(path: string): Promise<any> {
  const res = await fetch(`${MIRROR}${path}`);
  if (!res.ok) throw new Error(`mirror ${path} → ${res.status}`);
  return res.json();
}

/**
 * One transaction from the mirror node, with a bounded wait for ingestion.
 * Mirror lag is a couple of seconds; asking for a transaction the instant its
 * receipt came back is a 404 about timing, not about the transaction.
 */
export async function tx(txId: string, tries = 15): Promise<any> {
  const id = txId.replace("@", "-").replace(/\.(\d+)$/, "-$1");
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await mirror(`/api/v1/transactions/${id}`);
    } catch (e) {
      last = e;
      await sleep(2000);
    }
  }
  throw last;
}

export async function usdcBalance(id: string): Promise<number> {
  const j = await mirror(`/api/v1/accounts/${id}/tokens?token.id=${TOKEN}`);
  return j.tokens?.[0]?.balance ?? 0;
}

export async function balances(ids: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const id of ids) out[id] = await usdcBalance(id);
  return out;
}

export async function topicMessages(): Promise<any[]> {
  const j = await mirror(`/api/v1/topics/${process.env.HCS_TOPIC_ID}/messages?limit=100`);
  return j.messages ?? [];
}

/** Every state read, in one snapshot. */
export async function snapshot(name: string) {
  const [state, payouts, batches, batchesOpen, owed, events, wellKnown, health] = await Promise.all([
    api("/state"),
    api("/payouts", { operator: true }),
    api("/batches"),
    api("/batches"),
    api("/owed", { operator: true }),
    api("/events?since=0"),
    api("/.well-known/carpool"),
    api("/health"),
  ]);
  const snap = {
    state: state.body,
    payouts: payouts.body,
    batches: batches.body,
    owed: owed.body,
    events: events.body,
    wellKnown: wellKnown.body,
    health: health.body,
  };
  save(name, snap);
  void batchesOpen;
  return snap;
}
