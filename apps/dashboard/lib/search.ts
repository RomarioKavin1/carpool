/**
 * The ranked-versus-browse distinction, made structural.
 *
 * `GET /search` has two modes and CONTRACT.md is blunt about the difference
 * not being cosmetic:
 *
 * - given `q` or `vector`, the registry ranks through @carpool/tracker and
 *   serves `score`, `similarity` and `depth`;
 * - given neither, it serves every live artifact newest-first and OMITS those
 *   three, because nothing was ranked. "Do not read a browse as a search."
 *
 * So this module refuses to let the UI show a rank the server did not compute.
 * `rankingOf()` is the only function in the app allowed to read the three
 * ranking fields, and it returns `null` unless all three are finite numbers.
 * A component that wants a score has to handle null to get one.
 */
import type { SearchHit } from "./api";

export interface Ranking {
  score: number;
  similarity: number;
  depth: number;
}

/** The mode a result set is in. `browse` never carries a rank. */
export type SearchMode = "ranked" | "browse";

/**
 * The three ranking fields, or null if the registry did not send all three.
 *
 * All-or-nothing on purpose: a partial ranking would mean the registry changed
 * its response shape, and rendering two of three fields next to a blank would
 * read as "this artifact scored nothing" rather than "nobody scored anything".
 */
export function rankingOf(hit: SearchHit): Ranking | null {
  const { score, similarity, depth } = hit;
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  if (typeof similarity !== "number" || !Number.isFinite(similarity)) return null;
  if (typeof depth !== "number" || !Number.isFinite(depth)) return null;
  return { score, similarity, depth };
}

/**
 * Which mode a response is in, decided by the response itself rather than by
 * what the client asked for.
 *
 * Deciding it from the request ("I sent q, so this is ranked") is the bug this
 * avoids: a registry that changed its mind, fell back, or served a cached
 * browse would be presented as a ranking. An empty result set is a `browse` —
 * zero hits carry no evidence of ranking either way, and the empty state says
 * what was asked rather than claiming a mode.
 */
export function searchMode(hits: SearchHit[]): SearchMode {
  if (hits.length === 0) return "browse";
  return hits.every((h) => rankingOf(h) !== null) ? "ranked" : "browse";
}

/**
 * The score formula, as a string, for the UI to show beside the column. Kept
 * next to `rankingOf` so the two cannot drift: if the registry's formula
 * changes, both the number and this legend are wrong in the same file.
 *
 * Source: apps/registry/src/server.ts's GET /search doc comment and
 * CONTRACT.md — `similarity × freshness × (0.5 + 0.5 × depth)`.
 */
export const SCORE_FORMULA = "similarity × freshness × (0.5 + 0.5 × depth)";
