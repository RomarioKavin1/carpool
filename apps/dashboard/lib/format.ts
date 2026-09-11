// Money is integer µUSDC. USDC has 6 decimals → 1¢ = 10_000 µUSDC, $1 = 1_000_000 µUSDC.
export const CENT = 10_000;
export const DOLLAR = 1_000_000;

/** µUSDC → cents string, e.g. 28000 → "2.800¢" */
export function fmtCent(uusdc: number, dp = 3): string {
  return `${(uusdc / CENT).toFixed(dp)}¢`;
}

/** µUSDC → dollar string, e.g. 28000 → "$0.0280" */
export function fmtUsd(uusdc: number, dp = 4): string {
  return `$${(uusdc / DOLLAR).toFixed(dp)}`;
}

export function pct(x: number, dp = 1): string {
  return `${(x * 100).toFixed(dp)}%`;
}

export function shortId(id: string, head = 8, tail = 6): string {
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

// HashScan testnet links — every on-chain number links out.
export function txUrl(txId: string): string {
  return `https://hashscan.io/testnet/transaction/${encodeURIComponent(txId)}`;
}
export function acctUrl(accountId: string): string {
  return `https://hashscan.io/testnet/account/${encodeURIComponent(accountId)}`;
}

// -------------------------------------------------- torrent-view additions

/** Byte count → torrent-style size, e.g. 188_416 → "184K", 900 → "900B". */
export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const units = ["K", "M", "G"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)}${units[i]}`;
}

/** Seconds → compact duration, e.g. 90_000 → "1d 1h", 45 → "45s". */
export function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

/** unix seconds → wall-clock time, no seconds noise. */
export function fmtTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString(undefined, { hour12: false });
}

/** unix seconds → "3m ago" / "2h ago", relative to `nowMs` (default: now). */
export function fmtAgo(unixSeconds: number, nowMs: number = Date.now()): string {
  const deltaS = Math.max(0, Math.round(nowMs / 1000 - unixSeconds));
  return `${fmtDuration(deltaS)} ago`;
}

// ------------------------------------------------------ counts and durations

/** Grouped integer, e.g. 2357943 → "2,357,943". Token counts live or die by this. */
export function fmtCount(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/**
 * A plain USD float (NOT µUSDC) → a dollar string. Used only for numbers that
 * arrive as dollars already: `manifest.provenance.estimatedCostUsd`, which the
 * author self-reports, and the A/B doc's recorded figures. Money that moved
 * through the registry is integer µUSDC and goes through `fmtUsd`.
 */
export function fmtUsdFloat(usd: number, dp = 4): string {
  return `$${usd.toFixed(dp)}`;
}

/** A multiple, e.g. 9.1 → "9.1×". Never rendered without its two operands nearby. */
export function fmtRatio(x: number, dp = 1): string {
  return `${x.toFixed(dp)}×`;
}

/** Fractional days → "2.4d" / "18h" / "41m". Used for age and time-to-expiry. */
export function fmtDays(days: number): string {
  if (!Number.isFinite(days)) return "—";
  if (days >= 1) return `${days.toFixed(days < 10 ? 1 : 0)}d`;
  return fmtDuration(days * 86_400);
}
