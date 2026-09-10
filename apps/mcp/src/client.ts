import { normalizeQuestion } from "@carpool/core";
import { encodeVector, type Embedder } from "./embed.js";

/**
 * The registry's declared embedding tuple and terms, exactly as
 * `GET /.well-known/carpool` sends them.
 *
 * `trackerFee` is NOT a top-level field — it is `prices.trackerFeeMicroUsdc`.
 * This type used to claim the former because it was written against
 * CONTRACT.md rather than against the server, which is the same mistake that
 * produced the `signature`/`authorSig` publish failure. The unit is in the
 * name on the wire, so keep it in the name here.
 */
export interface WellKnown {
  embedding: { model: string; dim: number };
  prices: { trackerFeeMicroUsdc: number };
  refundWindowSeconds: number;
  settlementAccount: string;
  asset: string;
  network: string;
  /**
   * The HCS topic epochs are anchored to, `null` when the registry has none.
   *
   * Optional in the type, not on the wire: this client may be pointed at a
   * registry older than the field, and the lesson of `ageDays` is that typing a
   * field as always-present against a server that might not send it is how a
   * `.toFixed()` ends up throwing on every call. Absent and `null` mean the same
   * thing here — no topic — so a reader needs no third branch.
   */
  anchorTopic?: string | null;
}

export interface ManifestSummary {
  magnet: string;
  question: string;
  questionNorm: string;
  scope?: string;
  abstract: string;
  sources: { url: string; fetchedAt: string }[];
  provenance: {
    model: string;
    durationSeconds: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    toolCalls: number;
  };
  decay: { halfLifeDays: number; producedAt: string };
  bodyHash: string;
  bodyBytes: number;
  priceNow: number;
  freshness: number;
  health: number;
  ageDays: number;
  /**
   * Ranking evidence, present only when the request carried a `vector` or a
   * `q` — a browse (`/search` with neither) ranks nothing and says so by
   * omitting these rather than reporting a score it did not compute.
   */
  score?: number;
  similarity?: number;
  depth?: number;
}

/** What the registry actually sends: `ageDays` is served, but tolerate its absence. */
type RawSummary = Omit<ManifestSummary, "ageDays"> & { ageDays?: number };

const MS_PER_DAY = 86_400_000;

/**
 * Fills in `ageDays` when a registry did not send it.
 *
 * The registry serves `ageDays` (one clock for age, freshness and price — see
 * its ledger.ts), so this is a compatibility floor, not the primary path. It
 * exists because the previous version of this file *declared* `ageDays: number`
 * against a server that never sent it, and `renderCandidate` called
 * `.toFixed(1)` on the result: every search with a hit threw a TypeError. A
 * type that can be wrong at runtime should be narrowed where the data enters,
 * not asserted at the point of use.
 */
export function normaliseSummary(raw: RawSummary, nowMs = Date.now()): ManifestSummary {
  if (typeof raw.ageDays === "number") return raw as ManifestSummary;
  const producedMs = Date.parse(raw.decay?.producedAt ?? "");
  const ageDays = Number.isFinite(producedMs) ? Math.max(0, (nowMs - producedMs) / MS_PER_DAY) : 0;
  return { ...raw, ageDays };
}

/** Thin HTTP client for the registry. No payment logic — that lives in pay.ts. */
export class RegistryClient {
  constructor(private readonly base: string) {}

  private url(path: string): string {
    return `${this.base.replace(/\/$/, "")}${path}`;
  }

  async wellKnown(): Promise<WellKnown> {
    const res = await fetch(this.url("/.well-known/carpool"));
    if (!res.ok) throw new Error(`registry /.well-known/carpool → ${res.status}`);
    return (await res.json()) as WellKnown;
  }

  /**
   * Search. Sends a vector when one can be produced locally, otherwise the
   * question text — the caller decides which, and tells the user which happened.
   *
   * Embeds `normalizeQuestion(question)`, not the raw question: the registry
   * indexes each artifact's `questionNorm`, so embedding the raw string would
   * compare a differently-cased, differently-punctuated rendering of the text
   * against the corpus and cost similarity for no reason. Both sides of the
   * comparison now run the same normaliser from @carpool/core.
   */
  async search(
    question: string,
    limit: number,
    embedder: Embedder | null,
  ): Promise<{ results: ManifestSummary[]; sentText: boolean }> {
    const params = new URLSearchParams({ limit: String(limit) });
    const norm = normalizeQuestion(question);
    let sentText = true;
    if (embedder) {
      params.set("vector", encodeVector(await embedder.embed(norm)));
      sentText = false;
    } else {
      params.set("q", question);
    }
    const res = await fetch(this.url(`/search?${params}`));
    if (!res.ok) throw new Error(`registry /search → ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { results?: RawSummary[] } | RawSummary[];
    const raw = Array.isArray(body) ? body : (body.results ?? []);
    return { results: raw.map((r) => normaliseSummary(r)), sentText };
  }

  /**
   * One artifact's manifest by magnet. Free, like every other manifest read.
   *
   * The buyer's integrity check needs `bodyHash` fixed *before* payment; this
   * is where it comes from when the caller has a magnet and no search result
   * in hand. Returns null on 404/410 so a caller can distinguish "nothing to
   * buy" from "could not check".
   */
  async manifest(magnet: string): Promise<ManifestSummary | null> {
    const res = await fetch(this.url(`/manifest/${encodeURIComponent(magnet)}`));
    if (res.status === 404 || res.status === 410) return null;
    if (!res.ok) throw new Error(`registry /manifest → ${res.status}`);
    return normaliseSummary((await res.json()) as RawSummary);
  }
}
