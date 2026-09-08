/**
 * What a buyer's rating of an artifact is, and what may be said about a set of
 * them. The scale is a **binary judgement plus an optional reason**, and the
 * summary deliberately carries **no average, ratio or percentage at all**.
 *
 * ## Why binary, and not five stars
 *
 * Five stars is the reflex, and it is the wrong instrument for this data:
 *
 * 1. **The samples are tiny.** An artifact's price decays with a half-life
 *    measured in days and most artifacts will be bought a handful of times
 *    inside that window. A mean of one or two ordinal scores is noise with a
 *    decimal point on it, and this repository has already had to retract one
 *    number that looked more certain than it was (see CONTRACT.md's preamble,
 *    and PRODUCT.md's "every number says where it came from"). Serving `4.5`
 *    off two ratings is exactly that class of error.
 * 2. **Nobody agrees what three stars means.** Between raters the interval
 *    between two adjacent stars is not constant, so averaging them is arithmetic
 *    over a scale that does not support it. A binary answer to a *specific*
 *    question — "was this worth what you paid?" — is a judgement every rater
 *    makes the same way, and it is the only question the buyer of a
 *    priced-by-decay artifact is actually in a position to answer.
 * 3. **The graded negative signal already exists, in money.** `refundRate` is a
 *    buyer taking their money back inside the window; it is stronger evidence
 *    than any star count and it is already folded into `health`. A star scale
 *    would mostly re-express it, less reliably.
 * 4. **The free-text reason carries more per rating than a star does.** At
 *    n = 2, "not worth it — every source is the same blog post" tells a buying
 *    agent something actionable; "3.0 average" tells it nothing it can act on.
 *
 * So: `worth: true | false`, plus up to `MAX_RATING_REASON_CHARS` of prose.
 *
 * ## Why there is no average in the summary, structurally
 *
 * `summariseRatings` returns counts and a label. It has no `average`, `score`,
 * `stars`, `ratio` or `percent` field, and `ratings.test.ts` asserts that it never
 * grows one. A client that wants a percentage has to divide by `count`, which
 * means `count` is in its hand at the moment it decides whether the percentage
 * is worth printing — the count is impossible to ignore because it is the only
 * denominator available anywhere.
 *
 * `verdict` is the one aggregate opinion served, and it is `null` until
 * `MIN_RATINGS_FOR_VERDICT` ratings exist. It is a *label*, not a number, so it
 * cannot be rendered as false precision: three buyers who all said yes produce
 * `"worth"`, never `"100%"`.
 */

/**
 * Ratings below which no `verdict` is served at all.
 *
 * Three is the smallest sample where a majority is not one person's opinion
 * ("two out of three" has a dissenter; "one out of one" is an anecdote), and it
 * is deliberately a floor on *sample size* rather than a confidence interval:
 * an interval would be another number implying more than it knows.
 */
export const MIN_RATINGS_FOR_VERDICT = 3;

/**
 * Longest reason a rating may carry, in characters.
 *
 * Short on purpose. The reason is evidence for one buying decision, not a
 * review: it is served inline on every `GET /search` result, so the cap is also
 * what keeps a 100-result search from carrying 100 essays. The registry
 * **rejects** a longer one rather than truncating it — the buyer signs the exact
 * string that gets stored, so a silently truncated reason would be a stored
 * statement whose signature does not cover it.
 */
export const MAX_RATING_REASON_CHARS = 280;

/**
 * The only aggregate judgement the registry will state, and only with
 * `MIN_RATINGS_FOR_VERDICT` ratings behind it.
 *
 * Kebab-case on the wire because it is a wire value, and three-valued because
 * "the buyers disagree" is a real and useful answer that a single number hides.
 */
export type RatingVerdict = "worth" | "mixed" | "not-worth";

/** Counts, and the label they can support. No averages — see this module's header. */
export interface RatingSummary {
  /** Ratings that count. Every other field is relative to this one. */
  count: number;
  worth: number;
  notWorth: number;
  /** `null` below `MIN_RATINGS_FOR_VERDICT` — the honest answer at n < 3. */
  verdict: RatingVerdict | null;
}

/**
 * Two thirds. A verdict is served when the raters are at least 2:1 one way;
 * anything closer is `"mixed"`, which is what a split sample actually is.
 *
 * Expressed as a fraction of the count rather than as a margin so that it does
 * not shift with sample size — at n = 3 it takes 2 of 3, at n = 9 it takes 6 of 9.
 */
const VERDICT_SHARE = 2 / 3;

/**
 * Summarise a set of ratings. Pure: the caller supplies the two counts it read
 * out of real rows, and gets back exactly what may be said about them.
 *
 * Negative or non-integer inputs throw rather than being coerced. A count is a
 * number of rows; if a caller has produced a fractional one it has computed
 * something else, and quietly rounding it would put an invented figure on a
 * surface whose whole purpose is that its figures are countable.
 */
export function summariseRatings(input: { worth: number; notWorth: number }): RatingSummary {
  for (const [name, n] of Object.entries(input)) {
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`${name} must be a non-negative integer count of rating rows, got ${n}`);
    }
  }
  const count = input.worth + input.notWorth;
  return {
    count,
    worth: input.worth,
    notWorth: input.notWorth,
    verdict: verdictFor(input.worth, count),
  };
}

function verdictFor(worth: number, count: number): RatingVerdict | null {
  if (count < MIN_RATINGS_FOR_VERDICT) return null;
  const share = worth / count;
  if (share >= VERDICT_SHARE) return "worth";
  if (share <= 1 - VERDICT_SHARE) return "not-worth";
  return "mixed";
}
