/**
 * Measure the redo side of the A/B from a real Claude Code session transcript.
 *
 *   pnpm --filter @carpool/bench measure:redo -- <transcript.jsonl> \
 *     --from 8 --to 222 \
 *     [--start-anchor "..."] [--end-anchor "..."] [--json]
 *
 * This is a script rather than a test because the transcript it reads is a
 * private file in the operator's `~/.claude` directory. `pnpm test` must stay
 * hermetic, so the parser's behaviour is asserted against synthetic rows in
 * `provenance.test.ts` and the real numbers are produced here, on demand, by
 * whoever has the record.
 *
 * The dollar figure is printed at the rates given, and the rates are printed
 * with it. There is no default rate card: `--rates` may be omitted only to get
 * Claude Opus 5's published list price, which is itself printed and dated.
 */
import {
  ACTIVE_GAP_CAP_SECONDS,
  PUBLISHED_OPUS_5_RATES,
  costUsd,
  findRowIndex,
  measureSegment,
  parseTranscript,
  totalTokens,
  type Rates,
} from "../provenance.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function main(): void {
  const path = process.argv.slice(2).find((a) => !a.startsWith("--") && a.endsWith(".jsonl"));
  if (!path) {
    console.error(
      "usage: measure-redo <transcript.jsonl> --from <row> --to <row> [--start-anchor s] [--end-anchor s] [--json]",
    );
    process.exit(2);
  }

  const rows = parseTranscript(path);
  const from = Number(arg("from") ?? 0);
  const to = Number(arg("to") ?? rows.length - 1);

  // Anchors are optional but strongly recommended: a transcript is append-only
  // and still being written to, so a row *number* quoted in a document is only
  // meaningful if the row it names can be re-identified by content.
  const startAnchor = arg("start-anchor");
  const endAnchor = arg("end-anchor");
  const anchorReport: string[] = [];
  for (const [label, needle, expected] of [
    ["start", startAnchor, from],
    ["end", endAnchor, to],
  ] as const) {
    if (!needle) continue;
    const found = findRowIndex(rows, needle);
    anchorReport.push(
      found === expected
        ? `  ${label} anchor confirmed at row ${expected}: ${JSON.stringify(needle.slice(0, 60))}`
        : `  ${label} anchor MISMATCH: ${JSON.stringify(needle.slice(0, 60))} is at row ${found}, not ${expected}`,
    );
  }

  const cost = measureSegment(rows, from, to);
  const rates: Rates = arg("rates")
    ? (JSON.parse(arg("rates")!) as Rates)
    : PUBLISHED_OPUS_5_RATES;

  const sidechainRows = rows.filter((r) => r.isSidechain).length;
  const total = totalTokens(cost);
  const usd = costUsd(cost, rates);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ path, from, to, cost, rates, totalTokens: total, usd }, null, 2));
    return;
  }

  const L: string[] = [];
  L.push(`REDO — measured from ${path}`);
  L.push(`  segment: rows ${from}..${to} inclusive, of ${rows.length} rows in the file`);
  L.push(...anchorReport);
  L.push("");
  L.push(`  model(s)            ${cost.models.join(", ") || "(none recorded)"}`);
  L.push(`  API calls           ${cost.apiCalls}  (from ${cost.usageRows} rows carrying a usage block)`);
  L.push(`  input tokens        ${cost.inputTokens.toLocaleString("en-US")}`);
  L.push(`  output tokens       ${cost.outputTokens.toLocaleString("en-US")}`);
  L.push(`  cache write tokens  ${cost.cacheWriteTokens.toLocaleString("en-US")}`);
  L.push(`  cache read tokens   ${cost.cacheReadTokens.toLocaleString("en-US")}`);
  L.push(`  TOTAL tokens        ${total.toLocaleString("en-US")}`);
  L.push("");
  L.push(`  elapsed             ${cost.elapsedSeconds.toFixed(1)}s  (includes waiting on the human)`);
  L.push(
    `  assistant-active    ${cost.activeSeconds.toFixed(1)}s  (gaps <= ${ACTIVE_GAP_CAP_SECONDS}s, timestamps sorted)`,
  );
  L.push(`  tool calls          ${cost.toolCalls}`);
  L.push(`  subagent dispatches ${cost.subagentCalls}  — their tokens are NOT in the totals above`);
  L.push(`  sidechain rows      ${sidechainRows}  — ${sidechainRows === 0 ? "no subagent turns were retained" : "subagent turns are present"}`);
  L.push("");
  L.push(`  cost                $${usd.toFixed(4)}`);
  L.push(
    `  at rates ($/MTok)   input ${rates.input} · output ${rates.output} · ` +
      `cache write ${rates.cacheWrite} · cache read ${rates.cacheRead}`,
  );
  L.push("");
  L.push("  Tokens and timestamps are measured. The dollar figure is those tokens priced at the");
  L.push("  rates printed above — state them wherever the number is quoted.");
  if (cost.subagentCalls > 0) {
    L.push(
      `  This is a FLOOR: ${cost.subagentCalls} subagent dispatches spent tokens in transcripts this ` +
        "did not read.",
    );
  }
  console.log(L.join("\n"));
}

main();
