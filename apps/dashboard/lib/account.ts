/**
 * Looking up one account: what it published, sold, bought and was paid.
 *
 * ## Why this exists
 *
 * The earnings desk used to open on `NEXT_PUBLIC_CARPOOL_AUTHOR`, an account
 * baked in at deploy, and label it "you". That was a seed account, not the
 * viewer. A page with no session cannot know who is looking at it, so the
 * account now comes from the viewer: typed, linked (`#earnings?account=0.0.x`),
 * or read off a wallet they connected (lib/wallet.ts).
 *
 * Everything below is arithmetic over two open reads: `/state` (artifacts joined
 * to their author account, purchases joined to artifacts) and the payee-scoped
 * `/payouts?payee=`. Nothing is estimated.
 */
import type { Payout, RegistryState } from "./api";
import { AUTHOR_ROYALTY, buildSeeders, totalPayouts, type PayoutTotals, type Seeder } from "./seeding";

/* ------------------------------------------------------------------ input */

export type AccountInput =
  | { kind: "empty" }
  | { kind: "account"; id: string }
  | { kind: "evm"; address: string }
  | { kind: "invalid"; reason: string };

/**
 * A Hedera account id (`shard.realm.num`, optionally with the `-abcde` checksum
 * wallets display), or a 20-byte EVM address that the mirror node can resolve.
 */
export function parseAccountInput(raw: string): AccountInput {
  const text = raw.trim();
  if (text === "") return { kind: "empty" };
  const account = /^(\d{1,10})\.(\d{1,10})\.(\d{1,19})(?:-[a-z]{5})?$/i.exec(text);
  if (account) {
    // Canonical form: no leading zeros, no checksum, so a link and a typed id
    // for the same account compare equal.
    const id = account.slice(1, 4).map((n) => String(Number(n))).join(".");
    return { kind: "account", id };
  }
  if (/^0x[0-9a-f]{40}$/i.test(text)) return { kind: "evm", address: text.toLowerCase() };
  return { kind: "invalid", reason: "That is not a Hedera account id. They look like 0.0.1234567." };
}

/* --------------------------------------------------------------- the hash */

/**
 * `#earnings?account=0.0.x` → `{ view: "earnings", account: "0.0.x" }`.
 * The view is returned raw; the caller checks it names a real desk.
 */
export function readHash(hash: string): { view: string; account: string | null } {
  const body = hash.replace(/^#/, "");
  const q = body.indexOf("?");
  const view = q === -1 ? body : body.slice(0, q);
  if (q === -1) return { view, account: null };
  const raw = new URLSearchParams(body.slice(q + 1)).get("account");
  const parsed = raw === null ? null : parseAccountInput(raw);
  return { view, account: parsed?.kind === "account" ? parsed.id : null };
}

export function hashFor(view: string, account: string | null): string {
  if (view === "earnings" && account) return `#earnings?account=${account}`;
  return view === "overview" ? "" : `#${view}`;
}

/* ------------------------------------------------------ the mirror node */

/** `hedera:testnet` → the public mirror node for that network, or null when unknown. */
export function mirrorBaseFor(network: string | null | undefined): string | null {
  switch (network) {
    case "hedera:testnet":
      return "https://testnet.mirrornode.hedera.com";
    case "hedera:mainnet":
      return "https://mainnet-public.mirrornode.hedera.com";
    case "hedera:previewnet":
      return "https://previewnet.mirrornode.hedera.com";
    default:
      return null;
  }
}

export type EvmResolution =
  | { kind: "account"; id: string }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

/**
 * Resolve a 20-byte EVM address to its Hedera account through the mirror node's
 * open `GET /api/v1/accounts/{evmAddress}`.
 *
 * Verified against testnet on 13 Sep 2026: `0x01b130…0d72` resolves to
 * `0.0.10477413`, an account created from its EVM alias. It does NOT resolve
 * every key: `0.0.10475801` was created from an ECDSA key without an alias, and
 * the address MetaMask derives from that same key returns 404. That case is
 * `not-found`, and the UI says to paste the `0.0` id instead of guessing.
 */
export async function resolveEvmAddress(
  address: string,
  mirrorBase: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EvmResolution> {
  let res: Response;
  try {
    res = await fetchImpl(`${mirrorBase}/api/v1/accounts/${encodeURIComponent(address)}`, {
      headers: { accept: "application/json" },
    });
  } catch {
    return { kind: "error", message: `cannot reach ${mirrorBase}` };
  }
  if (res.status === 404) return { kind: "not-found" };
  if (!res.ok) return { kind: "error", message: `the mirror node answered HTTP ${res.status}` };
  try {
    const body = (await res.json()) as { account?: unknown };
    const parsed = typeof body.account === "string" ? parseAccountInput(body.account) : null;
    if (parsed?.kind === "account") return { kind: "account", id: parsed.id };
  } catch {
    /* fall through */
  }
  return { kind: "error", message: "the mirror node answered without an account id" };
}

/* ---------------------------------------------------------- the summary */

export interface AccountSummary {
  account: string;
  /**
   * Every author identity on this registry whose payout account is this one.
   * Usually one; two when the same account published under two keys, which the
   * registry keeps apart on purpose (see `buildSeeders`).
   */
  seeders: Seeder[];
  published: number;
  onSale: number;
  sales: number;
  /** µUSDC buyers paid for this account's artifacts, refunded sales included. */
  grossUusdc: number;
  /** Purchases this account made as a buyer. */
  bought: number;
  spentUusdc: number;
  /** Royalty rows for this payee, or null while `/payouts` has not answered. */
  royalties: PayoutTotals | null;
  /** Rows a failed transfer parked. They report `held` and need the operator. */
  parked: number;
}

export function summarizeAccount(
  state: RegistryState,
  account: string,
  payouts: Payout[] | null,
): AccountSummary {
  const seeders = buildSeeders(state, payouts ?? []).filter(
    (s) => s.identity.payoutAccount === account,
  );
  const mine = state.purchases.filter((p) => p.buyer === account);
  return {
    account,
    seeders,
    published: seeders.reduce((n, s) => n + s.artifacts.length, 0),
    onSale: seeders.reduce((n, s) => n + s.liveArtifacts, 0),
    sales: seeders.reduce((n, s) => n + s.sales, 0),
    grossUusdc: seeders.reduce((n, s) => n + s.grossUusdc, 0),
    bought: mine.length,
    spentUusdc: mine.reduce((n, p) => n + p.paid, 0),
    royalties: payouts === null ? null : totalPayouts(payouts, AUTHOR_ROYALTY),
    parked: payouts === null ? 0 : payouts.filter((p) => p.parkedAt != null).length,
  };
}
