/**
 * The four `carpool_*` tools, driven the way an agent drives them: through an MCP
 * client over an in-memory transport, against the REAL registry.
 *
 * ## Why this file exists
 *
 * `apps/mcp/src/server.ts` is the product's entire agent-facing surface, and until
 * this file **no test had executed a single line of it.** It could not even be
 * imported: `await server.connect(new StdioServerTransport())` ran at module
 * scope. `e2e.test.ts`'s describe blocks are named after the tools
 * ("carpool_publish → carpool_search → carpool_fetch") but what they call is
 * `publishArtifact`, `RegistryClient.search`, `payFetch` and `delistArtifact` —
 * the layer *underneath* the handlers. Everything that lives only in the handler
 * was covered by nothing:
 *
 *   - the `confirm` gate, which is the whole of the consent story for publishing:
 *     without it, publishing on the first call is the same code path as publishing
 *     on the approved second call;
 *   - `priceForRedoCost(provenance.estimatedCostUsd)` — the handler, not the
 *     caller, decides what the artifact is listed at;
 *   - the `scanForPublish` → `scan.redacted` wiring, i.e. whether a secret the
 *     scanner found is actually stripped from what gets published or merely
 *     reported in the preview;
 *   - `carpool_fetch` writing the body to a **file** and returning a summary
 *     rather than the body inline, which is the context saving the product exists
 *     to produce;
 *   - the spend-cap sentence in `carpool_search`, and `isError` on the failures.
 *
 * This is not a hypothetical gap. Both of the defects `e2e.test.ts` was written
 * for were *in this layer or one call below it* and both survived a green suite:
 * `carpool_search` threw `TypeError: Cannot read properties of undefined (reading
 * 'toFixed')` on every non-empty result, and `carpool_publish` 400'd on every
 * call. A tool whose handler is never executed is a tool nothing tests.
 *
 * ## What is real here
 *
 * REAL: the `McpServer` and its registration, the zod `inputSchema` on every tool
 * (an MCP client request is validated by it, so a schema that disagrees with the
 * handler is a failure here), all four handlers, the registry app, its database,
 * `priceAt()` pricing, the x402 `PaymentGate`, signature verification, and the
 * body store.
 *
 * STUBBED: the x402 facilitator and the Hedera mirror node, by
 * `apps/registry/src/testing/harness.ts` — with that stub's payload checks ON, so
 * the payment `carpool_fetch` makes is one the real facilitator would accept (see
 * `testing/stubFacilitator.ts`). The embedder is the network-free hashed
 * stand-in; `tryLocalEmbedder` therefore fails to match the registry's declared
 * tuple and `carpool_search` takes its `?q=` text path, which is the path whose
 * privacy cost the tool announces. Both are stated in the assertions that depend
 * on them.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PrivateKey } from "@x402/hedera";
import {
  newAuthor,
  startRegistry,
  type AuthorKeypair,
  type RegistryHarness,
} from "../../registry/src/testing/harness.js";

let harness: RegistryHarness;
let author: AuthorKeypair;
let client: Client;
let artifactDir: string;

/** One tool call, as an agent makes it. Returns the joined text content. */
async function call(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text?: string }[];
    isError?: boolean;
  };
  const text = res.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
  return { text, isError: res.isError === true };
}

const BODY = [
  "# Associating USDC before asking the faucet",
  "",
  "Circle's Hedera testnet faucet checks the mirror node for an existing token",
  "relationship before it submits, so maxAutomaticTokenAssociations does not satisfy it.",
].join("\n");

const QUESTION = "Why does the Circle testnet faucet decline to mint USDC to an unassociated Hedera account?";

