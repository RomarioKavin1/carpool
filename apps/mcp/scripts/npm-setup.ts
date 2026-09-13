/**
 * `npx carpool-mcp setup`: the whole onboarding in one command.
 *
 *   1. asks for a Hedera testnet account id (Enter skips: search only)
 *   2. asks for its private key, hidden, or reads HEDERA_PRIVATE_KEY
 *   3. associates the account with test USDC if it is not already
 *   4. runs `claude mcp add` with the account as both buyer and author
 *
 * The key is never printed and never passed through a shell.
 */
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

const DEFAULT_REGISTRY = "https://carpool-registry-production.up.railway.app";
const MIRROR = "https://testnet.mirrornode.hedera.com";
const USDC = "0.0.429274";

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Echo nothing after the prompt itself.
      const out = rl as unknown as { _writeToOutput: (s: string) => void };
      let prompted = false;
      out._writeToOutput = (s: string) => {
        if (!prompted) {
          process.stdout.write(s);
          prompted = true;
        }
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

async function usdcBalance(id: string): Promise<number | null> {
  try {
    const res = await fetch(`${MIRROR}/api/v1/accounts/${id}/tokens?token.id=${USDC}`);
    if (!res.ok) return null;
    const json = (await res.json()) as { tokens?: { balance?: number }[] };
    return json.tokens?.[0]?.balance ?? null;
  } catch {
    return null;
  }
}

function hasClaude(): boolean {
  return spawnSync("claude", ["--version"], { stdio: "ignore" }).status === 0;
}

export async function setup(): Promise<number> {
  const registry = process.env.CARPOOL_REGISTRY_URL?.trim() || DEFAULT_REGISTRY;
  console.log("Carpool setup\n");
  console.log("A Hedera ECDSA testnet account lets your agent buy research and get paid for its own.");
  console.log("No account yet? Create one at https://portal.hedera.com, or press Enter to search only.\n");

  const id = process.env.HEDERA_ACCOUNT_ID?.trim() || (await ask("Account id (0.0.x, Enter to skip): "));
  const env: [string, string][] = [["CARPOOL_REGISTRY_URL", registry]];

  if (id) {
    const key = process.env.HEDERA_PRIVATE_KEY?.trim() || (await ask("Private key (hex, hidden): ", true));
    process.env.HEDERA_ACCOUNT_ID = id;
    process.env.HEDERA_PRIVATE_KEY = key;
    const { associateAccount } = await import("../../registry/src/scripts/associate-account-run.js");
    console.log("\nChecking the account and USDC association...");
    await associateAccount();
    env.push(
      ["CARPOOL_BUYER_ACCOUNT_ID", id],
      ["CARPOOL_BUYER_PRIVATE_KEY", key],
      ["CARPOOL_AUTHOR_ACCOUNT_ID", id],
      ["CARPOOL_AUTHOR_PRIVATE_KEY", key],
    );
  }

  const args = ["mcp", "add", "carpool", "-s", "user"];
  for (const [k, v] of env) args.push("-e", `${k}=${v}`);
  args.push("--", "npx", "-y", "carpool-mcp");

  if (!hasClaude()) {
    const shown = args.map((a) => (a.includes("PRIVATE_KEY=") ? a.replace(/=.*/, "=<your key>") : a));
    console.log("\nClaude Code (the `claude` command) was not found. Once installed, run:\n");
    console.log(`  claude ${shown.join(" ")}`);
    return 1;
  }

  // Replace an earlier install rather than failing on the name clash.
  spawnSync("claude", ["mcp", "remove", "carpool", "-s", "user"], { stdio: "ignore" });
  const added = spawnSync("claude", args, { stdio: ["ignore", "ignore", "inherit"] });
  if (added.status !== 0) {
    console.error("\n`claude mcp add` failed; see the message above.");
    return 1;
  }

  console.log("\nDone. Carpool is added to Claude Code for every project. Restart Claude Code to load it.");
  if (!id) {
    console.log("Search only. Run `npx carpool-mcp setup` again with an account to buy and publish.");
    return 0;
  }
  const bal = await usdcBalance(id);
  if (bal === 0) {
    console.log(`\n${id} holds no USDC yet. To buy, get test USDC (Hedera testnet) at https://faucet.circle.com`);
    console.log("Publishing needs none: royalties arrive in this account.");
  } else if (bal !== null) {
    console.log(`\n${id} holds $${(bal / 1e6).toFixed(2)} test USDC. Ready to buy and publish.`);
  }
  console.log("Keys given to `claude mcp add` are stored in plaintext in its config. Use a testnet key.");
  return 0;
}
