import { config as _dotenvConfig } from "dotenv";
import { resolve as _dotenvResolve } from "node:path";
_dotenvConfig({ path: [_dotenvResolve(process.cwd(), ".env"), _dotenvResolve(process.cwd(), "../../.env")] });
import { usdcId } from "@carpool/hedera-x402";

// Read-only preflight: env, USDC association, balances, facilitator
// reachability. Mirror node only. Ported from apps/settlement, minus the
// "provider" account check — v2 has no fixed provider account.
const MIRROR = "https://testnet.mirrornode.hedera.com";

type Row = { ok: boolean; label: string; detail: string };
const rows: Row[] = [];
const add = (ok: boolean, label: string, detail = "") => rows.push({ ok, label, detail });

async function j(url: string): Promise<any> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

async function checkAccount(name: string, id: string | undefined, token: string) {
  if (!id || id === "0.0.000000") {
    add(false, `${name} account`, "unset");
    return;
  }
  add(true, `${name} account`, id);
  try {
    const assoc = await j(`${MIRROR}/api/v1/accounts/${id}/tokens?token.id=${token}`);
    const t = (assoc.tokens ?? [])[0];
    if (t) {
      add(true, `${name} USDC`, `associated, balance ${t.balance}`);
    } else {
      const acct = await j(`${MIRROR}/api/v1/accounts/${id}`);
      const slots = acct?.max_automatic_token_associations ?? 0;
      const auto = slots === -1 || slots > 0;
      add(
        false,
        `${name} USDC`,
        `NOT associated${auto ? ` (auto-assoc ${slots === -1 ? "unlimited" : slots}, but the Circle faucet ignores that)` : ""} — run: pnpm --filter @carpool/registry associate`,
      );
    }
  } catch (e) {
    add(false, `${name} USDC`, `mirror error ${(e as Error).message}`);
  }
  try {
    const acct = await j(`${MIRROR}/api/v1/accounts/${id}`);
    const hbar = acct?.balance?.balance ?? 0;
    add(hbar > 0, `${name} tHBAR`, `${(hbar / 1e8).toFixed(2)} ℏ`);
  } catch (e) {
    add(false, `${name} tHBAR`, `mirror error ${(e as Error).message}`);
  }
}

async function main() {
  const token = usdcId();
  add(!!process.env.USDC_TOKEN_ID, "USDC_TOKEN_ID", token);
  add(
    !!process.env.HCS_TOPIC_ID && process.env.HCS_TOPIC_ID !== "0.0.000000",
    "HCS_TOPIC_ID",
    process.env.HCS_TOPIC_ID ?? "unset",
  );
  add(
    !!process.env.CARPOOL_PRIVATE_KEY,
    "CARPOOL_PRIVATE_KEY",
    process.env.CARPOOL_PRIVATE_KEY ? "set" : "unset (x402-gated GET /artifact will quote requirements no one can settle)",
  );
  add(
    !!process.env.LEDGER_API_KEY,
    "LEDGER_API_KEY",
    process.env.LEDGER_API_KEY ? "set" : "unset (POST /settle is open — fine locally only)",
  );

  await checkAccount("carpool", process.env.CARPOOL_ACCOUNT_ID, token);

  const facilitator = process.env.FACILITATOR_URL || "https://api.testnet.blocky402.com";
  try {
    await j(`${facilitator}/supported`);
    add(true, "facilitator /supported", facilitator);
  } catch (e) {
    add(false, "facilitator /supported", `${facilitator} — ${(e as Error).message}`);
  }

  console.log("\n  Carpool registry doctor\n  " + "─".repeat(50));
  for (const r of rows) {
    console.log(`  ${r.ok ? "OK  " : "FAIL"}  ${r.label.padEnd(26)} ${r.detail}`);
  }
  const allOk = rows.every((r) => r.ok);
  console.log(allOk ? "  all green — ready for a live run\n" : "  fill the FAIL rows in .env, then re-run\n");
  // Always exit 0: this is a status report, not a gate.
}

main().catch((e) => {
  console.error("doctor failed:", e.message);
  process.exit(1);
});
