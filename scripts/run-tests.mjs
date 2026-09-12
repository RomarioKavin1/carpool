// `pnpm test`, with a run that did not execute the whole suite made impossible
// to mistake for a pass.
//
// ## The failure this exists for
//
// `turbo run test` stops scheduling dependents as soon as one task fails. On a
// red run of `@carpool/tracker` the summary read:
//
//     Tasks:  4 successful, 8 total        Failed: @carpool/tracker#test
//
// and `@carpool/registry` and `@carpool/dashboard` were never started —
// **236 of 506 tests silently did not run.** The exit code was non-zero, so the
// build was red, but nothing said which packages had been skipped, and the next
// reader of that log has no way to know that "4 successful" is not "4 of 4".
// The same shape produced the Node 26 partial green (only the SQLite packages
// fail there) and the A/B runner's silent skip in CI. A count of successes is
// not a statement of coverage unless the denominator is checked.
//
// ## What this does
//
// 1. Runs turbo with `--continue`, so one red package no longer prevents the
//    others from running. A failing run now reports every failure it has, not
//    the first one.
// 2. Derives the expected set of `test` tasks from the workspace itself —
//    every `package.json` under the workspace globs that declares a `test`
//    script — and fails if any of them produced no result in this run.
// 3. Sums the per-package vitest summaries and prints the executed test count,
//    naming any package whose tests were replayed from turbo's cache rather
//    than run.
// 4. Ends with one line that says either FULL SUITE or PARTIAL RUN, and never
//    exits 0 on a partial run.
//
// Kept dependency-free (it runs before anything is built) and readable: it is a
// reporting guard, and a reporting guard nobody can read is the thing it guards
// against.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);

/** Workspace packages that declare a `test` script — the denominator. */
function expectedTestTasks() {
  const ws = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8");
  // Deliberately crude: the file is a flat `packages:` list of two-segment
  // globs (`apps/*`, `packages/*`). A YAML parser here would be a dependency
  // this script cannot have, and a wrong parse fails loudly below rather than
  // silently shrinking the denominator.
  const dirs = [...ws.matchAll(/^\s*-\s*["']?([^"'\n]+?)["']?\s*$/gm)].map((m) => m[1]);
  const names = [];
  for (const glob of dirs) {
    const base = join(ROOT, glob.replace(/\/\*$/, ""));
    if (!existsSync(base)) continue;
    const children = glob.endsWith("/*")
      ? readdirSync(base).map((d) => join(base, d))
      : [base];
    for (const dir of children) {
      if (!statSync(dir).isDirectory()) continue;
      const pkgPath = join(dir, "package.json");
      if (!existsSync(pkgPath)) continue;
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (pkg.scripts?.test) names.push(pkg.name);
    }
  }
  return names.sort();
}

const expected = expectedTestTasks();
if (expected.length === 0) {
  console.error("run-tests: found no workspace package with a `test` script — refusing to report a pass");
  process.exit(1);
}

const turbo = spawn(
  "npx",
  ["turbo", "run", "test", "--continue", ...args],
  { cwd: ROOT, stdio: ["inherit", "pipe", "pipe"], env: process.env },
);

let captured = "";
const tee = (stream, out) => {
  stream.on("data", (chunk) => {
    const text = chunk.toString();
    captured += text;
    out.write(text);
  });
};
tee(turbo.stdout, process.stdout);
tee(turbo.stderr, process.stderr);

