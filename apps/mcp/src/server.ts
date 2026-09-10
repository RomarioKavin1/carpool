#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { RegistryClient } from "./client.js";
import { tryLocalEmbedder, REMOTE_EMBED_NOTICE, type Embedder } from "./embed.js";
import { scanForPublish } from "./scan.js";
import { renderPublishDiff } from "./diff.js";
import { CAP_MICRO_USDC, renderCandidate, renderIntegrity, usd } from "./render.js";
import { maxBuyableRedoCostUsd, priceForRedoCost } from "@carpool/core";

const REGISTRY = process.env.CARPOOL_REGISTRY_URL ?? "http://localhost:8403";
const OUT_DIR = process.env.CARPOOL_ARTIFACT_DIR ?? join(tmpdir(), "carpool-artifacts");

const registry = new RegistryClient(REGISTRY);
let embedder: Embedder | null = null;
let embedReason = "";

async function ensureEmbedder(): Promise<void> {
  if (embedder) return;
  const wk = await registry.wellKnown();
  const attempt = await tryLocalEmbedder(wk.embedding);
  if (attempt.embedder) embedder = attempt.embedder;
  else embedReason = attempt.reason;
}

const server = new McpServer({ name: "carpool", version: "0.1.0" });

/**
 * ## Why the handlers below are named exports and the transport is connected last
 *
 * `await server.connect(new StdioServerTransport())` used to run at module scope,
 * which made this file impossible to import — so **no test had ever executed a
 * line of it.** `apps/mcp/src/e2e.test.ts` drives `publishArtifact`, `payFetch`,
 * `delistArtifact` and `RegistryClient.search`: the layer *underneath* these
 * handlers, while its describe blocks are named after the tools. Everything that
 * lives only here was uncovered — the `confirm` gate, which is the whole of the
 * consent story for publishing; `priceForRedoCost`, which sets what an author is
 * paid; the `scanForPublish` redaction wiring; the spend-cap message; and
 * `carpool_fetch` writing the body to a file instead of returning it inline,
 * which is the saving this product exists to produce.
 *
 * Each handler is therefore a named exported function, registered by name below,
 * and the transport is connected only when this module is the process entry point
 * — the same shape and the same reason as `apps/registry/src/server.ts`'s
 * `import.meta.url === file://${process.argv[1]}` guard. `src/server.test.ts`
 * drives all four against the real registry.
 *
 * Note for anyone writing that kind of test: `REGISTRY` is read at module scope,
 * so `CARPOOL_REGISTRY_URL` (and `CARPOOL_ARTIFACT_DIR`) must be set *before* the
 * import.
 */
type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export async function carpoolSearch({
  question,
  limit,
}: {
  question: string;
  limit?: number;
}): Promise<ToolResult> {
  {
    await ensureEmbedder();
    const { results, sentText } = await registry.search(question, limit ?? 5, embedder);

    if (results.length === 0) {
      return {
        content: [
          {
            type: "text",
            text:
              `No prior research found for: ${question}\n\nDo the research yourself.` +
              (sentText ? `\n\n${REMOTE_EMBED_NOTICE}${embedReason ? ` Reason: ${embedReason}.` : ""}` : ""),
          },
        ],
      };
    }

    const body = results.map((m, i) => renderCandidate(m, i)).join("\n\n");
    const affordable = results.filter((r) => r.priceNow <= CAP_MICRO_USDC);
    const cheapest = affordable.length > 0 ? Math.min(...affordable.map((r) => r.priceNow)) : null;
    const dearestToRedo = Math.max(...results.map((r) => r.provenance.estimatedCostUsd));
    return {
      content: [
        {
          type: "text",
          text:
            `${results.length} candidate(s) for: ${question}\n\n${body}\n\n` +
            (cheapest === null
              ? `All of these are above your ${usd(CAP_MICRO_USDC)} per-payment cap (which buys research ` +
                `costing up to $${maxBuyableRedoCostUsd(CAP_MICRO_USDC).toFixed(2)} to produce); raise ` +
                `CARPOOL_MAX_MICRO_USDC to buy one. `
              : `Buying the cheapest costs ${usd(cheapest)}; `) +
            `the most expensive of these cost $${dearestToRedo.toFixed(2)} to produce. ` +
            `Use carpool_fetch <magnet> to buy one.` +
            (sentText ? `\n\n${REMOTE_EMBED_NOTICE}${embedReason ? ` Reason: ${embedReason}.` : ""}` : ""),
        },
      ],
    };
  }
}

