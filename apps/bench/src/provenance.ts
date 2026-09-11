/**
 * Recover what producing an artifact actually cost, from a Claude Code session
 * transcript.
 *
 * This exists because the previous version of the A/B "measurement" was not a
 * measurement: the redo-side numbers were literals typed into a test fixture
 * and then transcribed into the docs as results. The only way a redo cost is
 * honest is if something reads it off a record of the work, so this reads the
 * recorded per-turn `usage` blocks out of the session's own JSONL.
 *
 * ## What is a measurement here and what is not
 *
 * MEASURED: token counts (input, output, cache-write, cache-read) and
 * timestamps. These are recorded by the harness at the time of the call.
 *
 * ASSUMED: the dollar rates. Tokens are a fact; their price is a price list
 * that changes. `costUsd` therefore takes the rates as an argument and the
 * caller must state them, so a reader can re-derive the number against
 * whatever the rates are when they read it. See `PUBLISHED_OPUS_5_RATES` for
 * the one further trap: the *recorded* rate a session was billed at is not
 * necessarily the published one.
 *
 * A FLOOR, NOT A TOTAL: subagent turns run in their own transcripts, which are
 * not retained alongside the parent session. A segment that dispatched agents
 * spent strictly more than this reports. `subagentCalls` carries the count so
 * the shortfall is visible rather than silent.
 *
 * ## One usage block per API call, not per row — the trap that inflates by 3x
 *
 * A single API response is written to the JSONL as **several rows**: one per
 * content block (`thinking`, then `text`, then each `tool_use`). Every one of
 * those rows carries a *copy* of the same `message.usage`, and they share a
 * `message.id` and a `requestId`. Summing usage per row therefore counts most
 * calls two to six times over.
 *
 * In the segment this repo measures, 56 rows carry a usage block but they are
 * only 25 distinct API calls, and the naive per-row sum reports 5,431,568
 * tokens against an actual 2,357,943 — a 2.3x overstatement. The error is not
 * subtle once you look for it, and it is checkable without trusting this code:
 * the session's own `cost-state` rows record a cumulative 127,733 output tokens
 * for the whole session, while the per-row sum claims 244,810 output tokens for
 * a *subset* of it. A subset cannot exceed its superset.
 *
 * `measureSegment` therefore dedupes by `message.id` and reports `apiCalls`
 * alongside `usageRows` so the collapse is visible in the output.
 */
import { readFileSync } from "node:fs";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