beforeAll(async () => {
  harness = await startRegistry({ similarityThreshold: 0.4 });
  author = newAuthor("0.0.1111");
  artifactDir = mkdtempSync(join(tmpdir(), "carpool-mcp-tools-"));

  // `server.ts` reads REGISTRY and OUT_DIR at module scope, so both have to be
  // set before the import below — that is the one awkwardness of the module-scope
  // config and it is why this is a dynamic import.
  process.env.CARPOOL_REGISTRY_URL = harness.base;
  process.env.CARPOOL_ARTIFACT_DIR = artifactDir;
  process.env.CARPOOL_AUTHOR_ACCOUNT_ID = author.accountId;
  process.env.CARPOOL_AUTHOR_PRIVATE_KEY = author.privateKeyHex;
  // The stub facilitator reports this as the payer, so it is what the registry
  // records as `purchase.buyer`. The transaction id belongs to the facilitator's
  // fee payer instead, as it does on chain.
  process.env.CARPOOL_BUYER_ACCOUNT_ID = harness.facilitator.payer!;
  process.env.CARPOOL_BUYER_PRIVATE_KEY = PrivateKey.generateECDSA().toStringRaw();
  process.env.HEDERA_NETWORK = "hedera:testnet";
  process.env.USDC_TOKEN_ID = "0.0.429274";
  // pay.ts reads its per-payment cap at module scope too; the default is below
  // what this artifact's self-reported cost prices it at.
  process.env.CARPOOL_MAX_MICRO_USDC = "5000000";

  const { server } = await import("./server.js");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "carpool-tools-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client?.close();
  harness?.close();
});

describe("the tool surface an agent sees", () => {
  it("advertises exactly the four carpool tools, each with a description and a schema", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "carpool_delist",
      "carpool_fetch",
      "carpool_publish",
      "carpool_search",
    ]);
    for (const t of tools) {
      expect(t.description, `${t.name} has a description`).toBeTruthy();
      expect(t.inputSchema, `${t.name} has an input schema`).toBeTruthy();
    }
    // The irreversibility warning is the sentence that asks for consent, so it is
    // part of the contract rather than decoration.
    const publish = tools.find((t) => t.name === "carpool_publish")!;
    expect(publish.description).toMatch(/IRREVERSIBLE/);
    expect(publish.description).toMatch(/carpool_delist stops new sales/);
    // carpool_search must say it is free, or an agent has no reason to call it
    // before doing the work — which is the whole mechanism.
    expect(tools.find((t) => t.name === "carpool_search")!.description).toMatch(/Free/);
  });

  it("rejects an argument the schema forbids, before any handler runs", async () => {
    // The schemas are real, not documentation, and the SDK reports a violation as
    // a tool result with `isError` and the offending field named — not as a thrown
    // transport error, which is worth pinning because an agent branches on
    // `isError` and would otherwise treat a validation failure as a tool answer.
    const badMagnet = await call("carpool_fetch", { magnet: "not-a-magnet" });
    expect(badMagnet.isError).toBe(true);
    expect(badMagnet.text).toMatch(/Invalid arguments for tool carpool_fetch/);
    expect(badMagnet.text).toMatch(/must start with "swarm:" at magnet/);
    // No payment was attempted for it: the handler never ran.
    expect(badMagnet.text).not.toMatch(/Bought|Could not buy/);

    const shortQuestion = await call("carpool_search", { question: "hi" }); // min(3)
    expect(shortQuestion.isError).toBe(true);
    expect(shortQuestion.text).toMatch(/Invalid arguments for tool carpool_search/);

    // A tool that does not exist comes back the same way — as an error result
    // naming the tool, not as a silent empty answer.
    const unknown = await call("carpool_nonexistent", {});
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toMatch(/Tool carpool_nonexistent not found/);
  });
});

