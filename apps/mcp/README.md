# @carpool/mcp

The MCP server agents actually use. Four tools:

- **`carpool_search(question)`** — free. Call it *before* starting deep research.
- **`carpool_fetch(magnet)`** — pays, verifies, writes the artifact to a file.
- **`carpool_publish(...)`** — lists research you already did. Guarded, see below.
- **`carpool_delist(magnet)`** — withdraws something you published from sale.
  Stops new sales and nothing else: a buyer who already paid keeps their copy, a
  refund window that is open stays open, and a royalty already earned is still
  paid.

## Installing it

This package declares a `bin` (`carpool-mcp`) whose target is `dist/server.js`,
which carries a shebang and is made executable by the build. Build first:

```bash
pnpm --filter @carpool/mcp build
```

Then register it. The command form, which was run and reports
`carpool: … ✔ Connected` under `claude mcp list`:

```bash
claude mcp add carpool \
  -e CARPOOL_REGISTRY_URL=http://127.0.0.1:8403 \
  -e CARPOOL_ARTIFACT_DIR=$HOME/carpool-artifacts \
  -- node /abs/path/to/carpool/apps/mcp/dist/server.js
```

The equivalent JSON, for any client configured by file. In Claude Code this is
`.mcp.json` at the root of a project; elsewhere it is the same `mcpServers`
object in that client's own configuration:

```json
{
  "mcpServers": {
    "carpool": {
      "type": "stdio",
      "command": "node",
      "args": ["/abs/path/to/carpool/apps/mcp/dist/server.js"],
      "env": {
        "CARPOOL_REGISTRY_URL": "http://127.0.0.1:8403",
        "CARPOOL_ARTIFACT_DIR": "/abs/path/to/artifacts"
      }
    }
  }
}
```

This form was also run. It connects, and Claude Code holds a project-scoped
server at **pending approval** until you approve it once in an interactive
session, which is by design and not a failure.

Which variables to add to that `env` block depends on what you want to do, and
the whole of that decision is in **[docs/GETTING-STARTED.md](../../docs/GETTING-STARTED.md)**:
searching needs none at all, buying needs `CARPOOL_BUYER_*`, publishing needs
`CARPOOL_AUTHOR_*` plus the consent hook below. The table at the end of this
file is the reference for all of them.

Three things about the install that are true and easy to assume otherwise:

- **There is no `npx @carpool/mcp`.** The package is `private: true` and is
  published to no registry, so nothing can fetch it by name. Do not look for one.
- **The path on its own also works**, with no `node` in front of it
  (`-- /abs/path/to/carpool/apps/mcp/dist/server.js`), because of the shebang and
  the executable bit. Also run.
- **`carpool-mcp` is not on your `PATH`** merely because the `bin` exists. pnpm
  does not link a workspace package's own bin into the workspace, so putting that
  name on your `PATH` means linking it deliberately (`pnpm link --global` inside
  `apps/mcp`). That form is **not verified here**; the two above are.

Nothing works until a registry is listening at `CARPOOL_REGISTRY_URL`. If you
have none, `pnpm --filter @carpool/registry dev` gives you an empty one on 8403,
which is a fine place to learn: publish to it and buy from yourself.

## Why `carpool_fetch` writes a file instead of returning the body

An MCP tool result is capped (~25k tokens in Claude Code) and a real artifact
does not fit. More importantly, returning it inline would spend the buyer's
context on the whole document whether or not they need all of it — and the
context saving *is* the product. The tool returns a path and a summary; the
agent reads the parts it needs.

## Embedding: local or remote, and what each actually buys

`carpool_search` prefers to embed **locally** and send only a vector, so the
registry never receives the question text.

**This is not privacy.** Embedding inversion recovers a large fraction of short
inputs from vectors alone. What local embedding buys is that the operator
cannot read questions without deliberately running an inversion attack, and
that queries are not sitting in plaintext access logs. That is worth something;
it is not confidentiality.

Local embedding needs `@carpool/tracker`, which pulls `onnxruntime-node`
unpruned across platforms — **about 240 MB installed**. That is a real tax on a
tool that saves cents per query, so the dependency is declared as an **optional
peer** (`peerDependenciesMeta`): it is not installed for you, and the tool works
without it. Install it deliberately if you want the vector path:

```
pnpm --filter @carpool/mcp add @carpool/tracker
```

Without it, `carpool_search` sends the question as text and says so **on every
call**, with the specific reason the local embedder could not load:

> Note: this search sent your question text to the registry, which can read and
> log it.

A user who declined a 240 MB install should not have to infer what it cost them.

Either way the ranking is the same one: the registry embeds a `q` server-side
with its own declared tuple and ranks through `@carpool/tracker`. The choice is
about who sees the question text, not about whether search works.

## What `carpool_fetch` actually verifies

It fetches the artifact's manifest first — free — and keeps its `bodyHash`.
After paying, it hashes the delivered body and compares against that. The
comparison is fixed *before* payment on purpose: `x-carpool-body-hash` on the
paid response comes from the same server as the body, so a registry serving the
wrong bytes would send a matching header.

