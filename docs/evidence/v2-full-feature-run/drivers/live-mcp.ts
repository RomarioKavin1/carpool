/**
 * TEMPORARY driver: drive the `carpool_*` MCP tools the way an MCP client does.
 *
 * Not an in-process function call: this spawns `apps/mcp/src/server.ts` as a
 * child process, speaks the Model Context Protocol to it over stdio with the
 * official SDK client, lists its tools, and calls them. `carpool_fetch` makes a
 * REAL x402 purchase on Hedera testnet against the real Blocky402 facilitator
 * and the registry on :8403; `carpool_publish` publishes for real on the second
 * call (the first is the unconfirmed consent diff, which must publish nothing).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.OUT_DIR!;
const accounts = JSON.parse(readFileSync(process.env.ACCOUNTS_JSON!, "utf8"));
const author = accounts.author13;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx", join(import.meta.dirname, "src/server.ts")],
  env: {
    ...(process.env as Record<string, string>),
    CARPOOL_REGISTRY_URL: process.env.CARPOOL_BASE ?? "http://127.0.0.1:8403",
    CARPOOL_AUTHOR_ACCOUNT_ID: author.id,
    CARPOOL_AUTHOR_PRIVATE_KEY: author.key,
    CARPOOL_BUYER_ACCOUNT_ID: accounts.buyer.id,
    CARPOOL_BUYER_PRIVATE_KEY: accounts.buyer.key,
  },
});

const client = new Client({ name: "carpool-live-run-mcp-client", version: "0.1.0" });
await client.connect(transport);

const record: Record<string, unknown> = {
  _what:
    "The carpool_* MCP tools driven over stdio by the official @modelcontextprotocol/sdk client, " +
    "against the live registry on :8403, the real Blocky402 facilitator and real Hedera testnet. " +
    "apps/mcp/src/server.ts was spawned as a child process; nothing was called in-process.",
  serverVersion: client.getServerVersion(),
  capabilities: client.getServerCapabilities(),
};

const tools = await client.listTools();
record.tools = tools.tools.map((t) => ({
  name: t.name,
  title: (t as { title?: string }).title,
  description: t.description?.slice(0, 160),
  inputSchemaKeys: Object.keys((t.inputSchema as { properties?: object }).properties ?? {}),
}));
console.log(`tools: ${tools.tools.map((t) => t.name).join(", ")}`);

const text = (r: unknown) =>
  ((r as { content?: { type: string; text?: string }[] }).content ?? [])
    .map((c) => c.text ?? `[${c.type}]`)
    .join("\n");

// ---------------------------------------------------------------- publish

const QUESTION =
  "How does an MCP client drive carpool's publish and fetch tools against a real x402 registry?";
const BODY = `# Driving carpool over MCP

Fixture for the v2 full-feature testnet run, published through carpool_publish
over a real stdio MCP session rather than by calling publishArtifact directly.

The point of routing it this way is that the tool surface — descriptions, input
schemas, the consent diff on an unconfirmed call, and the receipt carpool_fetch
returns — is exercised exactly as an agent would reach it, including the
registry's x402 gate and a real Hedera settlement underneath.
`;

const provenance = {
  model: "claude-opus-5",
  durationSeconds: 60,
  inputTokens: 1000,
  outputTokens: 200,
  estimatedCostUsd: 0.02,
  toolCalls: 3,
};
const sources = [{ url: "https://modelcontextprotocol.io/specification", fetchedAt: "2026-09-12T00:00:00Z" }];

const unconfirmed = await client.callTool({
  name: "carpool_publish",
  arguments: { question: QUESTION, abstract: `MCP-driven publish fixture. ${QUESTION}`, body: BODY, sources, provenance, scope: "carpool-full-feature-run", halfLifeDays: 365 },
});
record.publishUnconfirmed = { text: text(unconfirmed), isError: (unconfirmed as { isError?: boolean }).isError ?? false };
console.log("carpool_publish (no confirm) returned the consent diff");

const searchBefore = await client.callTool({ name: "carpool_search", arguments: { question: QUESTION, limit: 5 } });
record.searchBeforePublish = { text: text(searchBefore) };

const confirmed = await client.callTool({
  name: "carpool_publish",
  arguments: { question: QUESTION, abstract: `MCP-driven publish fixture. ${QUESTION}`, body: BODY, sources, provenance, scope: "carpool-full-feature-run", halfLifeDays: 365, confirm: true },
});
record.publishConfirmed = { text: text(confirmed), isError: (confirmed as { isError?: boolean }).isError ?? false };
console.log(`carpool_publish (confirm) -> ${text(confirmed).split("\n")[0]}`);

const magnet = /swarm:[0-9a-f]{64}/.exec(text(confirmed))?.[0];
if (!magnet) throw new Error("no magnet in the publish result");
record.magnet = magnet;

// ----------------------------------------------------------------- search

const search = await client.callTool({ name: "carpool_search", arguments: { question: QUESTION, limit: 5 } });
record.searchAfterPublish = { text: text(search) };
console.log("carpool_search found it");

// ------------------------------------------------------------------ fetch

const t0 = Date.now();
const fetched = await client.callTool({ name: "carpool_fetch", arguments: { magnet } });
record.fetch = {
  text: text(fetched),
  isError: (fetched as { isError?: boolean }).isError ?? false,
  wallClockMs: Date.now() - t0,
};
console.log(`carpool_fetch -> ${text(fetched).split("\n")[0]} (${Date.now() - t0} ms)`);

// ----------------------------------------------------------------- delist

const delisted = await client.callTool({ name: "carpool_delist", arguments: { magnet } });
record.delist = { text: text(delisted), isError: (delisted as { isError?: boolean }).isError ?? false };
const delistedAgain = await client.callTool({ name: "carpool_delist", arguments: { magnet } });
record.delistAgain = { text: text(delistedAgain) };

// A buy after the withdrawal must fail, through the tool, with the tool's words.
const buyAfterDelist = await client.callTool({ name: "carpool_fetch", arguments: { magnet } });
record.fetchAfterDelist = {
  text: text(buyAfterDelist),
  isError: (buyAfterDelist as { isError?: boolean }).isError ?? false,
};
console.log(`carpool_fetch after delist -> ${text(buyAfterDelist).split("\n")[0]}`);

await client.close();
writeFileSync(join(OUT, "64-mcp-tools.json"), `${JSON.stringify(record, null, 2)}\n`);
console.log(`\n-> 64-mcp-tools.json`);
