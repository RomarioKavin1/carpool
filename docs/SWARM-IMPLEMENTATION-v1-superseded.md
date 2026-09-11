# Swarm — implementation plan

A market for research artifacts, built inside this repo, reusing Carpool's
payment stack. Sponsors: **Hedera** (settlement, provenance) and **Bazantic**
(agent usability). ENS is designed for but not built — see §9.

> **Prerequisite: Phase 0 gates everything.** The tracker is the product, and
> it is unproven. Do not build Phases 1–7 before Phase 0 returns a number.

---

## 1. What this is

An author runs deep research in Claude Code. The result is signed, given a
manifest, and listed. The next person whose question it answers pays instead of
burning the tokens to redo it. The author earns on every sale, forever. Price
falls as the artifact ages, because a 40-day-old answer is worth less than a
2-day-old one.

Torrent vocabulary throughout: artifact = torrent, magnet = its id, tracker =
the index, swarm = its buyers, ratio = published vs consumed.

### Pricing — settled, and deliberately not Carpool's

```
price(t) = floor + P · 0.5 ^ (ageDays / halfLifeDays)
```

- **Decay only.** No buyer-to-buyer refunds, no `P/n`.
- **Author royalty `ρ_a` is uncapped.** Their work, not a shared utility bill.
- `P ≤ provenance.estimatedCostUsd × margin`, margin < 1. The buyer's saving is
  legible and the price has a real anchor.

Rationale in `../../swarm/PIVOT-ANALYSIS.md` §1. The short version: Carpool
shares a cost incurred *on behalf of* its buyers; Swarm sells work produced
before any buyer existed. Capping the author's return would guarantee nobody
publishes anything good.

---

## 2. Repo layout

Extend this monorepo. **Do not touch Carpool's packages until after the
ETHOnline submission** — Phase 1 is additive only.

```
packages/
  carpool-core/         unchanged
  carpool-express/      unchanged
  x402-kit/             NEW (Phase 5) — extracted, shared by both
  swarm-core/           NEW — manifest, magnet, decay, pricing, signing
  swarm-tracker/        NEW — embeddings, index, search
apps/
  settlement/           unchanged (Carpool's ledger)
  swarm-registry/       NEW — HTTP: free search, x402-gated fetch, publish
  swarm-mcp/            NEW — MCP server for Claude Code
  dashboard/            extended — torrent-client view
```

Two ledgers, deliberately. Carpool's has a rebate pool; Swarm's does not. Do
not force one schema to serve both.

---

## 3. Phase 0 — the kill test (do this first)

**Question:** do research questions repeat often enough, and can a tracker find
the right prior artifact reliably enough, to support a market?

### Method

1. **Harvest.** Claude Code transcripts live under
   `~/.claude/projects/*/`. Extract every user turn that initiated a research
   task. Target 150–300 questions across ≥3 months.
2. **Label.** For each pair `(question_i, question_j)`, would an artifact
   answering `i` have genuinely answered `j`? Label a sample of ~500 pairs by
   hand — biased toward near-misses, since those decide precision.
3. **Measure.**
   - **Collision rate** — % of questions with ≥1 genuinely-relevant prior. *If
     this is under ~10%, stop. There is no market and no retrieval quality
     fixes it.*
   - **Precision@1** — when the tracker offers a top match, is it right?
     Target **≥70%**. Below that, two bad purchases and nobody trusts it.
   - **Recall@5** — of the genuinely relevant, how many surface in 5?
     Misses are cheap (you do the research). False positives are expensive.
4. **Threshold sweep.** Find the similarity cutoff maximising precision subject
   to recall ≥ 40%. Record it; it becomes the tracker's default.

### Deliverable

`packages/swarm-tracker/bench/` — the corpus, labels, and a `pnpm bench` that
prints the three numbers. **These go in the README the way Carpool's hit-rate
ceiling did**: measured, not claimed.

### Go/no-go

| Result | Action |
|---|---|
| collision ≥10% and P@1 ≥70% | Build |
| collision ≥10%, P@1 <70% | Try reranking (§4.3) before deciding |
| collision <10% | **Stop.** Write up the negative result. |

**Effort: 1 day.**

---

## 4. The tracker

The one genuinely new component.

### 4.1 Index

- **Embeddings** over `question + abstract`. One API call per artifact at
  publish, one per search.
- **Store** in SQLite via `sqlite-vec`, loaded as an extension on the
  `better-sqlite3` already in this repo. No new database, no vector service.
