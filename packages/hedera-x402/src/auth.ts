import type { RequestHandler } from "express";
import { timingSafeEqual } from "node:crypto";

/**
 * Authentication boundary for the ledger.
 *
 * Every mutating route here moves money: /ledger/rider mints a rebate accrual
 * payable to whatever `payer` the caller names, and /settle turns accruals into
 * real HTS transfers. Before this existed the whole API was unauthenticated and
 * CORS-open, so anyone who could reach the port could credit themselves and
 * then ask the settler to pay it out.
 *
 * The trust model is deliberately narrow: the only legitimate callers of the
 * mutating routes are the provider middleware instances, which are operated by
 * the same party as the settlement service. A shared secret is sufficient for
 * that and avoids inventing a key-management story. Reads (/state, /events,
 * /health) stay open because the dashboard is a static client with no secret to
 * keep, and they expose no payee-controllable field.
 */

const HEADER = "x-carpool-key";

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface AuthConfig {
  /** Shared secret; when absent the service refuses to start in production. */
  secret: string | null;
  /** True when the service is running without a secret (local dev only). */
  open: boolean;
}

export function loadAuth(): AuthConfig {
  const secret = process.env.LEDGER_API_KEY?.trim() || null;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "LEDGER_API_KEY is required in production: the ledger's mutating " +
          "routes create payment obligations and must not be open.",
      );
    }
    return { secret: null, open: true };
  }
  if (secret.length < 32) {
    throw new Error(
      `LEDGER_API_KEY must be at least 32 characters (got ${secret.length}).`,
    );
  }
  return { secret, open: false };
}

/** Gate for routes that create or discharge payment obligations. */
export function requireKey(auth: AuthConfig): RequestHandler {
  return (req, res, next) => {
    if (auth.open) return next();
    const provided = req.header(HEADER);
    if (!provided || !constantTimeEqual(provided, auth.secret!)) {
      res.status(401).json({ error: "unauthorised" });
      return;
    }
    next();
  };
}

/**
 * CORS policy. The dashboard needs cross-origin reads; nothing needs
 * cross-origin writes, so the mutating routes are same-origin only and the
 * browser will not attach the header for them.
 */
export function corsOrigins(): string[] | true {
  const raw = process.env.DASHBOARD_ORIGIN?.trim();
  if (!raw) return true; // dev: any origin may read
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
