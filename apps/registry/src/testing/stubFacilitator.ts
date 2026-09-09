// Test-only support (excluded from the build — see tsconfig.json): the one stub
// x402 facilitator every registry test uses, and the one stub mirror node.
//
// ## Why this file exists rather than a copy per test file
//
// There were FOUR hand-written stub facilitators in this repo
// (`testing/harness.ts`, `server.test.ts`, `audit-onpaid-throw.test.ts`,
// `packages/hedera-x402/src/gate.test.ts`), each an independent guess at what
// Blocky402 does. A stub that is copied is a stub that drifts: the fix to one
// copy does not reach the other three, and every copy is another place where the
// suite can end up asserting the stub instead of the product. Three of the four
// are now this module; `gate.test.ts` cannot import it (wrong dependency
// direction — `packages/hedera-x402` must not depend on `apps/registry`) and
// carries a pointer here instead.
//
// ## What a stub facilitator must *not* do, and used to
//
// The facilitator is the one participant in a paid request that this repo cannot
// run locally, so it is the one place where a stub is unavoidable. That makes it
// the most dangerous double in the tree: every paid test in every package goes
// through it, and for most of this branch's life it answered
// `{ isValid: true }` and `{ success: true }` **without looking at the payload at
// all**. Consequences, all of them real:
//
//  - `apps/mcp/src/pay.ts` and `apps/bench/src/agent.ts` build a genuine signed
//    Hedera transfer through `@x402/hedera`. Nothing checked that they produced
//    anything: `payload: { signature: "stub" }` — a literal string — was accepted
//    exactly as readily as 8 signed transaction bodies. A regression that
//    stopped signing, signed for the wrong network, or named the wrong asset
//    would have left all 828 tests green and failed on the first real purchase.
//  - `gate.ts`'s own doc comment says the facilitator "compares
//    payload.accepted.amount and .payTo to the requirements by strict equality",
//    and that re-quoting on the paid retry is therefore the bug that breaks real
//    payments. Nothing enforced that equality, so the claim was asserted by no
//    test that could fail.
//
// So this stub checks the two things the real one checks that can be checked
// offline (see `StubFacilitatorControls`), and records every call so a test can
// assert on what the product actually sent.
//
// ## Where the shapes come from
//
// Captured, not guessed:
//
//  - `REAL_SUPPORTED` is `curl -sS https://api.testnet.blocky402.com/supported`,
//    run 2026-09-12. It advertises THREE networks and hedera is the **third** —
//    a single-kind stub cannot tell "selects by network" from "takes kinds[0]".
//  - The `/verify` and `/settle` request body shape
//    (`{ x402Version, paymentPayload, paymentRequirements }`) is
//    `HTTPFacilitatorClient` in `@x402/core@2.25.0`, confirmed by logging the
//    real request out of `apps/mcp/src/e2e.test.ts`.
//  - The `/settle` response shape and, importantly, the fact that `payer` is the
//    **buyer** while `transaction` belongs to the facilitator's **fee payer**,
//    are from the one real testnet purchase:
//    `docs/evidence/v2-first-testnet-run/05-purchase.json` (tx
//    `0.0.7162784@1789202339.427560739`) beside `19-ledger-rows.txt`
//    (`purchase.buyer = 0.0.10477413`). The stub's old defaults made those two
//    accounts the *same* (`0.0.2222` / `0.0.2222@1-1`), which is a coincidence
//    production never has — see `DEFAULT_PAYER` / `DEFAULT_TX_ID`.
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

export const listen = (a: Express): Promise<Server> =>
  new Promise((r) => {
    const s = a.listen(0, "127.0.0.1", () => r(s));
  });

export const portOf = (s: Server) => (s.address() as AddressInfo).port;

/**
 * `GET /supported`, verbatim from the real facilitator.
 *
 * ```
 * curl -sS https://api.testnet.blocky402.com/supported      # 2026-09-12
 * ```
 *
 * Kept verbatim on purpose. The hedera kind is third and there are two signer
 * families this repo never uses; a stub that served only the hedera kind agreed
 * with `@x402/core`'s scheme selection by construction, whichever way that
 * selection worked.
 */
export const REAL_SUPPORTED = {
  kinds: [
    { x402Version: 2, scheme: "exact", network: "eip155:80002" },
    {
      x402Version: 2,
      scheme: "exact",
      network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      extra: { feePayer: "7B6Q2MvcJvNcy1A13wHmAzmmdo3L8DVriaXML7bvkojm" },
    },
    { x402Version: 2, scheme: "exact", network: "hedera:testnet", extra: { feePayer: "0.0.7162784" } },
  ],
  extensions: [],
  signers: {
    "eip155:*": ["0xDCF7D72C2eE049DE4269ac6AAf925F33efdA18de"],
    "solana:*": ["7B6Q2MvcJvNcy1A13wHmAzmmdo3L8DVriaXML7bvkojm"],
    "hedera:*": ["0.0.7162784"],
  },
} as const;