export async function carpoolFetch({ magnet }: { magnet: string }): Promise<ToolResult> {
  {
    const { payFetch } = await import("./pay.js");
    const result = await payFetch(REGISTRY, magnet);
    if (!result.ok) {
      return {
        content: [{ type: "text", text: `Could not buy ${magnet}: ${result.error}` }],
        isError: true,
      };
    }

    mkdirSync(OUT_DIR, { recursive: true });
    const name = `${magnet.replace(/^swarm:/, "").slice(0, 16)}.md`;
    const path = join(OUT_DIR, name);
    writeFileSync(path, result.body, "utf8");

    const bytes = Buffer.byteLength(result.body, "utf8");
    const digest = createHash("sha256").update(result.body).digest("hex");
    return {
      content: [
        {
          type: "text",
          text:
            `Bought ${magnet} for ${usd(result.paid)}.\n` +
            `Written to: ${path}\n` +
            `${bytes} bytes · ${renderIntegrity(result, digest)}\n` +
            `Transaction: ${result.txId || "(none reported)"}\n\n` +
            `Read the file for the research. You did not have to run it.`,
        },
      ],
    };
  }
}

export interface PublishArgs {
  question: string;
  abstract: string;
  body: string;
  sources: { url: string; fetchedAt: string }[];
  provenance: {
    model: string;
    durationSeconds: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    toolCalls: number;
  };
  scope?: string;
  halfLifeDays?: number;
  neverPublish?: string[];
  confirm?: boolean;
}

export async function carpoolPublish(args: PublishArgs): Promise<ToolResult> {
  {
    const scan = scanForPublish({
      question: args.question,
      abstract: args.abstract,
      body: args.body,
      sources: args.sources,
      neverPublish: args.neverPublish,
    });

    // 10% of what the research cost to produce — from pricing.ts, which derives
    // the buyer's default spend cap from this same share so the two cannot
    // contradict each other. They did twice: this rule against a 20,000 µUSDC cap
    // made anything costing over $0.1333 to produce unbuyable out of the box (I4),
    // and the share itself read 0.15 here while apps/bench listed at 0.10
    // (AUDIT-CLAIMS M4). Resolved to 0.10; the reasoning is on
    // PRICE_SHARE_OF_REDO_COST in packages/carpool-core/src/pricing.ts.
    //
    // `estimatedCostUsd` is SELF-REPORTED by the author, which is the whole
    // reason the price is a fraction of it rather than it.
    const priceMicro = priceForRedoCost(args.provenance.estimatedCostUsd);
    const halfLife = args.halfLifeDays ?? 1;

    if (!args.confirm) {
      return {
        content: [
          {
            type: "text",
            text:
              renderPublishDiff({
                scan,
                bodyBytes: Buffer.byteLength(scan.redacted.body, "utf8"),
                priceMicroUsdc: priceMicro,
                halfLifeDays: halfLife,
              }) +
              "\n\nNothing has been published. Show this to the user and call again with confirm: true " +
              "only if they approve.",
          },
        ],
      };
    }

    const { publishArtifact } = await import("./publish.js");
    const out = await publishArtifact(REGISTRY, {
      ...args,
      ...scan.redacted,
      halfLifeDays: halfLife,
      priceMicroUsdc: priceMicro,
      redacted: !scan.clean,
    });
    return {
      content: [
        {
          type: "text",
          text: out.ok
            ? `Published ${out.magnet} at ${usd(priceMicro)}, halving every ${halfLife} day(s).` +
              (scan.clean ? "" : ` ${scan.findings.length} item(s) were stripped before publishing.`) +
              (out.duplicateOf
                ? `\n\nNote: ${out.duplicateOf} already answers the same normalised question. Both are ` +
                  `live and the tracker ranks between them — yours is not a replacement.`
                : "")
            : `Publish failed: ${out.error}`,
        },
      ],
      isError: !out.ok,
    };
  }
}

