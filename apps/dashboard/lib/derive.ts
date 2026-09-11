// Pure transforms from the registry's real /state and /events shapes (see
// lib/api.ts) to what the torrent view renders. No decay math lives here —
// freshness/priceNow/health arrive already computed by
// apps/registry/src/ledger.ts's state(), which itself calls @carpool/core's
// freshness()/priceAt()/health(). This module only reshapes and aggregates
// fields the registry actually emits; see derive.test.ts, which is written
// to fail if any of those field names are ever renamed.

import type { ArtifactState, CarpoolEvent, PurchaseState, RegistryState } from "./api";

/** Trailing window used for SEED-vs-PEER and RATE — see buildRows. */
export const RATE_WINDOW_SECONDS = 3600;

export interface ArtifactRow {
  magnet: string;
  name: string;
  scope: string | null;
  bodyBytes: number;
  health: number;
  freshness: number;
  live: boolean;
  redacted: boolean;
  /** Holders — distinct buyers, all time. Torrent "seeds". Source: artifact.distinctBuyers. */
  seed: number;
  /** Current demand — distinct buyers in the trailing window. Torrent "peers". */
  peer: number;
  /** Purchases in the trailing window. Torrent "download rate". */
  ratePerHour: number;
  priceNow: number;
  /** Refunds ÷ sales, as the registry computed it. One of the three health inputs. */
  refundRate: number;
  /** Pricing inputs, so the decay panel can show what the price decays toward. */
  priceBase: number;
  priceFloor: number;
  /** The signed decay block — fixed for the life of the artifact, unlike freshness. */
  decay: ArtifactState["manifest"]["decay"];
  author: string;
  /** Days since producedAt, on the REGISTRY's clock. Served, never derived here. */
  ageDays: number;
  /** Unix seconds the author withdrew it, or null. */
  delistedAt: number | null;
  /** Unix seconds its manifest hash was in a successful HCS anchor, or null. */
  anchoredAt: number | null;
  status: ArtifactStatus;
}

/**
 * Why an artifact is or is not on sale.
 *
 * `live` folds two different facts together, and they are not interchangeable:
 * an artifact can stop selling because its author **withdrew** it or because it
 * **decayed** past the expiry threshold. One is a decision and one is time. The
 * registry now serves `delistedAt` precisely so a client can tell them apart,
 * and a seeder reading "expired" about research they deliberately took down —
 * or "withdrawn" about something that simply aged out — is being misinformed
 * about their own listing.
 *
 * Withdrawal wins when both are true: it is the author's statement, and it is
 * final for that magnet in a way expiry is not.
 */
export type ArtifactStatus = "live" | "withdrawn" | "expired";

export function artifactStatus(a: Pick<ArtifactState, "live" | "delistedAt">): ArtifactStatus {
  if (a.delistedAt != null) return "withdrawn";
  return a.live ? "live" : "expired";
}

export const STATUS_MEANING: Record<ArtifactStatus, string> = {
  live: "On sale. /search ranks it and /artifact will quote it.",
  withdrawn:
    "The author withdrew it with POST /delist. No new sale is possible and this is final for this magnet — republishing the same manifest does not relist it. Purchases still inside their refund window stay refundable, accrued royalties are still paid, the manifest hash still anchors, and every buyer who already paid keeps their copy. Nothing can recall it.",
  expired:
    "Freshness fell below ⅛ — three half-lives. Search drops it and /artifact returns 410. Its author did not take it down; time did.",
};

/** NAME column: `scope · question` when the artifact has a scope, else just the question. */
export function rowName(a: ArtifactState): string {
  return a.manifest.scope ? `${a.manifest.scope} · ${a.manifest.question}` : a.manifest.question;
}

/**
 * One row per artifact, live or dead — a dead (expired/delisted) artifact is
 * a legible state for a torrent view, not something to hide. Rows are
 * ordered by health, richest signal first, ties broken by freshness.
 */