turbo.on("close", (code) => {
  const lines = captured.split("\n");

  /** package → { tests, failed, files, filesFailed, cached } */
  const results = new Map();
  const seen = (pkg) =>
    results.get(pkg) ??
    results.set(pkg, { tests: 0, failed: 0, files: 0, filesFailed: 0, cached: false }).get(pkg);

  /** Tasks turbo itself reports as failed — including `build`, which never reaches a test. */
  const failedTasks = new Set();
  let tasksSuccessful = null;
  let tasksTotal = null;

  for (const line of lines) {
    const trimmed = line.trim();
    // `@carpool/core:test:       Tests  56 passed (56)`
    const m = /^(\S+):test:\s+Tests\s+(.+)$/.exec(trimmed);
    if (m) {
      const r = seen(m[1]);
      const failed = /(\d+)\s+failed/.exec(m[2]);
      const total = /\((\d+)\)\s*$/.exec(m[2]);
      r.failed += failed ? Number(failed[1]) : 0;
      r.tests += total ? Number(total[1]) : 0;
      continue;
    }
    // `@carpool/mcp:test:  Test Files  1 failed | 3 passed (4)` — a file that
    // fails to even load reports no test count, so this is the only place a
    // transform or import error shows up as a number.
    const f = /^(\S+):test:\s+Test Files\s+(.+)$/.exec(trimmed);
    if (f) {
      const r = seen(f[1]);
      const failed = /(\d+)\s+failed/.exec(f[2]);
      const total = /\((\d+)\)\s*$/.exec(f[2]);
      r.filesFailed += failed ? Number(failed[1]) : 0;
      r.files += total ? Number(total[1]) : 0;
      continue;
    }
    if (/^(\S+):test:\s+cache hit, replaying logs/.test(trimmed)) {
      seen(/^(\S+):test:/.exec(trimmed)[1]).cached = true;
      continue;
    }
    // `Failed:    @carpool/bench#test, @carpool/registry#build`
    const t = /^Failed:\s+(.+)$/.exec(trimmed);
    if (t) {
      for (const task of t[1].split(",")) failedTasks.add(task.trim());
      continue;
    }
    const s = /^Tasks:\s+(\d+) successful, (\d+) total$/.exec(trimmed);
    if (s) {
      tasksSuccessful = Number(s[1]);
      tasksTotal = Number(s[2]);
    }
  }

  const missing = expected.filter((p) => !results.has(p));
  const totalTests = [...results.values()].reduce((s, r) => s + r.tests, 0);
  const totalFailed = [...results.values()].reduce((s, r) => s + r.failed, 0);
  const totalFilesFailed = [...results.values()].reduce((s, r) => s + r.filesFailed, 0);
  const cached = [...results.entries()].filter(([, r]) => r.cached).map(([p]) => p);
  // A failed non-test task (almost always `build`) means some package's tests
  // could not run at all, or ran against a stale build. It is the exact shape of
  // the "looks like a pass" hazard, so it is named separately.
  const failedNonTestTasks = [...failedTasks].filter((t) => !t.endsWith("#test"));

  const report = [""];
  report.push("  suite coverage");
  report.push("  --------------");
  for (const pkg of expected) {
    const r = results.get(pkg);
    if (!r) {
      report.push(`  NEVER RAN  ${pkg}`);
      continue;
    }
    const broken = r.failed > 0 || r.filesFailed > 0;
    report.push(
      `  ${broken ? "FAIL" : "ok  "}  ${pkg.padEnd(24)} ${String(r.tests).padStart(4)} tests in ` +
        `${String(r.files).padStart(2)} files` +
        `${r.failed > 0 ? ` · ${r.failed} failed` : ""}` +
        `${r.filesFailed > 0 ? ` · ${r.filesFailed} file(s) did not load` : ""}` +
        `${r.cached ? "   [replayed from turbo cache]" : ""}`,
    );
  }
  report.push("");
  report.push(
    `  ${results.size} of ${expected.length} packages reported · ${totalTests} tests executed or ` +
      `replayed · ${totalFailed} failed · ${totalFilesFailed} file(s) did not load` +
      (tasksTotal !== null ? ` · turbo: ${tasksSuccessful}/${tasksTotal} tasks` : ""),
  );

  const partial = missing.length > 0 || totalFilesFailed > 0 || failedNonTestTasks.length > 0;
  if (partial) {
    report.push("");
    report.push("  ####  PARTIAL RUN — THIS IS NOT A GREEN SUITE  ########################");
    if (missing.length > 0) {
      report.push(`  ${missing.length} package(s) produced no test result at all:`);
      for (const p of missing) report.push(`      ${p}   →  pnpm --filter ${p} test`);
    }
    if (totalFilesFailed > 0) {
      report.push(
        `  ${totalFilesFailed} test file(s) failed to load, so every test inside them was never`,
      );
      report.push("  collected and is counted nowhere. Look for a transform or import error above.");
    }
    if (failedNonTestTasks.length > 0) {
      report.push(`  non-test task(s) failed: ${failedNonTestTasks.join(", ")}`);
      report.push("  A failed build means some package's tests ran against nothing, or not at all.");
    }
    report.push("");
    report.push("  A count of passes is not a statement of coverage unless the denominator is");
    report.push("  checked. The run this guard exists for reported '4 successful, 8 total' while");
    report.push("  236 of 506 tests were never started, and said nothing about it.");
    report.push("  ######################################################################");
    report.push("");
    console.error(report.join("\n"));
    process.exit(code === 0 ? 1 : code);
  }

  if (cached.length === expected.length) {
    report.push("");
    report.push("  NOTE: every package was replayed from turbo's cache — no test process ran in");
    report.push("  this invocation. That is a valid green (the cache key covers the inputs), but");
    report.push("  it is not a fresh execution. Use `pnpm test:force` when you need one.");
  }

  report.push("");
  report.push(
    totalFailed === 0 && code === 0
      ? `  FULL SUITE: ${expected.length}/${expected.length} packages, ${totalTests} tests, 0 failures.`
      : `  RED: ${totalFailed} failing test(s). Every package ran, so this count is the whole story.`,
  );
  report.push("");
  const out = totalFailed === 0 && code === 0 ? console.log : console.error;
  out(report.join("\n"));
  process.exit(code ?? 1);
});
