/**
 * Entry point of the published `carpool-mcp` npm package, bundled by
 * `scripts/build-npm.mjs`. Not part of the workspace build.
 *
 *   carpool-mcp                 the MCP server on stdio
 *   carpool-mcp setup         associate an account and add Carpool to Claude Code
 *   carpool-mcp associate       associate a Hedera testnet account with test USDC
 *                               (HEDERA_ACCOUNT_ID / HEDERA_PRIVATE_KEY from env only)
 *   carpool-mcp consent-hook    the PreToolUse consent hook for carpool_publish
 */
import { readFileSync } from "node:fs";

const sub = process.argv[2];

function emitDeny(reason: string): never {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

if (sub === "setup") {
  const { setup } = await import("./npm-setup.js");
  const { InputError } = await import("../../registry/src/scripts/associate-account-lib.js");
  setup().then(
    (code: number) => process.exit(code),
    (e: Error) => {
      console.error(e instanceof InputError ? `\n${e.message}` : `\nsetup failed: ${e.message}`);
      process.exit(1);
    },
  );
} else if (sub === "associate") {
  const { associateAccount, InputError } = await import(
    "../../registry/src/scripts/associate-account-run.js"
  );
  associateAccount().then(
    (code: number) => process.exit(code),
    (e: Error) => {
      console.error(e instanceof InputError ? e.message : `failed: ${e.message}`);
      process.exit(1);
    },
  );
} else if (sub === "consent-hook") {
  // Fails closed: any problem reading input or deciding is a deny.
  try {
    let input: unknown;
    try {
      input = JSON.parse(readFileSync(0, "utf8"));
    } catch {
      emitDeny("carpool publish hook could not read its input; refusing rather than guessing.");
    }
    const { decideConsent, hookOutput } = await import("../src/consent.js");
    const out = hookOutput(decideConsent(input as never, { mode: process.env.CARPOOL_PUBLISH_MODE as never }));
    process.stdout.write(JSON.stringify(out));
  } catch (e) {
    emitDeny(`carpool publish hook failed (${(e as Error).message}); refusing rather than guessing.`);
  }
} else if (sub === undefined || sub === "serve") {
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { server } = await import("../src/server.js");
  await server.connect(new StdioServerTransport());
} else if (sub === "--version" || sub === "-v") {
  console.log("carpool-mcp __VERSION__");
} else {
  console.error(
    `carpool-mcp: unknown command "${sub}".\n` +
      "Usage: carpool-mcp            start the MCP server on stdio\n" +
      "       carpool-mcp setup      associate an account and add Carpool to Claude Code\n" +
      "       carpool-mcp associate  associate HEDERA_ACCOUNT_ID with test USDC (key from HEDERA_PRIVATE_KEY env)\n" +
      "       carpool-mcp consent-hook  PreToolUse hook for carpool_publish",
  );
  process.exit(2);
}
