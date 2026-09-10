/**
 * Everything the three tools actually say to the agent.
 *
 * Separate from server.ts because server.ts connects a stdio transport at
 * import time and so cannot be imported by a test — which is how the two
 * defects here shipped: `renderCandidate` called `.toFixed(1)` on a field the
 * registry never sent (a TypeError on every non-empty search), and the buy
 * summary printed "(verified against the manifest)" for a comparison that
 * never ran. Both are one-line assertions once the rendering is importable.
 */
import type { ManifestSummary } from "./client.js";
import type { BuyResult } from "./pay.js";
import { capMicroUsdc as readCapMicroUsdc } from "@carpool/core";

export function usd(micro: number): string {
  return `$${(micro / 1e6).toFixed(4)}`;
}

/**
 * The buyer's per-payment spend cap, from the one place it is decided
 * (`pricing.ts`, which derives it from the default price rule) so
 * `carpool_search` can flag a candidate `carpool_fetch` would refuse. The x402
 * spend control rejects client-side, before any request is sent, so without
 * this the agent sees a price, picks it, and gets an opaque failure.
 *
 * Re-exported rather than re-read: this used to hard-code `"20000"` and `pay.ts`
 * a second copy of the same literal, next to a price rule in `server.ts` that
 * could not produce anything under it.
 */
export const CAP_MICRO_USDC = readCapMicroUsdc();

/**
 * One block per candidate. The buying agent decides from this, so it carries
 * the evidence rather than only a score: what the author spent producing it,
 * how many sources they consulted, and how stale it is now.
 *
 * `match` is appended only when the registry actually ranked (a `vector` or a
 * `q` was sent): similarity is what the embedding thought, depth is how much
 * independent work the provenance represents, and their product with freshness
 * is the order. Shown rather than hidden so an agent can disagree with the
 * ranking instead of trusting position 1.
 */
export function renderCandidate(
  m: ManifestSummary,
  i: number,
  capMicroUsdc = CAP_MICRO_USDC,
): string {
  const p = m.provenance;
  const overCap = m.priceNow > capMicroUsdc;
  const match =
    m.similarity != null && m.score != null
      ? `   match: similarity ${m.similarity.toFixed(2)} · depth ${(m.depth ?? 0).toFixed(2)} · score ${m.score.toFixed(3)}`
      : null;
  return [
    `${i + 1}. ${m.question}`,
    `   ${m.magnet}`,
    `   price ${usd(m.priceNow)}${overCap ? ` — OVER your ${usd(capMicroUsdc)} spend cap; carpool_fetch will refuse it` : ""} · ${m.ageDays.toFixed(1)}d old · freshness ${m.freshness.toFixed(2)} · health ${m.health.toFixed(2)}`,
    ...(match ? [match] : []),
    `   cost to produce: ${p.model}, ${p.durationSeconds}s, ${p.inputTokens + p.outputTokens} tokens, ${p.toolCalls} tool calls, $${p.estimatedCostUsd.toFixed(2)}`,
    `   ${m.sources.length} sources: ${m.sources.slice(0, 3).map((s) => s.url).join(", ")}${m.sources.length > 3 ? " …" : ""}`,
    `   ${m.abstract.slice(0, 220)}${m.abstract.length > 220 ? "…" : ""}`,
  ].join("\n");
}

/**
 * The integrity line for a completed purchase.
 *
 * Derived from `result.verification`, never asserted: the only string that
 * claims a verification is the one reached when a comparison actually
 * succeeded, and the unverified branch says what could not be checked and what
 * the agent should do about it.
 */
export function renderIntegrity(result: BuyResult, digest: string): string {
  const short = `sha256 ${digest.slice(0, 16)}…`;
  if (result.verification.state === "verified") {
    return `${short} — verified: matches the bodyHash in the manifest read before paying`;
  }
  return (
    `${short} — NOT VERIFIED (${result.verification.reason}). ` +
    `Treat the content as unchecked: it was not compared against a hash fixed before payment.`
  );
}