describe("carpool_publish", () => {
  it("does NOT publish without confirm: it returns the diff and says nothing happened", async () => {
    const before = await registryArtifactCount();
    const { text } = await call("carpool_publish", {
      question: QUESTION,
      abstract: "The association-before-faucet order, and the two-hour rate-limit window.",
      body: BODY,
      sources: [{ url: "https://faucet.circle.com/", fetchedAt: "2026-09-12T00:00:00Z" }],
      provenance: {
        model: "claude-opus-5",
        durationSeconds: 5400,
        inputTokens: 412_000,
        outputTokens: 18_400,
        estimatedCostUsd: 3.41,
        toolCalls: 96,
      },
      halfLifeDays: 120,
    });

    expect(text).toMatch(/Nothing has been published/);
    expect(text).toMatch(/confirm: true/);
    // …and the registry agrees that nothing happened. Asserting only on the text
    // would pass for a handler that published and then said it had not.
    expect(await registryArtifactCount()).toBe(before);
  });

  it("prices the listing at 10% of the self-reported redo cost — the handler's decision, not the caller's", async () => {
    const { text } = await call("carpool_publish", {
      question: "What does a $3.41 artifact list for?",
      abstract: "A pricing check with a round self-reported cost.",
      body: "the body",
      sources: [],
      provenance: {
        model: "m",
        durationSeconds: 1,
        inputTokens: 1,
        outputTokens: 1,
        estimatedCostUsd: 3.41,
        toolCalls: 1,
      },
      confirm: true,
      halfLifeDays: 7,
    });
    // priceForRedoCost(3.41) = round(3.41 × 1e6 × 0.10) = 341,000 µUSDC = $0.341.
    expect(text).toMatch(/^Published swarm:[0-9a-f]{64} at \$0\.34/);
    expect(text).toMatch(/halving every 7 day\(s\)/);
  });

  it("publishes on confirm, and the registry has it at the price the tool named", async () => {
    const { text, isError } = await call("carpool_publish", {
      question: QUESTION,
      abstract: "The association-before-faucet order, and the two-hour rate-limit window.",
      body: BODY,
      sources: [{ url: "https://faucet.circle.com/", fetchedAt: "2026-09-12T00:00:00Z" }],
      provenance: {
        model: "claude-opus-5",
        durationSeconds: 5400,
        inputTokens: 412_000,
        outputTokens: 18_400,
        estimatedCostUsd: 3.41,
        toolCalls: 96,
      },
      halfLifeDays: 120,
      confirm: true,
    });
    expect(isError).toBe(false);
    const magnet = /swarm:[0-9a-f]{64}/.exec(text)?.[0];
    expect(magnet, text).toBeTruthy();

    // Through the real POST /publish: signature verified, questionNorm recomputed,
    // bodyHash checked. The manifest the registry stored is the evidence.
    const manifest = (await (await fetch(`${harness.base}/manifest/${encodeURIComponent(magnet!)}`)).json()) as any;
    expect(manifest.bodyHash).toBe(createHash("sha256").update(BODY).digest("hex"));
    expect(manifest.author).toBe(`${author.accountId}:${author.publicKeyHex}`);
    expect(manifest.priceNow).toBeGreaterThan(341_000 * 0.1); // floor + decayed base
    expect(manifest.decay.halfLifeDays).toBe(120);
  });

  it("names the duplicate rather than pretending the second publish replaced the first", async () => {
    const { text } = await call("carpool_publish", {
      question: QUESTION.toUpperCase(), // normalises to the same questionNorm
      abstract: "A second answer to a question that already has one.",
      body: `${BODY}\n\nA second take.`,
      sources: [{ url: "https://faucet.circle.com/", fetchedAt: "2026-09-12T00:00:00Z" }],
      provenance: {
        model: "claude-opus-5",
        durationSeconds: 60,
        inputTokens: 100,
        outputTokens: 100,
        estimatedCostUsd: 0.5,
        toolCalls: 1,
      },
      confirm: true,
    });
    expect(text).toMatch(/already answers the same normalised question/);
    expect(text).toMatch(/yours is not a replacement/);
  });

  it("STRIPS what the scanner found, rather than only warning about it in the preview", async () => {
    // The redaction wiring: `publishArtifact(..., ...scan.redacted)`. If the
    // handler passed `args` through instead, the preview would still show the
    // finding and the secret would still be published — and nothing but this
    // assertion would notice, because the finding count comes from the same scan.
    const secret = "sk-carpool-audit-0123456789abcdef0123456789abcdef";
    const { text } = await call("carpool_publish", {
      question: "Does the publish tool actually strip a key it found?",
      abstract: "A body carrying something that must never be published.",
      body: `Run it with the key ${secret} in your environment.`,
      sources: [],
      provenance: {
        model: "m",
        durationSeconds: 1,
        inputTokens: 1,
        outputTokens: 1,
        estimatedCostUsd: 0.5,
        toolCalls: 1,
      },
      confirm: true,
    });
    const magnet = /swarm:[0-9a-f]{64}/.exec(text)?.[0];
    expect(magnet, text).toBeTruthy();
    expect(text).toMatch(/item\(s\) were stripped before publishing/);

    // Buy it back and look. The bytes the registry serves must not contain it.
    const bought = await call("carpool_fetch", { magnet: magnet! });
    const written = /Written to: (.+)/.exec(bought.text)?.[1];
    expect(written, bought.text).toBeTruthy();
    const served = readFileSync(written!.trim(), "utf8");
    expect(served, "the published body still carries the secret").not.toContain(secret);
    expect(served).toContain("Run it with the key");
  });
});