/** The facilitator's fee payer on `hedera:testnet`, per `REAL_SUPPORTED`. */
export const FACILITATOR_FEE_PAYER = "0.0.7162784";

/**
 * The buyer, and the account `purchase.buyer` must end up as.
 *
 * Distinct from the account inside `DEFAULT_TX_ID` — see that constant.
 */
export const DEFAULT_PAYER = "0.0.2222";

/**
 * The settled transaction id.
 *
 * Its account is the facilitator's **fee payer**, not the buyer: Blocky402
 * declares `extra.feePayer` and submits the buyer's signed transfer itself, so
 * the transaction belongs to `0.0.7162784` while the money is the buyer's
 * (`docs/evidence/v2-first-testnet-run/README.md`, "The two transactions"). The
 * stub used to report `payer: "0.0.2222"` with `txId: "0.0.2222@1-1"`, making the
 * two agree — so any code that took the buyer from the transaction id would have
 * looked correct in every test and attributed every real purchase to the
 * facilitator.
 */
export const DEFAULT_TX_ID = `${FACILITATOR_FEE_PAYER}@1789202339.427560739`;

/** One `/verify` or `/settle` the stub was asked for. */
export interface StubFacilitatorCall {
  op: "verify" | "settle";
  /** Rejected with this reason, or null when the stub accepted the payload. */
  rejected: string | null;
  payload: Record<string, unknown>;
  requirements: Record<string, unknown>;
}

export interface StubFacilitatorControls {
  /** Reported as `payer`. Null exercises the gate's "no payer" branch. */
  payer: string | null;
  /** Reported as `transaction`. Empty exercises the M2 (no tx id) branch. */
  txId: string;
  /** Answer `/verify` with `isValid: false`. */
  verifyOk: boolean;
  /** Answer `/settle` with `success: false`. */
  settleOk: boolean;
  /**
   * Enforce `paymentPayload.accepted` ≡ `paymentRequirements` on scheme,
   * network, asset, amount and payTo — the strict equality the real facilitator
   * applies, and the invariant `PaymentGate` exists to preserve on the paid
   * retry (`gate.ts`, `PaymentGateOptions.resourceKey`). Default true. There is
   * no legitimate reason to turn this off; it is a switch so that a test which
   * *wants* to see a mismatch rejected can also see it accepted.
   */
  strictAccepted: boolean;
  /**
   * Require `paymentPayload.payload.transaction` to be base64 that decodes to at
   * least 64 bytes — i.e. a real signed Hedera transaction list, which is what
   * `@x402/hedera`'s client scheme produces and what the real facilitator
   * submits. Default true.
   *
   * A test that hand-rolls its `PAYMENT-SIGNATURE` header (to drive the gate's
   * replay bookkeeping rather than the client) must set this to false **and say
   * so**, because with it off this stub accepts a payload the real facilitator
   * would reject outright, and nothing in that test proves the product can pay.
   */
  requireSignedTransaction: boolean;
  /** Every call, oldest first. Assertable; reset by the test that wants to. */
  calls: StubFacilitatorCall[];
}

export function defaultFacilitatorControls(): StubFacilitatorControls {
  return {
    payer: DEFAULT_PAYER,
    txId: DEFAULT_TX_ID,
    verifyOk: true,
    settleOk: true,
    strictAccepted: true,
    requireSignedTransaction: true,
    calls: [],
  };
}

/** Fields the real facilitator compares by strict equality. */
const COMPARED = ["scheme", "network", "asset", "amount", "payTo"] as const;

/**
 * Why this payload would be refused, or null.
 *
 * Deliberately narrow: this is not a re-implementation of the facilitator (there
 * is no honest offline version of "does this signature authorise this transfer
 * on hedera:testnet"). It is the subset of the real one's refusals that can be
 * checked without a network, and every one of them was previously unchecked.
 */
