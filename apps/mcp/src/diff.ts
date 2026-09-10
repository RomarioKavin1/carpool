import type { ScanResult } from "./scan.js";

/**
 * What the user sees before approving a publish.
 *
 * Ordered deliberately. Nobody reviews 40 KB of prose in a dialog, so the
 * question leads — it is usually the leakiest single line ("how do I fix the
 * auth bypass in our payment flow" tells a reader plenty before anyone opens
 * the body). Then the abstract, then the source URLs, then what the scan
 * stripped, and only then the body, behind an expander.
 */
export function renderPublishDiff(input: {
  scan: ScanResult;
  bodyBytes: number;
  priceMicroUsdc: number;
  halfLifeDays: number;
}): string {
  const { redacted, findings } = input.scan;
  const lines: string[] = [];

  lines.push("PUBLISHING THIS RESEARCH — review before approving");
  lines.push("");
  lines.push("QUESTION (published verbatim, and usually the leakiest line):");
  lines.push(`  ${redacted.question}`);
  lines.push("");
  lines.push("ABSTRACT:");
  for (const l of wrap(redacted.abstract, 76)) lines.push(`  ${l}`);
  lines.push("");
  lines.push(`SOURCES (${redacted.sources.length}, published in full):`);
  for (const s of redacted.sources.slice(0, 12)) lines.push(`  ${s.url}`);
  if (redacted.sources.length > 12) lines.push(`  … and ${redacted.sources.length - 12} more`);
  lines.push("");

  if (findings.length > 0) {
    lines.push(`REMOVED BY THE PRE-PUBLISH SCAN (${findings.length}):`);
    for (const f of findings) lines.push(`  ${f.where}: ${f.what} (${f.kind})`);
    lines.push("");
    lines.push("  These were stripped, not flagged — they are already gone from what would be published.");
  } else {
    lines.push("PRE-PUBLISH SCAN: nothing removed.");
  }
  lines.push("");
  lines.push(
    `BODY: ${fmtBytes(input.bodyBytes)} — not shown here. Ask to see it before approving if you want to read it.`,
  );
  lines.push("");
  lines.push(
    `TERMS: listed at ${(input.priceMicroUsdc / 1e6).toFixed(4)} USDC, halving every ${input.halfLifeDays} day(s).`,
  );
  lines.push(
    "IRREVERSIBLE: delisting stops new sales. It cannot recall a copy someone has already paid for.",
  );
  return lines.join("\n");
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width) {
      out.push(line.trim());
      line = w;
    } else line += " " + w;
  }
  if (line.trim()) out.push(line.trim());
  return out;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
