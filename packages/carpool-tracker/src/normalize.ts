import { normalizeQuestion } from "@carpool/core";

/**
 * Canonicalises a question for both indexing and exact-duplicate detection.
 *
 * The implementation moved to `@carpool/core`'s manifest.ts — next to the
 * `questionNorm` field it defines — and is re-exported here so this package's
 * API is unchanged. It had to move: `questionNorm` is inside the signed,
 * content-addressed manifest, so the registry must recompute it to reject a
 * hand-crafted one, and `apps/mcp` must produce it when publishing. Neither
 * can take a dependency on this package for a pure string function —
 * `./index.js` pulls better-sqlite3 + sqlite-vec, and `./embed.js` an ONNX
 * runtime — which is exactly why the MCP had grown a divergent copy.
 */
export { normalizeQuestion };

/** True when two questions normalise to the same string — the exact-duplicate check. */
export function isSameQuestion(a: string, b: string): boolean {
  return normalizeQuestion(a) === normalizeQuestion(b);
}

/**
 * The exact-duplicate check a publish path is expected to run before
 * minting a new artifact: does `question` normalise to the same string as
 * one already on file?
 *
 * Deliberately re-normalises each candidate's own `question` rather than
 * trusting a stored `questionNorm` — a publish endpoint that accepts
 * `questionNorm` from the author (as `apps/registry`'s does today) cannot
 * assume it was actually produced by `normalizeQuestion`, so comparing
 * stored `questionNorm` values directly would let a manifest with a
 * hand-crafted `questionNorm` dodge the duplicate check entirely. Comparing
 * freshly-normalised `question` strings on both sides doesn't have that
 * hole; it costs recomputing `normalizeQuestion` over `existing`, which is
 * O(1) work per candidate and never more than a handful of live artifacts
 * for the same `scope`.
 *
 * Returns the first match, or `undefined` if `question` is new. Near-
 * duplicates (same event, different phrasing) are the embedding index's
 * job, not this function's — this only catches the exact-normalised case.
 */
export function findDuplicateQuestion<M extends { question: string }>(
  question: string,
  existing: readonly M[],
): M | undefined {
  const norm = normalizeQuestion(question);
  return existing.find((m) => normalizeQuestion(m.question) === norm);
}
