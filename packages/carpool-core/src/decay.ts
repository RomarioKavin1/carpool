import type { Manifest } from "./manifest.js";

const MS_PER_DAY = 86_400_000;

/**
 * The one decay term. Price, health, and the tracker's staleness filter all
 * read this value — none of them keep their own age math.
 *
 * Halves every `halfLifeDays` since `producedAt`. Always in (0,1]; clamped
 * at 1 for artifacts produced in the future (clock skew) rather than let the
 * exponent go negative and exceed 1.
 */
export function freshness(m: Pick<Manifest, "decay">, nowMs: number = Date.now()): number {
  const ageDays = Math.max(0, (nowMs - Date.parse(m.decay.producedAt)) / MS_PER_DAY);
  return Math.pow(0.5, ageDays / m.decay.halfLifeDays);
}

/**
 * floor + round(base * freshness), in integer µUSDC. Never below priceFloor
 * since freshness is in (0,1] and priceBase is non-negative.
 */
export function priceAt(
  a: { priceBase: number; priceFloor: number; decay: Manifest["decay"] },
  nowMs: number = Date.now(),
): number {
  return a.priceFloor + Math.round(a.priceBase * freshness({ decay: a.decay }, nowMs));
}

/** Expired once freshness drops below 3 half-lives (0.5^3 = 0.125). */
export function isExpired(m: Pick<Manifest, "decay">, nowMs: number = Date.now()): boolean {
  return freshness(m, nowMs) < 0.125;
}
