import { freshness, isExpired, type Manifest } from "@carpool/core";

/** A raw hit from `TrackerIndex.search` — similarity only, nothing else. */
export interface Hit {
  magnet: string;
  /** Cosine similarity in roughly [-1, 1]; higher is more similar. */
  score: number;
}

export interface Ranked {
  magnet: string;
  manifest: Manifest;
  /** Final ranking score: similarity * freshness * (0.5 + 0.5 * depth). */
  score: number;
  similarity: number;
  freshness: number;
  depth: number;
}

export interface RankOptions {
  /** Minimum cosine similarity to be considered at all. Bias toward precision — see README. */
  threshold: number;
  nowMs?: number;
}

/**
 * Normalises how much independent work a manifest represents, 0..1.
 *
 * Four provenance signals, each saturating at a generous ceiling (so a
 * merely-solid artifact isn't punished for not being maximal), averaged
 * unweighted since none of the four is a reliable-enough proxy on its own —
 * `outputTokens` rewards verbosity as much as substance, `toolCalls` rewards
 * an inefficient agent, `durationSeconds` rewards a slow one, and
 * `sources.length` rewards padding a bibliography. Averaging means gaming
 * one signal alone buys at most a quarter of the score.
 *
 * This exists because Phase 0 found similarity alone cannot distinguish a
 * three-paragraph brief from a sourced deep-dive on the same event — they
 * are, by embedding, nearly the same document. `depth` is what tells them
 * apart, and per the brief it must be exposed and tested on its own: two
 * artifacts with identical similarity and freshness must order by this.
 */
export function depth(m: Pick<Manifest, "provenance" | "sources">): number {
  const p = m.provenance;
  const outputTokens = Math.min(1, p.outputTokens / 4000);
  const durationSeconds = Math.min(1, p.durationSeconds / 1800); // 30 minutes
  const toolCalls = Math.min(1, p.toolCalls / 40);
  const sources = Math.min(1, m.sources.length / 10);
  return (outputTokens + durationSeconds + toolCalls + sources) / 4;
}

/**
 * Ranks search hits into buyable candidates.
 *
 * Filters by `hit.score >= opts.threshold` (the similarity cutoff — see
 * README for why this is tuned toward precision) and drops anything with
 * `freshness < 0.125` (three half-lives, `isExpired` from `@carpool/core`):
 * a stale artifact that matches perfectly is still a poor buy. Survivors are
 * scored `similarity * freshness * (0.5 + 0.5 * depth)` — the 0.5 floor on
 * the depth term means a shallow artifact is never worth *zero*, only worth
 * at most half of what an equally fresh, equally similar deep one is worth —
 * and ordered by that score, descending.
 *
 * `artifacts` need not cover every hit (a magnet the caller doesn't have a
 * manifest for is silently skipped, not an error) — the index and the
 * manifest store are allowed to disagree transiently.
 */
export function rank(hits: readonly Hit[], artifacts: readonly Manifest[], opts: RankOptions): Ranked[] {
  const nowMs = opts.nowMs ?? Date.now();
  const byMagnet = new Map(artifacts.map((a) => [a.magnet, a] as const));

  const out: Ranked[] = [];
  for (const hit of hits) {
    if (hit.score < opts.threshold) continue;
    const manifest = byMagnet.get(hit.magnet);
    if (!manifest) continue;
    if (isExpired(manifest, nowMs)) continue;

    const fresh = freshness(manifest, nowMs);
    const d = depth(manifest);
    const score = hit.score * fresh * (0.5 + 0.5 * d);
    out.push({ magnet: hit.magnet, manifest, score, similarity: hit.score, freshness: fresh, depth: d });
  }

  out.sort((a, b) => b.score - a.score);
  return out;
}
