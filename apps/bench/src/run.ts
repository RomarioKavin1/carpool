// Bench runner: N buyers hit a registry concurrently, Zipf workload over
// whatever it actually holds, JSONL out + summary. `pnpm start`.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as _dotenvConfig } from "dotenv";
import { resolve as _dotenvResolve } from "node:path";
_dotenvConfig({ path: [_dotenvResolve(process.cwd(), ".env"), _dotenvResolve(process.cwd(), "../../.env")] });
import type { Account } from "./agent.js";
import { driveLoad, fetchCatalog } from "./load.js";
import { printSummary, summarize } from "./report.js";

interface Args {
  buyers: number;
  requests: number;
  seed: number;
  alpha: number;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    buyers: 13,
    requests: 30,
    seed: 42,
    alpha: 1.0,
    out: `run-${Date.now()}.jsonl`,
  };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    if (f === "--buyers") a.buyers = Number(argv[++i]);
    else if (f === "--requests") a.requests = Number(argv[++i]);
    else if (f === "--seed") a.seed = Number(argv[++i]);
    else if (f === "--alpha") a.alpha = Number(argv[++i]);
    else if (f === "--out") a.out = argv[++i]!;
  }
  return a;
}

function loadAccounts(): Account[] {
  const path = resolve(process.cwd(), "accounts.json");
  if (!existsSync(path)) {
    console.error("accounts.json not found — run bootstrap first (pnpm bootstrap).");
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = process.env.CARPOOL_REGISTRY_URL || "http://localhost:8403";
  const network = process.env.HEDERA_NETWORK || "hedera:testnet";
  const accounts = loadAccounts();

  const catalog = await fetchCatalog(base);
  if (catalog.length === 0) {
    console.error(`registry at ${base} has no live artifacts to buy — publish some first (POST /publish).`);
    process.exit(1);
  }
  console.log(`catalog: ${catalog.length} live artifact(s) at ${base}`);

  const lines = await driveLoad({
    base,
    network,
    catalog,
    accounts,
    buyerCount: Math.min(args.buyers, accounts.length),
    requestsPerBuyer: args.requests,
    seed: args.seed,
    alpha: args.alpha,
  });

  writeFileSync(args.out, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  printSummary(summarize(lines));
  console.log(`log:           ${args.out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
