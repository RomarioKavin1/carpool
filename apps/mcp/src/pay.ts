// Client construction is copied from apps/bench/src/agent.ts rather than
// re-derived: that file already resolved the two traps here — PrivateKey must
// come from @x402/hedera (not @hiero-ledger/sdk) so its SDK version matches
// createClientHederaSigner, and wrapFetchWithPayment takes no maxAmount, so the
// spend cap is a per-asset client spend control in atomic micro-USDC.
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { createHash } from "node:crypto";
import { RegistryClient } from "./client.js";
import { capMicroUsdc, maxBuyableRedoCostUsd } from "@carpool/core";

/**
 * Whether the delivered body was checked against a hash the buyer held
 * *before* paying, and against which one.
 *
 * Three states, not two, because "could not check" is not the same claim as
 * "checked and matched" and the tool output must not blur them. The previous
 * version compared against a response header the registry never set, so
 * `expected` was always null, the comparison never ran — and the tool printed
 * "(verified against the manifest)" regardless. A false security claim is worse
 * than an absent one.
 */
export type Verification =
  | { state: "verified"; source: "manifest"; bodyHash: string }
  | { state: "unverified"; reason: string };

export interface BuyResult {
  ok: boolean;
  body: string;
  paid: number;
  txId: string;
  verification: Verification;
  error?: string;
}

/**
 * Per-payment spend cap, µUSDC. From `pricing.ts`, which derives the default
 * from the default price rule rather than picking a number beside it: the two
 * shipped defaults used to be mutually exclusive (a 20,000 µUSDC cap against a
 * rule that priced 15% of the production cost, so nothing costing over $0.1333
 * to produce could be bought out of the box). The share is now 0.10 repo-wide, so
 * this default is 500,000 µUSDC = $0.50 — still the price of a $5 redo, read from
 * the buyer's end. `x402Client` wants it as a string.
 */
const MAX_PER_PAYMENT = String(capMicroUsdc());

/** The transaction id, decoded out of the x402 PAYMENT-RESPONSE header. */
function decodeTx(res: Response): string {
  const raw = res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("payment-response");
  if (!raw) return "";
  try {
    // Base64 JSON, not an id: reporting the raw header as the "Transaction:"
    // (as this used to) hands the agent a blob nothing can look up.
    return decodePaymentResponseHeader(raw).transaction ?? "";
  } catch {
    return "";
  }
}

/**
 * Buy one artifact.
 *
 * The expected `bodyHash` comes from the artifact's manifest, fetched free
 * before payment — the registry publishes manifests free precisely so a buyer
 * can fix its expectations before it spends. Verifying against that is strictly
 * stronger than verifying against a header on the paid response: the header
 * comes from the same server as the body, so a registry serving the wrong bytes
 * would send a header that matches them. A buyer who trusts a seller's own
 * integrity check has no integrity check.
 *
 * @param expectedBodyHash the manifest's `bodyHash` if the caller already has
 * it (e.g. straight from a `carpool_search` result). Omitted, the manifest is
 * fetched here.
 */
