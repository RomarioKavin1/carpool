// Typed fetchers for @carpool/registry's JSON API.
//
// Base = NEXT_PUBLIC_SETTLEMENT_URL (kept as-is — .env.example already wires
// this name to the registry's own base URL; renaming it is an infra change
// outside this app). Default http://localhost:8403, matching
// apps/registry/src/config.ts's REGISTRY_PORT default.
//
// Only the OPEN routes are read here: GET /state, GET /events, GET /search,
// GET /health, GET /batches, GET /.well-known/carpool, and GET /payouts **in
// its scoped form only**. The dashboard holds no shared secret and never sends
// one, so POST /settle, /publish, /refund and /delist are not callable from
// this app by construction — see components/Chrome.tsx for why "Settle now"
// was dropped rather than shipped 401ing.
//
// `GET /payouts` is the one route here with two forms and only one of them
// open: `?payee=` is public (every input is already public — /state serves
// every `paid` and `buyer`, the free manifest carries the payout account, and
// /.well-known publishes the fee), while the unscoped table is gated by the
// operator secret because it aggregates the registry's own take beside every
// author's position. `getPayouts` therefore REQUIRES a payee: the unscoped
// call is not expressible from this app, rather than expressible and 401ing.
//
// Every artifact/purchase shape below is a TYPE-ONLY reference into
// apps/registry/src/ledger.ts itself — not hand-copied. `import type` is
// erased completely at build time (no runtime import, no bundling of the
// registry's server-only dependencies), so if `state()`/`eventsSince()` ever
// rename a field, this file fails to typecheck instead of quietly drifting.
import type { PurchaseEventData, RegistryLedger } from "../../registry/src/ledger";

export const REGISTRY_URL =
  process.env.NEXT_PUBLIC_SETTLEMENT_URL || "http://localhost:8403";

/**
 * The payout account whose seeding view opens by default, when the operator
 * has one. Absent → the seeding view asks which account is yours instead of
 * guessing. The dashboard has no wallet and no session; it never claims to
 * know who is looking at it.
 */
export const SELF_AUTHOR_ACCOUNT = process.env.NEXT_PUBLIC_CARPOOL_AUTHOR || null;

export type RegistryState = ReturnType<RegistryLedger["state"]>;
export type ArtifactState = RegistryState["artifacts"][number];
export type PurchaseState = RegistryState["purchases"][number];
export type PeerState = RegistryState["peers"][number];
export type RegistrySummary = RegistryState["summary"];

/**
 * `"refunded" | "window" | "closed"`, DERIVED by the registry on its own clock
 * (`RegistryLedger.effectiveRefundState`). The stored column is written
 * `"window"` at purchase and nothing ever moves it, so the served value is the
 * only one that distinguishes still-reversible from finished. Never re-derive
 * it from `ts + refundWindowSeconds` here: that is a second clock, and it is
 * the bug this field was added to retire.
 */
export type RefundState = PurchaseState["refundState"];

/**
 * One `GET /payouts` row. `state` is `held | claimable | settled | voided`,
 * derived on the registry's clock — the read the rail never had, and the reason
 * the seeding view no longer renders "settled → not observable".
 */
export type Payout = ReturnType<RegistryLedger["payouts"]>[number];
export type PayoutState = Payout["state"];

/** One `GET /batches` row. `txId` is NULL until the transfer's id is recorded. */
export type Batch = ReturnType<RegistryLedger["batches"]>[number];

/** The free half of an artifact — @carpool/core's Manifest, as JSON. */
export type Manifest = ArtifactState["manifest"];

/** GET /events — see RegistryLedger.eventsSince(). `ts` is unix SECONDS. */
export interface CarpoolEvent {
  id: number;
  ts: number; // unix SECONDS — NOT milliseconds; see CONTRACT.md "Units, stated once"
  type: "purchase" | "refund";
  data: PurchaseEventData;
}

export interface WellKnown {
  embedding: { model: string; dim: number };
  prices: { trackerFeeMicroUsdc: number };
  refundWindowSeconds: number;
  settlementAccount: string;
  asset: string;
  network: string;
  /**
   * The HCS topic epochs are anchored to, or null when the registry has none.
   *
   * This plus `artifact.anchoredAt` on /state is the WHOLE of what can be said
   * about anchoring, and the UI must not imply more. HCS messages are submitted
   * and not stored, so the registry keeps no per-anchor record: there is no
   * sequence number, no consensus timestamp, and no anchor route. "Its hash was
   * in a successful anchor to this topic, at this time" is the claim; "here is
   * the consensus message" is not one this data supports.
   */
  anchorTopic: string | null;
}

/** GET /health. `creds` false ⇒ payouts accrue but settlement cannot run. */
export interface RegistryHealth {
  ok: boolean;
  creds: boolean;
  authEnforced: boolean;
  registryAccount: string;
  network: string;
  asset: string;
}