- Corpus will be small for a long time; exact search is fine to ~100k rows.

### 4.2 Query path

```
search(question)
  → embed(question)
  → top-k by cosine, k=20
  → filter: score ≥ threshold (from Phase 0)
  → filter: freshness(t) ≥ 0.15   (drop 3-half-lives-dead artifacts)
  → return manifests, ranked        ← FREE, no payment
```

**Search is always free.** The manifest is the product's honesty mechanism;
charging for it would defeat the purpose.

### 4.3 Reranking (only if Phase 0 needs it)

If precision@1 lands between 50–70%, add a rerank over the top 20 using a cheap
model scoring "would this artifact answer this question?" Costs one call per
search; the tracker's `ρ_t` pays for it. Do not build this speculatively.

### 4.4 The final judgement is the buyer's

The tracker ranks; **the buying agent decides**. It reads abstract, source list
and provenance from the free manifest and chooses. That is the lemons-market
fix — inspecting evidence, not trusting a score — and it means the tracker can
be imperfect without the product being untrustworthy.

---

## 5. Data model

`apps/swarm-registry/src/db/schema.ts`:

```sql
CREATE TABLE artifact (
  magnet        TEXT PRIMARY KEY,      -- sha256(canonical question ‖ scope)
  question      TEXT NOT NULL,
  abstract      TEXT NOT NULL,
  sources_json  TEXT NOT NULL,
  provenance_json TEXT NOT NULL,       -- model, tokens, cost, duration, toolCalls
  author        TEXT NOT NULL,         -- Hedera account id today; see §9
  author_sig    TEXT NOT NULL,         -- over manifest_hash
  manifest_hash TEXT NOT NULL,
  body_hash     TEXT NOT NULL,         -- buyer verifies what they got
  body_bytes    INTEGER NOT NULL,
  price_floor   INTEGER NOT NULL,      -- µUSDC
  price_base    INTEGER NOT NULL,      -- P
  half_life_days INTEGER NOT NULL,
  produced_at   INTEGER NOT NULL,
  redacted      INTEGER NOT NULL DEFAULT 0,
  delisted_at   INTEGER
);

CREATE TABLE purchase (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  magnet     TEXT NOT NULL,
  buyer      TEXT NOT NULL,
  tx_id      TEXT NOT NULL,
  paid       INTEGER NOT NULL,
  ts         INTEGER NOT NULL,
  refunded   INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX idx_purchase_txid ON purchase(tx_id) WHERE tx_id <> '';

CREATE TABLE royalty (              -- owed to authors, settled in batches
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payee TEXT NOT NULL, amount INTEGER NOT NULL,
  magnet TEXT, purchase_id INTEGER, settled_batch_id INTEGER
);

CREATE TABLE peer (                 -- ratio
  account TEXT PRIMARY KEY,
  published INTEGER NOT NULL DEFAULT 0,
  purchased INTEGER NOT NULL DEFAULT 0,
  rejected  INTEGER NOT NULL DEFAULT 0
);
```

`batch` and the settler come from Carpool unchanged.

---

## 6. Phases

Each ends with the repo coherent and a git tag.

### Phase 1 — `swarm-core` (additive, safe before the deadline)
- Manifest schema + zod validation; canonical JSON hashing (port
  `carpool-core/src/policy.ts` `policyHash`).
- `magnet(question, scope)` = sha256 over canonicalised question.
- `price(artifact, now)` decay function.
- Author signing/verification over `manifest_hash` (Hedera key today).
- **Accept:** `pnpm --filter @swarm/core test` — round-trip sign/verify, decay
  at 0/1/2/3 half-lives, magnet stability across key orderings.

### Phase 2 — tracker
- sqlite-vec index, embed-on-publish, search endpoint.
- Phase 0 corpus becomes the test fixture.
- **Accept:** `pnpm bench` reproduces the Phase 0 numbers within tolerance.

### Phase 3 — registry service
- `GET /search?q=` — free, returns manifests.
- `GET /artifact/:magnet` — **x402-gated**, serves the body.
- `POST /publish` — authenticated, verifies signature, indexes, stores body.
- Reuse from Carpool: 402 flow, issued-quote binding, outbox, auth boundary.
- Body storage: content-addressed files, `body_hash` verified on read.
- **Accept:** a real paid fetch on Hedera testnet with a HashScan link, same
  bar Carpool met.