export interface Rates {
  /** USD per million tokens. */
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

/**
 * Claude Opus 5's published per-MTok list price as of 2026-09-12: $5 input,
 * $25 output, with cache writes at 1.25x input and cache reads at 0.1x input.
 *
 * This is a dated snapshot of a price list, not a constant of nature — that is
 * why nothing here reads it implicitly and every caller passes rates in.
 *
 * It is also **not** necessarily what a given session was billed. The session
 * measured in docs/AB-MEASUREMENT.md ran on the 1M-context tier, which Claude
 * Code's own accounting records under the model key `claude-opus-5[1m]` with a
 * `costUSD` about 1.19x what these rates predict for the same token counts.
 * The long-context premium is not derivable from the transcript (two
 * independent `cost-state` snapshots imply different multipliers, 1.187 and
 * 1.259, so it is not a flat factor), so a dollar figure computed here is a
 * figure *at these rates* and must be labelled as such.
 */
export const PUBLISHED_OPUS_5_RATES: Rates = {
  input: 5,
  output: 25,
  cacheWrite: 6.25,
  cacheRead: 0.5,
};

export interface SegmentCost extends TokenUsage {
  models: string[];
  /** Wall clock from the first row to the last, including time spent waiting on the human. */
  elapsedSeconds: number;
  /**
   * Wall clock with human-latency gaps removed: the sum of inter-row gaps
   * shorter than `activeGapCapSeconds`. A lower bound on machine time and an
   * upper bound on nothing — a genuinely slow single call is still counted.
   */
  activeSeconds: number;
  toolCalls: number;
  /** Agent dispatches whose own token spend is NOT included above. */
  subagentCalls: number;
  /** Distinct API calls counted. The denominator for any per-call average. */
  apiCalls: number;
  /**
   * Rows that carried a usage block. Larger than `apiCalls` whenever a response
   * spanned several content blocks; the gap is the double-count that was
   * avoided, and is printed so a reader can see the dedup happened.
   */
  usageRows: number;
}

export const ACTIVE_GAP_CAP_SECONDS = 120;

/**
 * Tool names that spend tokens in a transcript this parser cannot see.
 *
 * `Agent` is the current name and `Task` the historical one; both dispatch a
 * subagent whose turns are recorded as `isSidechain` rows in a separate file,
 * or not retained at all.
 */
export const SUBAGENT_TOOL_NAMES: readonly string[] = ["Agent", "Task"];

export function totalTokens(u: TokenUsage): number {
  return u.inputTokens + u.outputTokens + u.cacheWriteTokens + u.cacheReadTokens;
}

/** Dollars at the caller's stated rates. Rates are an input, never a constant. */
export function costUsd(u: TokenUsage, r: Rates): number {
  return (
    (u.inputTokens * r.input +
      u.outputTokens * r.output +
      u.cacheWriteTokens * r.cacheWrite +
      u.cacheReadTokens * r.cacheRead) /
    1_000_000
  );
}

/** One JSONL row, reduced to the fields a cost measurement depends on. */
export interface TranscriptRow {
  /** Zero-based line number in the file. Segment bounds are quoted in these. */
  index: number;
  type: string | null;
  timestamp: string | null;
  epochMs: number | null;
  /**
   * `message.id`. The API-call identity: rows sharing one are content blocks of
   * a single response and carry duplicate usage.
   */
  messageId: string | null;
  model: string | null;
  /** Present only on assistant rows the API billed. */
  usage: TokenUsage | null;
  /** `tool_use` block names in this row, in order. */
  toolNames: string[];
  isSidechain: boolean;
  /** The first text/thinking block, truncated — enough to verify a segment anchor. */
  preview: string;
  /**
   * Each `tool_use` block's input, JSON-serialised and truncated. The end of the
   * measured segment is a `Bash` heredoc writing the artifact, which is
   * identifiable only from the tool input — so anchoring needs this, not just
   * `preview`.
   */
  toolInputs: string[];
}

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface RawRow {
  type?: string;
  timestamp?: string;
  isSidechain?: boolean;
  message?: {
    id?: string;
    model?: string;
    role?: string;
    usage?: RawUsage;
    content?: unknown;
  };
}

/**
 * A model name that means "the harness wrote this row itself".
 *
 * Claude Code records local errors (a dropped connection, a machine that went
 * to sleep mid-response) as assistant rows with `model: "<synthetic>"` and an
 * all-zero usage block. They are real events but not API calls, so they must
 * not appear in the model list a report prints.
 */
const SYNTHETIC_MODEL = "<synthetic>";

function readUsage(u: RawUsage | undefined): TokenUsage | null {
  if (!u) return null;
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
  };
}

/**
 * Parse a Claude Code session JSONL into rows.
 *
 * Unparseable lines become rows with everything null rather than throwing: a
 * transcript is an append-only log that can be truncated mid-write, and one bad
 * trailing line should not cost the whole measurement. Their index is still
 * consumed so that `index` stays equal to the line number — segment bounds are
 * quoted as line numbers and must not shift.
 */
export function parseTranscript(path: string): TranscriptRow[] {
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.length > 0);
  return lines.map((line, index) => {
    let raw: RawRow;
    try {
      raw = JSON.parse(line) as RawRow;
    } catch {
      return {
        index,
        type: null,
        timestamp: null,
        epochMs: null,
        messageId: null,
        model: null,
        usage: null,
        toolNames: [],
        isSidechain: false,
        preview: "",
        toolInputs: [],
      };
    }

    const toolNames: string[] = [];
    const toolInputs: string[] = [];
    let preview = "";
    const content = raw.message?.content;
    if (Array.isArray(content)) {
      const blocks = content as {
        type?: string;
        name?: string;
        text?: string;
        thinking?: string;
        input?: unknown;
      }[];
      for (const block of blocks) {
        if (block.type === "tool_use" && typeof block.name === "string") {
          toolNames.push(block.name);
          toolInputs.push(JSON.stringify(block.input ?? null).slice(0, 400));
        }
        if (!preview) preview = (block.text ?? block.thinking ?? "").slice(0, 200);
      }
    } else if (typeof content === "string") {
      preview = content.slice(0, 200);
    }

    const epoch = raw.timestamp ? Date.parse(raw.timestamp) : Number.NaN;
    return {
      index,
      type: raw.type ?? null,
      timestamp: raw.timestamp ?? null,
      epochMs: Number.isFinite(epoch) ? epoch : null,
      messageId: raw.message?.id ?? null,
      model: raw.message?.model ?? null,
      usage: readUsage(raw.message?.usage),
      toolNames,
      isSidechain: raw.isSidechain === true,
      preview,
      toolInputs,
    };
  });
}

