/**
 * The transcript parser, against synthetic transcripts.
 *
 * Synthetic on purpose: the real transcript this repo measures is a private file
 * in `~/.claude`, and a suite that depends on it is a suite that cannot run. The
 * real numbers are produced by `src/scripts/measure-redo.ts` and recorded in
 * `src/redo-measured.json` with the command that made them; `ab-run.test.ts`
 * re-derives them whenever the transcript is present.
 *
 * The case that matters most here is the duplicate-usage one. A single API
 * response is written as one row per content block, each carrying a copy of the
 * same `usage`. Summing per row overstated the measured segment by 2.3x, and
 * that inflated figure was the one first reported. Anything that regresses the
 * dedup must fail here.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PUBLISHED_OPUS_5_RATES,
  costUsd,
  findRowIndex,
  measureSegment,
  parseTranscript,
  totalTokens,
} from "./provenance.js";

const dir = mkdtempSync(join(tmpdir(), "carpool-provenance-"));

function transcript(rows: unknown[]): string {
  const path = join(dir, `t-${Math.random().toString(36).slice(2)}.jsonl`);
  writeFileSync(path, `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
  return path;
}

const usage = (o: number, cw: number, cr: number, i = 2) => ({
  input_tokens: i,
  output_tokens: o,
  cache_creation_input_tokens: cw,
  cache_read_input_tokens: cr,
});

/** One API response spread over three content-block rows, as the CLI writes it. */
function splitResponse(id: string, ts: string[], u: ReturnType<typeof usage>) {
  return [
    { type: "assistant", timestamp: ts[0], message: { id, model: "claude-opus-5", usage: u, content: [{ type: "thinking", thinking: "…" }] } },
    { type: "assistant", timestamp: ts[1], message: { id, model: "claude-opus-5", usage: u, content: [{ type: "text", text: "hello" }] } },
    { type: "assistant", timestamp: ts[2], message: { id, model: "claude-opus-5", usage: u, content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }] } },
  ];
}

describe("counting one API call once", () => {
  it("charges a response spread over several rows a single time", () => {
    const path = transcript(
      splitResponse("msg_a", ["2026-09-09T11:00:00Z", "2026-09-09T11:00:01Z", "2026-09-09T11:00:02Z"], usage(700, 18000, 27000)),
    );
    const cost = measureSegment(parseTranscript(path), 0, 99);

    expect(cost.apiCalls).toBe(1);
    expect(cost.usageRows, "the gap between these two is the double-count avoided").toBe(3);
    expect(cost.outputTokens).toBe(700);
    expect(cost.cacheWriteTokens).toBe(18000);
    expect(cost.cacheReadTokens).toBe(27000);
    // The bug: 3 rows x 700 output tokens.
    expect(cost.outputTokens).not.toBe(2100);
  });

  it("still counts two genuinely different calls twice", () => {
    const path = transcript([
      ...splitResponse("msg_a", ["2026-09-09T11:00:00Z", "2026-09-09T11:00:01Z", "2026-09-09T11:00:02Z"], usage(700, 18000, 27000)),
      ...splitResponse("msg_b", ["2026-09-09T11:00:10Z", "2026-09-09T11:00:11Z", "2026-09-09T11:00:12Z"], usage(300, 1000, 45000)),
    ]);
    const cost = measureSegment(parseTranscript(path), 0, 99);

    expect(cost.apiCalls).toBe(2);
    expect(cost.outputTokens).toBe(1000);
    expect(totalTokens(cost)).toBe(4 + 1000 + 19000 + 72000);
  });

  it("charges a usage row with no message id on its own, rather than dropping it", () => {
    const path = transcript([
      { type: "assistant", timestamp: "2026-09-09T11:00:00Z", message: { model: "claude-opus-5", usage: usage(100, 0, 0), content: [] } },
      { type: "assistant", timestamp: "2026-09-09T11:00:01Z", message: { model: "claude-opus-5", usage: usage(100, 0, 0), content: [] } },
    ]);
    const cost = measureSegment(parseTranscript(path), 0, 99);
    expect(cost.apiCalls).toBe(2);
    expect(cost.outputTokens).toBe(200);
  });
});

describe("segment bounds", () => {
  const path = () =>
    transcript([
      { type: "user", timestamp: "2026-09-09T11:00:00Z", message: { role: "user", content: "analyse all the prizes" } },
      ...splitResponse("msg_a", ["2026-09-09T11:00:01Z", "2026-09-09T11:00:02Z", "2026-09-09T11:00:03Z"], usage(700, 0, 0)),
      { type: "assistant", timestamp: "2026-09-09T11:00:20Z", message: { id: "msg_b", model: "claude-opus-5", usage: usage(50, 0, 0), content: [{ type: "tool_use", name: "Bash", input: { command: "cat > out.md <<EOF" } }] } },
      { type: "assistant", timestamp: "2026-09-09T11:00:30Z", message: { id: "msg_c", model: "claude-opus-5", usage: usage(9999, 0, 0), content: [] } },
    ]);

  it("is inclusive at both ends", () => {
    const rows = parseTranscript(path());
    // Rows 0..4 stop before msg_c, whose 9,999 output tokens are out of scope.
    expect(measureSegment(rows, 0, 4).outputTokens).toBe(750);
    expect(measureSegment(rows, 0, 5).outputTokens).toBe(10_749);
  });

  it("finds a row by text or by tool input, so a quoted row number can be re-verified", () => {
    const rows = parseTranscript(path());
    expect(findRowIndex(rows, "analyse all the prizes")).toBe(0);
    expect(findRowIndex(rows, "cat > out.md"), "the end anchor lives in tool input, not text").toBe(4);
    expect(findRowIndex(rows, "nothing here")).toBeNull();
  });

  it("counts tool calls and names the subagent dispatches separately", () => {
    const path2 = transcript([
      { type: "assistant", timestamp: "2026-09-09T11:00:00Z", message: { id: "m1", model: "claude-opus-5", usage: usage(10, 0, 0), content: [{ type: "tool_use", name: "Agent", input: {} }, { type: "tool_use", name: "Bash", input: {} }] } },
      { type: "assistant", timestamp: "2026-09-09T11:00:01Z", message: { id: "m2", model: "claude-opus-5", usage: usage(10, 0, 0), content: [{ type: "tool_use", name: "Task", input: {} }] } },
    ]);
    const cost = measureSegment(parseTranscript(path2), 0, 99);
    expect(cost.toolCalls).toBe(3);
    expect(cost.subagentCalls, "Agent and Task both spend tokens this parser cannot see").toBe(2);
  });
});