export async function carpoolDelist({ magnet }: { magnet: string }): Promise<ToolResult> {
  {
    const { delistArtifact } = await import("./delist.js");
    const out = await delistArtifact(REGISTRY, magnet);
    if (!out.ok) {
      return { content: [{ type: "text", text: `Could not delist ${magnet}: ${out.error}` }], isError: true };
    }
    return {
      content: [
        {
          type: "text",
          text:
            (out.alreadyDelisted
              ? `${magnet} was already withdrawn (at ${new Date(out.delistedAt * 1000).toISOString()}).`
              : `Withdrawn ${magnet} from sale.`) +
            `\n\n${out.note}`,
        },
      ],
    };
  }
}

// --------------------------------------------------------------- registration

server.registerTool(
  "carpool_search",
  {
    title: "Search prior research before doing your own",
    description:
      "Call this BEFORE starting deep research. Returns prior research artifacts whose question " +
      "matches yours, with what each cost to produce, how stale it is, and what it costs to buy. " +
      "Free — no payment is made by this tool. Read the evidence and decide whether buying beats " +
      "redoing the work.",
    inputSchema: { question: z.string().min(3), limit: z.number().int().min(1).max(20).optional() },
  },
  carpoolSearch,
);

server.registerTool(
  "carpool_fetch",
  {
    title: "Buy an artifact and write it to a file",
    description:
      "Pays for an artifact over x402 and writes it to a file, returning the path and a summary. " +
      "It does NOT return the body inline: an MCP tool result is capped at ~25k tokens and a real " +
      "artifact does not fit. Writing to a file also keeps the context cost under your control, " +
      "which is the saving this whole system exists to produce — read only the parts you need.",
    inputSchema: { magnet: z.string().startsWith("swarm:") },
  },
  carpoolFetch,
);

server.registerTool(
  "carpool_publish",
  {
    title: "List research you already did, for sale",
    description:
      "Publishes a completed research artifact so the next person with the same question can buy it " +
      "instead of redoing the work. IRREVERSIBLE: carpool_delist stops new sales but cannot recall a copy " +
      "someone has already paid for. Requires explicit approval every time; never available to subagents, " +
      "and turned off entirely by CARPOOL_PUBLISH_MODE=off.",
    inputSchema: {
      question: z.string().min(3),
      abstract: z.string().min(10),
      body: z.string().min(1),
      sources: z.array(z.object({ url: z.string().url(), fetchedAt: z.string() })),
      provenance: z.object({
        model: z.string(),
        durationSeconds: z.number(),
        inputTokens: z.number(),
        outputTokens: z.number(),
        estimatedCostUsd: z.number(),
        toolCalls: z.number(),
      }),
      scope: z.string().optional(),
      halfLifeDays: z.number().positive().optional(),
      neverPublish: z.array(z.string()).optional(),
      confirm: z.boolean().optional(),
    },
  },
  carpoolPublish,
);

server.registerTool(
  "carpool_delist",
  {
    title: "Withdraw research you published, from sale",
    description:
      "Stops new sales of an artifact you published. What it CANNOT do: recall a copy someone has " +
      "already paid for, cancel a buyer's refund window, or cancel a royalty you have already earned " +
      "(you still get paid for sales that happened). Final for that magnet: republishing the same " +
      "research does not relist it. Requires the author credentials the artifact was published with.",
    inputSchema: { magnet: z.string().startsWith("swarm:") },
  },
  carpoolDelist,
);

/**
 * Connect only when this module IS the process, never on import — otherwise a test
 * that imports a handler hijacks stdio and hangs. `apps/registry/src/server.ts`
 * guards its `listen()` the same way.
 */
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await server.connect(new StdioServerTransport());
}

export { server };
