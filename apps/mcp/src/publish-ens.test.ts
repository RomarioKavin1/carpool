/**
 * `carpool_publish` with `CARPOOL_AUTHOR_ENS_NAME` set, against the real
 * registry (testing/harness.ts, which switches ENS resolution off so no test
 * reaches Ethereum). What this proves is the wire: the MCP builds an ENS author
 * string the registry parses, verifies and stores, and the registry's
 * `/identity` reads it back as an ENS author.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { newAuthor, startRegistry, type AuthorKeypair, type RegistryHarness } from "../../registry/src/testing/harness.js";
import { publishArtifact, type PublishInput } from "./publish.js";

let harness: RegistryHarness;
let author: AuthorKeypair;

const input = (question: string): PublishInput => ({
  question,
  abstract: "Published under an ENS name.",
  body: `# ${question}\n\nbody\n`,
  sources: [{ url: "https://docs.ens.domains/ensv2/overview", fetchedAt: "2026-09-13T00:00:00Z" }],
  provenance: { model: "claude-opus-5", durationSeconds: 60, inputTokens: 100, outputTokens: 100, estimatedCostUsd: 0.01, toolCalls: 1 },
  scope: "ens",
  halfLifeDays: 1,
  priceMicroUsdc: 10_000,
  redacted: false,
});

beforeAll(async () => {
  harness = await startRegistry();
  author = newAuthor("0.0.1111");
  process.env.CARPOOL_AUTHOR_ACCOUNT_ID = author.accountId;
  process.env.CARPOOL_AUTHOR_PRIVATE_KEY = author.privateKeyHex;
});

afterEach(() => {
  delete process.env.CARPOOL_AUTHOR_ENS_NAME;
});

afterAll(() => harness?.close());

describe("carpool_publish under an ENS name", () => {
  it("publishes as ens:<name>:<account>:<key>, and the registry verifies and stores it", async () => {
    process.env.CARPOOL_AUTHOR_ENS_NAME = "carpool-author.eth";
    const out = await publishArtifact(harness.base, input("ens mcp publish"));
    if (!out.ok) throw new Error(out.error);
    const state = (await fetch(`${harness.base}/state`).then((r) => r.json())) as any;
    const row = state.artifacts.find((a: any) => a.manifest.magnet === out.magnet);
    expect(row.manifest.author).toBe(`ens:carpool-author.eth:${author.accountId}:${author.publicKeyHex}`);

    const id = (await fetch(`${harness.base}/identity?author=${encodeURIComponent(row.manifest.author)}`).then((r) =>
      r.json(),
    )) as any;
    expect(id).toMatchObject({ kind: "ens", name: "carpool-author.eth", fallbackAccount: author.accountId });
    // ENS is off in the harness, so nothing is known about the name, and the next sale would pay the fallback.
    expect(id.binding.status).toBe("unreachable");
    expect(id.payoutNow).toEqual({ account: author.accountId, source: "fallback" });
  });

  it("without the variable, publishes in the Hedera convention exactly as before", async () => {
    const out = await publishArtifact(harness.base, input("hedera mcp publish unchanged"));
    if (!out.ok) throw new Error(out.error);
    const state = (await fetch(`${harness.base}/state`).then((r) => r.json())) as any;
    const row = state.artifacts.find((a: any) => a.manifest.magnet === out.magnet);
    expect(row.manifest.author).toBe(`${author.accountId}:${author.publicKeyHex}`);
  });

  it("refuses a malformed name before signing anything", async () => {
    process.env.CARPOOL_AUTHOR_ENS_NAME = "Not A Name";
    const out = await publishArtifact(harness.base, input("ens mcp bad name"));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatch(/CARPOOL_AUTHOR_ENS_NAME/);
  });
});