export function refuseReason(
  payload: Record<string, any>,
  requirements: Record<string, any>,
  controls: Pick<StubFacilitatorControls, "strictAccepted" | "requireSignedTransaction">,
): string | null {
  if (controls.strictAccepted) {
    const accepted = payload?.accepted;
    if (!accepted || typeof accepted !== "object") {
      return "paymentPayload.accepted is missing: the facilitator has nothing to compare the requirements against";
    }
    for (const field of COMPARED) {
      if (requirements?.[field] === undefined) continue;
      if (String(accepted[field]) !== String(requirements[field])) {
        return (
          `paymentPayload.accepted.${field} is ${JSON.stringify(accepted[field])} but the ` +
          `requirements say ${JSON.stringify(requirements[field])} — the facilitator compares these ` +
          `by strict equality, so a re-quote on the paid retry is refused, not repriced`
        );
      }
    }
  }
  if (controls.requireSignedTransaction) {
    const tx = payload?.payload?.transaction;
    if (typeof tx !== "string" || tx === "") {
      return (
        "paymentPayload.payload.transaction is missing: the exact/hedera scheme sends a base64 " +
        "SignedTransaction list, and there is nothing here to submit"
      );
    }
    let bytes = 0;
    try {
      bytes = Buffer.from(tx, "base64").length;
    } catch {
      bytes = 0;
    }
    if (bytes < 64) {
      return `paymentPayload.payload.transaction decodes to ${bytes} byte(s); a signed Hedera transfer is not that small`;
    }
  }
  return null;
}

/**
 * Start the stub facilitator. Caller closes the returned server.
 *
 * `/supported` is the real response; `/verify` and `/settle` apply
 * `refuseReason` and then whatever `controls` say.
 */
export async function startStubFacilitator(
  controls: StubFacilitatorControls,
): Promise<{ server: Server; url: string }> {
  const fac = express();
  fac.use(express.json({ limit: "16mb" }));

  fac.get("/supported", (_req, res) => {
    res.json(REAL_SUPPORTED);
  });

  fac.post("/verify", (req, res) => {
    const payload = (req.body?.paymentPayload ?? {}) as Record<string, unknown>;
    const requirements = (req.body?.paymentRequirements ?? {}) as Record<string, unknown>;
    const rejected = refuseReason(payload, requirements, controls);
    controls.calls.push({ op: "verify", rejected, payload, requirements });
    if (rejected) {
      res.json({ isValid: false, invalidReason: `stub: ${rejected}` });
      return;
    }
    res.json(
      controls.verifyOk
        ? { isValid: true, payer: controls.payer }
        : { isValid: false, invalidReason: "stub: invalid" },
    );
  });

  fac.post("/settle", (req, res) => {
    const payload = (req.body?.paymentPayload ?? {}) as Record<string, unknown>;
    const requirements = (req.body?.paymentRequirements ?? {}) as Record<string, unknown>;
    const rejected = refuseReason(payload, requirements, controls);
    controls.calls.push({ op: "settle", rejected, payload, requirements });
    if (rejected) {
      res.json({
        success: false,
        errorReason: `stub: ${rejected}`,
        transaction: "",
        network: "hedera:testnet",
      });
      return;
    }
    res.json(
      controls.settleOk
        ? {
            success: true,
            payer: controls.payer,
            transaction: controls.txId,
            network: "hedera:testnet",
          }
        : {
            // A failed settlement can still carry a transaction id — which is
            // why `success` is the field that decides.
            success: false,
            errorReason: "stub: settle failed",
            transaction: controls.txId,
            network: "hedera:testnet",
          },
    );
  });

  const server = await listen(fac);
  return { server, url: `http://127.0.0.1:${portOf(server)}` };
}

/**
 * Start the stub mirror node.
 *
 * `GET /api/v1/accounts/:id` only — what `mirrorNodeKeyResolver` calls to check
 * that a refund request's public key controls the recorded `purchase.buyer`.
 * `keys` is mutable so a test can decide which accounts it knows about.
 *
 * What it is NOT:
 *
 *  - **Not the other endpoint.** `Settler.reconcile()` reads
 *    `GET /api/v1/transactions?account.id=…&limit=100&order=desc`, which this does
 *    not serve. Nothing routed through this harness has a pending batch at boot,
 *    so reconcile never fetches; `packages/hedera-x402/src/settler.test.ts` covers
 *    that endpoint with its own stub instead.
 *  - **Not the whole response.** The real one returns balances, `evm_address`,
 *    `max_automatic_token_associations`, a transaction page and paging links
 *    (`docs/evidence/v2-full-feature-run/40-unpayable-purchase.json`). Only
 *    `key.key` is read, so serving that subset is honest — but it means the
 *    resolver is never exercised against a **key list or threshold key**, where the
 *    real mirror node returns `_type: "ProtobufEncoded"` and a protobuf blob in
 *    `key.key`. The hex comparison then fails and the refund is refused, which
 *    fails closed; that behaviour is reasoned about here and asserted nowhere.
 */
export async function startStubMirror(
  keys: Record<string, string>,
): Promise<{ server: Server; url: string }> {
  const mir = express();
  mir.get("/api/v1/accounts/:id", (req, res) => {
    const key = keys[req.params.id!];
    if (!key) {
      res.status(404).json({});
      return;
    }
    res.json({ key: { key, _type: "ECDSA_SECP256K1" } });
  });
  const server = await listen(mir);
  return { server, url: `http://127.0.0.1:${portOf(server)}` };
}
