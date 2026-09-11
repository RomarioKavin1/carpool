// Drive N concurrent buyers against a registry.
//
// The Zipf request generator below is the one part of
// packages/carpool-core/src/workload.ts worth keeping: a deterministic
// power-law draw so popular artifacts get requested (and re-requested) far
// more than obscure ones, the way real agent traffic would. Everything else
// in workload.ts — the fixed UNIVERSE of coins/pools/contracts, the
// QueryClass machinery — described a product (cached API responses) that no
// longer exists. What bench draws over instead is whatever the registry
// actually holds, fetched fresh via GET /search.
import {
  buyArtifact,
  makePayFetch,
  type Account,
  type BuyLogLine,
  type CatalogItem,
} from "./agent.js";

// --- deterministic PRNG (mulberry32), ported verbatim from workload.ts ---
function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function zipfCumulative(n: number, alpha: number): { cum: number[]; total: number } {
  const cum: number[] = [];
  let total = 0;
  for (let i = 1; i <= n; i++) {
    total += 1 / Math.pow(i, alpha);
    cum.push(total);
  }
  return { cum, total };
}

function zipfPick(rng: () => number, cum: number[], total: number): number {
  const r = rng() * total;
  for (let i = 0; i < cum.length; i++) if (r < cum[i]!) return i;
  return cum.length - 1;
}

/**
 * Deterministic Zipf draw of `count` indices into a catalog of size `n`.
 * Same (seed,count,n,alpha) → identical output — same contract workload.ts's
 * `zipfWorkload` made, minus the fixed universe: the caller supplies `n` (the
 * live catalog size) instead of it coming from a committed universe.json.
 */
export function zipfPicks(seed: number, count: number, n: number, alpha = 1.0): number[] {
  if (n <= 0) throw new Error("zipfPicks: catalog is empty");
  const rng = mulberry32(seed);
  const { cum, total } = zipfCumulative(n, alpha);
  return Array.from({ length: count }, () => zipfPick(rng, cum, total));
}

/** FREE. Manifests only — see apps/registry GET /search. */
export async function fetchCatalog(base: string, limit = 100): Promise<CatalogItem[]> {
  const res = await fetch(`${base.replace(/\/$/, "")}/search?limit=${limit}`);
  if (!res.ok) throw new Error(`GET /search failed: ${res.status}`);
  const listings = (await res.json()) as Array<{
    magnet: string;
    priceNow: number;
    provenance: CatalogItem["provenance"];
  }>;
  return listings.map((l) => ({
    magnet: l.magnet,
    priceNow: l.priceNow,
    provenance: l.provenance,
  }));
}

/** Global concurrency limiter, ported from fleet/src/run.ts. */
function semaphore(max: number) {
  let active = 0;
  const q: (() => void)[] = [];
  const next = () => {
    if (active >= max) return;
    const run = q.shift();
    if (run) {
      active++;
      run();
    }
  };
  return async function <T>(fn: () => Promise<T>): Promise<T> {
    await new Promise<void>((res) => {
      q.push(res);
      next();
    });
    try {
      return await fn();
    } finally {
      active--;
      next();
    }
  };
}

const defaultJitter = () => 200 + Math.floor(Math.random() * 600); // 200-800ms
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type PayFetchFactory = (acct: Account, network: string) => ReturnType<typeof makePayFetch>;

export interface LoadOptions {
  base: string;
  network: string;
  catalog: CatalogItem[];
  accounts: Account[];
  buyerCount: number;
  requestsPerBuyer: number;
  seed: number;
  alpha?: number;
  /** Global concurrency across all buyers. Default 4, same as fleet. */
  concurrency?: number;
  /** Injectable for tests, so no real crypto/network is required to exercise the driver. */
  makePayFetch?: PayFetchFactory;
  jitterMs?: () => number;
}

/**
 * Run `buyerCount` buyers, each issuing `requestsPerBuyer` Zipf-distributed
 * buys against `catalog`, over one shared account. Deterministic given
 * (seed, buyerCount, requestsPerBuyer, catalog, alpha) — every buyer draws
 * from seed+index so streams overlap on popular artifacts without being
 * identical.
 */
export async function driveLoad(opts: LoadOptions): Promise<BuyLogLine[]> {
  if (opts.catalog.length === 0) {
    throw new Error("catalog is empty — publish at least one artifact before running a load test");
  }
  const buyers = opts.accounts.slice(0, opts.buyerCount);
  if (buyers.length < opts.buyerCount) {
    throw new Error(
      `requested ${opts.buyerCount} buyers but accounts.json has only ${opts.accounts.length} — run bootstrap first`,
    );
  }
  const factory = opts.makePayFetch ?? makePayFetch;
  const acquire = semaphore(opts.concurrency ?? 4);
  const jitter = opts.jitterMs ?? defaultJitter;

  const out: BuyLogLine[] = [];
  await Promise.all(
    buyers.map(async (acct, i) => {
      const payFetch = factory(acct, opts.network);
      const picks = zipfPicks(opts.seed + i, opts.requestsPerBuyer, opts.catalog.length, opts.alpha ?? 1.0);
      for (const idx of picks) {
        await sleep(jitter());
        const item = opts.catalog[idx]!;
        const line = await acquire(() => buyArtifact(payFetch, acct.id, item, opts.base));
        out.push(line);
      }
    }),
  );
  return out;
}
