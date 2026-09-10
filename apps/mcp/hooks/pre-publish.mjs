#!/usr/bin/env node
/**
 * PreToolUse hook for carpool_publish.
 *
 * This exists because an MCP server cannot tell that it is running inside a
 * subagent. Only the client knows, so only the client can enforce it.
 *
 * **It decides nothing itself.** Every rule lives in `src/consent.ts` and is
 * imported from the compiled `dist/consent.js` below. That is the whole point of
 * this file's current shape: it used to carry a hand-written subset of those
 * rules — different reason strings, a different mode vocabulary, no awareness of
 * the `auto` path — while `decideConsent`'s five tests covered the copy nobody
 * executed. The tested decision could `allow`; this one always asked. Two
 * implementations of one security decision, and the tests were pointed at the
 * wrong one.
 *
 * What the decision can actually see, and therefore what it decides on:
 *   - `agent_id`        — present for a subagent. Deniable, and denied.
 *   - `permission_mode` — a non-prompting mode must never auto-approve a
 *                         publish, which is irreversible.
 *   - `CARPOOL_PUBLISH_MODE` — `ask` (default) or `off`. Nothing else.
 *
 * What it cannot see: whether the session is `-p`, headless, or backgrounded.
 * There is no documented field for that. So the README says what this does —
 * denies subagents, non-prompting modes and `off`, otherwise asks — and does not
 * claim "blocked outside interactive sessions", which would be a lie.
 *
 * There is no `allow` outcome. Auto-listing always asks first.
 *
 * Install:
 *   "hooks": { "PreToolUse": [{ "matcher": "mcp__carpool__carpool_publish",
 *              "hooks": [{ "type": "command", "command": "node <path>/pre-publish.mjs" }] }] }
 *   Run `pnpm --filter @carpool/mcp build` first — this loads dist/consent.js.
 */
import { readFileSync } from "node:fs";

/** Emit and exit. Every exit from this file goes through here. */
function emit(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  // Unparseable input is not a reason to let an irreversible action through.
  emit("deny", "carpool publish hook could not read its input; refusing rather than guessing.");
}

// Fail closed on a missing build rather than falling back to a second copy of
// the rules — a fallback is how the two implementations diverged in the first
// place.
let decideConsent, hookOutput;
try {
  ({ decideConsent, hookOutput } = await import(new URL("../dist/consent.js", import.meta.url).href));
} catch (e) {
  emit(
    "deny",
    "carpool publish hook could not load its decision module (dist/consent.js): " +
      `${e.message}. Run \`pnpm --filter @carpool/mcp build\`. Refusing rather than guessing.`,
  );
}

const out = hookOutput(decideConsent(input, { mode: process.env.CARPOOL_PUBLISH_MODE }));
process.stdout.write(JSON.stringify(out));
