/**
 * The decay bar's arithmetic — readings OF numbers the registry computed, never
 * second opinions about them.
 *
 * ## There is no browser clock in this module any more
 *
 * It used to hold one: `timeToExpirySeconds` parsed `decay.producedAt` and
 * measured it against `Date.now()`, because the registry served no age. The
 * registry now serves **`ageDays` on `/state` as well as `/search`**, computed
 * on its own clock over the same table — so both surfaces print ages that
 * cannot contradict the freshness beside them, and the expiry estimate is a
 * subtraction between two server-clock quantities rather than a comparison
 * across two machines.
 *
 * `ageDaysFromManifest` is gone with it. Every path that needs an age now has
 * one served: the swarm table and the artifact panel read `/state.ageDays`, and
 * search results read `/search.ageDays`. Nothing left re-derives it.
 */
import type { Manifest } from "./api";

/**
 * `@carpool/core`'s `isExpired()` threshold: freshness below 0.5^3. Three
 * half-lives. Duplicated as a constant rather than imported because
 * @carpool/core's export surface drags better-sqlite3 and an ONNX runtime
 * into whatever imports it — wrong for a browser bundle. `decay.test.ts`
 * asserts this still matches the value in packages/carpool-core/src/decay.ts.
 */
export const EXPIRY_FRESHNESS = 0.125;

/** Freshness crosses the expiry threshold after this many half-lives. */
export const HALF_LIVES_TO_EXPIRY = 3;

/** Where the half-life boundaries fall on a linear freshness axis. */
export const HALF_LIFE_TICKS = [0.5, 0.25, EXPIRY_FRESHNESS] as const;

/**
 * How many half-lives this artifact has lived through, read off its freshness:
 * `freshness = 0.5^n`, so `n = -log2(freshness)`. This is the number the bar's
 * legend shows, and it is the honest unit for decay — days are not comparable
 * between a one-day and a thirty-day half-life, half-lives are.
 *
 * Read off freshness rather than off `ageDays / halfLifeDays` so the legend and
 * the bar's width are the same quantity: the two agree to floating-point noise
 * because the registry computes freshness from that very ratio, and reading the
 * bar's own number keeps them from ever disagreeing on screen.
 */
export function halfLivesElapsed(freshness: number): number {
  if (!(freshness > 0)) return Number.POSITIVE_INFINITY;
  return -Math.log2(Math.min(1, freshness));
}

/**
 * Days until freshness crosses `EXPIRY_FRESHNESS`, on the REGISTRY's clock.
 * Negative once past.
 *
 * Both inputs are server-side facts: `ageDays` is served with the row, and
 * `halfLifeDays` is inside the signed, content-addressed manifest and cannot
 * change. So this is an estimate about the future but not a guess about the
 * present, and it cannot drift from the price printed next to it.
 */
export function daysToExpiry(ageDays: number, halfLifeDays: number): number {
  return HALF_LIVES_TO_EXPIRY * halfLifeDays - ageDays;
}

export type DecayStage = "fresh" | "halved" | "dying" | "expired";

/**
 * Three named bands plus expired, so the bar can change intensity without a
 * continuous gradient nobody can read. The bands ARE the half-lives: above
 * one, above two, below two, past three. Strictly-less-than throughout,
 * matching core's `isExpired` — an artifact sitting exactly on a half-life has
 * not yet passed it.
 */
export function decayStage(freshness: number): DecayStage {
  if (freshness < EXPIRY_FRESHNESS) return "expired";
  if (freshness < 0.25) return "dying";
  if (freshness < 0.5) return "halved";
  return "fresh";
}

/**
 * What the price will be once freshness halves again — the decay made
 * forward-looking. Exact, because `priceAt()` is `floor + round(base × f)`
 * and halving f is the only thing that changes.
 */
export function priceAtFreshness(
  a: { priceBase: number; priceFloor: number },
  freshness: number,
): number {
  return a.priceFloor + Math.round(a.priceBase * Math.max(0, Math.min(1, freshness)));
}

/** The signed decay block, for components that only need the half-life. */
export type Decay = Manifest["decay"];
