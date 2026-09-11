/**
 * `CONTRACT.md` against the code it claims to be derived from.
 *
 * Four of its statements were false, and all four had survived every review
 * because they were checked by re-reading the zod schemas — which say nothing
 * about a column's later writes, a response's nesting, or the range of a computed
 * float. They were found by booting the registry and diffing real responses, and
 * corrected on 2026-09-12:
 *
 * 1. `refundState`'s stored column *does* move to `"refunded"`, and `refundedAt`
 *    is not an input to the derivation;
 * 2. `/batches.status` also emits `EMPTY_CLAIM` and raw ledger result codes,
 *    including `SUCCESS_BUT_MISSING_EXPECTED_OPERATION`;
 * 3. `health` can be exactly 0, so its range is `[0, 1]`, not `(0, 1]`;
 * 4. `/state` nests the manifest; only `/search` spreads it.
 *
 * This file keeps them fixed. It reads the production sources off disk — the same
 * technique `apps/dashboard/lib/decay.test.ts` uses to guard a constant it
 * deliberately cannot import — and pairs each code fact with the sentence the
 * document has to contain. It lives in `apps/bench` because that is where this
 * branch's documentation guards live; it asserts nothing about bench itself.
 *
 * It does not boot the registry: `apps/registry/src/server.test.ts` and
 * `apps/mcp/src/e2e.test.ts` already drive the real app, and duplicating that
 * here would be a second harness to maintain. What this adds is the link the
 * runtime tests cannot make — code fact ⇒ document sentence.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { health } from "@carpool/core";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (...parts: string[]) => readFileSync(join(REPO, ...parts), "utf8");

const contract = read("CONTRACT.md");
const ledger = read("apps", "registry", "src", "ledger.ts");
const settler = read("packages", "hedera-x402", "src", "settler.ts");
const sqliteLedger = read("packages", "hedera-x402", "src", "sqlite-ledger.ts");

describe("refundState", () => {
  it("the stored column does move to refunded, so the doc must not say it never moves", () => {
    // Two writers: refundPurchase and refundUndelivered.
    const writes = [...ledger.matchAll(/refundState:\s*"refunded"/g)];
    expect(writes.length).toBeGreaterThanOrEqual(2);
    expect(contract).toMatch(/does move/);
    expect(
      contract,
      "CONTRACT.md claims the refundState column never moves; ledger.ts writes 'refunded' to it",
    ).not.toMatch(/written `"window"` at purchase and never moves/);
  });

  it("the derivation reads refundState and refundDeadline, not refundedAt", () => {
    const start = ledger.indexOf("effectiveRefundState(");
    expect(start).toBeGreaterThan(0);
    const body = ledger.slice(start, ledger.indexOf("\n  }", start));
    expect(body).toContain("refundDeadline");
    expect(
      body,
      "effectiveRefundState now consults refundedAt — CONTRACT.md's derivation has to be updated",
    ).not.toContain("refundedAt");
    expect(contract).toMatch(/`refundedAt` is \*\*served alongside it and never consulted\*\*/);
  });

  it("the window boundary is inclusive, and the doc says so", () => {
    expect(ledger).toContain("nowSeconds <= p.refundDeadline");
    expect(contract).toMatch(/inclusive/);
  });
});

describe("/batches status", () => {
  /**
   * Derived from `BATCH_STATUS` in settler.ts rather than listed here: the
   * document has to document whatever the code can write, including a status
   * added after this test was written. That is the property the old sentence
   * ("`status` is `pending`, `SUCCESS`, or `FAILED:<result>`") did not have — the
   * code already wrote `EMPTY_CLAIM` and raw ledger result codes.
   */
  const block = settler.slice(settler.indexOf("export const BATCH_STATUS"));
  const values = [...block.slice(0, block.indexOf("} as const;")).matchAll(/:\s*"([^"]+)"/g)].map(
    (m) => m[1]!,
  );

  it("finds the statuses in the source, so an empty list cannot pass", () => {
    expect(values.length).toBeGreaterThanOrEqual(4);
    expect(values).toContain("EMPTY_CLAIM");
    expect(values).toContain("FAILED:");
  });

  it("every status the code can write is a status CONTRACT.md documents", () => {
    const undocumented = values.filter((v) => !contract.includes(v));
    expect(
      undocumented,
      "these /batches status values are written by packages/hedera-x402/src/settler.ts and are not " +
        "in CONTRACT.md. A client switching on the documented set mis-handles them.",
    ).toEqual([]);
  });

  it("also documents the success codes the allow-list admits, not just SUCCESS", () => {
    // `classifyLedgerResult` treats both as paid, so both can be stored verbatim.
    expect(settler).toContain("SUCCESS_BUT_MISSING_EXPECTED_OPERATION");
    expect(contract).toContain("SUCCESS_BUT_MISSING_EXPECTED_OPERATION");
  });

  it("does not still claim the status is one of exactly three values", () => {
    expect(contract).not.toMatch(/`status` is `pending`, `SUCCESS`, or `FAILED:<result>`/);
  });
});

describe("/payouts state", () => {
  it("every PayoutState the registry can serve is documented", () => {
    const union = /export type PayoutState =([^;]+);/.exec(ledger);
    expect(union, "PayoutState is no longer a plain union — update this guard").not.toBeNull();
    const states = [...union![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    expect(states.length).toBeGreaterThanOrEqual(4);
    const undocumented = states.filter((s) => !contract.includes(`\`${s}\``));
    expect(
      undocumented,
      "these payout states are served by GET /payouts and are not in CONTRACT.md",
    ).toEqual([]);
  });
});

describe("health", () => {
  it("can be exactly zero, so the documented range is [0, 1]", () => {
    // One purchase, refunded: refundRate 1.
    expect(health({ freshness: 1, refundRate: 1, distinctBuyers: 1 })).toBe(0);
    // And the buyer term floors at 0.4 rather than 0, so freshness alone cannot
    // drive it to zero — the refund term is the only way there.
    expect(health({ freshness: 1, refundRate: 0, distinctBuyers: 0 })).toBeCloseTo(0.4, 10);
    expect(contract).toMatch(/`health` \| float in \*\*\[0, 1\]\*\*/);
    expect(
      contract,
      "CONTRACT.md still puts health in (0, 1] alongside freshness; health reaches 0",
    ).not.toMatch(/`freshness`, `health` \| float in \(0, 1\]/);
  });
});

describe("/state's shape", () => {
  it("nests the manifest, and the document describes it that way", () => {
    const start = ledger.indexOf("artifacts: artifacts.map(");
    expect(start).toBeGreaterThan(0);
    const body = ledger.slice(start, start + 1200);
    expect(body).toMatch(/return \{\s*\n\s*manifest,/);
    expect(contract).toMatch(/`\/state` serves, per artifact, a \*\*nested\*\* object/);
    expect(contract).toMatch(/state\.artifacts\[0\]\.manifest\.magnet/);
  });

  it("documents the two top-level keys it also serves", () => {
    expect(ledger).toMatch(/\n {6}peers,/);
    expect(ledger).toMatch(/summary: \{/);
    expect(contract).toContain("`peers`");
    expect(contract).toContain("`summary`");
  });
});
