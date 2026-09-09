import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PaymentGate, type GateOutcome, type PaidContext } from "./gate.js";

const listen = (app: express.Express): Promise<Server> =>
  new Promise((r) => {
    const s = app.listen(0, () => r(s));
  });
const port = (s: Server) => (s.address() as AddressInfo).port;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8").toString("base64");

/**
 * The one refusal a stub facilitator can honestly reproduce offline: the real
 * one compares `paymentPayload.accepted` to `paymentRequirements` by strict
 * equality, which is precisely why `PaymentGate` must replay its issued quote
 * instead of re-pricing (see `PaymentGateOptions.resourceKey`). Nothing used to
 * check it, so the claim in that comment was asserted by no test that could fail.
 *
 * The registry's copy of this, with the same fields and the same reasoning, is
 * `apps/registry/src/testing/stubFacilitator.ts`; this package cannot import it
 * (apps must not be a dependency of packages) so the two are kept in step by
 * hand — there is a pointer in each.
 *
 * It deliberately does NOT check that `payload.transaction` is a signed Hedera
 * transaction: every test here hand-rolls its `PAYMENT-SIGNATURE` header because
 * what it is exercising is the gate's replay bookkeeping, not a client's
 * signing. The check that a shipped client produces a submittable payload lives
 * where a shipped client runs: `apps/mcp/src/e2e.test.ts`.
 */
function mismatch(body: any): string | null {
  const accepted = body?.paymentPayload?.accepted;
  const reqs = body?.paymentRequirements;
  if (!accepted || typeof accepted !== "object") return "paymentPayload.accepted is missing";
  for (const field of ["scheme", "network", "asset", "amount", "payTo"]) {
    if (reqs?.[field] === undefined) continue;
    if (String(accepted[field]) !== String(reqs[field])) {
      return `accepted.${field} is ${JSON.stringify(accepted[field])}, requirements say ${JSON.stringify(reqs[field])}`;
    }
  }
  return null;
}

/**
 * Ported from carpool-express/src/quotebinding.test.ts — the guard against the
 * regression that breaks real payments: re-quoting on the paid retry.
 *
 * The facilitator compares payload.accepted.amount and .payTo to the
 * requirements by strict equality. If the middleware re-prices on the retry and
 * the price has moved, verification fails and the agent errors — under any
 * concurrency, most of a fleet.
 *
 * ## The `/settle` route, and why it is the point of this file now
 *
 * The stub facilitator here used to have **one** handler — `/verify`, returning
 * `isValid: false` unconditionally — so `PaymentGate.handle()` could never get
 * past its verify check and every line after it was dead in test. `paidCtx` was
 * assigned and never asserted. Four semantic mutations survived a green suite on
 * that one gap (docs/AUDIT-TESTS.md): dropping the `!s.success` check so the gate
 * serves goods on a *failed* settlement, `payer ?? "unknown"` inventing a buyer,
 * `paid: 0` recording every sale as free, and silencing the `LEDGER WRITE LOST`
 * alarm. The facilitator below settles, and the tests after it assert the
 * success path — including what the gate reports when the payment succeeded and
 * the *recording* did not, which is the whole of docs/AUDIT-MONEY.md H1.
 */
