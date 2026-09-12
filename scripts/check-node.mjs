// Fails fast with a readable message when Node is outside the supported range.
// engine-strict is deliberately NOT used: the dependency tree declares engines
// that permit Node >= 26, but better-sqlite3's native build fails there, so
// pnpm's own check does not catch the version that actually breaks.
//
// Wired into `preinstall` AND into `build`/`test`/`typecheck` (chained with
// `&&`, not a `pre*` hook, because pnpm only runs those when
// enable-pre-post-scripts is on). Install-time alone is not enough: the machine
// default here is Node 26, so `pnpm test` on a shell that forgot `nvm use`
// used to die inside better-sqlite3 with a NODE_MODULE_VERSION mismatch — and
// only in the packages that touch SQLite, so the rest of the run still looked
// green. Costs ~25 ms per invocation; keep it dependency-free so it stays that
// cheap.
const MIN = [20, 19, 0];
const MAX_MAJOR = 22; // inclusive; Node 23+ is untested, Node 26 fails better-sqlite3

const [maj, min, pat] = process.versions.node.split(".").map(Number);
const tooOld =
  maj < MIN[0] || (maj === MIN[0] && (min < MIN[1] || (min === MIN[1] && pat < MIN[2])));
const tooNew = maj > MAX_MAJOR;

if (tooOld || tooNew) {
  console.error(
    `\n  Carpool needs Node >=${MIN.join(".")} and <=${MAX_MAJOR}.x — found v${process.versions.node}.\n` +
      `  This repo pins a version in .nvmrc:\n\n      nvm use\n\n` +
      (tooNew
        ? `  Node ${maj} is rejected because better-sqlite3 has no prebuilt binary for it\n` +
          `  and its node-gyp build fails with an unreadable error during install.\n`
        : "") +
      "\n",
  );
  process.exit(1);
}
