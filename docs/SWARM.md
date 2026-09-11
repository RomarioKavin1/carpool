# Swarm — plan v2

Supersedes `SWARM-IMPLEMENTATION-v1-superseded.md`, which was written against a
scope the review in `SWARM-REVIEW.md` correctly dismantled. Every finding in
that review is addressed here or explicitly deferred with a reason.

Sponsors: **Hedera** (settlement, provenance) · **Bazantic** (agent usability).
ENS provisioned, not built. World dropped.

---

## 1. The scope, narrowed

**Swarm sells research artifacts whose demand is event-shaped.**

An event — a prize list drops, a protocol launches, a model ships, an exploit
happens, a framework breaks compatibility — creates *synchronised* demand from
many independent parties for the same synthesis. Nobody coordinates. Everyone
does the same work in the same week. Then it expires.

The worked example is this repo's own history: several hundred people entered
ETHOnline 2026, and every one of them needed to understand the same prize page.
One analysis, hundreds of genuine buyers, none of whom knew the others were
duplicating it.

**What this is not:**

- Not a durable library of general research. Questions that repeat across people
  are questions about *new* things, and new things go stale. High collision and
  long shelf life are close to mutually exclusive.
- Not a cache. A cache serves the same person twice; that needs no market.
- Not a place humans browse. Artifacts are bought by agents, at the moment of
  need, and injected into context.

**Why the narrowing rescues the idea:**

| Objection to the general version | Why event-shaped demand answers it |
|---|---|
| Decay kills value | Shelf life and demand window coincide. Expiring is normal; expiring *before buyers arrive* is the broken case, and that does not happen here. |
| Nobody will bother publishing | The author already did the work for themselves. Listing is zero marginal effort. |
| Matching is fuzzy and unreliable | Event questions carry named entities ("ETHOnline 2026 prizes"). Far easier than matching abstract research questions. |
| The counterfactual gets cheaper each quarter | The binding constraint is *time*, not tokens. Twenty minutes of waiting does not get cheaper with model releases. |

---

## 2. The pitch, in order

Ordering matters; leading with the wrong leg invites the wrong first question.

> Several hundred people entered ETHOnline. Every one needed to understand the
> same prize page. Every one burned the same twenty minutes and the same tokens
> working it out, and not one knew the others were doing it.
>
> Swarm puts that work on sale the moment it is finished. The next person's
> agent finds it *before* it starts researching, buys it for a fraction of what
> redoing it costs, and drops it straight into context — seconds instead of
> twenty minutes.
>
> The person who did the work gets paid for research that was already sunk. The
> person who skips it gets the answer immediately. And the same computation
> stops being run a hundred times by people who never knew about each other.

1. **Time first, tokens second.** Twenty minutes is the scarce thing.
2. **Sunk work earns**, and — the real differentiator — it arrives as
   *machine-consumable context*, not a blog post someone might read.
3. **Redundant compute** as the closing note. Sustainability is implied by it
   without the word being claimed, which keeps it out of greenwashing territory.

Do not open with sustainability. The first question becomes "how much energy,
exactly?" and there is no good answer until §4 produces one.

---

## 3. Phase 0 — the corrected kill test

The v1 test measured **self-repetition** across one person's transcripts. That
is a cache metric: if the same person asks twice, a local cache solves it for
free and no market is needed. It also could not reach its own sample size —
transcripts on this machine span 10 Aug to 12 Sep, 33 days, and Claude Code
prunes at 30 by default.

### What to measure instead: event-shaped convergence, from public evidence

**Claim under test:** when an event happens, many independent parties
produce substantially the same synthesis within a short window.

**Method.** Pick 8 events from the last 6 months across categories — a
hackathon prize drop, two protocol launches, a model release, a notable
exploit, a framework major version, a regulation, an airdrop criteria change.
For each:

1. Collect public artifacts published within 14 days that cover the same
   ground: blog posts, long-form threads, explainers, community docs.
2. Count **independent authors** (not reposts).
3. Score pairwise overlap: would artifact A have served a reader who sought B?
   Three-point scale, two raters, report agreement.

**Metrics:**

- **Convergence count** — median independent artifacts per event. This is the
  addressable buyer count for one artifact. *Under 5, the market is too thin.*
- **Overlap fraction** — share of pairs judged substitutable. *Under 50% means
  people are not actually answering the same question.*
- **Window** — days from event to the median artifact. Sets the half-life.