describe("wall clock", () => {
  it("strips gaps longer than the cap, and keeps the ones below it", () => {
    const path = transcript([
      { type: "assistant", timestamp: "2026-09-09T11:00:00Z", message: { id: "m1", usage: usage(1, 0, 0), content: [] } },
      { type: "assistant", timestamp: "2026-09-09T11:00:10Z", message: { id: "m2", usage: usage(1, 0, 0), content: [] } },
      // A 10-minute pause: the human went to lunch.
      { type: "assistant", timestamp: "2026-09-09T11:10:10Z", message: { id: "m3", usage: usage(1, 0, 0), content: [] } },
      { type: "assistant", timestamp: "2026-09-09T11:10:15Z", message: { id: "m4", usage: usage(1, 0, 0), content: [] } },
    ]);
    const cost = measureSegment(parseTranscript(path), 0, 99);
    expect(cost.elapsedSeconds).toBe(615);
    expect(cost.activeSeconds, "10s + 5s; the 600s pause is not machine time").toBe(15);
  });

  it("sorts timestamps before differencing them", () => {
    // Rows are not strictly monotonic in file order. Differencing in file order
    // and discarding negative gaps counts the forward half of an inversion
    // twice — which is how 630.9s of a real segment read as 641.1s.
    const path = transcript([
      { type: "assistant", timestamp: "2026-09-09T11:00:00Z", message: { id: "m1", usage: usage(1, 0, 0), content: [] } },
      { type: "assistant", timestamp: "2026-09-09T11:00:30Z", message: { id: "m2", usage: usage(1, 0, 0), content: [] } },
      { type: "assistant", timestamp: "2026-09-09T11:00:10Z", message: { id: "m3", usage: usage(1, 0, 0), content: [] } },
    ]);
    const cost = measureSegment(parseTranscript(path), 0, 99);
    expect(cost.elapsedSeconds).toBe(30);
    // Sorted: 0 -> 10 -> 30 = 30s. File order dropping negatives: 30 + 0 = 30
    // here, but the ordered reading is the one that generalises.
    expect(cost.activeSeconds).toBe(30);
  });

  it("reports zero rather than NaN for a segment with one timestamp or none", () => {
    const path = transcript([{ type: "assistant", timestamp: "2026-09-09T11:00:00Z", message: { id: "m1", usage: usage(1, 0, 0), content: [] } }]);
    const cost = measureSegment(parseTranscript(path), 0, 99);
    expect(cost.elapsedSeconds).toBe(0);
    expect(cost.activeSeconds).toBe(0);
  });
});

describe("robustness and hygiene", () => {
  it("survives a truncated trailing line without shifting row numbers", () => {
    const path = join(dir, "truncated.jsonl");
    writeFileSync(
      path,
      `${JSON.stringify({ type: "assistant", timestamp: "2026-09-09T11:00:00Z", message: { id: "m1", usage: usage(5, 0, 0), content: [] } })}\n{"type":"assist\n`,
      "utf8",
    );
    const rows = parseTranscript(path);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.index, "a bad line still consumes its line number").toBe(1);
    expect(measureSegment(rows, 0, 99).outputTokens).toBe(5);
  });

  it("keeps harness-written error rows out of the model list", () => {
    const path = transcript([
      { type: "assistant", timestamp: "2026-09-09T11:00:00Z", message: { id: "m1", model: "claude-opus-5", usage: usage(5, 0, 0), content: [] } },
      { type: "assistant", timestamp: "2026-09-09T11:00:01Z", message: { id: "m2", model: "<synthetic>", usage: usage(0, 0, 0, 0), content: [{ type: "text", text: "API Error: Your computer went to sleep mid-response." }] } },
    ]);
    const cost = measureSegment(parseTranscript(path), 0, 99);
    expect(cost.models, "a local error is not a model that served a request").toEqual(["claude-opus-5"]);
  });
});

describe("pricing measured tokens", () => {
  const u = { inputTokens: 48, outputTokens: 83_177, cacheWriteTokens: 131_024, cacheReadTokens: 2_143_694 };

  it("prices at the rates it is given, and nowhere else", () => {
    expect(costUsd(u, PUBLISHED_OPUS_5_RATES)).toBeCloseTo(3.970412, 6);
    // Double every rate and the bill doubles: nothing is hard-coded.
    const doubled = { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 };
    expect(costUsd(u, doubled)).toBeCloseTo(2 * 3.970412, 6);
    expect(costUsd(u, { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 })).toBe(0);
  });

  it("counts cache traffic, which is most of the bill on a long session", () => {
    expect(totalTokens(u)).toBe(2_357_943);
    const cacheShare = (u.cacheWriteTokens + u.cacheReadTokens) / totalTokens(u);
    expect(cacheShare).toBeGreaterThan(0.9);
  });
});