export async function payFetch(
  base: string,
  magnet: string,
  expectedBodyHash?: string,
): Promise<BuyResult> {
  const accountId = process.env.CARPOOL_BUYER_ACCOUNT_ID;
  const key = process.env.CARPOOL_BUYER_PRIVATE_KEY;
  const network = process.env.HEDERA_NETWORK ?? "hedera:testnet";
  const asset = process.env.USDC_TOKEN_ID ?? "0.0.429274";

  const unpaid = (error: string): BuyResult => ({
    ok: false,
    body: "",
    paid: 0,
    txId: "",
    verification: { state: "unverified", reason: "nothing was bought" },
    error,
  });

  if (!accountId || !key) {
    return unpaid(
      "no buyer credentials: set CARPOOL_BUYER_ACCOUNT_ID and CARPOOL_BUYER_PRIVATE_KEY. " +
        "carpool_search works without them; only buying needs a funded account.",
    );
  }

  // Fixed before payment. A failure here is reported rather than swallowed, and
  // it does not abort the purchase the user asked for — but it does mean the
  // result says plainly that nothing could be verified.
  let expected = expectedBodyHash ?? null;
  let expectedError: string | null = null;
  if (!expected) {
    try {
      const manifest = await new RegistryClient(base).manifest(magnet);
      if (!manifest) return unpaid("no such artifact (or it is delisted or expired)");
      expected = manifest.bodyHash;
    } catch (e) {
      expectedError = `could not fetch the manifest to verify against (${(e as Error).message})`;
    }
  }

  const url = `${base.replace(/\/$/, "")}/artifact/${encodeURIComponent(magnet)}`;

  // Peek unpaid to read the quoted price. PaymentGate replays the same issued
  // quote on the paid retry, so this is exactly what gets paid — the paid
  // response carries only a transaction id, not an amount.
  const probe = await fetch(url);
  if (probe.status === 404) return unpaid("no such artifact");
  if (probe.status === 410) return unpaid("artifact is delisted or expired");
  /**
   * Anything other than 402 here is the REGISTRY's problem, and the message has
   * to say so, because a buyer reading a bare status about a payment reasonably
   * concludes their own keys are wrong.
   *
   * The case that made this necessary: a registry started with an unreachable
   * `FACILITATOR_URL` answers `503 {"error":"facilitator unavailable: …"}` to
   * every artifact request. This line used to report that as
   * `unexpected status 503` and nothing else, so a new buyer following the
   * getting-started document went looking at their account, their key type and
   * their USDC balance, none of which could have been the cause: the registry,
   * not the buyer, chooses the facilitator.
   *
   * So the registry's own body is passed through, truncated, and the sentence
   * says which side of the exchange is broken. `text()` cannot throw here
   * (the body is already buffered by fetch), but it is guarded anyway so a
   * diagnostic can never become the failure it is describing.
   */
  if (probe.status !== 402) {
    let detail = "";
    try {
      detail = (await probe.text()).trim().replace(/\s+/g, " ").slice(0, 300);
    } catch {
      /* an unreadable body is still a reportable status */
    }
    return unpaid(
      `the registry answered ${probe.status} instead of quoting a price` +
        (detail ? `: ${detail}` : "") +
        ". Nothing was charged, and this is the registry's end rather than your credentials.",
    );
  }

  const quoted = (await probe.json()) as { accepts?: { amount?: string }[] };
  const paid = Number(quoted.accepts?.[0]?.amount ?? 0);

  const signer = createClientHederaSigner(accountId, PrivateKey.fromStringECDSA(key), { network });
  const client = x402Client.fromConfig({
    schemes: [{ network: network as never, client: new ExactHederaScheme(signer) }],
    spendControls: {
      allowedAssets: [
        { network: network as never, asset, maxAmountPerPayment: MAX_PER_PAYMENT },
      ],
    },
  });

  const paidFetch = wrapFetchWithPayment(fetch, client);
  let res: Response;
  try {
    res = await paidFetch(url);
  } catch (e) {
    // The spend control rejects client-side, before the request is sent, so
    // the reason never appears as an HTTP status. Name the quote and the cap
    // instead of reporting a bare failure.
    return {
      ...unpaid(
        `payment was not attempted (${(e as Error).message}). The quote was ${paid} µUSDC and this ` +
          `client's per-payment cap is ${MAX_PER_PAYMENT} µUSDC — raise CARPOOL_MAX_MICRO_USDC to buy it. ` +
          `At the default price rule that cap buys research costing up to ` +
          `$${maxBuyableRedoCostUsd(Number(MAX_PER_PAYMENT)).toFixed(2)} to produce.`,
      ),
      paid,
    };
  }
  if (!res.ok) {
    return { ...unpaid(`paid fetch → ${res.status}`), paid, txId: decodeTx(res) };
  }

  const body = await res.text();
  const txId = decodeTx(res);

  if (!expected) {
    return {
      ok: true,
      body,
      paid,
      txId,
      verification: {
        state: "unverified",
        reason: expectedError ?? "no manifest bodyHash was available to compare against",
      },
    };
  }

  const actual = createHash("sha256").update(body).digest("hex");
  if (actual !== expected) {
    return {
      ok: false,
      body: "",
      paid,
      txId,
      verification: { state: "unverified", reason: "the delivered body did not match the manifest" },
      error:
        `body hash mismatch: the manifest says ${expected.slice(0, 16)}… but the registry served ` +
        `${actual.slice(0, 16)}…. Paid, but the content is not what was sold — keep the ` +
        `transaction id and request a refund.`,
    };
  }

  return { ok: true, body, paid, txId, verification: { state: "verified", source: "manifest", bodyHash: expected } };
}