**Why this is better:** it measures cross-author demand, which is the thing the
market needs and which no single-user corpus can estimate; it uses public data,
so nothing private is gathered or committed; and it directly matches the
product rather than a proxy for it.

### Derive the bar, do not invent it

v1 asserted precision@1 ≥ 70% with no derivation. The break-even precision
follows from the margin: if an artifact costs `p` and redoing costs `c`, a bad
purchase wastes `p` and a good one saves `c − p`. Buying is rational while

```
P(useful) ≥ p / c
```

At the planned `p ≈ 0.15c`, break-even precision is **~15%**, and a comfortable
operating target is **~40%** — far below the invented 70%. Record the derivation
next to the number.

> **Shipped value differs from this plan.** The price fraction was resolved to
> **0.10** (`AUDIT-CLAIMS.md` M4; `PRICE_SHARE_OF_REDO_COST` in
> `packages/carpool-core/src/pricing.ts` carries the reasoning), which makes
> break-even 10% and the operating target 30%. `docs/PHASE0.md` §5 is the current
> derivation; the 0.15 above is what was planned, kept as the record.

### Deliverable

`docs/PHASE0.md` — method, the event list, the three numbers, the derivation.
**Numbers only. Never the corpus** — v1 proposed committing harvested questions
to `packages/swarm-tracker/bench/`, which would publish client-project questions
and is exactly the leak the consent model exists to prevent.

**Effort: 1 day. Gate: convergence ≥ 5 and overlap ≥ 50%, or stop and publish
the negative result.**

---

## 4. The measurement that is the proof

One number carries the entire pitch, the Bazantic submission and the
sustainability claim at once:

> **How much does buying actually save versus redoing?**

Run it against this repo's own ETHOnline prize analysis, which exists and whose
cost side is recoverable from the transcript.

```
Redoing:  N input tokens, M output, T seconds, $C
Buying:   n input tokens, m output, t seconds, $c
```

Publish both. Until this exists, every claim in §2 is a story.

---

## 5. Architecture

Additive to this repo. **Nothing in Carpool's packages is modified** until after
the ETHOnline submission.

```
packages/
  swarm-core/        manifest, magnet, decay, pricing, signing, AuthorIdentity
  swarm-tracker/     local embedding, index, search
apps/
  swarm-registry/    free search · x402-gated fetch · publish
  swarm-mcp/         MCP server + the PreToolUse consent hook
  dashboard/         extended: torrent-client view
```

### Reuse, stated honestly

The review was right: this is **a fork, not a dependency**. `carpool-express`
exports `chooseRole`, `fetchWithRetry`, `carpool()`, `LedgerClient` and types —
the 402 flow (`send402`, `buildRequirements`, the issued-quote LRU, the
verify→settle sequence) is closure-local inside a 521-line Router built around
`QueryClass`, pioneer/rider and `upstream.fetch`.

- **Copy ~250 lines** of the 402 flow into `swarm-registry`. Fine, and cheap.
- **Import cleanly:** `merkleRoot`, `groupAndChunk`, `canonical`, `sha256`.
- **Reuse as-is:** the four Hedera scripts (`associate`, `create-accounts`,
  `distribute`, `create-topic`).
- **Port with edits:** `settler.ts`, `outbox.ts`, `auth.ts`.

`anchor.ts` is **not** reusable as written: it calls `loadConfig()`, which
throws without a `carpool.policy.json` carrying four DeFi classes, and anchors a
cumulative root over `(payee, amount)`. Swarm anchors *manifest hashes*, which
is a different payload and a different purpose.

Drop the "45% reuse" claim. The honest figure is "the Hedera plumbing and the
settlement shape carry over; the 402 handler is a copy."

---

## 6. Data model — with the v1 defects fixed

```sql
CREATE TABLE artifact (
  magnet          TEXT PRIMARY KEY,   -- sha256(manifest) — CONTENT-addressed
  question        TEXT NOT NULL,      -- indexed, NOT unique
  question_norm   TEXT NOT NULL,      -- canonicalised, for exact-dup detection
  scope           TEXT,               -- event/entity this pertains to
  abstract        TEXT NOT NULL,
  sources_json    TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  author          TEXT NOT NULL,      -- opaque; resolved via AuthorIdentity
  author_sig      TEXT NOT NULL,
  manifest_hash   TEXT NOT NULL,
  body_hash       TEXT NOT NULL,
  body_bytes      INTEGER NOT NULL,
  body_uri        TEXT NOT NULL,
  embedding_model TEXT NOT NULL,      -- version, so a model change is detectable
  embedding_dim   INTEGER NOT NULL,
  price_base      INTEGER NOT NULL,
  price_floor     INTEGER NOT NULL,
  half_life_days  REAL NOT NULL,
  produced_at     INTEGER NOT NULL,
  redacted        INTEGER NOT NULL DEFAULT 0,
  delisted_at     INTEGER
);
CREATE INDEX idx_artifact_question ON artifact(question_norm);
CREATE INDEX idx_artifact_scope    ON artifact(scope);
```