/**
 * Sum one inclusive row range into a cost.
 *
 * Both bounds are inclusive line numbers, so a segment quoted in a document is
 * the same range someone else can re-run.
 *
 * `activeSeconds` sorts the timestamps before differencing them. Rows are not
 * strictly monotonic — a row written after a tool result can carry an earlier
 * timestamp than the assistant row that requested it — and in the measured
 * segment five steps go backwards. Differencing in file order and discarding
 * the negative gaps (rather than ordering first) silently inflates the total:
 * it counts the forward half of each inversion twice and the backward half not
 * at all, which is how a 630.9 s span reads as 641.1 s.
 */
export function measureSegment(
  rows: readonly TranscriptRow[],
  fromIndex: number,
  toIndex: number,
  activeGapCapSeconds: number = ACTIVE_GAP_CAP_SECONDS,
): SegmentCost {
  const segment = rows.filter((r) => r.index >= fromIndex && r.index <= toIndex);

  const totals: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
  };
  const seenCalls = new Set<string>();
  const models = new Set<string>();
  let usageRows = 0;
  let toolCalls = 0;
  let subagentCalls = 0;

  for (const row of segment) {
    for (const name of row.toolNames) {
      toolCalls++;
      if (SUBAGENT_TOOL_NAMES.includes(name)) subagentCalls++;
    }

    if (!row.usage) continue;
    usageRows++;

    // Dedupe on the API-call identity, not the row. A row with no message.id
    // cannot be matched to a sibling, so it is charged once on its own index —
    // counting it is the safe direction when the alternative is dropping a
    // real call.
    const callId = row.messageId ?? `row:${row.index}`;
    if (seenCalls.has(callId)) continue;
    seenCalls.add(callId);

    totals.inputTokens += row.usage.inputTokens;
    totals.outputTokens += row.usage.outputTokens;
    totals.cacheWriteTokens += row.usage.cacheWriteTokens;
    totals.cacheReadTokens += row.usage.cacheReadTokens;
    if (row.model && row.model !== SYNTHETIC_MODEL) models.add(row.model);
  }

  const stamps = segment
    .map((r) => r.epochMs)
    .filter((ms): ms is number => ms !== null)
    .sort((a, b) => a - b);

  let elapsedSeconds = 0;
  let activeSeconds = 0;
  if (stamps.length > 1) {
    elapsedSeconds = (stamps[stamps.length - 1]! - stamps[0]!) / 1000;
    for (let i = 1; i < stamps.length; i++) {
      const gap = (stamps[i]! - stamps[i - 1]!) / 1000;
      if (gap <= activeGapCapSeconds) activeSeconds += gap;
    }
  }

  return {
    ...totals,
    models: [...models],
    elapsedSeconds,
    activeSeconds,
    toolCalls,
    subagentCalls,
    apiCalls: seenCalls.size,
    usageRows,
  };
}

/**
 * Locate a row by a substring of its text, tool input, or preview.
 *
 * Segment bounds live in a document as line numbers, which are stable only for
 * an append-only file. Anchoring the bounds to content as well means a reader
 * who re-runs this against a transcript that has since grown can confirm the
 * numbers still name the same two rows.
 */
export function findRowIndex(
  rows: readonly TranscriptRow[],
  needle: string,
  fromIndex = 0,
): number | null {
  for (const row of rows) {
    if (row.index < fromIndex) continue;
    if (row.preview.includes(needle)) return row.index;
    if (row.toolInputs.some((i) => i.includes(needle))) return row.index;
  }
  return null;
}
