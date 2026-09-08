/**
 * Composite health score for an artifact: freshness discounted by refunds,
 * scaled up as distinct buyers validate it.
 *
 * The 0.4 floor on the buyer term matters: a brand-new artifact with zero
 * buyers must not read as dead. Event-shaped demand exists precisely in the
 * first hours after an artifact is produced, before anyone has had time to
 * buy it — scoring it near zero then would bury exactly the artifacts the
 * tracker most needs to surface.
 *
 * ## Buyer ratings are deliberately NOT a term here
 *
 * `POST /rate` lets a buyer who paid say whether the artifact was worth what it
 * cost (`ratings.ts`). That signal is served **beside** this number, on
 * `/search`, `/manifest/:magnet` and `/state`, and is not folded into it. Three
 * reasons, stated here because this formula is documented in CONTRACT.md and
 * RESTRUCTURE §4 and is rendered in the dashboard with its terms shown, so
 * changing it silently is not available:
 *
 * 1. **A fourth factor would have to be a number, and at small n there isn't an
 *    honest one.** `ratings.ts` refuses to state even a *label* below three
 *    ratings. Multiplying freshness by a figure derived from one or two opinions
 *    would launder exactly the false precision the binary scale was chosen to
 *    avoid — and it would do it inside a value this project prints.
 * 2. **`refundRate` already carries the strongest negative signal, in money.** A
 *    buyer who took their money back is stronger evidence than a buyer who
 *    clicked "not worth it", and it is already the `(1 − refundRate)` term. A
 *    rating term would partly re-express it (which is also why a refunded
 *    purchase's rating is not counted at all — see `RegistryLedger.ratingsFor`).
 * 3. **Most rows would have no ratings.** `health` is computed for every
 *    artifact, including every artifact nobody has bought, over a decay window
 *    measured in days. A term that is a constant for most rows is not a signal;
 *    it is a way of making unrated artifacts look worse than they are, which is
 *    the same mistake the 0.4 buyer floor above exists to correct.
 *
 * So `health` keeps its three terms and its documented range of [0, 1], and a
 * client that wants to weigh ratings does it with the counts, which are served.
 */
export function health(a: {
  freshness: number;
  refundRate: number;
  distinctBuyers: number;
}): number {
  const buyerTerm = 0.4 + 0.6 * Math.min(1, a.distinctBuyers / 5);
  return a.freshness * (1 - a.refundRate) * buyerTerm;
}