### Phase 4 — settlement
- Port `settler.ts` + `anchor.ts`. Royalties batch ≤9 payees, dust carried.
- HCS anchor changes role: it now timestamps **artifact manifest hashes**,
  which is provenance, not just a payment receipt.
- **Accept:** a batch paying ≥3 authors, plus an anchor whose merkle root
  covers the epoch's manifest hashes.

### Phase 5 — extract `x402-kit` *(only after the ETHOnline submission)*
- Pull the shared half out of `carpool-express` + `settlement`: 402 flow, quote
  binding, outbox, batched settler, HCS anchor, auth.
- Carpool and Swarm both consume it.
- **Accept:** Carpool's 109 tests still pass unchanged.

### Phase 6 — MCP server
Three tools:
- `swarm_search(question)` — free; returns manifests with price, provenance,
  decay, health.
- `swarm_fetch(magnet)` — pays, verifies `body_hash`, returns the body.
- `swarm_publish(artifact)` — **opt-in, interactive sessions only.**

Consent rules are non-negotiable and specified in
`../../swarm/PLAN.md` §8a: three states (off/ask/auto), `ask` default, `auto`
per-project only, pre-publish scan that *strips* secrets rather than warning,
diff led by the question line, publish-with-edits, and **unavailable inside
subagents, background tasks, hooks and scheduled runs.**

- **Accept:** a research run in Claude Code that searches first, buys a prior
  artifact, and completes using it — with the token saving measured.

### Phase 7 — dashboard
Torrent-client shape: library table, health bar, **decay bar that visibly
drains**, swarm/peer view, ratio, activity feed, magnet copy. Dense monospace,
information-first.

---

## 7. Bazantic

Not a bolt-on — Swarm is close to the thing Bazantic exists to reward.

- **T3 "Agentify a New API"** — Swarm *is* a new agent capability. Gateway in
  front of `/search` and `/artifact/:magnet`, Recipe describing the
  search → judge → buy → inject flow.
- **T1 "Help an agent use your project"** — their A/B test is nearly our demo:
  the same model, same question, with and without the Recipe. Without it the
  agent redoes the research; with it, it finds and buys the prior artifact.
  Record both, report the token delta.
- The free manifest is the direct answer to their thesis question, *can an
  agent use your project without you there to explain it* — everything the
  agent needs to decide is in the 402.

**Accept:** the A/B transcript pair, plus token counts for each.

---

## 8. Hedera

Reused as-is from Carpool: association, facilitator-sponsored fees, batched HTS
settlement under the 10-entry limit, mirror-node verification. Scripts
(`associate`, `create-accounts`, `distribute`, `create-topic`) carry over
untouched.

**HCS earns a better role here.** In Carpool it receipts a payment batch. In
Swarm it timestamps manifest hashes — proof an artifact existed, unmodified, at
a given consensus time. That is provenance, which is what HCS is for.

---

## 9. ENS — provision now, build later

Author identity is behind an interface from day one so ENS drops in without a
migration.

```ts
export interface AuthorIdentity {
  /** Canonical id stored on the artifact and paid as royalty. */
  id(): string;
  verify(manifestHash: string, sig: string): Promise<boolean>;
  display(): string;
}
```

- **Today:** `HederaAuthor` — id is the account, signature is its key.
- **Later:** `EnsAuthor` — id is `alice.eth`, resolving to a payout address;
  ENSv2 hierarchical registries and Enhanced Access Control govern who may
  publish under a namespace, with per-agent subnames.

Requirements so the seam holds:
- `artifact.author` is an opaque string, never parsed as a Hedera id.
- Royalty payout resolves through `AuthorIdentity`, not directly from `author`.
- The dashboard renders `display()`.

Cost of provision now: one interface and two small implementations. Cost of
retrofitting later: a schema migration across every artifact ever published.

---

## 10. Sequencing against the ETHOnline deadline

48 hours out at the time of writing.

1. **Carpool ships.** It is finished and real. Remaining: (G) multi-provider
   royalties, (H) dashboard field names, a 13-agent run, a video. ~1 day.
2. **Swarm Phase 0 runs in parallel.** Independent, 1 day, gates everything.
3. **Phases 1–4 after the deadline.** Phase 5 (extraction) strictly after, so
   a refactor cannot destabilise a submitted project.

Nothing in Phases 1–4 modifies Carpool's packages. That is deliberate.
