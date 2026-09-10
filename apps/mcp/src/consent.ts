/**
 * Publishing consent — the decision, in one place, called by the hook that runs.
 *
 * An MCP server cannot tell that it is running inside a subagent. Only the
 * client knows, so only the client can enforce it: this is the decision function
 * for a `PreToolUse` hook, and `hooks/pre-publish.mjs` imports it rather than
 * reimplementing it.
 *
 * It used to reimplement it. `decideConsent` had five tests and exactly one
 * importer — its own test file — while the hook Claude Code actually executed
 * carried a hand-written subset with different reason strings and a different
 * mode vocabulary. The acceptance criterion ("publish denied in a subagent,
 * proven by test") was therefore proven for a function no hook called. Worse,
 * the two disagreed on the thing that mattered: this function could return
 * `allow`, from an `auto` mode plus a list of "approved projects", so the tested
 * decision could publish without asking while the executed one always asked.
 *
 * The requirement is explicit and is now the type, not a convention:
 *
 *   **Auto-listing always asks permission first, and can be turned off.**
 *
 * So `Decision` has no `allow` member. There is no mode, permission mode,
 * project, or recorded history that publishes research without a human answering
 * a prompt — that is why the earlier `auto` / `approvedProjects` /
 * "approval recorded in PostToolUse" design is gone rather than repaired. (No
 * `PostToolUse` hook ever existed to record anything, which is the other half of
 * why: the story described machinery that was never written.)
 *
 * What remains is two answers, and "off" is the way to turn it off:
 *
 *   - `deny` — this call cannot publish at all, and the reason says why.
 *   - `ask`  — put it to the user. The only route to a publish.
 */

/** How publishing is configured here. `off` is the off switch. */
export type ConsentMode = "ask" | "off";

/**
 * What the hook tells Claude Code.
 *
 * Deliberately missing `allow`: see the module comment. If a future
 * requirement ever wants an auto-publish, it has to add the member, which makes
 * the change visible in a diff and breaks every exhaustive check — rather than
 * being reachable by setting an environment variable.
 */
export type Decision = "deny" | "ask";

export const CONSENT_MODES: readonly ConsentMode[] = ["ask", "off"];

/** The env var an operator or project sets to turn publishing off. */
export const CONSENT_MODE_ENV = "CARPOOL_PUBLISH_MODE";

export interface HookInput {
  /** Present when the invocation comes from a subagent. */
  agent_id?: string;
  /** Claude Code's permission mode for this session. */
  permission_mode?: string;
  tool_name?: string;
}

export interface ConsentConfig {
  /**
   * The raw `CARPOOL_PUBLISH_MODE` value, unvalidated on purpose: an
   * unrecognised mode must be refused with a message naming the valid ones, not
   * silently treated as the default. A typo in the off switch should not publish.
   */
  mode?: string;
}

export interface ConsentDecision {
  decision: Decision;
  /** Shown to the user, so it must say what actually happened. */
  reason: string;
}

/**
 * Permission modes that do not prompt.
 *
 * Publishing is irreversible and must never be auto-approved: a mode chosen to
 * speed up file edits should not also put someone's research on sale. Since
 * `ask` is the only path to a publish and these modes cannot ask, they are a
 * denial rather than a silent allow.
 */
const NON_PROMPTING_MODES = new Set(["bypassPermissions", "acceptEdits", "dontAsk", "auto"]);

/**
 * The prompt text. Exported so the hook, the tool description and the tests all
 * quote one string rather than three that drift.
 */
export const ASK_REASON =
  "Publishing puts this research on sale. It cannot be recalled once bought — delisting stops new " +
  "sales but copies already paid for stay with their buyers. Review the question, sources and " +
  "stripped items before approving.";

export function decideConsent(input: HookInput, cfg: ConsentConfig = {}): ConsentDecision {
  if (input.agent_id) {
    return {
      decision: "deny",
      reason:
        "carpool_publish is not available to subagents. Publishing is irreversible and needs a human in an " +
        "interactive session; a subagent cannot be one.",
    };
  }

  if (input.permission_mode && NON_PROMPTING_MODES.has(input.permission_mode)) {
    return {
      decision: "deny",
      reason:
        `carpool_publish is not available in permission mode "${input.permission_mode}", which does not prompt. ` +
        "Publishing cannot be auto-approved.",
    };
  }

  const raw = cfg.mode?.trim();
  if (raw === "off") {
    return {
      decision: "deny",
      reason: `Publishing is turned off here (${CONSENT_MODE_ENV}=off).`,
    };
  }
  if (raw !== undefined && raw !== "" && raw !== "ask") {
    return {
      decision: "deny",
      reason:
        `${CONSENT_MODE_ENV} is set to "${raw}", which is not one of ${CONSENT_MODES.join(" | ")}. ` +
        "Refusing rather than guessing at an irreversible action.",
    };
  }

  return { decision: "ask", reason: ASK_REASON };
}

/**
 * The `hookSpecificOutput` envelope Claude Code expects from a `PreToolUse`
 * hook. Built here, not in the hook, so the wire shape is covered by the same
 * tests as the decision.
 */
export function hookOutput(d: ConsentDecision): {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    permissionDecision: Decision;
    permissionDecisionReason: string;
  };
} {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: d.decision,
      permissionDecisionReason: d.reason,
    },
  };
}
