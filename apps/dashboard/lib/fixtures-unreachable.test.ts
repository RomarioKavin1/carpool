import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * The hard rule, enforced: no fabricated data reaches the rendered app.
 *
 * `lib/fixtures.testonly.ts` exists for tests. If the rendered app can reach it,
 * the demo shows invented numbers, which is precisely the failure this project
 * has already retracted once. A convention cannot fail a build; this can.
 *
 * ## Why this file was rewritten
 *
 * The first version of this guard read every `.ts`/`.tsx` file under `app/` and
 * `components/` and grepped the source for the string `fixtures.testonly`. A
 * mutation audit defeated it four different ways, because a *text search of two
 * directories* is not a statement about what the app imports:
 *
 * | bypass | why the grep missed it |
 * |---|---|
 * | `app/page.tsx` → `lib/helper.ts` → `lib/fixtures.testonly.ts` | `lib/helper.ts` is not under `app/` or `components/`; the second grep only looked one level, at files that name the fixtures directly |
 * | a three-hop re-export chain (`export * from`) | same, one more hop |
 * | `await import("./fixtures" + ".testonly")` | the literal string never appears |
 * | `import { x } from "@/lib/fixtures.testonly"` behind a further alias hop | the alias is resolved by the compiler, not by the grep |
 *
 * So the guard now walks the **actual module graph**: it starts at the files
 * Next.js renders, resolves every import edge that survives compilation, and
 * fails if a test-only module is reachable at any depth.
 *
 * ## How it resolves
 *
 * With **TypeScript's own module resolution** — `ts.resolveModuleName` against
 * the options parsed from this package's `tsconfig.json`, and `ts.createSourceFile`
 * for the import scan. That is a deliberate choice and worth stating plainly:
 * `typescript` is already a devDependency here, it is the authority on the `@/*`
 * path aliases the app actually uses, and it costs no bundler, no extra
 * dependency, and no second implementation of a resolver that would be wrong in
 * ways the compiler is not. Nothing here type-checks; only the graph is walked.
 *
 * ## What counts as an edge
 *
 * Every edge that survives compilation to JavaScript:
 * `import`, `import "side-effect"`, `export … from`, `export * from`,
 * `export * as ns from`, `import x = require(…)`, dynamic `import(…)` and
 * `require(…)`.
 *
 * **Not** followed: `import type` / `export type` statements. Those are erased
 * before any bundle exists, so they cannot deliver a number to a page — and one
 * of them (`lib/api.ts`'s `import type … from "../../registry/src/ledger"`) is
 * load-bearing: it is how the dashboard's row types stay pinned to the ledger's
 * instead of being hand-copied. Following it would drag the whole registry, core,
 * tracker and hedera-x402 source trees into a dashboard unit test for no safety.
 * A *textual* mention of the fixtures under `app/` or `components/` — including a
 * type-only one — is still caught by the two grep assertions kept at the end of
 * this file, so the cheap check and the deep check are layered rather than traded.
 *
 * A dynamic `import()`/`require()` whose argument is not a literal is a **hard
 * failure**, not a skip: an unresolvable specifier is an edge this guard cannot
 * prove anything about, and "cannot prove" must not read as "fine".
 */

/* ------------------------------------------------------------------ *
 * The conventions this guard enforces
 * ------------------------------------------------------------------ */

/**
 * Next.js App Router entry points — the files that actually get rendered.
 * Anything not reachable from one of these is not in the shipped app.
 */
const NEXT_ENTRY_BASENAMES = new Set([
  "page",
  "layout",
  "route",
  "template",
  "default",
  "error",
  "global-error",
  "loading",
  "not-found",
]);

/** Root-level Next.js entry points that live outside `app/`. */
const ROOT_ENTRY_BASENAMES = ["middleware", "instrumentation", "instrumentation-client"];

const SCRIPT_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

/**
 * The test-only naming convention, enforced rather than documented. A module
 * whose name says it is for tests must not be reachable from a rendered page,
 * whatever it contains — so renaming the fixtures file does not escape the guard,
 * and a *new* fixtures file is covered the day it is written.
 */
const TEST_ONLY_FILE = /(?:\.testonly|\.test|\.spec|\.fixture|\.fixtures|\.mock|\.mocks)\.[cm]?[jt]sx?$/;
const TEST_ONLY_DIRS = new Set(["__tests__", "__mocks__", "__fixtures__", "testing", "fixtures"]);

/** Non-script imports (stylesheets, images, fonts). Leaves: named, never parsed. */
const ASSET_EXT =
  /\.(css|scss|sass|less|styl|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot|mp4|webm|md|mdx|txt|wasm)$/i;

function isTestOnlyPath(file: string): boolean {
  if (TEST_ONLY_FILE.test(basename(file))) return true;
  return dirname(file)
    .split(sep)
    .some((segment) => TEST_ONLY_DIRS.has(segment));
}

/* ------------------------------------------------------------------ *
 * The walk
 * ------------------------------------------------------------------ */

interface Edge {
  /** The specifier as written. */
  readonly specifier: string;
  /** The file it was written in. */
  readonly from: string;
  /** How it was written — named in failure output so a human can find it. */
  readonly kind: "import" | "export-from" | "dynamic-import" | "require" | "import-equals";
}

interface Graph {
  /** Rendered entry points, absolute. */
  readonly entries: string[];
  /** Reachable file → the edge that first reached it (`null` for an entry point). */
  readonly reached: Map<string, Edge | null>;
  /** Edges this guard could not resolve to a file and could not dismiss as external. */
  readonly unresolved: Edge[];
  /** Specifiers resolved outside the workspace — not walked, listed for the record. */
  readonly external: Set<string>;
}

/** Every value-carrying import edge in one file, via TypeScript's parser. */
function edgesOf(file: string, text: string): { edges: Edge[]; computed: Edge[] } {
  const kind = file.endsWith(".tsx") || file.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, /* setParentNodes */ false, kind);
  const edges: Edge[] = [];
  const computed: Edge[] = [];

  const literalOf = (node: ts.Node | undefined): string | undefined => {
    if (node && (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
      return node.text;
    }
    return undefined;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      // `import type {…}` is erased; `import {type A, B}` is not (B emits).
      if (!node.importClause?.isTypeOnly) {
        const spec = literalOf(node.moduleSpecifier);
        if (spec !== undefined) edges.push({ specifier: spec, from: file, kind: "import" });
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      if (!node.isTypeOnly) {
        const spec = literalOf(node.moduleSpecifier);
        if (spec !== undefined) edges.push({ specifier: spec, from: file, kind: "export-from" });
      }
    } else if (ts.isImportEqualsDeclaration(node)) {
      if (ts.isExternalModuleReference(node.moduleReference)) {
        const spec = literalOf(node.moduleReference.expression);
        if (spec !== undefined) edges.push({ specifier: spec, from: file, kind: "import-equals" });
      }
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === "require" && node.arguments.length > 0;
      if (isDynamicImport || isRequire) {
        const edgeKind = isDynamicImport ? "dynamic-import" : "require";
        const spec = literalOf(node.arguments[0]);
        if (spec !== undefined) {
          edges.push({ specifier: spec, from: file, kind: edgeKind });
        } else {
          // `import("./fixtures" + ".testonly")`, `require(name)`. Unprovable.
          const src = node.getText(sf) ?? "<computed>";
          computed.push({ specifier: src.replace(/\s+/g, " ").slice(0, 120), from: file, kind: edgeKind });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sf, visit);
  return { edges, computed };
}

function walkDir(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walkDir(path));
    else out.push(path);
  }
  return out;
}

/** The files Next.js renders, by its own file conventions. */
function entryPointsOf(root: string): string[] {
  const entries = walkDir(join(root, "app")).filter((file) => {
    const ext = extname(file);
    return SCRIPT_EXTS.includes(ext) && NEXT_ENTRY_BASENAMES.has(basename(file, ext));
  });
  for (const name of ROOT_ENTRY_BASENAMES) {
    for (const ext of SCRIPT_EXTS) {
      const candidate = join(root, `${name}${ext}`);
      if (existsSync(candidate)) entries.push(candidate);
    }
  }
  return entries.sort();
}

/** Workspace package name → directory, so a `@carpool/*` import resolves to source. */
function workspacePackages(repoRoot: string): Map<string, string> {
  const map = new Map<string, string>();
  const wsPath = join(repoRoot, "pnpm-workspace.yaml");
  if (!existsSync(wsPath)) return map;
  const globs = [...readFileSync(wsPath, "utf8").matchAll(/^\s*-\s*["']?([^"'\n]+?)["']?\s*$/gm)].map(
    (m) => m[1]!,
  );
  for (const glob of globs) {
    const base = join(repoRoot, glob.replace(/\/\*$/, ""));
    if (!existsSync(base)) continue;
    const dirs = glob.endsWith("/*") ? readdirSync(base).map((d) => join(base, d)) : [base];
    for (const dir of dirs) {
      const pkgPath = join(dir, "package.json");
      if (!statSync(dir).isDirectory() || !existsSync(pkgPath)) continue;
      const name = JSON.parse(readFileSync(pkgPath, "utf8")).name;
      if (typeof name === "string") map.set(name, dir);
    }
  }
  return map;
}

function firstExisting(candidates: string[]): string | undefined {
  return candidates.find((c) => existsSync(c) && statSync(c).isFile());
}

/**
 * A workspace-internal bare specifier resolved to **source**, not to `dist/`.
 * `@carpool/core`'s `exports` points at `dist/index.js`, which does not exist in
 * a clean clone, so the compiler's resolver reports it unresolved — and an
 * unresolved workspace import is exactly the silent gap this guard must not have.
 */
function resolveWorkspace(specifier: string, packages: Map<string, string>): string | undefined {
  const parts = specifier.split("/");
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
  const dir = packages.get(name);
  if (!dir) return undefined;
  const sub = specifier.slice(name.length).replace(/^\//, "") || "index";
  const bases = [join(dir, "src", sub), join(dir, sub)];
  return firstExisting([
    ...bases.flatMap((b) => SCRIPT_EXTS.map((ext) => b + ext)),
    ...bases.flatMap((b) => SCRIPT_EXTS.map((ext) => join(b, "index" + ext))),
    // `./foo.js` in a NodeNext package means `./foo.ts` on disk.
    ...bases.map((b) => b.replace(/\.js$/, ".ts")),
  ]);
}

/**
 * Walk the module graph from `root`'s rendered entry points.
 *
 * Parameterised over the root on purpose: the "prove it bites" suite below runs
 * it against synthetic trees containing each known bypass, so the guard's own
 * detection is tested rather than assumed.
 */
function moduleGraph(root: string, repoRoot: string): Graph {
  const tsconfigPath = join(root, "tsconfig.json");
  const options: ts.CompilerOptions = existsSync(tsconfigPath)
    ? ts.parseJsonConfigFileContent(
        ts.readConfigFile(tsconfigPath, ts.sys.readFile).config,
        ts.sys,
        root,
        undefined,
        tsconfigPath,
      ).options
    : { moduleResolution: ts.ModuleResolutionKind.Bundler };
  const cache = ts.createModuleResolutionCache(root, (f) => f, options);
  const packages = workspacePackages(repoRoot);

  const entries = entryPointsOf(root);
  const reached = new Map<string, Edge | null>(entries.map((e) => [e, null]));
  const unresolved: Edge[] = [];
  const external = new Set<string>();
  const queue = [...entries];

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (!SCRIPT_EXTS.includes(extname(file))) continue; // asset leaf
    const { edges, computed } = edgesOf(file, readFileSync(file, "utf8"));
    unresolved.push(...computed);

    for (const edge of edges) {
      if (ASSET_EXT.test(edge.specifier)) continue;

      let target = edge.specifier.startsWith(".")
        ? undefined
        : resolveWorkspace(edge.specifier, packages);

      if (!target) {
        const r = ts.resolveModuleName(edge.specifier, file, options, ts.sys, cache);
        const m = r.resolvedModule;
        if (m) {
          if (m.isExternalLibraryImport || m.resolvedFileName.includes(`${sep}node_modules${sep}`)) {
            external.add(edge.specifier);
            continue;
          }
          target = m.resolvedFileName;
        }
      }

      if (!target) {
        // A bare specifier that is neither a workspace package nor resolvable is
        // an uninstalled or types-only npm package: external, and not walkable.
        // A relative or aliased specifier that does not resolve is a real hole.
        const aliased = !edge.specifier.startsWith(".") && !packages.has(edge.specifier);
        if (edge.specifier.startsWith(".") || isAliasSpecifier(edge.specifier, options)) {
          unresolved.push(edge);
        } else if (aliased) {
          external.add(edge.specifier);
        }
        continue;
      }

      if (!reached.has(target)) {
        reached.set(target, edge);
        queue.push(target);
      }
    }
  }

  return { entries, reached, unresolved, external };
}

/** Does this bare specifier match a `paths` alias? Then failing to resolve it is a hole. */
function isAliasSpecifier(specifier: string, options: ts.CompilerOptions): boolean {
  for (const pattern of Object.keys(options.paths ?? {})) {
    if (pattern.endsWith("*")) {
      if (specifier.startsWith(pattern.slice(0, -1))) return true;
    } else if (specifier === pattern) return true;
  }
  return false;
}

/** The import chain from a rendered entry point to `file`, for failure output. */
function chainTo(graph: Graph, root: string, file: string): string {
  const rel = (f: string) => relative(root, f) || f;
  const hops: string[] = [rel(file)];
  let cursor = file;
  for (let i = 0; i < 64; i++) {
    const edge = graph.reached.get(cursor);
    if (!edge) break;
    hops.unshift(`${rel(edge.from)} --[${edge.kind} "${edge.specifier}"]-->`);
    cursor = edge.from;
  }
  return hops.join(" ");
}

/* ------------------------------------------------------------------ *
 * The guard, on the real tree
 * ------------------------------------------------------------------ */

const ROOT = process.cwd();
const REPO_ROOT = resolve(ROOT, "..", "..");

describe("fixtures are unreachable from the rendered app", () => {
  const graph = moduleGraph(ROOT, REPO_ROOT);

  it("finds the app's real entry points, so the walk is not vacuously empty", () => {
    // A guard that walks nothing passes everything. If Next's file conventions
    // change, or `app/` moves, this is the assertion that notices.
    //
    // Three entries since the split: `/` is the explainer and `/app` is the
    // working surface. This list is a PIN and not a discovery — it was updated by
    // hand when the second route was added, on purpose. The alternative (deriving
    // the expectation from the same walk it is checking) would make the
    // assertion vacuous, and loosening it to `toContain` would let a fourth
    // rendered route appear with nothing walking it.
    expect(graph.entries.map((e) => relative(ROOT, e)).sort()).toEqual([
      "app/app/page.tsx",
      "app/layout.tsx",
      "app/page.tsx",
    ]);
  });

  it("no test-only module is reachable from a rendered entry point, at any depth", () => {
    const offenders = [...graph.reached.keys()]
      .filter((f) => isTestOnlyPath(f))
      .map((f) => chainTo(graph, ROOT, f));
    expect(
      offenders,
      "the rendered app must not be able to reach a test-only module:\n" + offenders.join("\n"),
    ).toEqual([]);
  });

  it("resolves every edge it followed, so nothing is skipped silently", () => {
    const holes = graph.unresolved.map(
      (e) => `${relative(ROOT, e.from)}: ${e.kind} ${e.specifier}`,
    );
    expect(
      holes,
      "an import this guard cannot resolve is an import it cannot clear:\n" + holes.join("\n"),
    ).toEqual([]);
  });

  it("the fixtures are live test code, so the guard is not passing on dead weight", () => {
    // If nothing imported the fixtures at all, "unreachable from the app" would
    // be true for an uninteresting reason. They must still be reachable from
    // tests — the whole point of the exemption.
    const fixtures = join(ROOT, "lib", "fixtures.testonly.ts");
    expect(existsSync(fixtures)).toBe(true);
    expect(isTestOnlyPath(fixtures)).toBe(true);
    expect(graph.reached.has(fixtures)).toBe(false);
    const importers = walkDir(join(ROOT, "lib"))
      .filter((f) => f.endsWith(".test.ts") && readFileSync(f, "utf8").includes("fixtures.testonly"))
      .map((f) => basename(f));
    expect(importers.length).toBeGreaterThan(0);
  });

  /* The original grep checks, kept. They are nearly free and they catch a
   * *textual* reference the graph walk deliberately ignores — a type-only import
   * of the fixtures, or a comment-level one, under app/ or components/. */

  it("no file under app/ or components/ mentions the test-only fixtures at all", () => {
    const offenders: string[] = [];
    for (const dir of ["app", "components"].map((d) => join(ROOT, d))) {
      for (const file of walkDir(dir).filter((f) => /\.(ts|tsx)$/.test(f))) {
        if (readFileSync(file, "utf8").includes("fixtures.testonly")) offenders.push(file);
      }
    }
    expect(offenders, "rendered code must never import fixtures").toEqual([]);
  });

  it("no file under lib/ imports the fixtures outside a test", () => {
    const offenders: string[] = [];
    for (const file of walkDir(join(ROOT, "lib")).filter((f) => /\.(ts|tsx)$/.test(f))) {
      /*
       * `isTestOnlyPath` rather than two hand-written suffix checks. This used
       * to be `endsWith(".test.ts") || endsWith("fixtures.testonly.ts")`, which
       * had one definition of "is a test file" here and a different, wider one
       * at the top of this file — so `lib/prose-budget.test.tsx` was reported as
       * production code importing the fixtures. One definition, used twice,
       * cannot disagree with itself; and the rule it enforces is unchanged,
       * because a file only escapes by being named as a test.
       */
      if (isTestOnlyPath(file)) continue;
      if (readFileSync(file, "utf8").includes("fixtures.testonly")) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Proving the guard bites
 * ------------------------------------------------------------------ */

/**
 * Every bypass that defeated the grep, built as a real tree and run through the
 * real walker. This repo has already shipped one guard (`toContain("28")`) that
 * looked like verification and was not; an evasion nobody attempted is not an
 * evasion the guard is known to stop, so the attempts live here permanently
 * rather than in a one-off audit note.
 */
function scaffold(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "carpool-graph-guard-"));
  for (const [rel, contents] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
  return root;
}

const TSCONFIG_WITH_ALIAS = JSON.stringify({
  compilerOptions: {
    moduleResolution: "bundler",
    jsx: "preserve",
    paths: { "@/*": ["./*"], "~fixtures": ["./lib/fixtures.testonly.ts"] },
  },
});

const FIXTURES_SRC = "export const FABRICATED_ROW = { magnet: 'swarm:aaaa', priceNow: 999_999 };\n";

/** Files every scenario shares. The only thing that varies is how `app/page.tsx` cheats. */
function base(page: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "tsconfig.json": TSCONFIG_WITH_ALIAS,
    "lib/fixtures.testonly.ts": FIXTURES_SRC,
    "lib/honest.ts": "export const fromTheLedger = () => [];\n",
    "app/page.tsx": page,
    ...extra,
  };
}

/** Reachable test-only modules, relative to the synthetic root. */
function offendersIn(root: string): { offenders: string[]; unresolved: string[]; entries: number } {
  const graph = moduleGraph(root, root);
  return {
    offenders: [...graph.reached.keys()].filter(isTestOnlyPath).map((f) => relative(root, f)),
    unresolved: graph.unresolved.map((e) => `${relative(root, e.from)}: ${e.specifier}`),
    entries: graph.entries.length,
  };
}

describe("the guard bites — every bypass that defeated the source grep", () => {
  const roots: string[] = [];
  const build = (files: Record<string, string>): string => {
    const root = scaffold(files);
    roots.push(root);
    return root;
  };

  it("A · the clean tree passes", () => {
    const root = build(base('import { fromTheLedger } from "../lib/honest";\nexport default function P() { return fromTheLedger(); }\n'));
    const { offenders, unresolved, entries } = offendersIn(root);
    expect(entries).toBe(1);
    expect(offenders).toEqual([]);
    expect(unresolved).toEqual([]);
  });

  it("B · a direct import fails (the only case the grep caught)", () => {
    const root = build(base('import { FABRICATED_ROW } from "../lib/fixtures.testonly";\nexport default function P() { return FABRICATED_ROW; }\n'));
    expect(offendersIn(root).offenders).toEqual(["lib/fixtures.testonly.ts"]);
  });

  it("C · a re-export chain at depth 2 fails", () => {
    const root = build(
      base('import { FABRICATED_ROW } from "../lib/helper";\nexport default function P() { return FABRICATED_ROW; }\n', {
        "lib/helper.ts": 'export { FABRICATED_ROW } from "./fixtures.testonly";\n',
      }),
    );
    // The grep saw `app/page.tsx` (clean) and `lib/helper.ts` (not under app/ or
    // components/, and the old lib/ check only flagged the direct namer).
    expect(offendersIn(root).offenders).toEqual(["lib/fixtures.testonly.ts"]);
  });

  it("D · a re-export chain at depth 3, through `export * from`, fails", () => {
    const root = build(
      base('import { FABRICATED_ROW } from "../lib/a";\nexport default function P() { return FABRICATED_ROW; }\n', {
        "lib/a.ts": 'export * from "./b";\n',
        "lib/b.ts": 'export * as fx from "./fixtures.testonly";\nexport { FABRICATED_ROW } from "./fixtures.testonly";\n',
      }),
    );
    expect(offendersIn(root).offenders).toEqual(["lib/fixtures.testonly.ts"]);
  });

  it("E · a dynamic import with a literal specifier fails", () => {
    const root = build(base('export default async function P() { const m = await import("../lib/fixtures.testonly"); return m.FABRICATED_ROW; }\n'));
    expect(offendersIn(root).offenders).toEqual(["lib/fixtures.testonly.ts"]);
  });

  it("F · a `require()` at depth 2 fails", () => {
    const root = build(
      base('import { rows } from "../lib/helper";\nexport default function P() { return rows; }\n', {
        "lib/helper.ts": 'export const rows = require("./fixtures.testonly").FABRICATED_ROW;\n',
      }),
    );
    expect(offendersIn(root).offenders).toEqual(["lib/fixtures.testonly.ts"]);
  });

  it("G · an aliased import fails — both `@/…` and a bespoke alias", () => {
    const wildcard = build(base('import { FABRICATED_ROW } from "@/lib/fixtures.testonly";\nexport default function P() { return FABRICATED_ROW; }\n'));
    expect(offendersIn(wildcard).offenders).toEqual(["lib/fixtures.testonly.ts"]);

    const exact = build(base('import { FABRICATED_ROW } from "~fixtures";\nexport default function P() { return FABRICATED_ROW; }\n'));
    expect(offendersIn(exact).offenders).toEqual(["lib/fixtures.testonly.ts"]);
  });

  it("H · an alias hop through a barrel, depth 3, fails", () => {
    const root = build(
      base('import { FABRICATED_ROW } from "@/lib/barrel";\nexport default function P() { return FABRICATED_ROW; }\n', {
        "lib/barrel.ts": 'export * from "@/lib/inner";\n',
        "lib/inner.ts": 'export * from "~fixtures";\n',
      }),
    );
    expect(offendersIn(root).offenders).toEqual(["lib/fixtures.testonly.ts"]);
  });

  it("I · a computed specifier fails as unresolvable rather than passing as clean", () => {
    const root = build(base('const which = "./fixtures" + ".testonly";\nexport default async function P() { return (await import(`../lib/${which}`)).FABRICATED_ROW; }\n'));
    const { offenders, unresolved } = offendersIn(root);
    // The string never appears, so nothing is *proved* reachable — which is
    // exactly why an unresolvable edge has to be red on its own.
    expect(offenders).toEqual([]);
    expect(unresolved.join("\n")).toMatch(/app\/page\.tsx/);
  });

  it("J · a renamed fixtures file is still caught, by convention not by filename", () => {
    const root = build({
      "tsconfig.json": TSCONFIG_WITH_ALIAS,
      "lib/demo-rows.fixtures.ts": FIXTURES_SRC,
      "lib/__fixtures__/seed.ts": FIXTURES_SRC,
      "app/page.tsx":
        'import { FABRICATED_ROW } from "../lib/demo-rows.fixtures";\nimport { FABRICATED_ROW as B } from "../lib/__fixtures__/seed";\nexport default function P() { return [FABRICATED_ROW, B]; }\n',
    });
    expect(offendersIn(root).offenders.sort()).toEqual([
      "lib/__fixtures__/seed.ts",
      join("lib", "demo-rows.fixtures.ts"),
    ]);
  });

  it("K · a type-only import does NOT fail, and does not drag its subtree in", () => {
    const root = build(
      base('import type { Row } from "../lib/types-only";\nexport default function P() { const r: Row = { n: 1 }; return r; }\n', {
        "lib/types-only.ts": 'export type { Row } from "./fixtures.testonly";\nexport type Row = { n: number };\n',
      }),
    );
    const { offenders, unresolved } = offendersIn(root);
    expect(offenders).toEqual([]);
    expect(unresolved).toEqual([]);
  });

  it("L · a test file importing the fixtures is not an entry point, so it is fine", () => {
    const root = build(
      base('import { fromTheLedger } from "../lib/honest";\nexport default function P() { return fromTheLedger(); }\n', {
        "lib/honest.test.ts": 'import { FABRICATED_ROW } from "./fixtures.testonly";\nexport const t = FABRICATED_ROW;\n',
      }),
    );
    expect(offendersIn(root).offenders).toEqual([]);
  });

  it("M · a non-page module under app/ is not an entry point but is still walked", () => {
    // `app/helpers.ts` is not rendered by itself; it only matters if a page
    // imports it. Reached through `layout.tsx`, its cheat must still fail.
    const root = build({
      "tsconfig.json": TSCONFIG_WITH_ALIAS,
      "lib/fixtures.testonly.ts": FIXTURES_SRC,
      "app/helpers.ts": 'export { FABRICATED_ROW } from "../lib/fixtures.testonly";\n',
      "app/page.tsx": "export default function P() { return null; }\n",
      "app/layout.tsx": 'import { FABRICATED_ROW } from "./helpers";\nexport default function L() { return FABRICATED_ROW; }\n',
    });
    const { offenders, entries } = offendersIn(root);
    expect(entries).toBe(2);
    expect(offenders).toEqual(["lib/fixtures.testonly.ts"]);
  });

  it("cleans up its scaffolds", () => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    expect(roots.every((r) => !existsSync(r))).toBe(true);
  });
});
