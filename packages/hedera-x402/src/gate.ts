import { x402Version } from "@x402/core";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import type {
  Network,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
} from "@x402/core/types";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { LRUCache } from "lru-cache";
import type { Request, Response } from "express";

/** How long an issued 402 stays honourable. */
export const DEFAULT_QUOTE_TTL_MS = 30_000;

export interface PaidContext {
  resourceKey: string;
  /** null when the facilitator returns no payer. Never the string "unknown". */
  payer: string | null;
  txId: string;
  paid: number;
  settle: SettleResponse;
  meta: Record<string, unknown>;
}

export type Quoted =
  | { priceUnits: number; payTo: string; meta?: Record<string, unknown> }
  | { notFound: true }
  | { gone: true };

export interface PaymentGateOptions {
  facilitatorUrl: string;
  network: string;
  asset: string;
  quoteTtlMs?: number;

  /**
   * Pure and synchronous. Must not touch the ledger or the network.
   *
   * Separate from `quote` because the paid retry has to find the requirements
   * it issued WITHOUT re-pricing — re-quoting is exactly the bug that breaks
   * real payments, since the facilitator compares payload.accepted.amount and
   * .payTo to the requirements by strict equality.
   */
  resourceKey(req: Request): string;

  /** Priced only on the unpaid path. */
  quote(req: Request, key: string): Promise<Quoted>;

  /** MUST be idempotent on txId: retried from an outbox and de-duplicated downstream. */
  onPaid(ctx: PaidContext): Promise<void>;

  /**
   * Settled but unrecordable. Return false if the obligation is not durable.
   *
   * `reason` is the actual failure — the thrown error's message, or why the gate
   * would not even attempt `onPaid` — because that string is what an operator (or
   * a replay loop) has to work from when the only record of a settled payment is
   * this one.
   */
  owe?(op: string, ctx: PaidContext, reason: string): boolean;
}

interface Issued {
  reqs: PaymentRequirements;
  priceUnits: number;
  payTo: string;
  meta: Record<string, unknown>;
}

const issuedKey = (key: string, amount: string | number, payTo: string) =>
  `${key}|${amount}|${payTo}`;

/** Absolute URL of the resource being paid for (x402 `resource.url`). */
export function resourceUrl(req: Request): string {
  const proto = (req.header("x-forwarded-proto") ?? req.protocol).split(",")[0]!;
  return `${proto}://${req.get("host") ?? "localhost"}${req.originalUrl}`;
}

export type GateOutcome =
  | { kind: "unpaid" }
  | { kind: "not_found" }
  | { kind: "gone" }
  | {
      kind: "paid";
      ctx: PaidContext;
      /**
       * `onPaid` completed. **The caller must branch on this**, not on `kind`.
       *
       * `kind: "paid"` used to be the only thing the gate said, so a route could
       * not tell "paid and recorded" from "paid, and nothing in this system knows
       * it": `apps/registry` served the body with a 200 for a sale that had no
       * purchase row, no royalty and no refund path (docs/AUDIT-MONEY.md H1).
       */
      recorded: boolean;
      /**
       * A durable record of the settled payment exists — either because `onPaid`
       * wrote one, or because `owe()` did. When this is false the money moved and
       * *nothing anywhere* has a record of it, which is the one outcome a caller
       * must not answer with the goods and a 200.
       */
      durable: boolean;
    };

/**
 * The x402 half of a paid endpoint: build requirements, issue a 402, and on the
 * paid retry verify and settle against the requirements actually issued.
 *
 * Product-free by construction — it knows nothing about what is being sold.
 */
export class PaymentGate {
  private readonly server: x402ResourceServer;
  private readonly facilitator: HTTPFacilitatorClient;
  private readonly issued: LRUCache<string, Issued>;
  private initP: Promise<void> | null = null;

  constructor(private readonly opts: PaymentGateOptions) {
    this.facilitator = new HTTPFacilitatorClient({ url: opts.facilitatorUrl });
    this.server = new x402ResourceServer(this.facilitator).register(
      "hedera:*" as Network,
      new ExactHederaScheme({}),
    );
    this.issued = new LRUCache<string, Issued>({
      max: 50_000,
      ttl: opts.quoteTtlMs ?? DEFAULT_QUOTE_TTL_MS,
    });
  }

  /** Cached; dropped on failure so a transient facilitator outage can recover. */
  private ensureInit(): Promise<void> {
    if (!this.initP) {
      this.initP = this.server.initialize().catch((e) => {
        this.initP = null;
        throw e;
      });
    }
    return this.initP;
  }

  private async buildRequirements(payTo: string, priceUnits: number) {
    await this.ensureInit();
    const reqs = await this.server.buildPaymentRequirements({
      scheme: "exact",
      network: this.opts.network as Network,
      payTo,
      price: { asset: this.opts.asset, amount: String(priceUnits) },
    });
    const r = reqs[0];
    if (!r) throw new Error("no payment requirements built");
    return r;
  }

