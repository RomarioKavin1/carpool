/**
 * The live half of the economics: what this registry has actually absorbed.
 *
 * The product's claim is that the same research stops being produced by people
 * who never knew about each other. The registry can observe exactly one side of
 * that — every sale is one agent that did not redo the work — and it knows what
 * the work cost only because the author SAID so, in
 * `manifest.provenance.{inputTokens,outputTokens,estimatedCostUsd}`.
 *
 * So every total here is `author-reported`, not measured, and the UI labels it
 * that way. That is not a hedge: the manifest's cost claim is the buyer's
 * evidence and is deliberately self-reported (see docs/AB-MEASUREMENT.md, "The
 * manifest's cost claim is still self-reported"). Presenting a sum of author
 * claims as a measured saving is exactly the move this project retracted once.
 *
 * Two things the registry cannot see, and this module refuses to estimate:
 *
 * - **Tokens the buyer's context absorbed.** That happens inside the buying
 *   agent. `carpool_fetch` writes a file precisely so the buyer chooses; the
 *   registry never learns what they read.
 * - **Research that was redone elsewhere instead of bought here.** The "drove
 *   alone" half of the thesis. No field anywhere observes demand that never
 *   became a purchase.
 */
import type { ArtifactState, PurchaseState, RegistryState } from "./api";

export const BUYER_TOKENS_UNOBSERVABLE =
  "How many tokens a buyer's context absorbed is decided inside the buying agent: " +
  "carpool_fetch writes the body to a file rather than returning it, so the registry " +
  "never learns whether it was read. The one measured figure for this is in the recorded " +
  "run below: 83 tokens for the receipt, 11,355 if the whole artifact is read.";

export const DROVE_ALONE_UNOBSERVABLE =
  "Nothing in /state or /events observes research that was redone elsewhere instead of " +
  "bought here. The registry sees purchases, not the duplicates it failed to prevent.";

export interface ReuseTotals {
  /** Sales matched to an artifact still in /state. */
  salesCounted: number;
  /** Sales whose artifact is gone from /state — counted, never attributed a cost. */
  salesUnmatched: number;
  refundedSales: number;
  /** Sales that were not refunded: one agent each that did not redo the work. */
  keptSales: number;
  /** µUSDC buyers paid on kept sales. */
  paidUusdc: number;
  /**
   * µUSDC buyers were actually out of pocket: kept sales in full, plus the
   * tracker fee on each refunded sale (a refund returns `paid − trackerFee`).
   * Null when `GET /.well-known/carpool` has not landed, because the fee is
   * this registry's configuration and not a constant.
   */
  netPaidUusdc: number | null;
  /** `provenance.inputTokens + outputTokens`, summed over kept sales. Author-reported. */
  authorClaimedTokens: number;
  /** `provenance.estimatedCostUsd`, summed over kept sales. Author-reported dollars. */
  authorClaimedUsd: number;
  /** Distinct artifacts with at least one kept sale. */
  artifactsSold: number;
  /** The artifact that has been reused most — the thesis, as one row. */
  mostReused: { magnet: string; question: string; sales: number } | null;
}

export function buildReuseTotals(
  state: RegistryState,
  opts: { trackerFeeMicroUsdc: number | null },
): ReuseTotals {
  const byMagnet = new Map<string, ArtifactState>();
  for (const a of state.artifacts) byMagnet.set(a.manifest.magnet, a);

  const keptByMagnet = new Map<string, number>();
  let salesCounted = 0;
  let salesUnmatched = 0;
  let refundedSales = 0;
  let keptSales = 0;
  let paidUusdc = 0;
  let authorClaimedTokens = 0;
  let authorClaimedUsd = 0;

  for (const p of state.purchases as PurchaseState[]) {
    const artifact = byMagnet.get(p.magnet);
    if (!artifact) {
      salesUnmatched += 1;
      if (p.refundState === "refunded") refundedSales += 1;
      continue;
    }
    salesCounted += 1;
    if (p.refundState === "refunded") {
      refundedSales += 1;
      continue;
    }
    keptSales += 1;
    paidUusdc += p.paid;
    keptByMagnet.set(p.magnet, (keptByMagnet.get(p.magnet) ?? 0) + 1);
    const prov = artifact.manifest.provenance;
    authorClaimedTokens += prov.inputTokens + prov.outputTokens;
    authorClaimedUsd += prov.estimatedCostUsd;
  }

  let mostReused: ReuseTotals["mostReused"] = null;
  for (const [magnet, sales] of keptByMagnet) {
    if (mostReused && sales <= mostReused.sales) continue;
    const a = byMagnet.get(magnet);
    if (a) mostReused = { magnet, question: a.manifest.question, sales };
  }

  const netPaidUusdc =
    opts.trackerFeeMicroUsdc === null
      ? null
      : paidUusdc + refundedSales * opts.trackerFeeMicroUsdc;

  return {
    salesCounted,
    salesUnmatched,
    refundedSales,
    keptSales,
    paidUusdc,
    netPaidUusdc,
    authorClaimedTokens,
    authorClaimedUsd,
    artifactsSold: keptByMagnet.size,
    mostReused,
  };
}

/**
 * The claim in one line, or null when there is nothing to claim yet.
 *
 * Deliberately NOT a ratio when either side is zero: a "∞× cheaper" reads as a
 * result and is an artefact of a divide. And the ratio is only offered when
 * both sides exist, with both operands printed beside it.
 */
export function claimedSavingUsd(t: ReuseTotals): { savedUsd: number; ratio: number | null } | null {
  if (t.keptSales === 0) return null;
  const paidUsd = t.paidUusdc / 1_000_000;
  const savedUsd = t.authorClaimedUsd - paidUsd;
  const ratio = paidUsd > 0 && t.authorClaimedUsd > 0 ? t.authorClaimedUsd / paidUsd : null;
  return { savedUsd, ratio };
}
