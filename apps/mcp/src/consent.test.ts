import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ASK_REASON, CONSENT_MODE_ENV, decideConsent, hookOutput, type HookInput } from "./consent.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "..");
const HOOK = join(PKG, "hooks", "pre-publish.mjs");

/**
 * Runs the hook Claude Code actually executes, as a process, over stdin — the
 * same way the client invokes it.
 */
function runHook(input: HookInput, env: Record<string, string | undefined> = {}) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, CARPOOL_PUBLISH_MODE: undefined, ...env } as NodeJS.ProcessEnv,
  });
  expect(res.status, res.stderr).toBe(0);
  return JSON.parse(res.stdout) as ReturnType<typeof hookOutput>;
}

beforeAll(() => {
  // The hook imports `dist/consent.js` — the compiled module, because that is
  // what it will load on a user's machine, and a hook that loaded TypeScript
  // source would be testing something the client cannot run. CI builds before
  // it tests; a bare `pnpm test` on a fresh checkout does not (turbo's `test`
  // depends on `^build`, dependencies only), so build on demand.
  if (!existsSync(join(PKG, "dist", "consent.js"))) {
    const built = spawnSync("npx", ["tsc"], { cwd: PKG, encoding: "utf8" });
    expect(built.status, built.stdout + built.stderr).toBe(0);
  }
}, 120_000);

/**
 * I7 — the consent decision that is tested is the one that runs.
 *
 * `decideConsent` had five tests and one importer: its own test file. The hook
 * Claude Code executes carried a *separate* hand-written subset of the same
 * rules, with different reason strings and no `auto` path. So the plan's Phase F
 * acceptance ("publish denied in a subagent, proven by test") was proven for a
 * function no hook called — and the two disagreed on the requirement itself,
 * because `decideConsent` could return `allow` while the hook always asked.
 */
describe("auto-listing always asks permission first", () => {
  it("has no `allow` outcome at all, under any input or mode", () => {
    const inputs: HookInput[] = [
      {},
      { permission_mode: "default" },
      { permission_mode: "plan" },
      { tool_name: "mcp__carpool__carpool_publish" },
      { agent_id: "sub-1" },
      { permission_mode: "bypassPermissions" },
    ];
    // Including the vocabulary the removed design used to allow on: `auto`, and
    // a project that had "recorded a prior approval".
    const modes = [undefined, "", "ask", "off", "auto", "always", "yes", "ALLOW"];
    for (const input of inputs) {
      for (const mode of modes) {
        const d = decideConsent(input, { mode });
        expect(["ask", "deny"], `${JSON.stringify(input)} + mode=${mode}`).toContain(d.decision);
      }
    }
  });

  it("asks by default — the path that must stay reachable", () => {
    // The original design was circular: deny-by-default until an approval was
    // recorded, with the approval recorded when the user answered a prompt that
    // deny-by-default prevented from ever appearing.
    const d = decideConsent({});
    expect(d.decision).toBe("ask");
    expect(d.reason).toMatch(/cannot be recalled|already paid/i);
  });

  it("can be turned off", () => {
    const d = decideConsent({}, { mode: "off" });
    expect(d.decision).toBe("deny");
    expect(d.reason).toContain(`${CONSENT_MODE_ENV}=off`);
  });

  it("refuses an unrecognised mode instead of falling back to asking", () => {
    // A typo in the off switch must not publish. `auto` is specifically here:
    // it used to be a real mode that could allow.
    for (const mode of ["auto", "of", "OFF", "true"]) {
      const d = decideConsent({}, { mode });
      expect(d.decision, mode).toBe("deny");
      expect(d.reason).toContain("not one of");
    }
  });

  it("denies a subagent regardless of mode", () => {
    for (const mode of [undefined, "ask", "off"]) {
      const d = decideConsent({ agent_id: "sub-1" }, { mode });
      expect(d.decision).toBe("deny");
      expect(d.reason).toMatch(/subagent/i);
    }
  });

  it("denies every non-prompting permission mode", () => {
    for (const pm of ["bypassPermissions", "acceptEdits", "dontAsk", "auto"]) {
      const d = decideConsent({ permission_mode: pm });
      expect(d.decision, `${pm} must not auto-approve a publish`).toBe("deny");
      expect(d.reason).toMatch(/does not prompt/);
    }
  });
});

describe("hooks/pre-publish.mjs — the executed path IS the tested one", () => {
  const cases: { name: string; input: HookInput; mode?: string }[] = [
    { name: "default session", input: {} },
    { name: "explicit ask", input: {}, mode: "ask" },
    { name: "turned off", input: {}, mode: "off" },
    { name: "subagent", input: { agent_id: "sub-7" } },
    { name: "subagent while off", input: { agent_id: "sub-7" }, mode: "off" },
    { name: "bypassPermissions", input: { permission_mode: "bypassPermissions" } },
    { name: "acceptEdits", input: { permission_mode: "acceptEdits" } },
    { name: "dontAsk", input: { permission_mode: "dontAsk" } },
    { name: "permission_mode auto", input: { permission_mode: "auto" } },
    { name: "unrecognised mode", input: {}, mode: "auto" },
    { name: "normal interactive mode", input: { permission_mode: "default" } },
  ];

  for (const c of cases) {
    it(`${c.name}: the hook emits exactly decideConsent's decision and reason`, () => {
      const expected = hookOutput(decideConsent(c.input, { mode: c.mode }));
      expect(runHook(c.input, { CARPOOL_PUBLISH_MODE: c.mode })).toEqual(expected);
    });
  }

  it("never emits `allow`, whatever it is handed", () => {
    for (const c of cases) {
      const out = runHook(c.input, { CARPOOL_PUBLISH_MODE: c.mode });
      expect(out.hookSpecificOutput.permissionDecision).not.toBe("allow");
    }
  });

  it("reports the ask text the module owns, not a second copy of it", () => {
    const out = runHook({});
    expect(out.hookSpecificOutput.permissionDecision).toBe("ask");
    expect(out.hookSpecificOutput.permissionDecisionReason).toBe(ASK_REASON);
  });

  it("denies rather than guessing when its input cannot be parsed", () => {
    const res = spawnSync(process.execPath, [HOOK], { input: "not json", encoding: "utf8" });
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/could not read its input/);
  });
});