  send402(res: Response, reqs: PaymentRequirements, resource: string, error?: string) {
    const body: PaymentRequired = {
      x402Version,
      error,
      resource: { url: resource },
      accepts: [reqs],
    };
    res.setHeader("PAYMENT-REQUIRED", encodePaymentRequiredHeader(body));
    res.status(402).json(body);
  }

  /**
   * Run the gate. Returns `paid` only when money has actually settled; the
   * caller then serves the goods. Every other outcome has already been written
   * to `res`.
   */
  async handle(req: Request, res: Response): Promise<GateOutcome> {
    const key = this.opts.resourceKey(req);
    const sig = req.header("PAYMENT-SIGNATURE");

    // Paid retry: honour the requirements we issued, never a fresh quote.
    let replay: Issued | undefined;
    if (sig) {
      try {
        const probe = decodePaymentSignatureHeader(sig) as {
          accepted?: { amount?: string | number; payTo?: string };
        };
        const a = probe.accepted?.amount;
        const to = probe.accepted?.payTo;
        if (a != null && to != null) replay = this.issued.get(issuedKey(key, a, to));
      } catch {
        /* malformed header — fall through to a fresh 402 */
      }
    }

    if (!replay) {
      const q = await this.opts.quote(req, key);
      if ("notFound" in q) {
        res.status(404).json({ error: "not found" });
        return { kind: "not_found" };
      }
      if ("gone" in q) {
        res.status(410).json({ error: "no longer available" });
        return { kind: "gone" };
      }
      let reqs: PaymentRequirements;
      try {
        reqs = await this.buildRequirements(q.payTo, q.priceUnits);
      } catch (e) {
        res.status(503).json({ error: `facilitator unavailable: ${(e as Error).message}` });
        return { kind: "unpaid" };
      }
      const entry: Issued = {
        reqs,
        priceUnits: q.priceUnits,
        payTo: q.payTo,
        meta: q.meta ?? {},
      };
      this.issued.set(issuedKey(key, reqs.amount, q.payTo), entry);

      this.send402(
        res,
        reqs,
        resourceUrl(req),
        sig ? "quote expired or not recognised; retry with these requirements" : undefined,
      );
      return { kind: "unpaid" };
    }

    let ctx: PaidContext;
    try {
      const payload = decodePaymentSignatureHeader(sig!);
      const v = await this.facilitator.verify(payload, replay.reqs);
      if (!v.isValid) {
        this.send402(res, replay.reqs, resourceUrl(req), v.invalidReason ?? "verification failed");
        return { kind: "unpaid" };
      }
      const s = await this.facilitator.settle(payload, replay.reqs);
      if (!s.success) {
        this.send402(res, replay.reqs, resourceUrl(req), s.errorReason ?? "settlement failed");
        return { kind: "unpaid" };
      }
      res.setHeader("PAYMENT-RESPONSE", encodePaymentResponseHeader(s));
      ctx = {
        resourceKey: key,
        payer: s.payer ?? null,
        txId: s.transaction,
        paid: replay.priceUnits,
        settle: s,
        meta: replay.meta,
      };
    } catch (e) {
      res.status(502).json({ error: `payment processing failed: ${(e as Error).message}` });
      return { kind: "unpaid" };
    }

    // A settlement with no transaction id cannot be recorded idempotently: it is
    // the key `onPaid` de-duplicates on, the key a refund is looked up by, and
    // the key the unique index on `purchase.tx_id` covers. Calling `onPaid`
    // anyway is how one payment became three purchase rows and six payout rows
    // (docs/AUDIT-MONEY.md M2, verified) — so it is not called. The obligation
    // goes straight to `owe()`, which is the path built for exactly this.
    if (!ctx.txId) {
      return this.deferred(
        res,
        ctx,
        "settle-no-tx-id",
        "the facilitator reported success but returned no transaction id, so this payment " +
          "cannot be recorded idempotently or refunded; it needs manual reconciliation " +
          "against the facilitator",
      );
    }

    try {
      await this.opts.onPaid(ctx);
    } catch (e) {
      return this.deferred(res, ctx, "onPaid", (e as Error).message);
    }
    return { kind: "paid", ctx, recorded: true, durable: true };
  }

  /**
   * Money moved and could not be recorded here. Push the obligation somewhere
   * durable and tell the caller which of the two situations it is in.
   */
  private deferred(
    res: Response,
    ctx: PaidContext,
    op: string,
    reason: string,
  ): GateOutcome {
    // Money moved. The record must outlive this request.
    const durable = this.opts.owe?.(op, ctx, reason) ?? false;
    if (!durable) {
      console.error(
        `LEDGER WRITE LOST for settled tx ${ctx.txId || "(no tx id)"}: no outbox configured. ` +
          "The payer's transfer exists on chain and nothing here has a record of it.",
      );
    }
    res.setHeader("X-Payment-Record", "deferred");
    console.error(`${op} failed for ${ctx.txId || "(no tx id)"}: ${reason}`);
    return { kind: "paid", ctx, recorded: false, durable };
  }
}