export function buildRows(
  state: RegistryState,
  nowSeconds: number,
  windowSeconds: number = RATE_WINDOW_SECONDS,
): ArtifactRow[] {
  const byMagnet = new Map<string, PurchaseState[]>();
  for (const p of state.purchases) {
    const list = byMagnet.get(p.magnet);
    if (list) list.push(p);
    else byMagnet.set(p.magnet, [p]);
  }

  const rows = state.artifacts.map((a): ArtifactRow => {
    const magnet = a.manifest.magnet;
    const purchasesFor = byMagnet.get(magnet) ?? [];
    const windowPurchases = purchasesFor.filter((p) => p.ts >= nowSeconds - windowSeconds);
    const peer = new Set(windowPurchases.map((p) => p.buyer)).size;
    return {
      magnet,
      name: rowName(a),
      scope: a.manifest.scope ?? null,
      bodyBytes: a.manifest.bodyBytes,
      health: a.health,
      freshness: a.freshness,
      live: a.live,
      redacted: a.manifest.redacted,
      seed: a.distinctBuyers,
      peer,
      ratePerHour: windowPurchases.length,
      priceNow: a.priceNow,
      refundRate: a.refundRate,
      priceBase: a.priceBase,
      priceFloor: a.priceFloor,
      decay: a.manifest.decay,
      author: a.manifest.author,
      ageDays: a.ageDays,
      delistedAt: a.delistedAt,
      anchoredAt: a.anchoredAt,
      status: artifactStatus(a),
    };
  });

  return rows.sort((x, y) => y.health - x.health || y.freshness - x.freshness);
}

/**
 * Column sorting, because a torrent client without sortable columns is not a
 * torrent client. `name` sorts alphabetically; every other key is numeric and
 * descending-first, which is what "sort by SEED" means to anyone who has ever
 * clicked that header.
 */
export type SortKey =
  | "name"
  | "bodyBytes"
  | "health"
  | "seed"
  | "peer"
  | "ratePerHour"
  | "ageDays"
  | "freshness"
  | "priceNow";
export type SortDir = "asc" | "desc";

export function sortRows(rows: ArtifactRow[], key: SortKey, dir: SortDir): ArtifactRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const cmp = (x: ArtifactRow, y: ArtifactRow): number => {
    if (key === "name") return x.name.localeCompare(y.name);
    return x[key] - y[key];
  };
  // Ties fall back to health then magnet, so the order is total and a poll that
  // changes nothing never reshuffles rows under the reader's cursor.
  return [...rows].sort(
    (x, y) => sign * cmp(x, y) || y.health - x.health || x.magnet.localeCompare(y.magnet),
  );
}

/**
 * The default direction for a freshly clicked column. Text reads A→Z and
 * numbers read big→small — except age, where "sort by age" means newest first
 * to everyone who has ever clicked it, and newest is the *smallest* age.
 */
export function defaultDirFor(key: SortKey): SortDir {
  if (key === "name") return "asc";
  if (key === "ageDays") return "asc";
  return "desc";
}

export function purchasesForMagnet(state: RegistryState, magnet: string): PurchaseState[] {
  return state.purchases.filter((p) => p.magnet === magnet).sort((a, b) => b.ts - a.ts);
}

export interface FooterSummary {
  published: number;
  purchased: number;
  ratio: number;
  grossUusdc: number;
  /** Distinct accounts that bought at least once — "rode" instead of researching it themselves. */
  rode: number;
  /**
   * "drove alone": duplicated effort the registry did NOT absorb — demand
   * that existed but was never served by a purchase here. There is no field
   * anywhere in /state or /events that observes research which never
   * resulted in a purchase, so this is always null. Render it as an em dash
   * with a tooltip — never fabricate a number for it. See task-G-brief.md.
   */
  droveAlone: null;
}

export function buildFooter(state: RegistryState): FooterSummary {
  const published = state.summary.artifactCount;
  const purchased = state.summary.purchaseCount;
  const ratio = purchased > 0 ? published / purchased : 0;
  const rode = state.peers.filter((p) => p.purchased > 0).length;
  return { published, purchased, ratio, grossUusdc: state.summary.gross, rode, droveAlone: null };
}

/** Newest-first, capped, typed feed for the activity panel. */
export function recentEvents(events: CarpoolEvent[], limit = 60): CarpoolEvent[] {
  return [...events].sort((a, b) => b.ts - a.ts).slice(0, limit);
}
