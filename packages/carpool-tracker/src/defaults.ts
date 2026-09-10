/**
 * Recommended defaults for `Manifest.decay.halfLifeDays`.
 *
 * `ManifestSchema` (`@carpool/core`) only enforces `halfLifeDays > 0` — it
 * has no opinion on what a *good* half-life is, and nothing stops an author
 * from declaring a multi-month one to keep a stale artifact priced near
 * `priceBase` indefinitely. The brief requires this package to make "short"
 * concrete rather than leave it as prose, so the numbers live here (not in
 * `@carpool/core`, which is product-agnostic) for the registry's publish
 * path and the MCP client that constructs a manifest to import.
 *
 * Both numbers come directly from Phase 0's own measurement
 * (`docs/PHASE0.md` §4), not a guess:
 *
 * - Median lag to a free substitute across 8 real events was **0.5 days**
 *   (mean 1.4 days) — half of an event's free competition already exists by
 *   the next morning. `DEFAULT_HALF_LIFE_DAYS` sits on that same order: at
 *   one half-life old (a day after production) a fresh artifact has decayed
 *   to half of `priceBase`, which is fast enough to concede that a same-day
 *   buyer is already choosing between this and a free brief, while a
 *   same-hour buyer still sees most of the value (freshness at 0.5 days is
 *   `0.5^0.5 ≈ 0.71`).
 * - Phase 0's own observation window was **14 days** — every artifact count
 *   and lag it reports is bounded by that window, and it explicitly notes a
 *   *second* wave of slower-moving coverage (law-firm alerts, framework
 *   retrospectives) landing at days 20-37, outside it. `MAX_HALF_LIFE_DAYS`
 *   is set to that same 14 days: this package has no evidence — Phase 0's
 *   or otherwise — to support pricing a half-life slower than the window it
 *   actually measured, so a publisher declaring one is pricing against a
 *   window nobody looked at, not against data.
 *
 * Neither constant is enforced by `ManifestSchema` (out of this package's
 * scope — that schema belongs to `@carpool/core`); they are exported here
 * for a publish path or MCP client to apply or validate against.
 */
export const DEFAULT_HALF_LIFE_DAYS = 1;
export const MAX_HALF_LIFE_DAYS = 14;
