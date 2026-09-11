/**
 * The seeding side: what an author has on the wire and what it has earned.
 *
 * ## This module used to compute the payout states. It no longer does.
 *
 * Until `GET /payouts` existed, three of the four payout states were inferred
 * here from `refundState` plus `ts + refundWindowSeconds` on the browser clock,
 * and the fourth — **settled** — was rendered as "not observable", because
 * `settled_batch_id` was served by nothing. A payment rail that cannot tell a
 * payee whether they have been paid is not a payment rail, and a dashboard for
 * a product whose claim is that authors get paid had a hole exactly where the
 * claim is.
 *
 * The registry now serves the rows. So:
 *
 * - `state` (`held | claimable | settled | voided`) is **read**, not derived. It
 *   comes off the payout row, computed on the registry's clock against
 *   `available_at`, `voided_at` and `settled_batch_id`.
 * - `amount` is **read**. No client re-runs `paid − trackerFee`; that
 *   arithmetic was wrong across a tracker-fee change and is now the registry's.
 * - `refundState` is **read** (`refunded | window | closed`), and `closed` is
 *   its own state with its own affordance: the window has expired without a
 *   refund, so the money is the author's and is no longer reversible. Treating
 *   `closed` as `window` would tell a seeder their earnings can still be taken
 *   back when they cannot.
 *
 * What this module still does: group artifacts by author, join purchases to
 * their `author_royalty` payout row by `authorRoyaltyPayoutId`, and total a
 * payee-scoped payout set. All of that is arithmetic over served facts.
 */
import type {
  ArtifactState,
  Batch,
  Payout,
  PayoutState,
  PurchaseState,
  RefundState,
  RegistryState,
} from "./api";

/**
 * This registry's author convention: `"<accountId>:<publicKeyHex>"`
 * (apps/registry/src/identity.ts). The protocol treats `manifest.author` as
 * opaque, so this can fail — and when it does, the raw string is kept and the
 * payout account is null rather than guessed at.
 *
 * The payout account is also the `?payee=` scope for `GET /payouts`, so an
 * author whose string does not parse has no payouts view. That is correct: we
 * would not know whose rows to ask for.
 */
export interface AuthorIdentity {
  raw: string;
  payoutAccount: string | null;
  publicKey: string | null;
}

export function parseAuthor(raw: string): AuthorIdentity {
  const at = raw.indexOf(":");
  if (at <= 0) return { raw, payoutAccount: null, publicKey: null };
  const account = raw.slice(0, at);
  const key = raw.slice(at + 1);
  const looksLikeAccount = /^\d+\.\d+\.\d+$/.test(account);
  const looksLikeHex = /^[0-9a-fA-F]{8,}$/.test(key);
  if (!looksLikeAccount || !looksLikeHex) return { raw, payoutAccount: null, publicKey: null };
  return { raw, payoutAccount: account, publicKey: key };
}

// ------------------------------------------------------------ refund states

export const REFUND_STATE_MEANING: Record<RefundState, string> = {
  window:
    "Inside the refund window. The buyer can still reverse this sale, and the author's royalty is held until the deadline passes.",
  closed:
    "The window expired without a refund. This sale is final — the royalty is the author's and no longer reversible.",
  refunded:
    "The buyer refunded inside the window. The royalty row was voided; the buyer got back what they paid minus the tracker fee, which is never returned.",
};

/** Seconds left before a purchase stops being reversible, or null once it is not. */
export function secondsUntilFinal(
  purchase: Pick<PurchaseState, "refundState" | "refundDeadline">,
  nowSeconds: number,
): number | null {
  if (purchase.refundState !== "window") return null;
  if (purchase.refundDeadline == null) return null;
  return Math.max(0, purchase.refundDeadline - nowSeconds);
}

// ----------------------------------------------------------------- payouts

export const PAYOUT_STATE_MEANING: Record<PayoutState, string> = {
  held: "Accrued, but inside its refund window: available_at is the refund deadline, so the buyer can still reverse it.",
  claimable: "Owed and no longer reversible. The next settlement epoch will pay it.",
  settled: "A settlement batch claimed it. The batch names the Hedera transaction that moved the money.",
  voided: "A refund reversed it. It will never be paid — shown rather than hidden, so a refunded sale does not look like a sale that never happened.",
};

/** `reason` values the rail writes. Only the first is the author's earnings. */
export const AUTHOR_ROYALTY = "author_royalty";

export interface PayoutTotals {
  held: number;
  claimable: number;
  settled: number;
  voided: number;
  /** held + claimable + settled — accrued and not reversed. */
  earned: number;
  /** claimable + settled — no longer reversible by anyone. */
  final: number;
  rows: number;
}

const EMPTY_TOTALS: PayoutTotals = {
  held: 0,
  claimable: 0,
  settled: 0,
  voided: 0,
  earned: 0,
  final: 0,
  rows: 0,
};

/**
 * Total a payee-scoped payout set, optionally narrowed to one `reason`.
 *
 * Amounts are summed straight off the rows: this never recomputes a royalty
 * from `paid − trackerFee`, which is the arithmetic that silently produced
 * wrong numbers whenever the operator changed the fee after artifacts were
 * already live at a price set under the old one.
 */
export function totalPayouts(payouts: Payout[], reason?: string): PayoutTotals {
  const rows = reason ? payouts.filter((p) => p.reason === reason) : payouts;
  const totals = { ...EMPTY_TOTALS, rows: rows.length };
  for (const row of rows) totals[row.state] += row.amount;
  totals.earned = totals.held + totals.claimable + totals.settled;
  totals.final = totals.claimable + totals.settled;
  return totals;
}