describe("PaymentGate", () => {
  let facilitator: Server, app: Server, base: string;
  let price = 10_000;
  let payTo = "0.0.1111";
  let ledgerDown = false;
  let quoteCalls = 0;
  let lastVerified: unknown;
  let lastSettled: unknown;

  /** Mutable stub-facilitator behaviour, read per request. */
  const fac = {
    verifyOk: true,
    settleOk: true,
    payer: "0.0.2222" as string | null,
    transaction: "0.0.2222@1690000000.000000001",
  };

  /** What the gate handed `onPaid`, and what it did with a throw. */
  let paidCtx: PaidContext | null = null;
  let onPaidThrows: string | null = null;
  let oweResult: boolean | null = null;
  let oweCalls: { op: string; txId: string; paid: number; payer: string | null; reason: string }[] = [];
  let lastOutcome: GateOutcome | null = null;

  beforeAll(async () => {
    const f = express();
    f.use(express.json());
    // The real facilitator's response, verbatim:
    //   curl -sS https://api.testnet.blocky402.com/supported   # 2026-09-12
    // Three networks, and hedera is the THIRD. The single-kind version this
    // replaced could not tell "selects the kind matching the configured network"
    // from "takes kinds[0]" — they are the same answer when there is one kind.
    // Kept in step with `apps/registry/src/testing/stubFacilitator.ts`'s
    // REAL_SUPPORTED, which this package cannot import (apps must not be a
    // dependency of packages).
    f.get("/supported", (_req, res) => {
      res.json({
        kinds: [
          { x402Version: 2, scheme: "exact", network: "eip155:80002" },
          {
            x402Version: 2,
            scheme: "exact",
            network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
            extra: { feePayer: "7B6Q2MvcJvNcy1A13wHmAzmmdo3L8DVriaXML7bvkojm" },
          },
          {
            x402Version: 2,
            scheme: "exact",
            network: "hedera:testnet",
            extra: { feePayer: "0.0.7162784" },
          },
        ],
        extensions: [],
        signers: {
          "eip155:*": ["0xDCF7D72C2eE049DE4269ac6AAf925F33efdA18de"],
          "solana:*": ["7B6Q2MvcJvNcy1A13wHmAzmmdo3L8DVriaXML7bvkojm"],
          "hedera:*": ["0.0.7162784"],
        },
      });
    });
    f.post("/verify", (req, res) => {
      lastVerified = req.body?.paymentRequirements ?? req.body?.requirements ?? req.body;
      const bad = mismatch(req.body);
      if (bad) {
        res.json({ isValid: false, invalidReason: `stub facilitator: ${bad}` });
        return;
      }
      res.json(
        fac.verifyOk
          ? { isValid: true, payer: fac.payer }
          : { isValid: false, invalidReason: "stub facilitator" },
      );
    });
    f.post("/settle", (req, res) => {
      lastSettled = req.body?.paymentRequirements ?? req.body?.requirements ?? req.body;
      const bad = mismatch(req.body);
      if (bad) {
        res.json({ success: false, errorReason: `stub facilitator: ${bad}`, transaction: "", network: "hedera:testnet" });
        return;
      }
      res.json(
        fac.settleOk
          ? {
              success: true,
              payer: fac.payer,
              transaction: fac.transaction,
              network: "hedera:testnet",
            }
          : {
              success: false,
              errorReason: "stub: settlement failed on chain",
              // A failed settlement can still carry a transaction id — which is
              // exactly why `success` is the field that decides.
              transaction: fac.transaction,
              network: "hedera:testnet",
            },
      );
    });
    facilitator = await listen(f);

    const gate = new PaymentGate({
      facilitatorUrl: `http://127.0.0.1:${port(facilitator)}`,
      network: "hedera:testnet",
      asset: "0.0.429274",
      resourceKey: (req) => String(req.query.k ?? "k1"),
      async quote() {
        quoteCalls++;
        if (ledgerDown) throw new Error("ledger unavailable");
        return { priceUnits: price, payTo, meta: { note: "hi" } };
      },
      async onPaid(ctx) {
        paidCtx = ctx;
        if (onPaidThrows) throw new Error(onPaidThrows);
      },
      owe(op, ctx, reason) {
        if (oweResult === null) return false;
        oweCalls.push({ op, txId: ctx.txId, paid: ctx.paid, payer: ctx.payer, reason });
        return oweResult;
      },
    });

    const server = express();
    server.get("/thing", async (req, res) => {
      const out = await gate.handle(req, res);
      lastOutcome = out;
      // The caller's contract: `kind: "paid"` is not enough to serve the goods.
      // A settled-but-unrecorded payment that is at least durable is served (the
      // buyer's money moved), one with no record anywhere is not.
      if (out.kind !== "paid") return;
      if (!out.recorded && !out.durable) {
        res.status(502).json({ error: "settled but unrecorded", txId: out.ctx.txId });
        return;
      }
      res.json({ ok: true, goods: "the body", txId: out.ctx.txId });
    });
    app = await listen(server);
    base = `http://127.0.0.1:${port(app)}`;
  });

  afterAll(() => {
    facilitator.close();
    app.close();
  });

  afterEach(() => {
    fac.verifyOk = true;
    fac.settleOk = true;
    fac.payer = "0.0.2222";
    fac.transaction = "0.0.2222@1690000000.000000001";
    paidCtx = null;
    lastOutcome = null;
    onPaidThrows = null;
    oweResult = null;
    oweCalls = [];
    vi.restoreAllMocks();
  });

  /** Issue a 402, then pay it back with the requirements it issued. */
  async function pay(key: string): Promise<{ status: number; body: any }> {
    const first = await fetch(`${base}/thing?k=${key}`);
    expect(first.status).toBe(402);
    const accepted = ((await first.json()) as any).accepts[0];
    const res = await fetch(`${base}/thing?k=${key}`, {
      headers: {
        "PAYMENT-SIGNATURE": b64({
          x402Version: 2,
          scheme: "exact",
          network: "hedera:testnet",
          accepted,
          payload: { signature: "stub" },
        }),
      },
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  it("issues a 402 quoting the price", async () => {
    const r = await fetch(`${base}/thing?k=a`);
    expect(r.status).toBe(402);
    const b = (await r.json()) as {
      accepts: Array<{ amount: string; payTo: string; network: string; extra?: { feePayer?: string } }>;
    };
    expect(b.accepts[0]!.amount).toBe("10000");
    expect(b.accepts[0]!.payTo).toBe("0.0.1111");
    // Selected by network out of the real three-kind /supported response above,
    // where hedera is third. A positional pick would take eip155 (which carries
    // no feePayer at all) or solana's.
    expect(b.accepts[0]!.network).toBe("hedera:testnet");
    expect(b.accepts[0]!.extra?.feePayer).toBe("0.0.7162784");
  });

  it("does not re-quote on the paid retry — proved by removing the quote source", async () => {
    const first = await fetch(`${base}/thing?k=b`);
    const accepted = ((await first.json()) as any).accepts[0];

    ledgerDown = true;
    fac.verifyOk = false;
    try {
      const retry = await fetch(`${base}/thing?k=b`, {
        headers: {
          "PAYMENT-SIGNATURE": b64({
            x402Version: 2,
            scheme: "exact",
            network: "hedera:testnet",
            accepted,
            payload: { signature: "stub" },
          }),
        },
      });
      const body = (await retry.json()) as { error?: string };
      expect(retry.status).not.toBe(502);
      expect(body.error ?? "").not.toContain("ledger unavailable");
      expect(body.error ?? "").toContain("stub facilitator");
    } finally {
      ledgerDown = false;
    }
  });

  it("verifies against the issued requirements after the price moves", async () => {
    const first = await fetch(`${base}/thing?k=c`);
    const accepted = ((await first.json()) as any).accepts[0];

    price = 4_000;
    payTo = "0.0.2222";
    try {
      await fetch(`${base}/thing?k=c`, {
        headers: {
          "PAYMENT-SIGNATURE": b64({
            x402Version: 2,
            scheme: "exact",
            network: "hedera:testnet",
            accepted,
            payload: { signature: "stub" },
          }),
        },
      });
      const seen = JSON.stringify(lastVerified ?? {});
      expect(seen, "must verify against the requirements it issued").toContain('"amount":"10000"');
      expect(seen).toContain('"payTo":"0.0.1111"');
      expect(seen).not.toContain('"amount":"4000"');
      // …and settle against the same object, not a fresh quote either.
      const settled = JSON.stringify(lastSettled ?? {});
      expect(settled).toContain('"amount":"10000"');
      expect(settled).toContain('"payTo":"0.0.1111"');
      expect(settled).not.toContain('"amount":"4000"');
    } finally {
      price = 10_000;
      payTo = "0.0.1111";
    }
  });

  it("re-quotes when the signature names an amount never issued", async () => {
    const r = await fetch(`${base}/thing?k=d`, {
      headers: {
        "PAYMENT-SIGNATURE": b64({
          x402Version: 2,
          scheme: "exact",
          network: "hedera:testnet",
          accepted: { amount: "1", payTo: "0.0.9999" },
          payload: { signature: "stub" },
        }),
      },
    });
    expect(r.status).toBe(402);
    expect(((await r.json()) as any).error ?? "").toContain("quote expired or not recognised");
  });

  it("resourceKey is consulted once per request and never re-priced on replay", async () => {
    const before = quoteCalls;
    const first = await fetch(`${base}/thing?k=e`);
    const accepted = ((await first.json()) as any).accepts[0];
    expect(quoteCalls).toBe(before + 1);

    await fetch(`${base}/thing?k=e`, {
      headers: {
        "PAYMENT-SIGNATURE": b64({
          x402Version: 2,
          scheme: "exact",
          network: "hedera:testnet",
          accepted,
          payload: { signature: "stub" },
        }),
      },
    });
    expect(quoteCalls, "the replay path must not call quote()").toBe(before + 1);
  });

  it("404s and 410s without building requirements", async () => {
    const gone = new PaymentGate({
      facilitatorUrl: "http://127.0.0.1:1",
      network: "hedera:testnet",
      asset: "0.0.429274",
      resourceKey: () => "x",
      async quote(req) {
        return String(req.query.mode) === "gone" ? { gone: true } : { notFound: true };
      },
      async onPaid() {},
    });
    const s = express();
    s.get("/t", async (req, res) => {
      await gone.handle(req, res);
    });
    const srv = await listen(s);
    const b = `http://127.0.0.1:${port(srv)}`;
    expect((await fetch(`${b}/t?mode=nf`)).status).toBe(404);
    expect((await fetch(`${b}/t?mode=gone`)).status).toBe(410);
    srv.close();
  });

  // -------------------------------------------------------- the settled path

  describe("a settlement that succeeds", () => {
    it("serves the goods and hands onPaid the payment as issued and as settled", async () => {
      const { status, body } = await pay("paid-ok");
      expect(status).toBe(200);
      expect(body).toMatchObject({ ok: true, goods: "the body" });

      // The exact object the product's ledger writes its purchase row from. Every
      // field here was unasserted, which is how `payer ?? "unknown"` and
      // `paid: 0` both survived a green suite.
      expect(paidCtx).not.toBeNull();
      expect(paidCtx!.resourceKey).toBe("paid-ok");
      expect(paidCtx!.payer, "the account the facilitator identified").toBe("0.0.2222");
      expect(paidCtx!.txId).toBe("0.0.2222@1690000000.000000001");
      expect(paidCtx!.paid, "the price ISSUED in the 402, in µUSDC — never 0").toBe(10_000);
      expect(paidCtx!.meta).toEqual({ note: "hi" });
      expect(paidCtx!.settle).toMatchObject({ success: true, network: "hedera:testnet" });

      expect(lastOutcome).toMatchObject({ kind: "paid", recorded: true, durable: true });
    });

    it("echoes the settlement in PAYMENT-RESPONSE so a client can find the transaction", async () => {
      const first = await fetch(`${base}/thing?k=hdr`);
      const accepted = ((await first.json()) as any).accepts[0];
      const res = await fetch(`${base}/thing?k=hdr`, {
        headers: {
          "PAYMENT-SIGNATURE": b64({
            x402Version: 2,
            scheme: "exact",
            network: "hedera:testnet",
            accepted,
            payload: { signature: "stub" },
          }),
        },
      });
      expect(res.status).toBe(200);
      const header = res.headers.get("PAYMENT-RESPONSE");
      expect(header, "the only place the transaction id reaches the buyer").toBeTruthy();
      expect(JSON.parse(Buffer.from(header!, "base64").toString("utf8"))).toMatchObject({
        success: true,
        transaction: "0.0.2222@1690000000.000000001",
      });
    });

    it("prices the paid retry from the issued quote even after the price moves", async () => {
      const first = await fetch(`${base}/thing?k=moved`);
      const accepted = ((await first.json()) as any).accepts[0];
      price = 999;
      try {
        const res = await fetch(`${base}/thing?k=moved`, {
          headers: {
            "PAYMENT-SIGNATURE": b64({
              x402Version: 2,
              scheme: "exact",
              network: "hedera:testnet",
              accepted,
              payload: { signature: "stub" },
            }),
          },
        });
        expect(res.status).toBe(200);
        expect(paidCtx!.paid, "what the buyer agreed to pay, not today's price").toBe(10_000);
      } finally {
        price = 10_000;
      }
    });
  });

  describe("a settlement that fails", () => {
    it("never serves the goods and never calls onPaid", async () => {
      fac.settleOk = false;
      const { status, body } = await pay("settle-failed");
      // 402 with the reason, not 200 with the body: `success: false` means the
      // money did not move, whatever transaction id came back with it.
      expect(status).toBe(402);
      expect(body.error ?? "").toContain("stub: settlement failed on chain");
      expect(paidCtx, "no purchase may be recorded for a payment that did not settle").toBeNull();
      expect(lastOutcome).toEqual({ kind: "unpaid" });
    });
  });

  describe("a settlement with no payer", () => {
    it("hands onPaid null rather than inventing an account id", async () => {
      fac.payer = null;
      const { status } = await pay("no-payer");
      expect(status).toBe(200);
      // "unknown" is a string an account column would happily accept, and a
      // purchase row attributed to it is a purchase attributed to nobody.
      expect(paidCtx!.payer).toBeNull();
      expect(paidCtx!.payer).not.toBe("unknown");
    });
  });

  describe("a settlement that cannot be recorded (H1)", () => {
    it("reports recorded:false and durable:true when owe() takes the obligation", async () => {
      onPaidThrows = "SQLITE_BUSY: database is locked";
      oweResult = true;
      const { status, body } = await pay("owe-durable");

      // The buyer's money moved on chain, so refusing the body would take the
      // payment and give nothing. It is served — and the caller is told the
      // record is deferred, which is what lets the registry replay it.
      expect(status).toBe(200);
      expect(body).toMatchObject({ ok: true });
      expect(lastOutcome).toMatchObject({ kind: "paid", recorded: false, durable: true });
      expect(oweCalls).toEqual([
        {
          op: "onPaid",
          txId: "0.0.2222@1690000000.000000001",
          paid: 10_000,
          payer: "0.0.2222",
          reason: "SQLITE_BUSY: database is locked",
        },
      ]);
    });

    it("reports durable:false — and shouts — when nothing took the obligation", async () => {
      const errors: string[] = [];
      vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
        errors.push(a.join(" "));
      });
      onPaidThrows = "disk full";
      oweResult = false;
      const { status } = await pay("owe-lost");

      // Nothing anywhere has a record of this payment, so the caller must not
      // answer with the goods. The alarm is the only operator-facing signal
      // there is, and silencing it survived the old suite.
      expect(status).toBe(502);
      expect(lastOutcome).toMatchObject({ kind: "paid", recorded: false, durable: false });
      expect(
        errors.join("\n"),
        "LEDGER WRITE LOST is the alarm for money that moved and was never recorded",
      ).toMatch(/LEDGER WRITE LOST for settled tx 0\.0\.2222@/);
      expect(errors.join("\n")).toMatch(/onPaid failed for .*disk full/);
    });

    it("sets X-Payment-Record: deferred so a client can tell a deferred sale from a clean one", async () => {
      onPaidThrows = "boom";
      oweResult = true;
      const first = await fetch(`${base}/thing?k=deferred-header`);
      const accepted = ((await first.json()) as any).accepts[0];
      const res = await fetch(`${base}/thing?k=deferred-header`, {
        headers: {
          "PAYMENT-SIGNATURE": b64({
            x402Version: 2,
            scheme: "exact",
            network: "hedera:testnet",
            accepted,
            payload: { signature: "stub" },
          }),
        },
      });
      expect(res.headers.get("x-payment-record")).toBe("deferred");

      onPaidThrows = null;
      const clean = await fetch(`${base}/thing?k=deferred-header-2`);
      const accepted2 = ((await clean.json()) as any).accepts[0];
      const ok = await fetch(`${base}/thing?k=deferred-header-2`, {
        headers: {
          "PAYMENT-SIGNATURE": b64({
            x402Version: 2,
            scheme: "exact",
            network: "hedera:testnet",
            accepted: accepted2,
            payload: { signature: "stub" },
          }),
        },
      });
      expect(ok.headers.get("x-payment-record")).toBeNull();
    });
  });

  describe("a settlement with no transaction id (M2)", () => {
    it("does not call onPaid at all, and defers instead", async () => {
      fac.transaction = "";
      oweResult = true;
      const { status } = await pay("no-txid");

      // `txId` is the key onPaid de-duplicates on, the key a refund is found by,
      // and the key the unique index covers. Three recordPurchase calls with ""
      // produced three purchases and six payout rows for one payment.
      expect(paidCtx, "nothing may be recorded against an empty transaction id").toBeNull();
      expect(lastOutcome).toMatchObject({ kind: "paid", recorded: false, durable: true });
      expect(oweCalls[0]!.op).toBe("settle-no-tx-id");
      expect(oweCalls[0]!.reason).toMatch(/no transaction id/);
      expect(oweCalls[0]!.paid).toBe(10_000);
      // Durable, so the buyer still gets what they paid for.
      expect(status).toBe(200);
    });
  });
});
