/**
 * The proof, transcribed from committed evidence.
 *
 * ## Why this file exists
 *
 * `PRODUCT.md`'s fifth design principle: "the strongest thing this product can
 * show is a real transaction that paid a real author. That belongs in the open,
 * linked to a public explorer, not buried three panels deep." Nothing at runtime
 * can produce that. A registry running on a laptop with no credentials accrues
 * royalties and settles none of them, and the one time this system did move
 * money on Hedera testnet is a recorded historical fact, not a live read.
 *
 * So the top of the page quotes this: one purchase, one settlement, two
 * transaction ids anyone can open on HashScan, and a mirror-node response stored
 * verbatim in the repo saying the transfer reached the author's account.
 *
 * ## Why it is transcribed rather than imported
 *
 * Same reason as `lib/measured.ts`: a value-import of a file under
 * `docs/evidence/` would put a JSON blob in the browser bundle and, worse, would
 * make the app's module graph reach outside `apps/dashboard`. `evidence.test.ts`
 * buys the same guarantee without either cost — it reads the evidence JSON off
 * disk and fails if any figure below stops matching its source, comparing
 * **integers** rather than rendered dollars, because a four-decimal dollar
 * comparison already hid a wrong µUSDC charge in this repo for two commits.
 *
 * ## What this file must never grow
 *
 * A number that is not in one of the files named in `EVIDENCE_FILES`. Every
 * field below is checked at its labelled position by the test beside it.
 */

/** Where each figure below comes from. Named in the UI, not just here. */
export const EVIDENCE_FILES = {
  dir: "docs/evidence/v2-first-testnet-run/",
  manifest: "02-manifest.json",
  purchase: "05-purchase.json",
  settle: "09-settle-response.json",
  mirrorSettlement: "10-mirror-settlement-tx.json",
  payoutsAfter: "13-payouts-after-settle.json",
  verifier: "verify.py",
} as const;

/**
 * The one round trip where money reached an author, end to end, on a public
 * ledger.
 *
 * Date: 2026-09-12. Real Blocky402 facilitator, real `@hiero-ledger/sdk`, real
 * Hedera testnet, the registry's real ONNX embedder. Before this run v2 had
 * never moved a cent.
 */
export const SETTLED = {
  date: "2026-09-12",
  network: "hedera:testnet",
  /** The artifact that sold. A real research question, not a placeholder. */
  question:
    "Why does the Circle testnet faucet silently decline to mint USDC to a Hedera account with unlimited automatic token associations?",
  scope: "hedera-testnet-ops",
  magnet: "swarm:e38566220be6a9ddcbd11300bf3d16da6d41340a3dd7a6f94f16be3010b2bdf0",
  /** µUSDC the buyer paid at the x402 gate. */
  paidMicroUsdc: 110_000,
  /** µUSDC that actually moved to the author in the settlement transfer. */
  authorPaidMicroUsdc: 109_500,
  /** µUSDC the registry kept. Taken at the sale and never refunded. */
  trackerFeeMicroUsdc: 500,
  buyer: "0.0.10477413",
  author: "0.0.10475801",
  registry: "0.0.10475802",
  /** The x402 purchase. Payer is the facilitator's declared fee payer, not the buyer. */
  purchaseTxId: "0.0.7162784@1789202339.427560739",
  /** The settlement transfer that paid the author. This is the proof. */
  settlementTxId: "0.0.10475802@1789202482.460233839",
  /** HCS topic the epoch was anchored to, and the message sequence number. */
  anchorTopic: "0.0.10496824",
  anchorSeq: 1,
  batchId: 1,
} as const;

/**
 * What the settlement transfer does NOT establish, stated in the UI beside it.
 *
 * One sale is a working rail, not a market. The distinction matters here because
 * this repo has already retracted one measurement that was presented as more
 * than it was.
 */
export const SETTLED_LIMITS: readonly string[] = [
  "One sale, one author, one settlement. It shows the rail works end to end; it does not show demand.",
  "Testnet USDC, not money anyone can spend. The transfer, the fees and the consensus are real; the asset is a test token.",
  "The registry holds the buyer's payment and pays the author later, which is what makes the refund window possible and also what means a settlement is a second transaction rather than part of the first.",
  "Network fees were real HBAR and are not in the dollar figures above: 1,346,855 tinybar for the settlement transfer and the on-chain timestamp together.",
] as const;

/** A HashScan link for a transaction id. */
export function hashscanTx(txId: string): string {
  return `https://hashscan.io/testnet/transaction/${encodeURIComponent(txId)}`;
}

/** A HashScan link for an account. */
export function hashscanAccount(accountId: string): string {
  return `https://hashscan.io/testnet/account/${encodeURIComponent(accountId)}`;
}

/** A HashScan link for the HCS topic the epoch anchored to. */
export function hashscanTopic(topicId: string): string {
  return `https://hashscan.io/testnet/topic/${encodeURIComponent(topicId)}`;
}
