# Getting started

**There is no sign-up.** No Carpool account, no email address, no password, no
dashboard login, no invite. Nothing to create and nothing to wait for.

Your identity is a **Hedera keypair**. That is the whole of it. The registry
knows an author by the account its royalties are paid to, and a buyer by the
account its payments came from, and it never learns anything else about either.

The second thing worth saying before any command: **the same person is usually
both.** Author and buyer are not two products or two accounts. They are the two
directions of one mechanism: research goes out and money comes back, or money
goes out and research comes back. Most people who run this run both, on one
keypair, from one MCP server.

So this document is organised by role because the *steps* genuinely differ, not
because the roles do.

| role | what it needs | where |
|---|---|---|
| **Buyer / consumer** | nothing at all to search. A funded ECDSA account to buy. | [below](#buyer) |
| **Author / provider** | an ECDSA account for royalties, plus a consent hook | [below](#author) |
| **Registry operator** | a testnet identity, a topic, a settler you keep running | [docs/RUNBOOK.md](RUNBOOK.md) |

**This is Hedera testnet and test USDC.** The refund path, multi-payee
settlement, `reconcile` and the cross-process settle lease have all now been
proven on chain (`docs/evidence/v2-full-feature-run/`), and it is still testnet.
Nobody earns real money here. Do not read any figure below as income.

---

## 0. Install the MCP server

Both roles need this and it is the only install. Four tools arrive with it:
`carpool_search`, `carpool_fetch`, `carpool_publish`, `carpool_delist`.

```bash
nvm use                               # Node 20.19.0; the preinstall guard rejects 26
pnpm install
pnpm --filter @carpool/mcp build      # writes apps/mcp/dist/server.js
```

The build step is not optional and it is not only about the server. The publish
consent hook loads `dist/consent.js` and **fails closed** if it is absent, so an
author who skips the build gets a hook that refuses every publish.

Then register the server with your client. For Claude Code:

```bash
claude mcp add carpool \
  -e CARPOOL_REGISTRY_URL=http://127.0.0.1:8403 \
  -e CARPOOL_ARTIFACT_DIR=$HOME/carpool-artifacts \
  -- node /abs/path/to/carpool/apps/mcp/dist/server.js
```

The equivalent JSON, for a client that is configured by file rather than by
command. In Claude Code this is `.mcp.json` at the root of the project you want
it in; other clients take the same `mcpServers` object in their own config file:

```json
{
  "mcpServers": {
    "carpool": {
      "type": "stdio",
      "command": "node",
      "args": ["/abs/path/to/carpool/apps/mcp/dist/server.js"],
      "env": {
        "CARPOOL_REGISTRY_URL": "http://127.0.0.1:8403",
        "CARPOOL_ARTIFACT_DIR": "/abs/path/to/somewhere/artifacts"
      }
    }
  }
}
```

Both forms were run. Three details that will otherwise cost time:

- **A `.mcp.json` server needs approving once.** `claude mcp list` reports it as
  `⏸ Pending approval (run claude to approve)` until you say yes in an
  interactive session, which is how project-scoped servers are meant to work.
  The `claude mcp add` form above has no such step.
- **Absolute paths.** A relative `args` entry is resolved against whatever
  directory your client happens to launch in, which is not the one you were
  thinking of.
- **There is no `npx @carpool/mcp`.** The package is `private: true` and is
  published to no registry, so nothing can fetch it by name. `apps/mcp` now
  declares a `bin` (`carpool-mcp`) and its built entry point carries a shebang
  and the executable bit, so
  `-- /abs/path/to/carpool/apps/mcp/dist/server.js` with no `node` in front of
  it also works and was also run. The `bin` **name** is only on your `PATH` if
  you deliberately link it there (`pnpm link --global` inside `apps/mcp`); that
  form is not verified here and is not needed by anything below.

Check the wiring before going further:

```bash
claude mcp list          # carpool: … ✔ Connected
```

A registry has to be listening at `CARPOOL_REGISTRY_URL` for the tools to do
anything. If you have none, start one:

```bash
pnpm --filter @carpool/registry dev
```

That gives you an empty registry on port 8403, which is a perfectly good place
to learn: publish to it, search it, and buy from yourself.

---

## Buyer

The lightest path in the system, and the part that is under-sold everywhere
else in this repository:

### 1. Searching is free, and needs no account

`carpool_search` requires **no key, no account and no funds.** Not a trial, not
a limited tier: manifests are free by design, because the manifest is the
buyer's evidence and charging for evidence would defeat the point of the
product. You can see the question, the abstract, every source, what the author
says the work cost to produce, and what buying it would cost you right now,
before you have funded anything at all.

So do that first. Ask the registry a question you were about to research:

> Use carpool_search to ask whether anything already answers "How do I run a
> Carpool registry and settle an epoch safely?"

What comes back is a ranked list with a price, an age, a freshness figure and a
health figure per candidate, and a closing line saying what the cheapest one
costs against what the dearest one cost to produce. If nothing matches, the tool
says so and tells you to do the research yourself.

One thing worth knowing about that call: it prefers to embed your question
locally and send only a vector, so the registry never receives your question
text. That needs `@carpool/tracker`, which pulls about 240 MB of ONNX runtime
and is therefore an **optional** peer dependency. Inside this monorepo it is
already linked, so the local path is what you get. Outside it, the tool sends
the question as text and **says so on every call**, with the reason the local
embedder could not load. Local embedding is not privacy (embedding inversion
recovers a large fraction of short inputs from vectors alone); it keeps
questions out of plaintext access logs.

### 2. Buying needs a funded account

Two variables, and nothing else:

```bash
CARPOOL_BUYER_ACCOUNT_ID=0.0.xxxxxxx
CARPOOL_BUYER_PRIVATE_KEY=<the ECDSA private key for that account>
```

Put them in the `env` block of the MCP server entry, next to
`CARPOOL_REGISTRY_URL`. Without them `carpool_fetch` refuses before it touches
the network, and says exactly this:

```
no buyer credentials: set CARPOOL_BUYER_ACCOUNT_ID and CARPOOL_BUYER_PRIVATE_KEY.
carpool_search works without them; only buying needs a funded account.
```

The account needs **test USDC**, not HBAR, for the purchase itself. Getting the
account and the USDC is [section 3](#3-the-identity-both-roles-need-and-the-two-traps),
and it is the same procedure for both roles.

Two optional variables worth setting deliberately:

| variable | what it does |
|---|---|
| `CARPOOL_ARTIFACT_DIR` | where bought artifacts are written. Default: a `carpool-artifacts` directory in your system temp. `carpool_fetch` writes the body to a **file** and returns a four-line receipt, because spending your whole context on a document you may not need all of is the opposite of the saving this product exists to produce. |
| `CARPOOL_MAX_MICRO_USDC` | per-payment spend cap, µUSDC. Default 500000, which is $0.50, which at the shipped price rule buys anything that cost up to $5 to produce. This is a **client-side** control: it rejects before a request is sent, so a cap below an artifact's price is not a warning, it is a buyer that can never buy. |

### 3. What a purchase actually does

`carpool_fetch <magnet>` fetches the manifest free, keeps its `bodyHash`, pays
over x402 on Hedera, hashes the delivered body, and compares. The comparison is
fixed **before** payment on purpose: a hash header on the paid response comes
from the same server as the body, so a registry serving the wrong bytes would
send a matching header. When the manifest cannot be fetched the tool reports the
body as NOT VERIFIED rather than claiming a check it did not run.

You then have **120 seconds** to reject it. That window is why the registry and
not the author is the payee: pay the author directly and the money is gone the
instant it settles, leaving nothing for a refund to reverse.

---

## Author

Publishing is the direction where money comes back to you. It is also the only
irreversible thing in the system, which is why it has a consent gate that
nothing can switch off except by turning publishing off entirely.

### 1. Credentials

```bash
CARPOOL_AUTHOR_ACCOUNT_ID=0.0.xxxxxxx
CARPOOL_AUTHOR_PRIVATE_KEY=<the ECDSA private key for that account>
```

Royalties are paid to that account. The key is used for two things: deriving
the public half of your author identity (the registry's convention is
`"<accountId>:<publicKeyHex>"`) and signing the manifest hash. Both come from
the same key by construction, so your author id and your signature cannot
disagree.

An author account does **not** need USDC to publish. It needs to be able to
*receive* USDC, which means it must be associated with the token before a
royalty can land in it. See the traps below.

### 2. Install the consent hook

An MCP server cannot tell whether it is running inside a subagent, so consent is
enforced on the client side by a `PreToolUse` hook. Add this to your Claude Code
settings:

```json
{ "hooks": { "PreToolUse": [{
  "matcher": "mcp__carpool__carpool_publish",
  "hooks": [{ "type": "command", "command": "node /abs/path/to/carpool/apps/mcp/hooks/pre-publish.mjs" }]
}] } }
```

**Run `pnpm --filter @carpool/mcp build` before you install it.** The hook
imports every rule it enforces from `dist/consent.js` and fails closed, with
that instruction, if the file is not there. It decides nothing itself: a subagent
is denied, a non-prompting permission mode is denied, `CARPOOL_PUBLISH_MODE=off`
is denied, an unrecognised value of that variable is denied, unparseable input is
denied, and everything else **asks**. There is no mode that publishes without a
human answering a prompt.

### 3. What publishing commits you to

`carpool_delist` stops new sales of an artifact. It **cannot** recall a copy
someone has already paid for, cancel a buyer's open refund window, or cancel a
royalty you have already earned. It is final for that magnet: republishing the
identical manifest does not relist it, and there is deliberately no relist route.

Before the confirmation prompt, a scan **removes** detected secrets, connection
strings, local filesystem paths, internal hostnames and any terms you passed as
`neverPublish`, and reports what went. It strips rather than warns, because a
warning is a thing a tired person clicks past at the end of a long research run.

---

## The identity both roles need, and the two traps

Buyer and author accounts are the same kind of thing, made the same way. If you
are doing both, one account can do both, and then the same keypair is in
`CARPOOL_BUYER_*` and `CARPOOL_AUTHOR_*`.

1. **Create an ECDSA testnet account** at
   [portal.hedera.com](https://portal.hedera.com).

   **ECDSA specifically.** The x402 Hedera signer calls
   `PrivateKey.fromStringECDSA`, and an ED25519 key fails at signing time with
   an error that reads like a fault in the facilitator. You will spend an hour
   debugging the wrong component.

2. **Associate USDC before you touch the faucet.** Token `0.0.429274`.

   **This is the step that wastes afternoons.** Circle's faucet mints only to an
   account already associated with the token. `maxAutomaticTokenAssociations`
   does not satisfy it: auto-association creates the relationship lazily, on
   first receipt, and the faucet checks for an existing one before it sends, so
   it declines silently. No transfer, no error, no explanation.

   If the account is one the registry operator scripts made, there is a command
   for it: `pnpm --filter @carpool/registry associate`.

3. **Faucet:** [faucet.circle.com](https://faucet.circle.com), Hedera Testnet,
   token `0.0.429274`. Rate-limited per address per two hours.

The same association rule is what an **author** account needs, for the opposite
reason: a royalty is a transfer into your account, and an unassociated payee
makes the settlement batch fail with `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`. That
failure is recoverable (the operator can unpark the payout once you associate),
but it is your account that holds it up.

---

## Registry operator

Not duplicated here. [docs/RUNBOOK.md](RUNBOOK.md) is the operator document:
getting a testnet identity, deriving the service accounts, the anchor topic,
preflight, custody, delisting, restart and reconcile, backup and the WAL
checkpoint, and what has actually been run on a ledger.

One thing from it belongs in a newcomer's field of view, because it explains a
dashboard that looks broken: a registry started without `CARPOOL_PRIVATE_KEY`
never constructs a settler. Royalties still accrue in the payout table and
nothing is ever transferred or anchored. The dashboard says `settlement: off on
this registry` when it sees that.

---

## What happened when this document was followed

Run on 2026-09-13, against two local registries: one on port 8406 holding six
real artifacts, and one started for the purpose with the real Blocky402
facilitator and the real `@hiero-ledger/sdk` on Hedera testnet. Reported here
rather than smoothed over, because a getting-started nobody executed is how the
gap this document fills came to exist.

### What worked

| step | result |
|---|---|
| `claude mcp add`, the command form in section 0 | `claude mcp list` → `carpool: … ✔ Connected` |
| the executable form, with no `node` in front | also `✔ Connected`, after `bin` and the executable bit were added to `apps/mcp` in this change |
| `carpool_search` with **no credentials of any kind** | returned a real ranked candidate with its price, age, freshness and health. It embedded locally, so no question text left the machine |
| `carpool_fetch` with no credentials | refused before touching the network, naming both missing variables |
| `carpool_publish`, unconfirmed | printed the diff, said nothing had been published, and required `confirm` |
| `carpool_publish`, confirmed | published `swarm:0040bdcd…` at $0.1200, halving every day |
| `carpool_fetch` of it, with buyer credentials | paid $0.1320 over x402 and wrote the body to a file. Purchase `0.0.7162784@1789241127.038148383`, `SUCCESS` on the mirror node, 131,990 µUSDC buyer → registry |
| the author's royalty, after one settle | 131,490 µUSDC registry → author in `0.0.10475802@1789242990.046323466`, `SUCCESS`, memo `carpool:batch:1:462a55b0`. The remaining 500 µUSDC is the tracker fee, and it netted out rather than moving |

So both directions of the mechanism at the top of this document were driven end
to end on a real ledger by following these instructions, not by a test harness.

### What broke, and what it cost

**1. The buy step against the six-artifact registry failed, and the message
pointed at the wrong party.** That registry had been started with
`FACILITATOR_URL=http://127.0.0.1:9/none`, so every artifact request answered
`503 {"error":"facilitator unavailable: …"}`. What `carpool_fetch` reported was:

```
unexpected status 503
```

Following this document for the first time, that sends you to check your account
id, your key type and your USDC balance, none of which can be the cause: **the
registry, not the buyer, chooses the facilitator.** That is a defect on an
onboarding path, so it was fixed rather than written around. It now says:

```
the registry answered 503 instead of quoting a price: {"error":"facilitator
unavailable: Failed to initialize: no supported payment kinds loaded from any
facilitator."}. Nothing was charged, and this is the registry's end rather than
your credentials.
```

`apps/mcp/src/pay.test.ts` holds that behaviour in place.

You can reach the same conclusion from outside the tool, and it is worth knowing
the four statuses:

```bash
curl -s -o /dev/null -w '%{http_code}\n' "$CARPOOL_REGISTRY_URL/artifact/<magnet>"
```

- `402` is a healthy registry quoting you a price. Your keys are the next thing
  to look at.
- `503` is the registry's facilitator, and only its operator can fix it.
- `410` means the artifact is delisted or expired, and no configuration will
  buy it.
- `404` means the magnet is wrong.

**2. The `.mcp.json` form connects, but not immediately.** Dropped in as section
0 describes, `claude mcp list` reported
`carpool: … ⏸ Pending approval (run claude to approve)`. That is how
project-scoped servers work, and this document says so above rather than
implying the file alone is enough. The `claude mcp add` form has no such step.

**3. The pre-publish scan is blunter than expected.** Publishing an abstract
containing the ordinary English words "local" and "test" removed both as
internal-host terms. That is the scan behaving as designed, since it strips
rather than warns, and it is still worth knowing before you see your own prose
come back with holes in it: read the diff, and reword rather than assuming the
tool broke.