**`magnet` is `sha256(manifest)`, not `sha256(question)`.** v1's question-keyed
primary key meant the first author to publish on a question locked everyone else
out, while a one-word paraphrase minted a fresh id — lockout and free plagiarism
in the same line. Content addressing removes both: many artifacts may answer one
question, and the tracker ranks between them. Competition on the same question
is a feature.

```sql
CREATE TABLE purchase (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  magnet TEXT NOT NULL, buyer TEXT NOT NULL,
  tx_id TEXT NOT NULL, paid INTEGER NOT NULL, ts INTEGER NOT NULL,
  refund_state TEXT NOT NULL DEFAULT 'none',   -- none | window | refunded
  refund_deadline INTEGER
);
CREATE UNIQUE INDEX idx_purchase_txid ON purchase(tx_id) WHERE tx_id <> '';

CREATE TABLE royalty (               -- author + tracker, settled in batches
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payee TEXT NOT NULL, amount INTEGER NOT NULL,
  reason TEXT NOT NULL,              -- author_royalty | tracker_fee
  magnet TEXT, purchase_id INTEGER, settled_batch_id INTEGER
);

CREATE TABLE peer (
  account TEXT PRIMARY KEY,
  published INTEGER NOT NULL DEFAULT 0,
  purchased INTEGER NOT NULL DEFAULT 0,
  refunds_received INTEGER NOT NULL DEFAULT 0,
  refunds_issued INTEGER NOT NULL DEFAULT 0
);
```

**Health, defined rather than gestured at:**

```
health(a) = freshness(a) · (1 − refundRate(a)) · min(1, distinctBuyers(a) / 5)
```

All three terms are computable from `artifact` and `purchase`. v1 listed
`health` in the dashboard with nothing behind it.

---

## 7. Economics — with the missing payee added

```
price(t) = floor + P · 0.5 ^ (ageDays / halfLifeDays)
P ≤ provenance.estimatedCostUsd × margin      (margin < 1)
```

Split per sale: **`ρ_a` author (uncapped) · `ρ_t` tracker · remainder to
settlement costs.**

v1 had no `ρ_t`, so the tracker paid for embeddings, storage and bandwidth out
of nothing while search was free. `ρ_t` funds it. Search stays free — the free
manifest is the honesty mechanism, and charging for it defeats the purpose —
but is rate-limited per account.

**Decay only. No buyer-to-buyer refunds.** The author produced the artifact
before any buyer existed, so there is no shared cost to split and no case for
capping their return. Reasoning in `../../swarm/PIVOT-ANALYSIS.md` §1.

`estimatedCostUsd` is **self-reported and therefore soft**. Two guards: it is
published in the manifest so a buyer can judge it against the source count and
output length, and a buyer who finds it inflated can refund inside the window,
which is recorded against the author's ratio.

---

## 8. What v1 omitted entirely

**Refund window.** 120 seconds from delivery. Reuses Carpool's `refund_due`
path unchanged. Recorded on the author's `peer` row. Mitigates both the
lemons problem and inflated cost claims.

**Abuse.** Self-purchase to inflate health costs the author only `ρ_t` plus
fees — cheap. Mitigations: `health` counts *distinct* buyers; a buyer whose
account funded the author is excluded; and rate-limit publishes per account.
Not solved, and stated as not solved.

**Storage.** Bodies are content-addressed blobs, capped at 2 MB, with
`body_hash` verified on read. Author pays a deposit against retention; if they
delete their body, the artifact is delisted and remaining royalties are frozen.

**Search privacy — the one v1 missed that matters most.** The tracker would see
every question anyone asks, which is more sensitive than the artifacts. Fix:
**embed client-side in the MCP server and send only the vector.** The tracker
never receives question text. This costs a local embedding model and is worth
it.

**Deployment.** v1 had no deployment phase while Bazantic requires a public
HTTPS gateway. Now Phase 6.