describe("carpool_search", () => {
  it("renders every candidate without throwing, with the match reason and the redo cost", async () => {
    // C3: `renderCandidate` called `.toFixed(1)` on `ageDays`, which `/search`
    // never sent — a TypeError on every search that found anything. It is this
    // handler that calls it.
    const { text } = await call("carpool_search", { question: QUESTION, limit: 5 });
    expect(text).toMatch(/candidate\(s\) for:/);
    expect(text).toMatch(/swarm:[0-9a-f]{64}/);
    expect(text).toMatch(/match: similarity/); // ranked, not browsed
    expect(text).toMatch(/\$3\.41 to produce/);
    expect(text).toMatch(/Use carpool_fetch <magnet> to buy one/);
  });

  it("states the remote-embedding exposure whenever it sent the question text", async () => {
    // The hashed stand-in the harness installs declares a tuple no local embedder
    // can match, so `tryLocalEmbedder` fails and this is the `?q=` path. The tool
    // has to say so on every such call — that is the whole privacy claim.
    const { text } = await call("carpool_search", { question: QUESTION });
    expect(text).toMatch(/registry/i);
    expect(text.toLowerCase()).toContain("question");
  });

  it("tells the agent to do the work itself when nothing matches", async () => {
    const { text } = await call("carpool_search", {
      question: "Wholly unrelated: what is the airspeed velocity of an unladen swallow?",
    });
    expect(text).toMatch(/No prior research found/);
    expect(text).toMatch(/Do the research yourself/);
  });

  it("says the cap is the reason, and how to raise it, when every hit is unaffordable", async () => {
    // A listing above CAP_MICRO_USDC. This branch is the one that stops an agent
    // reading "there is nothing here" off a result that is merely too expensive.
    const question = "What does an artifact priced above the buyer's cap look like?";
    const pub = await call("carpool_publish", {
      question,
      abstract: "A deliberately expensive listing, to exercise the cap message.",
      body: "expensive body",
      sources: [],
      provenance: {
        model: "m",
        durationSeconds: 1,
        inputTokens: 1,
        outputTokens: 1,
        estimatedCostUsd: 500, // 10% of $500 = 50,000,000 µUSDC, far above the cap
        toolCalls: 1,
      },
      confirm: true,
    });
    expect(pub.text).toMatch(/^Published/);

    const { text } = await call("carpool_search", { question, limit: 1 });
    expect(text).toMatch(/above your \$.* per-payment cap/);
    expect(text).toMatch(/raise CARPOOL_MAX_MICRO_USDC/);
    // And it still reports what redoing it would cost, which is the comparison.
    expect(text).toMatch(/\$500\.00 to produce/);
  });
});