/** Index payouts by id, for joining a purchase to the royalty row it accrued. */
export function payoutsById(payouts: Payout[]): Map<number, Payout> {
  return new Map(payouts.map((p) => [p.id, p]));
}

/** Index batches by id, so a settled payout can name the transaction that paid it. */
export function batchesById(batches: Batch[]): Map<number, Batch> {
  return new Map(batches.map((b) => [b.id, b]));
}

/**
 * The batch that paid a payout, or null.
 *
 * Null covers three different situations and the UI must not collapse them: the
 * row is not settled, the batch list has not been fetched, or the batch exists
 * but its `txId` is still NULL because the transfer's id has not been recorded.
 * Only the last of those is "settled but no transaction to show yet".
 */
export function batchFor(payout: Payout | undefined, batches: Map<number, Batch>): Batch | null {
  if (!payout || payout.settledBatchId == null) return null;
  return batches.get(payout.settledBatchId) ?? null;
}

// ------------------------------------------------------------------ seeders

export interface SaleRow {
  purchase: PurchaseState;
  /**
   * The `author_royalty` payout row this sale accrued, joined by
   * `purchase.authorRoyaltyPayoutId`. Undefined when the payout set has not
   * been fetched, or when the sale belongs to a different payee than the one
   * scoped — never a substitute for a computed amount.
   */
  royalty: Payout | undefined;
}

export interface SeederArtifact {
  artifact: ArtifactState;
  sales: number;
  grossUusdc: number;
  refundedSales: number;
}

export interface Seeder {
  identity: AuthorIdentity;
  artifacts: SeederArtifact[];
  liveArtifacts: number;
  /** Withdrawn by their author. Distinct from expired — see artifactStatus. */
  withdrawnArtifacts: number;
  /** Manifest hashes that have been in a successful HCS anchor. */
  anchoredArtifacts: number;
  sales: number;
  /** Everything buyers paid for this author's artifacts, including refunded sales. */
  grossUusdc: number;
  refundedSales: number;
  /** Sales still inside their refund window, so still reversible. */
  reversibleSales: number;
  saleRows: SaleRow[];
}

/**
 * Group the whole registry by author, richest first.
 *
 * Grouping is on the RAW `manifest.author` string, not on the parsed account:
 * two manifests with the same account id and different public keys are two
 * different signing identities, and merging them would attribute one author's
 * earnings to another's key.
 *
 * `payouts` is the payee-scoped set for whichever seeder is open, so most
 * seeders join nothing. That is deliberate: this app only ever asks for one
 * payee's rows at a time, because the unscoped table is operator-gated.
 */
export function buildSeeders(state: RegistryState, payouts: Payout[] = []): Seeder[] {
  const byId = payoutsById(payouts);

  const purchasesByMagnet = new Map<string, PurchaseState[]>();
  for (const p of state.purchases) {
    const list = purchasesByMagnet.get(p.magnet);
    if (list) list.push(p);
    else purchasesByMagnet.set(p.magnet, [p]);
  }

  const byAuthor = new Map<string, ArtifactState[]>();
  for (const a of state.artifacts) {
    const list = byAuthor.get(a.manifest.author);
    if (list) list.push(a);
    else byAuthor.set(a.manifest.author, [a]);
  }

  const seeders: Seeder[] = [];
  for (const [author, artifacts] of byAuthor) {
    const rows: SaleRow[] = [];
    const seederArtifacts: SeederArtifact[] = [];

    for (const artifact of artifacts) {
      const purchases = purchasesByMagnet.get(artifact.manifest.magnet) ?? [];
      let gross = 0;
      let refunded = 0;
      for (const p of purchases) {
        gross += p.paid;
        if (p.refundState === "refunded") refunded += 1;
        rows.push({
          purchase: p,
          royalty: p.authorRoyaltyPayoutId == null ? undefined : byId.get(p.authorRoyaltyPayoutId),
        });
      }
      seederArtifacts.push({
        artifact,
        sales: purchases.length,
        grossUusdc: gross,
        refundedSales: refunded,
      });
    }

    seederArtifacts.sort((x, y) => y.grossUusdc - x.grossUusdc || y.sales - x.sales);

    seeders.push({
      identity: parseAuthor(author),
      artifacts: seederArtifacts,
      liveArtifacts: artifacts.filter((a) => a.live).length,
      withdrawnArtifacts: artifacts.filter((a) => a.delistedAt != null).length,
      anchoredArtifacts: artifacts.filter((a) => a.anchoredAt != null).length,
      sales: rows.length,
      grossUusdc: rows.reduce((s, r) => s + r.purchase.paid, 0),
      refundedSales: rows.filter((r) => r.purchase.refundState === "refunded").length,
      reversibleSales: rows.filter((r) => r.purchase.refundState === "window").length,
      saleRows: rows.sort((a, b) => b.purchase.ts - a.purchase.ts),
    });
  }

  // Ordered by what buyers actually paid. Royalty totals would be a better key
  // but they only exist for the one payee whose rows were fetched, so ordering
  // on them would reshuffle the list every time the selection changed.
  return seeders.sort(
    (x, y) => y.grossUusdc - x.grossUusdc || y.artifacts.length - x.artifacts.length,
  );
}

/** Find a seeder by payout account or raw author string. */
export function findSeeder(seeders: Seeder[], key: string | null): Seeder | null {
  if (!key) return null;
  return (
    seeders.find((s) => s.identity.raw === key) ??
    seeders.find((s) => s.identity.payoutAccount === key) ??
    null
  );
}