When the manifest cannot be fetched, the tool says the body is **NOT VERIFIED**
and why, rather than claiming a check it did not run. An earlier version read a
header the registry never set — so the comparison never executed — while
printing "(verified against the manifest)" on every purchase. That is the worst
kind of bug: a security claim that is false.

## Publishing consent

Publishing is the only irreversible thing here. `carpool_delist` stops new sales;
it **cannot recall a copy someone has already paid for**, and the tool says so
wherever a delete-like affordance appears. That tool is new: until it existed the
consent prompt and this README both promised a withdrawal the product could not
perform, which means consent had been obtained under a false description of what
could be undone.

An MCP server cannot tell it is running inside a subagent, so consent is
enforced client-side by `hooks/pre-publish.mjs`, a `PreToolUse` hook. The hook
decides nothing itself: every rule is `src/consent.ts`'s `decideConsent`, which
the hook imports from `dist/consent.js`. **The requirement is that auto-listing
always asks permission first and can be turned off**, so `Decision` has no
`allow` member — there is no mode, permission mode or recorded history that
publishes without a human answering a prompt.

| Condition | Decision |
|---|---|
| `agent_id` present (subagent) | **deny** |
| a non-prompting `permission_mode` | **deny** — publishing is never auto-approved |
| `CARPOOL_PUBLISH_MODE=off` | **deny** — this is the off switch |
| `CARPOOL_PUBLISH_MODE` set to anything but `ask`/`off` | **deny** — a typo in the off switch must not publish |
| unparseable hook input, or `dist/consent.js` missing | **deny** — fails closed |
| otherwise | **ask** |

Run `pnpm --filter @carpool/mcp build` before installing the hook; it loads the
compiled module, and fails closed with that instruction if it is absent.

Install it:

```json
{ "hooks": { "PreToolUse": [{
  "matcher": "mcp__carpool__carpool_publish",
  "hooks": [{ "type": "command", "command": "node /abs/path/apps/mcp/hooks/pre-publish.mjs" }]
}] } }
```

**What this hook cannot see:** whether the session is `-p`, headless or
backgrounded. There is no documented field for it. So this README says what the
hook does — denies subagents and non-prompting modes, otherwise asks — rather
than claiming "blocked outside interactive sessions", which would be untrue.

An earlier design was circular: deny by default until an approval was recorded,
with the approval recorded when the user answered a prompt that deny-by-default
prevented from ever appearing. It was replaced by "always ask" rather than
repaired — the `auto` mode, the `approvedProjects` list, and the claim that "the
approval is recorded in `PostToolUse`" are all gone. No `PostToolUse` hook ever
existed, so that sentence described machinery nobody had written.

That design also left two implementations of one security decision:
`decideConsent` had five tests and a single importer — its own test file — while
this hook carried a hand-written subset with different reason strings. They
disagreed on the requirement, because `decideConsent` could return `allow` and
the hook always asked. `src/consent.test.ts` now spawns the hook as a process and
asserts its output *equals* `decideConsent`'s for every case, so the tested
decision and the executed one cannot drift apart again.

### The pre-publish scan strips, it does not warn

A warning is something a tired person clicks past at the end of a long research
run. The scan **removes** detected secrets, connection strings, local
filesystem paths, internal hostnames and any caller-supplied never-publish
terms, then reports what went. Source URLs pointing at internal hosts are
dropped whole rather than half-redacted into something unusable.

### The confirmation diff leads with the question

Nobody reviews 40 KB of prose in a dialog. Order: **the question as it would be
published** — usually the leakiest single line — then abstract, source URLs,
what the scan stripped, and only then the body, behind an expander.

## Environment

| Variable | Purpose |
|---|---|
| `CARPOOL_REGISTRY_URL` | registry base URL |
| `CARPOOL_ARTIFACT_DIR` | where bought artifacts are written |
| `CARPOOL_BUYER_ACCOUNT_ID` / `_PRIVATE_KEY` | funded account for buying. Search works without them. |
| `CARPOOL_AUTHOR_ACCOUNT_ID` / `_PRIVATE_KEY` | royalties are paid here |
| `CARPOOL_MAX_MICRO_USDC` | per-payment spend cap (default **500000** = $0.50). Not an arbitrary number: `carpool_publish` prices at 10% of what the research cost to produce, so the default cap is 10% × $5, i.e. it buys anything that cost up to $5 to produce. The two are derived together in `@carpool/core`'s `pricing.ts` — they used to contradict each other (a 20,000 µUSDC cap against that rule made anything over $0.1333 to produce unbuyable out of the box, which is a buyer that can never buy). The share was 0.15 here and 0.10 in the A/B runner until `AUDIT-CLAIMS.md` M4 was resolved to 0.10; `pricing.ts` carries the reasoning and why 0.15 was rejected. |
| `CARPOOL_PUBLISH_MODE` | `ask` (default) / `off`. Nothing else — an unrecognised value is refused, not treated as the default. There is no value that publishes without asking. |

Keys are never logged.
