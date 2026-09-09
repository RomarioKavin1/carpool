/**
 * `CONTRACT.md` against the rating code it claims to describe.
 *
 * The same technique `apps/bench/src/contractDoc.test.ts` uses for the `/batches`
 * status vocabulary and the `/payouts` state set, applied to the two vocabularies
 * ratings add: **derive the values from the source on disk** and fail if the
 * document does not list one the code can produce. A hand-written list in a test
 * is a third place to forget to update; this cannot be.
 *
 * It lives here rather than beside the existing guard because that file is
 * `apps/bench`'s, and because the code it reads is this app's and
 * `@carpool/core`'s. It boots nothing: `rate.test.ts` drives the real routes, and
 * what this adds is the link a runtime test cannot make — code fact ⇒ document
 * sentence.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_RATING_REASON_CHARS, MIN_RATINGS_FOR_VERDICT } from "@carpool/core";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (...parts: string[]) => readFileSync(join(REPO, ...parts), "utf8");

const contract = read("CONTRACT.md");
const ratings = read("packages", "carpool-core", "src", "ratings.ts");
const ledger = read("apps", "registry", "src", "ledger.ts");
const server = read("apps", "registry", "src", "server.ts");
const schema = read("apps", "registry", "src", "db", "schema.ts");

describe("the rating verdict vocabulary", () => {
  const union = /export type RatingVerdict =([^;]+);/.exec(ratings);

  it("is found in the source, so an empty list cannot pass", () => {
    expect(union, "RatingVerdict is no longer a plain union — update this guard").not.toBeNull();
    expect([...union![1]!.matchAll(/"([^"]+)"/g)].length).toBeGreaterThanOrEqual(3);
  });

  it("every verdict the registry can serve is a verdict CONTRACT.md documents", () => {
    const values = [...union![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    const undocumented = values.filter((v) => !contract.includes(`\`"${v}"\``));
    expect(
      undocumented,
      "these verdicts are served on /search, /manifest/:magnet and /state and are not in " +
        "CONTRACT.md. A client switching on the documented set mis-handles them.",
    ).toEqual([]);
  });

  it("documents that a verdict is withheld below the threshold the code enforces", () => {
    expect(MIN_RATINGS_FOR_VERDICT).toBe(3);
    expect(ratings).toContain("if (count < MIN_RATINGS_FOR_VERDICT) return null;");
    expect(contract).toMatch(/`null` below three ratings/);
    expect(contract).toMatch(/never\*\* as `100%`|never `100%`|never\*\* as `100%`/);
  });
});

describe("the served rating block", () => {
  /** Derived from the interface, so a field added to the wire has to be documented. */
  const block = ledger.slice(ledger.indexOf("export interface ArtifactRatings"));
  const fields = [
    ...block.slice(0, block.indexOf("\n}")).matchAll(/^\s{2}(\w+)(\?)?:/gm),
  ].map((m) => m[1]!);

  it("finds its own fields, so an empty list cannot pass", () => {
    expect(fields).toContain("discounted");
    expect(fields).toContain("reasons");
  });

  it("documents every field it adds on top of the count summary", () => {
    const undocumented = fields.filter((f) => !contract.includes(`\`${f}\``) && !contract.includes(`"${f}"`));
    expect(undocumented, "these rating fields are on the wire and not in CONTRACT.md").toEqual([]);
  });

  it("has no averaged field in the source either — the promise and the code agree", () => {
    const summary = ratings.slice(ratings.indexOf("export interface RatingSummary"));
    const declared = [...summary.slice(0, summary.indexOf("\n}")).matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]!);
    expect(declared.sort()).toEqual(["count", "notWorth", "verdict", "worth"]);
    expect(contract).toMatch(/There is no `average`, `ratio`, `percent` or `stars` field on any surface/);
  });
});

describe("POST /rate's wire contract", () => {
  it("documents the exact message the route verifies", () => {
    // The code's message, and the document's, character for character.
    expect(server).toContain(
      '`${args.txId}:${args.magnet}:rate:${args.worth ? "worth" : "not-worth"}:${sha256(args.reason)}`',
    );
    expect(contract).toContain('sha256("<txId>:<magnet>:rate:<worth|not-worth>:<sha256(reason)>")');
  });

  it("documents the status the route uses for an author rating their own work", () => {
    expect(server).toMatch(/HttpError\(\s*403,/);
    expect(contract).toMatch(/`403` \(the\n?author of the artifact\)/);
  });

  it("documents the reason cap the code enforces, and that it rejects rather than truncates", () => {
    expect(MAX_RATING_REASON_CHARS).toBe(280);
    expect(server).toContain("z.string().max(MAX_RATING_REASON_CHARS)");
    expect(contract).toContain("280");
    expect(contract).toMatch(/rejected, never truncated/);
  });

  it("documents the uniqueness constraint the schema actually declares", () => {
    expect(schema).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_rating_purchase ON rating(purchase_id)");
    expect(contract).toContain("UNIQUE(rating.purchase_id)");
    expect(contract).toMatch(/not\*\* one per `\(buyer, magnet\)`/);
  });

  it("documents what a refunded purchase may do, in both orderings", () => {
    // Both halves of the rule are in the code…
    expect(ledger).toContain('code: "refunded" as const');
    expect(ledger).toMatch(/if \(r\.refundState === "refunded"\) \{\s*\n\s*discounted\+\+;/);
    // …and the document states the rule rather than leaving it to be discovered.
    expect(contract).toMatch(/A refunded purchase's rating does not count/);
    expect(contract).toMatch(/`ratings\.discounted`/);
  });
});

describe("health is documented as unchanged by ratings", () => {
  it("still has exactly three terms in the source", () => {
    const health = read("packages", "carpool-core", "src", "health.ts");
    const body = health.slice(health.indexOf("export function health"));
    expect(body).toContain("a.freshness * (1 - a.refundRate) * buyerTerm");
    expect(body).not.toMatch(/worth|verdict|rating/i);
  });

  it("and CONTRACT.md says so rather than leaving a reader to compare formulas", () => {
    expect(contract).toMatch(/`health` is unchanged/);
    expect(contract).toMatch(/Not\*\* part of `health`|never folded in/);
  });
});