describe("carpool_fetch", () => {
  let magnet: string;

  beforeAll(async () => {
    const { text } = await call("carpool_publish", {
      question: "What does carpool_fetch write, and where?",
      abstract: "An artifact bought purely to inspect what the tool returns.",
      body: BODY,
      sources: [],
      provenance: {
        model: "m",
        durationSeconds: 1,
        inputTokens: 1,
        outputTokens: 1,
        estimatedCostUsd: 0.2,
        toolCalls: 1,
      },
      confirm: true,
    });
    magnet = /swarm:[0-9a-f]{64}/.exec(text)![0];
  });

  it("pays, writes the body to a FILE, and returns a summary rather than the body", async () => {
    const { text, isError } = await call("carpool_fetch", { magnet });
    expect(isError).toBe(false);

    // The body is not in the result. This is the product's central claim about
    // context cost, and the only thing enforcing it is this handler.
    expect(text).not.toContain(BODY);
    expect(text.length).toBeLessThan(BODY.length + 400);

    const written = /Written to: (.+)/.exec(text)?.[1]?.trim();
    expect(written, text).toBeTruthy();
    expect(written!.startsWith(artifactDir), `${written} is under CARPOOL_ARTIFACT_DIR`).toBe(true);
    expect(readFileSync(written!, "utf8")).toBe(BODY);

    expect(text).toMatch(new RegExp(`^Bought ${magnet} for \\$0\\.0`));
    expect(text).toMatch(/\d+ bytes ·/);
    expect(text).toMatch(/verified: matches the bodyHash in the manifest read before paying/);
    // The transaction id, decoded out of PAYMENT-RESPONSE — not the base64 blob.
    expect(text).toContain(`Transaction: ${harness.facilitator.txId}`);
    expect(text).toMatch(/You did not have to run it/);
  });

  it("reports a failure as an error and names the magnet, rather than writing an empty file", async () => {
    const missing = `swarm:${"0".repeat(64)}`;
    const { text, isError } = await call("carpool_fetch", { magnet: missing });
    expect(isError).toBe(true);
    expect(text).toContain(`Could not buy ${missing}`);
    expect(text).toMatch(/no such artifact/);
  });

  it("does not serve the goods when settlement fails", async () => {
    harness.facilitator.settleOk = false;
    try {
      const { isError, text } = await call("carpool_fetch", { magnet });
      expect(isError).toBe(true);
      expect(text).toMatch(/Could not buy/);
    } finally {
      harness.facilitator.settleOk = true;
    }
  });
});

describe("carpool_delist", () => {
  let magnet: string;

  beforeAll(async () => {
    const { text } = await call("carpool_publish", {
      question: "Which artifact is withdrawn by the delist tool test?",
      abstract: "Published so that it can be withdrawn again.",
      body: "withdrawable body",
      sources: [],
      provenance: {
        model: "m",
        durationSeconds: 1,
        inputTokens: 1,
        outputTokens: 1,
        estimatedCostUsd: 0.2,
        toolCalls: 1,
      },
      confirm: true,
    });
    magnet = /swarm:[0-9a-f]{64}/.exec(text)![0];
  });

  it("withdraws it, states what withdrawal does not undo, and stops new sales", async () => {
    const { text, isError } = await call("carpool_delist", { magnet });
    expect(isError).toBe(false);
    expect(text).toMatch(/Withdrawn swarm:/);
    // The tool description promises these two, so the tool has to say them.
    expect(text).toMatch(/refund window remain refundable/);
    expect(text).toMatch(/keeps their copy/);

    const attempt = await call("carpool_fetch", { magnet });
    expect(attempt.isError).toBe(true);
    expect(attempt.text).toMatch(/delisted or expired/);
  });

  it("is idempotent, and says when it was already withdrawn", async () => {
    const { text, isError } = await call("carpool_delist", { magnet });
    expect(isError).toBe(false);
    expect(text).toMatch(/was already withdrawn \(at \d{4}-\d{2}-\d{2}T/);
  });

  it("reports a refusal as an error rather than claiming a withdrawal", async () => {
    const notMine = `swarm:${"1".repeat(64)}`;
    const { text, isError } = await call("carpool_delist", { magnet: notMine });
    expect(isError).toBe(true);
    expect(text).toContain(`Could not delist ${notMine}`);
  });
});

async function registryArtifactCount(): Promise<number> {
  const state = (await (await fetch(`${harness.base}/state`)).json()) as { artifacts: unknown[] };
  return state.artifacts.length;
}
