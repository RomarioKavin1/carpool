// Summarise a bench run: requests, purchases, spend, latency, and the hit
// rate — plus the token/cost totals Task H's A/B measurement needs (the cost
// of buying vs. the cost of redoing the research, per artifact bought).
import type { BuyLogLine } from "./agent.js";

export interface LatencyStats {
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface RunSummary {
  requests: number;
  /** Requests that ended in a served, paid-for body (status 200). */
  purchases: number;
  /** Share of requests that found a usable artifact (bought it), not merely a live listing. */
  hitRatePct: number;
  spendMicroUsdc: number;
  /** Sums over purchased artifacts only — what redoing the research would have cost, per its own manifest. */
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCostUsd: number;
  latency: LatencyStats;
  statusCounts: Record<string, number>;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

export function summarize(lines: BuyLogLine[]): RunSummary {
  const requests = lines.length;
  const purchased = lines.filter((l) => l.status === 200);
  const latencies = lines.map((l) => l.latencyMs).sort((a, b) => a - b);
  const statusCounts: Record<string, number> = {};
  for (const l of lines) statusCounts[String(l.status)] = (statusCounts[String(l.status)] ?? 0) + 1;

  return {
    requests,
    purchases: purchased.length,
    hitRatePct: requests ? (purchased.length / requests) * 100 : 0,
    spendMicroUsdc: purchased.reduce((s, l) => s + l.priceMicroUsdc, 0),
    totalInputTokens: purchased.reduce((s, l) => s + l.inputTokens, 0),
    totalOutputTokens: purchased.reduce((s, l) => s + l.outputTokens, 0),
    totalEstimatedCostUsd: purchased.reduce((s, l) => s + l.estimatedCostUsd, 0),
    latency: {
      meanMs: latencies.length ? latencies.reduce((s, v) => s + v, 0) / latencies.length : 0,
      p50Ms: percentile(latencies, 0.5),
      p95Ms: percentile(latencies, 0.95),
      maxMs: latencies.length ? latencies[latencies.length - 1]! : 0,
    },
    statusCounts,
  };
}

export function printSummary(s: RunSummary): void {
  console.log("\n=== bench summary ===");
  console.log(`requests:      ${s.requests}`);
  console.log(`purchases:     ${s.purchases}`);
  console.log(`hit rate:      ${s.hitRatePct.toFixed(1)}%`);
  console.log(`spend:         ${s.spendMicroUsdc} µUSDC`);
  console.log(`tokens bought: ${s.totalInputTokens} in / ${s.totalOutputTokens} out`);
  console.log(
    `redo cost:     $${s.totalEstimatedCostUsd.toFixed(4)} (sum of manifest.provenance.estimatedCostUsd for what was bought)`,
  );
  console.log(
    `latency:       mean ${s.latency.meanMs.toFixed(0)}ms  p50 ${s.latency.p50Ms}ms  p95 ${s.latency.p95Ms}ms  max ${s.latency.maxMs}ms`,
  );
  console.log(`status:        ${JSON.stringify(s.statusCounts)}`);
}
