// One x402 buyer: pays the registry per artifact, records what it paid, what
// it got, and how long it took.
//
// Ported from apps/fleet/src/agent.ts. Fleet's buyer paid a v1 provider that
// sold cached API responses (role/n/ageSeconds headers, no manifest). The
// registry sells research artifacts instead: no role/n quote header, no
// per-request "quote" endpoint at all — the price is whatever the 402 body's
// `accepts[0].amount` says, and what a buyer gets back is the artifact body
// plus the manifest it already saw for free via GET /search.
//
// PrivateKey re-exported from @x402/hedera so its SDK version matches
// createClientHederaSigner (avoids the dual @hiero-ledger/sdk type clash).
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import {
  wrapFetchWithPayment,
  x402Client,
  decodePaymentResponseHeader,
} from "@x402/fetch";
import { DEFAULT_CAP_MICRO_USDC, USDC_TOKEN_ID_TESTNET } from "@carpool/core";

export interface Account {
  id: string;
  key: string;
}

// Per-request spend cap. In @x402/fetch@2.25.0 wrapFetchWithPayment has NO
// maxAmount arg (2 params only) — the cap is a client spend control, applied
// per-asset in atomic µUSDC units. That mechanism was kept from fleet unchanged;
// the *number* was not, because fleet's 2¢ (20,000 µUSDC) was inherited into a
// v2 whose default price rule then asked 15% of what the research cost to
// produce. The two never met: 20,000 / 0.15 / 1e6 = $0.1333, so this load driver
// could not buy anything that cost more than thirteen cents to produce, and
// neither could `apps/mcp`. The cap now comes from @carpool/core, where it is
// derived from that same price share — see packages/carpool-core/src/pricing.ts.
// The share has since been resolved to 0.10 (AUDIT-CLAIMS M4), so this is
// 500,000 µUSDC; it moves with the share by construction, never beside it.
export const MAX_AMOUNT_MICRO = DEFAULT_CAP_MICRO_USDC;

/** Build a payment-wrapped fetch bound to one funded Hedera account. */
export function makePayFetch(
  acct: Account,
  network: string,
  maxAmountMicro: number = MAX_AMOUNT_MICRO,
) {
  const signer = createClientHederaSigner(
    acct.id,
    PrivateKey.fromStringECDSA(acct.key),
    { network },
  );
  const client = x402Client.fromConfig({
    schemes: [{ network: network as any, client: new ExactHederaScheme(signer) }],
    spendControls: {
      allowedAssets: [
        {
          network: network as any,
          asset: USDC_TOKEN_ID_TESTNET,
          maxAmountPerPayment: String(maxAmountMicro),
        },
      ],
    },
  });
  return wrapFetchWithPayment(fetch, client);
}

function decodeTx(res: Response): string | null {
  const h =
    res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("payment-response");
  if (!h) return null;
  try {
    return decodePaymentResponseHeader(h).transaction ?? null;
  } catch {
    return null;
  }
}

/** What a buyer knows about one artifact before paying — from GET /search. */
export interface CatalogItem {
  magnet: string;
  priceNow: number;
  provenance: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
}

/**
 * One purchase attempt's full record. This is the unit Task H's A/B
 * measurement is built from: `priceMicroUsdc` is what buying cost,
 * `estimatedCostUsd` (carried over from the artifact's own manifest) is what
 * redoing the research to produce it cost its author — the two sides of the
 * comparison — and `latencyMs`/tokens make it possible to compare on more
 * than just money.
 */
export interface BuyLogLine {
  ts: number;
  buyer: string;
  magnet: string;
  /** HTTP status of the final attempt: 200 bought, 404/410 nothing to buy, -1 client-side error (e.g. spend cap). */
  status: number;
  priceMicroUsdc: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  tx: string | null;
  error?: string;
}

/**
 * Buy one artifact. Peeks the resource unpaid first purely to read the exact
 * quoted price: `PaymentGate` replays that same issued quote on the paid
 * retry (see hedera-x402/gate.ts), so this is exactly what `payFetch` below
 * ends up paying — the paid response itself carries no amount, only a tx id.
 * The peek is a second request against the registry; acceptable overhead for
 * a load/measurement tool, not something a real single-shot buyer would do.
 */
export async function buyArtifact(
  payFetch: ReturnType<typeof makePayFetch>,
  buyer: string,
  item: CatalogItem,
  base: string,
): Promise<BuyLogLine> {
  const url = `${base.replace(/\/$/, "")}/artifact/${item.magnet}`;
  const line: BuyLogLine = {
    ts: Date.now(),
    buyer,
    magnet: item.magnet,
    status: 0,
    priceMicroUsdc: 0,
    latencyMs: 0,
    inputTokens: item.provenance?.inputTokens ?? 0,
    outputTokens: item.provenance?.outputTokens ?? 0,
    estimatedCostUsd: item.provenance?.estimatedCostUsd ?? 0,
    tx: null,
  };
  const start = Date.now();
  try {
    const probe = await fetch(url);
    if (probe.status !== 402) {
      // Not found, gone, or some other error before payment was ever
      // possible — nothing to pay for, nothing further to do.
      line.status = probe.status;
      line.latencyMs = Date.now() - start;
      return line;
    }
    const quoted: any = await probe.json().catch(() => null);
    const amount = quoted?.accepts?.[0]?.amount;
    if (amount != null) line.priceMicroUsdc = Number(amount);

    const res = await payFetch(url);
    line.status = res.status;
    line.tx = decodeTx(res);
  } catch (e) {
    line.status = -1;
    line.error = (e as Error).message;
  }
  line.latencyMs = Date.now() - start;
  return line;
}