/**
 * One GET /search element: the whole manifest, plus the four evidence fields
 * the registry always serves, plus the three ranking fields it serves ONLY
 * when it actually ranked something.
 *
 * The ranking three are optional in the type on purpose. A browse (no `q`,
 * no `vector`) omits them because nothing was ranked, and the UI must not
 * render a rank the server did not compute — see lib/search.ts's
 * `rankingOf()`, which is the only place in this app allowed to read them.
 */
export type SearchHit = Manifest & {
  priceNow: number;
  freshness: number;
  health: number;
  /** Days since decay.producedAt, on the SERVER's clock. */
  ageDays: number;
  score?: number;
  similarity?: number;
  depth?: number;
};

/**
 * A failed call, carrying enough to say something true in the UI.
 *
 * `offline` distinguishes "the registry is not running" (fetch rejected: no
 * connection, DNS, CORS) from "the registry answered and said no" (an HTTP
 * status). Those two need different copy and different advice, and collapsing
 * them into one "error" state is the specific thing that makes a dashboard
 * useless the first time a judge opens it with nothing running.
 */
export class ApiError extends Error {
  constructor(
    readonly path: string,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
  get offline(): boolean {
    return this.status === null;
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${REGISTRY_URL}${path}`, {
      signal,
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(path, null, `cannot reach ${REGISTRY_URL}`);
  }
  if (!res.ok) {
    // The registry answers every failure as `{ error: "<message>" }` (see the
    // `h()` wrapper in apps/registry/src/server.ts). Surfacing that message
    // verbatim is the difference between "search failed" and "the registry
    // could not embed your question — retry".
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body?.error === "string" && body.error.trim() !== "") detail = body.error;
    } catch {
      /* non-JSON body: the status is all we have */
    }
    throw new ApiError(path, res.status, detail);
  }
  return (await res.json()) as T;
}

export function getState(signal?: AbortSignal): Promise<RegistryState> {
  return getJson<RegistryState>("/state", signal);
}

/** `sinceSeconds` is unix SECONDS, matching /events' own `since` contract. */
export function getEvents(sinceSeconds: number, signal?: AbortSignal): Promise<CarpoolEvent[]> {
  return getJson<CarpoolEvent[]>(`/events?since=${Math.floor(sinceSeconds)}`, signal);
}

/** Free, unauthenticated, static-ish config. Fetched once, not polled. */
export function getWellKnown(signal?: AbortSignal): Promise<WellKnown> {
  return getJson<WellKnown>("/.well-known/carpool", signal);
}

export function getHealth(signal?: AbortSignal): Promise<RegistryHealth> {
  return getJson<RegistryHealth>("/health", signal);
}

/**
 * One payee's payout rows. `payee` is REQUIRED and non-blank — see the header:
 * the unscoped table is operator-gated, and a function that could accidentally
 * omit the scope would 401 at runtime rather than at the call site.
 *
 * Rows arrive newest first and include `voided` ones. They are not filtered out
 * here: omitting a voided row would make a refunded sale look like a sale that
 * never happened, which is the opposite of what an author needs to see.
 */
export function getPayouts(payee: string, signal?: AbortSignal): Promise<Payout[]> {
  const scope = payee.trim();
  if (scope === "") {
    return Promise.reject(
      new ApiError("/payouts", null, "a payee is required; the unscoped payout table is operator-gated"),
    );
  }
  return getJson<{ payouts: Payout[] }>(
    `/payouts?payee=${encodeURIComponent(scope)}`,
    signal,
  ).then((r) => r.payouts);
}

/**
 * Settlement batches, newest first. Open, and the reason a settled royalty can
 * link out: `settledBatchId` on a payout names the batch, and the batch carries
 * the Hedera `txId` anyone can read on a mirror node.
 */
export function getBatches(signal?: AbortSignal): Promise<Batch[]> {
  return getJson<{ batches: Batch[] }>("/batches", signal).then((r) => r.batches);
}

/**
 * GET /search, both modes.
 *
 * `q` present and non-blank ⇒ the registry embeds it server-side and ranks.
 * `q` absent ⇒ browse: every live artifact, newest first, nothing ranked.
 *
 * This dashboard cannot send `?vector=` — it has no local embedder, and
 * shipping a second embedding implementation in a browser bundle is how a
 * client ends up indexing against a model the registry does not use (see
 * CONTRACT.md, "Every client must embed with this exact tuple"). So searching
 * from here sends the question text, which the registry can log. The UI says
 * so on the panel rather than in a comment.
 */
export function getSearch(
  args: { q?: string; limit?: number },
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  const params = new URLSearchParams();
  const q = args.q?.trim();
  if (q) params.set("q", q);
  params.set("limit", String(args.limit ?? 25));
  return getJson<SearchHit[]>(`/search?${params.toString()}`, signal);
}
