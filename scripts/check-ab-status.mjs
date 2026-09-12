// Fails when a run of the A/B measurement cannot say what it verified.
//
// `apps/bench/src/ab-run.test.ts` needs two inputs that live outside the
// repository: the artifact, and the producing session's transcript. On a bare
// checkout both are absent, so the measurement half of that file skips — and for
// as long as the skip left no trace, CI reported `42 passed | 4 skipped`, exited
// 0, and the repo's headline anti-fabrication check ran on exactly one laptop
// while every commit looked green.
//
// The runner now always writes a status file (`CARPOOL_AB_STATUS=<path>`). This
// script reads it and turns "nothing was verified" into a line you cannot miss,
// and "no status file at all" into a failure — because a missing status file
// means the whole test file did not execute, which is the one case a skip count
// cannot distinguish from a pass.
//
// Usage: node scripts/check-ab-status.mjs <status.json> [--require-measurement]
//
// `--require-measurement` is for a machine that is supposed to have the inputs
// (the release checklist; `CARPOOL_AB_STRICT=1` on the runner does the same
// thing from the other side). Without it, an honest skip is allowed — but it is
// announced, and the doc/record guards in `ab-doc.test.ts` are never skipped
// anywhere, which is what CI actually enforces.
import { existsSync, readFileSync } from "node:fs";

const [path, ...flags] = process.argv.slice(2);
const requireMeasurement = flags.includes("--require-measurement");

if (!path) {
  console.error("usage: node scripts/check-ab-status.mjs <status.json> [--require-measurement]");
  process.exit(2);
}

if (!existsSync(path)) {
  console.error(
    `\n  FAIL: ${path} does not exist.\n\n` +
      "  `pnpm ab:run` writes it unconditionally when CARPOOL_AB_STATUS is set, including when\n" +
      "  the artifact and transcript are absent. No file means the runner did not execute at all,\n" +
      "  which is indistinguishable from a pass in a test summary. That is the failure mode this\n" +
      "  check exists for.\n",
  );
  process.exit(1);
}

let status;
try {
  status = JSON.parse(readFileSync(path, "utf8"));
} catch (e) {
  console.error(`\n  FAIL: ${path} is not readable JSON: ${e.message}\n`);
  process.exit(1);
}

const lines = [
  "",
  "  A/B measurement status",
  "  ----------------------",
  `  node                 ${status.node}`,
  `  artifact             ${status.artifactPresent ? "present" : "ABSENT"}  ${status.artifactPath}`,
  `  transcript           ${status.transcriptPresent ? "present" : "ABSENT"}  ${status.transcriptPath}`,
  `  redo re-derived      ${status.redoReDerived ? "yes" : "NO"}`,
  `  round trip ran       ${status.roundTripRan ? "yes" : "NO"}`,
  "",
];

const verified = status.redoReDerived === true && status.roundTripRan === true;

if (verified) {
  lines.push(
    "  VERIFIED on this machine: redo-measured.json was re-derived from the transcript and the",
    "  publish -> search -> pay -> verify round trip ran against the real registry.",
    "",
  );
  console.log(lines.join("\n"));
  process.exit(0);
}

lines.push(
  "  NOT VERIFIED HERE. The recorded measurement was not re-derived in this run, because the",
  "  inputs are not on this machine. What still ran, and still fails the build if it drifts:",
  "  apps/bench/src/ab-doc.test.ts and apps/dashboard/lib/measured.test.ts check every figure in",
  "  docs/AB-MEASUREMENT.md and apps/dashboard/lib/measured.ts against the committed records, and",
  "  the records against each other's arithmetic. What did NOT run: the check that the records",
  "  match the artifact and the transcript. Only a machine with both can do that.",
  "",
);

if (requireMeasurement) {
  lines.push(
    "  FAIL: --require-measurement was passed, so a skip is an error here.",
    "",
  );
  console.error(lines.join("\n"));
  process.exit(1);
}

// Stderr, not stdout: on a CI provider this lands in the log as a warning
// rather than disappearing into a wall of green ticks.
console.error(lines.join("\n"));
process.exit(0);
