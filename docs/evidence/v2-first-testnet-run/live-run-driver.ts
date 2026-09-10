/**
 * TEMPORARY live-run driver — not part of the product, deleted after the run.
 *
 * Drives the real registry on :8403 through the real @carpool/mcp client code:
 *   publish  -> POST /publish with a real authorSig over the real magnet
 *   buy      -> GET /artifact/:magnet: 402 -> pay -> paid retry -> body,
 *               integrity-checked against the manifest's bodyHash
 * Everything it writes goes to the path given as argv[3].
 */
import { writeFileSync, readFileSync } from "node:fs";
import { publishArtifact } from "./src/publish.js";
import { payFetch } from "./src/pay.js";

const BASE = process.env.CARPOOL_BASE ?? "http://localhost:8403";
const step = process.argv[2];
const out = process.argv[3]!;

const BODY = `# Minting Circle testnet USDC to a Hedera account: the association order that wastes afternoons

## The short answer

Associate the account with the token **before** you ask the faucet for anything.
\`maxAutomaticTokenAssociations\` does not substitute for an explicit
\`TokenAssociateTransaction\`, and the failure is silent.

## Why

Hedera requires an account to hold a token *relationship* before a balance of
that token can exist on it. There are two ways to get one:

1. **Explicit** — a \`TokenAssociateTransaction\` signed by the receiving
   account, which creates the relationship immediately, at a cost of roughly
   \$0.05 in HBAR.
2. **Automatic** — \`maxAutomaticTokenAssociations\` reserves N slots (or -1 for
   unlimited) and the relationship is created **lazily, by the first transfer
   that needs it**. Until that transfer lands, the account has no relationship
   with the token and the mirror node's
   \`/api/v1/accounts/{id}/tokens?token.id={token}\` returns an empty list.

Circle's testnet faucet reads exactly that mirror-node view *before* it submits.
An account with unlimited automatic association slots and no existing
relationship reads, to the faucet, as an account that cannot receive the token —
so it declines. It does not raise an error, it does not explain, and the UI
gives the same acknowledgement it gives a successful mint. The only symptom is
that no transfer ever appears.

The two mechanisms are therefore not interchangeable for any counterparty that
pre-checks. Auto-association is sufficient for a *transfer you control* (your own
settler paying a payee, for instance: the transfer creates the relationship on
arrival) and insufficient for a *transfer somebody else decides whether to send*.

## The operational order

1. Create the account (ECDSA if anything in the path will call
   \`PrivateKey.fromStringECDSA\` — an ED25519 key fails at signing time with an
   error that reads like a remote fault).
2. Submit \`TokenAssociateTransaction\` for the token id, signed by the account.
   For Circle's testnet USDC on Hedera that is \`0.0.429274\`.
3. Confirm the relationship on the mirror node before going near the faucet:
   \`GET /api/v1/accounts/{id}/tokens?token.id=0.0.429274\` must return one entry.
4. Then mint.

## The rate limit, and what to do when you have burned it

The faucet is limited per address per two-hour window, and a declined mint
consumes the window just as a successful one does — which is the expensive part
of getting the order wrong, because the diagnosis ("it silently did nothing")
and the remedy ("wait two hours") arrive together.

The way out without waiting is to mint to a *different* account that is already
associated and sweep: a \`TransferTransaction\` moving the balance to the account
that actually needed it. That transfer creates the relationship on the
destination if it has an automatic slot free, which is the one case where
automatic association is enough.

## What this costs to verify

Association is a signed transaction per account per token, so a four-account
fleet is four transactions and about \$0.20 of testnet HBAR — cheap enough that
associating unconditionally at setup time, before you know which accounts will
receive a mint, is the correct default. The asymmetry is the point: the
association you did not need cost \$0.05, and the association you skipped cost
two hours.
`;

if (step === "publish") {
  const res = await publishArtifact(BASE, {
    question:
      "Why does the Circle testnet faucet silently decline to mint USDC to a Hedera account with unlimited automatic token associations?",
    abstract:
      "Circle's Hedera testnet faucet checks the mirror node for an existing token relationship before it submits, so maxAutomaticTokenAssociations (which creates the relationship lazily, on first receipt) does not satisfy it and the mint is declined with no error. Covers the required association order, the ECDSA key constraint, the two-hour rate-limit window a declined mint still consumes, and the mint-to-an-associated-account-and-sweep workaround.",
    body: BODY,
    sources: [
      {
        url: "https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/associate-tokens-to-an-account",
        fetchedAt: "2026-09-12T00:00:00Z",
      },
      { url: "https://faucet.circle.com/", fetchedAt: "2026-09-12T00:00:00Z" },
      {
        url: "https://testnet.mirrornode.hedera.com/api/v1/accounts/0.0.10477413/tokens?token.id=0.0.429274",
        fetchedAt: "2026-09-12T00:00:00Z",
      },
    ],
    provenance: {
      model: "claude-opus-5",
      durationSeconds: 5400,
      inputTokens: 412_000,
      outputTokens: 18_400,
      estimatedCostUsd: 3.41,
      toolCalls: 96,
    },
    scope: "hedera-testnet-ops",
    halfLifeDays: 120,
    priceMicroUsdc: 100_000,
    redacted: false,
  });
  console.log(JSON.stringify(res, null, 2));
  writeFileSync(out, JSON.stringify(res, null, 2));
  if (!res.ok) process.exit(1);
} else if (step === "buy") {
  const magnet = (JSON.parse(readFileSync(process.argv[4]!, "utf8")) as { magnet: string }).magnet;
  const res = await payFetch(BASE, magnet);
  const shown = { ...res, body: `${res.body.length} bytes`, bodySha256: null as string | null };
  const { createHash } = await import("node:crypto");
  shown.bodySha256 = createHash("sha256").update(res.body).digest("hex");
  console.log(JSON.stringify(shown, null, 2));
  writeFileSync(out, JSON.stringify(shown, null, 2));
  if (!res.ok) process.exit(1);
} else {
  throw new Error(`unknown step ${step}`);
}