**Consent.** v1 cited `../../swarm/PLAN.md` §8a and implemented none of it.
Also: an MCP server **cannot detect that it is running inside a subagent**
(`anthropics/claude-code#32514`, closed not-planned). So the rule must be
enforced client-side by a **`PreToolUse` hook** that blocks `swarm_publish`
outside interactive sessions — shipped as part of Phase 5, with tests.

---

## 9. Phases

| # | Phase | Gate |
|---|---|---|
| **0** | Event-convergence test (§3) | convergence ≥5, overlap ≥50% |
| **1** | `swarm-core`: manifest, content-addressed magnet, decay, signing, `AuthorIdentity` | round-trip sign/verify; decay at 0–3 half-lives; magnet stable across key order |
| **2** | `swarm-tracker`: **client-side** embedding, sqlite-vec index, search | reproduces Phase 0 numbers; tracker never sees query text |
| **3** | `swarm-registry`: free search, x402 fetch, publish, storage, refund window | a real paid fetch on Hedera testnet with a HashScan link — **passed 2026-09-12**, by v2's `apps/registry` rather than by the `swarm-registry` this row names: purchase `0.0.7162784@1789202339.427560739`, 110,000 µUSDC on chain. See `RESTRUCTURE.md` §8 Phase D and `docs/evidence/v2-first-testnet-run/`. **The refund-window half of this row passed 2026-09-12 too**, in the full-feature run: a real refund inside the window, the buyer's money returned on chain in batch `0.0.10475802@1789205157.179586999`, the author's royalty voided rather than paid, and `409 refund window has closed` afterwards — `docs/evidence/v2-full-feature-run/`. |
| **4** | Settlement: batched royalties (author + tracker), HCS anchoring **manifest hashes** | batch paying ≥3 payees; anchor whose root covers the epoch's manifest hashes — **half passed 2026-09-12**: settlement `0.0.10475802@1789202482.460233839` and anchor topic `0.0.10496824` seq 1, whose root does cover the epoch's manifest hash *and* its payout rows. The batch paid **one** payee, so "≥3 payees" is still only shown in test. |
| **5** | `swarm-mcp`: search / fetch / publish + **PreToolUse consent hook** | publish blocked in a subagent, proven by test |
| **6** | Deploy: public HTTPS, Bazantic Gateway + Recipe | §10 A/B recorded |
| **7** | Dashboard: torrent-client view, decay bar, swarm view, ratio | — |
| **8** | *(post-submission)* extract `x402-kit`, Carpool consumes it | Carpool's 109 tests still pass |

---

## 10. Sponsors

### Bazantic — corrected

v1 targeted **T1**, which is **Continuity-only, $500 max**. A net-new Swarm is
ineligible. **Target T3 "Agentify a New API" ($1,000)** instead.

v1's A/B also violated their rule that *the Recipe is the only material
difference* — it removed the tools entirely. The correct A/B:

- **Both arms:** same model, same question, Bazantic Gateway reachable.
- **Arm A:** no Recipe. The agent sees a paid endpoint and must work out the
  search → judge → buy → inject flow unaided.
- **Arm B:** with the Recipe.
- **Report:** completion, token counts, wall-clock.

That is both their deliverable and §4's number.

### Hedera

Association, facilitator-sponsored fees, batched HTS settlement under the
10-entry limit, mirror-node verification — all proven in Carpool, scripts
reused.

**HCS earns a better role than it had in Carpool.** There it receipted a
payment batch. Here it timestamps **manifest hashes**: proof an artifact
existed, unmodified, at a given consensus time. That is provenance, which is
what HCS is for, and it is the thing that makes "I published this first"
checkable.

### ENS — provisioned, not built

```ts
export interface AuthorIdentity {
  id(): string;                                        // stored, paid
  verify(manifestHash: string, sig: string): Promise<boolean>;
  display(): string;
}
```

`HederaAuthor` now; `EnsAuthor` later (`alice.eth`, ENSv2 hierarchical
registries and Enhanced Access Control governing who may publish under a
namespace). Constraints that keep the seam usable: `artifact.author` is opaque
and never parsed as a Hedera id, and payout resolves through the interface.

---

## 11. Sequencing

1. **Carpool ships first.** It is finished and real — 60 settled payments, a
   batched settlement, an HCS anchor, 109 tests. Remaining: multi-provider
   royalties, the dashboard's wrong field names, a 13-agent run, a video.
2. **Phase 0 runs in parallel.** Independent, one day, gates everything.
3. **Phases 1–7 after the deadline. Phase 8 last**, so a refactor cannot
   destabilise a submitted project.
