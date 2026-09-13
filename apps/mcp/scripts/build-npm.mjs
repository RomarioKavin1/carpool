#!/usr/bin/env node
/**
 * Builds the publishable `carpool-mcp` npm package into a staging folder
 * (default: apps/mcp/npm-dist, gitignored; override with CARPOOL_NPM_OUT).
 *
 *   pnpm --filter @carpool/mcp pack:npm      build + npm pack
 *
 * `@carpool/*` workspace code is inlined with esbuild (it cannot be installed
 * from npm). Real npm packages stay external and are listed as dependencies at
 * the versions the lockfile resolves. `@carpool/tracker` (ONNX, ~240 MB) is
 * excluded: the server falls back to sending question text and says so.
 */
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..");
const repo = resolve(app, "../..");
const out = resolve(process.env.CARPOOL_NPM_OUT ?? join(app, "npm-dist"));
const VERSION = "0.1.0";

// Exact versions the lockfile resolves for the monorepo (see pnpm-lock.yaml).
const DEPENDENCIES = {
  "@hiero-ledger/sdk": "2.88.0",
  "@modelcontextprotocol/sdk": "1.30.0",
  "@x402/fetch": "2.25.0",
  "@x402/hedera": "2.25.0",
  zod: "3.25.76",
};

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "dist"), { recursive: true });
mkdirSync(join(out, "hooks"), { recursive: true });

/** Only these four values of @carpool/hedera-x402 are used; its index pulls sqlite and express. */
const hederaX402Units = join(repo, "packages/hedera-x402/src/units.ts");

const plugin = {
  name: "carpool-npm",
  setup(b) {
    b.onResolve({ filter: /^@carpool\/core$/ }, () => ({ path: join(repo, "packages/carpool-core/src/index.ts") }));
    b.onResolve({ filter: /^@carpool\/hedera-x402$/ }, () => ({ path: hederaX402Units }));
    b.onResolve({ filter: /^@carpool\/tracker/ }, (a) => ({ path: a.path, external: true }));
    // The module-scope stdio guard in server.ts compares import.meta.url with
    // argv[1]; inside a bundle that comparison is meaningless, and the CLI entry
    // connects the transport itself.
    b.onLoad({ filter: /apps[\\/]mcp[\\/]src[\\/]server\.ts$/ }, (a) => {
      const src = readFileSync(a.path, "utf8");
      const guard = "if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {";
      if (!src.includes(guard)) throw new Error("server.ts entry guard changed; update build-npm.mjs");
      return { contents: src.replace(guard, "if (false) {"), loader: "ts" };
    });
  },
};

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  packages: "external",
  plugins: [plugin],
  logLevel: "warning",
  legalComments: "none",
  // Keep absolute build paths out of the output.
  sourcemap: false,
  absWorkingDir: repo,
};

await build({
  ...common,
  entryPoints: [join(app, "scripts/npm-cli.ts")],
  outfile: join(out, "dist/cli.js"),
  banner: { js: "#!/usr/bin/env node" },
  define: {},
});
// `packages: external` would also externalise @carpool/*; the plugin resolves
// those first, so only real npm packages remain as imports.

await build({
  ...common,
  entryPoints: [join(app, "src/consent.ts")],
  outfile: join(out, "dist/consent.js"),
});

const cli = readFileSync(join(out, "dist/cli.js"), "utf8").replace("__VERSION__", VERSION);
writeFileSync(join(out, "dist/cli.js"), cli);
chmodSync(join(out, "dist/cli.js"), 0o755);

// Every bare import left in the bundle must be a declared dependency or a node builtin.
const imports = new Set();
for (const f of ["dist/cli.js", "dist/consent.js"]) {
  const s = readFileSync(join(out, f), "utf8");
  for (const m of s.matchAll(/^\s*(?:import|export)\b[^;]*?from\s*["']([^"'./][^"']*)["']/gm)) imports.add(m[1]);
  for (const m of s.matchAll(/^\s*import\s*["']([^"'./][^"']*)["']/gm)) imports.add(m[1]);
  for (const m of s.matchAll(/\bimport\(\s*["']([^"'./][^"']*)["']\s*\)/g)) imports.add(m[1]);
}
const pkgOf = (s) => (s.startsWith("@") ? s.split("/").slice(0, 2).join("/") : s.split("/")[0]);
const undeclared = [...imports].filter((s) => !s.startsWith("node:") && !(pkgOf(s) in DEPENDENCIES));
if (undeclared.length) throw new Error(`bundle imports undeclared packages: ${undeclared.join(", ")}`);

cpSync(join(app, "hooks/pre-publish.mjs"), join(out, "hooks/pre-publish.mjs"));
cpSync(join(app, "npm/README.md"), join(out, "README.md"));
cpSync(join(repo, "LICENSE"), join(out, "LICENSE"));

const pkg = {
  name: "carpool-mcp",
  version: VERSION,
  description: "MCP server for Carpool: search, buy and sell prior agent research over x402 on Hedera.",
  type: "module",
  bin: { "carpool-mcp": "dist/cli.js" },
  files: ["dist", "hooks", "README.md", "LICENSE"],
  engines: { node: ">=20.19" },
  license: "MIT",
  repository: { type: "git", url: "git+https://github.com/RomarioKavin1/carpool.git" },
  homepage: "https://carpool-dashboard-plum.vercel.app",
  bugs: { url: "https://github.com/RomarioKavin1/carpool/issues" },
  keywords: ["mcp", "claude", "x402", "hedera", "research", "agents"],
  dependencies: DEPENDENCIES,
};
writeFileSync(join(out, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
console.log(`carpool-mcp ${VERSION} staged at ${out}`);
console.log(`external imports: ${[...imports].filter((s) => !s.startsWith("node:")).sort().join(", ")}`);
