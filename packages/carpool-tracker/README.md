# @carpool/tracker

Retrieval for Carpool v2. Given a question, find prior research artifacts
relevant enough to be worth paying for.

This is the one genuinely new component in Carpool v2 — everything else in
the product (the payment rail, the ledger, the registry's HTTP surface) is
plumbing built in earlier tasks. This package is the part that decides
whether the product works: it **ranks**, the buying agent **decides**. The
tracker hands back candidates with their full free manifest (abstract,
sources, provenance) rather than a bare score — the buyer inspects evidence
before paying, which is what keeps an imperfect ranker from making the whole
market untrustworthy (a lemons-market fix, not an accuracy requirement).

## What changed after Phase 0

`docs/PHASE0.md` ran the kill test on this product's founding premise —
"many independent parties produce substantially the same synthesis after an
event, so one artifact has many buyers" — and it returned **STOP** against
its own stated rule. Of 36 sampled artifact pairs across 8 real events, zero
were unrelated and 21 were only *partial* substitutes: people don't fail to
answer the same question, they answer it at different **depths**, and the
median free substitute appears within **half a day**.

That finding is why this package ranks on more than similarity:

```
score = similarity * freshness * (0.5 + 0.5 * depth)
```

A shallow artifact that matches a question perfectly is not a substitute for
a deep one, and ranking it first would sell the buyer something they could
have had free by teatime. `depth()` is exposed and tested on its own
(`src/rank.ts`, `src/rank.test.ts`) for exactly this reason.

Half-lives are short by default (hours to a few days, not a month) for the
same reason: free substitutes for an event-shaped question mostly exist
within a day, and an artifact priced as if it weren't racing them is
mispriced from hour one. That default is a real, named constant —
`DEFAULT_HALF_LIFE_DAYS` (1 day) and `MAX_HALF_LIFE_DAYS` (14 days) in
`src/defaults.ts` — not just prose, since `ManifestSchema.halfLifeDays`
(`@carpool/core`) only enforces "positive," and something has to say what
"short" actually means for a publish path or MCP client to use. Both
numbers are derived directly from Phase 0's own measurement — see the doc
comment on `src/defaults.ts` for the reasoning.

## Privacy claim, precisely

The MCP client embeds the question locally (`embed.ts`) and sends only the
resulting vector to the registry's `GET /search` — the registry never
receives question text.

**This is not a privacy guarantee, and this README will not call it one.**
Embedding inversion recovers a large fraction of short inputs from the
vector alone; a motivated registry operator (or anyone who compromises it)
can run that attack. What client-side embedding actually buys:

- The registry operator cannot read questions *casually* — there is no
  plaintext to grep in an access log or a database dump.
- Reading a question requires *deliberately* running an inversion attack,
  not just looking.

That is a real reduction in incidental exposure. It is not confidentiality.
If this trade-off is unacceptable for a deployment, the documented fallback
is server-side embedding with a stated retention policy — not a stronger
privacy claim that the mechanism doesn't actually support.

This also forces exactly one embedding model for the whole registry:
vectors from different models are not comparable, so `(model, dim)` is a
property of the registry (served from `GET /.well-known/carpool`), never a
per-artifact column — see `TrackerIndex`'s constructor, which asserts the
tuple it's opened with against the tuple its database was built with and
throws naming both on a mismatch.

## Install-size and latency cost — read before deploying

This is a real tax on an MCP server, not a footnote. Measured on this
machine (macOS, Apple Silicon, Node 20.19.0) with
`Xenova/all-MiniLM-L6-v2` (384-dim), the default:

| Cost | Measured |
|---|---|
| Model download (first run only) | **87 MB** — `du -sh` on the `@huggingface/transformers` cache directory after a cold embed: 90,387,606 bytes of `onnx/model.onnx` (86 MiB) plus a 712 KB `tokenizer.json` and two small JSON files, 91,100,283 bytes in total. `apps/registry/README.md` quotes the same measurement. |
| `node_modules` added by this package's runtime deps | **~240 MB**, dominated by `onnxruntime-node` (**210 MB** — it ships prebuilt binaries for every platform/arch it supports, not just the one you're running on, so this number does not shrink on a smaller deploy target) plus `@huggingface/transformers`'s own code (~13 MB) and `sharp`+`libvips` (~16 MB, pulled in for image models this package never uses) |
| Cold start, model already cached on disk (process boot → pipeline ready) | **~237 ms** |
| Cold start, model **not yet** cached (download + load, this network) | **~13.9 s** — network-dependent; this is the number a first request on a fresh deploy actually pays |
| Per-query latency, warm process | **~2–3 ms** per `embed()` call |

Total first-deploy disk footprint for this package's embedding path alone is
therefore **on the order of 330 MB**, and a cold container that hasn't
cached the model yet pays a multi-second first-request penalty. If that is
unacceptable for a given deployment target, see "the documented fallback" in
the privacy section above — server-side embedding avoids shipping the model
and runtime to every client at the cost of the privacy trade-off already
described.

(`sqlite-vec` and `better-sqlite3`, the vector index's dependencies, are
negligible by comparison — well under 1 MB and already a dependency
elsewhere in this repo.)

Reproduce these numbers yourself with `tsx bench/measure-cost.ts` (not part
of `pnpm test` — it loads the real model and needs the network on a cold
cache).

## API

### `embed.ts`

```ts
export interface Embedder {
  model: string;
  dim: number;
  embed(text: string): Promise<Float32Array>;
}

export function localEmbedder(opts?: LocalEmbedderOptions): Promise<Embedder>
```

`localEmbedder()` loads `Xenova/all-MiniLM-L6-v2` (384 dims) via
`@huggingface/transformers` by default. `opts.allowRemoteModels` maps to the
library's `env.allowRemoteModels` (set `false` to force an already-cached
model and fail closed instead of reaching the network); `opts.cacheDir` maps
to `env.cacheDir`. `opts.loadPipeline` is a test seam — production code never
sets it; it's how this package's own tests exercise `embed.ts`'s wrapping
logic (dimension checks, `Float32Array` conversion) without touching the
network or the real runtime.

### `index.ts` — `TrackerIndex`

`sqlite-vec`'s `vec0` extension loaded onto the `better-sqlite3` handle this
repo already uses elsewhere, storing embeddings at `distance_metric=cosine`
so `search()`'s `score` is cosine similarity directly regardless of whether
a caller's vectors happen to be unit-normalised.

```ts
const index = new TrackerIndex(db, { model: "Xenova/all-MiniLM-L6-v2", dim: 384 });
index.upsert(magnet, vec);
index.remove(magnet);
index.search(vec, k); // → { magnet, score }[], score = cosine similarity, descending
```

`vec0` tables are fixed-dimension. The constructor records the `(model,
dim)` tuple it's opened with in a `tracker_meta` table the first time it
runs against a given database file, and on every subsequent open asserts the
tuple matches — a mismatch throws, naming both tuples, rather than silently
ranking on incomparable vectors.

### `rank.ts`

```ts
export function depth(m: Pick<Manifest, "provenance" | "sources">): number; // 0..1
export function rank(hits: Hit[], artifacts: Manifest[], opts: { threshold: number; nowMs?: number }): Ranked[];
```

Filters `hits` to `score >= threshold`, drops anything `isExpired` (three
half-lives, `@carpool/core`), scores survivors
`similarity * freshness * (0.5 + 0.5 * depth)`, and returns them sorted
descending by that score.

### `normalize.ts`

```ts
export function normalizeQuestion(q: string): string; // lowercase, collapsed whitespace, no trailing punctuation
export function isSameQuestion(a: string, b: string): boolean;
export function findDuplicateQuestion<M extends { question: string }>(question: string, existing: readonly M[]): M | undefined;
```

`Manifest.questionNorm` (`@carpool/core`) documents this shape but nothing
produced it until this package. `normalizeQuestion` is used to build
`questionNorm` when a manifest is constructed (see `bench/run.ts`), and
`findDuplicateQuestion` is the exact-duplicate check a publish path should
run before minting a new artifact for a question already on file — it
re-normalises each candidate's own `question` rather than trusting a stored
`questionNorm`. Near-duplicates (same event, different phrasing) are the
embedding index's job, not this function's — this only catches the
exact-normalised case.

`normalizeQuestion` itself now **lives in `@carpool/core`** (next to the
`questionNorm` field it defines) and is re-exported here. It had to move:
`questionNorm` is inside the signed, content-addressed manifest, so
`apps/registry` must recompute it — which it does, rejecting a mismatch at
`POST /publish` rather than storing whatever the author sent — and
`apps/mcp` must produce it when publishing. Neither can take a dependency on
this package for a pure string function, since `./index.js` pulls
better-sqlite3 + sqlite-vec and `./embed.js` an ONNX runtime. That is exactly
why the MCP had grown a divergent copy that stripped a different punctuation
set, and therefore minted a different magnet for the same question.

**Wired in.** `TrackerIndex`, `rank()` and `findDuplicateQuestion` are on
`apps/registry`'s live path: `GET /search` embeds (or accepts) a query vector,
searches the index and ranks with `rank()`; `POST /publish` embeds the
validated `questionNorm` into the index before storing anything and reports
`duplicateOf` from `findDuplicateQuestion`. See
`apps/registry/src/search.ts` and its tests. Until that wiring existed this
package had no production caller at all while three READMEs described its
ranking as the product's core behaviour.

## `pnpm bench` — a pipeline smoke test, **not** a Phase 0 validation

```
pnpm bench
```

**This does not measure retrieval quality and does not validate Phase 0.**
It exercises the real embedder, `TrackerIndex`, and a threshold sweep
end-to-end, over a corpus built from `bench/events.ts` — numbers and facts
already published in this repo's own `docs/PHASE0.md` and its committed
evidence file `docs/evidence/phase0-rater-data.md` (8 real events, each
artifact's outlet/type/lag/word count, public URLs). It used to cite
`task-0-report.md`, which lived under a gitignored `.superpowers/` path and is in
no clone of this repo — see `docs/PHASE0.md` §8. `bench/events.ts` and
`bench/run.ts` still carry that stale citation in their header comments. No
article text is committed or fetched, so the text actually handed to the
embedder is synthetic: `${event's topic keywords} ... ${outlet}, a ${type}`.

That has a consequence worth stating plainly: **every artifact in an event
shares the identical topic string, and the 8 events are mutually unrelated
topics**. There is no artifact anywhere in the corpus that is topically
*close but wrong* — the one failure mode precision@1 could ever catch — so
the sweep cannot produce a false positive by construction. When it prints
`(synthetic) precision@1: 1.000`, that is not the same claim as
`docs/PHASE0.md §5`'s "precision@1 ≥ 95%" bar; it shows the wiring
(embedder → index → sweep) runs correctly and that MiniLM can match a
paraphrase of a keyword string to itself among 8 unrelated topics — the
least any embedding pipeline should manage, not evidence this product's
retrieval clears its economic bar. Every line the script prints is prefixed
`(synthetic)` for this reason, and the script repeats the caveat at the end
of its own output. Measuring real precision/recall needs real,
independently-authored artifacts on overlapping topics, which is exactly
the corpus this package is not allowed to commit — that measurement has to
happen against production traffic, not in this bench.

Sample output (this machine; every number below is synthetic, see above):

```
(synthetic) precision@1: 1.000
(synthetic) recall@5: 0.712
(synthetic) chosen threshold: 0.55
```

The threshold sweep itself is still built the way a real one should be —
biased toward precision over recall, per the brief: a miss just means the
buyer redoes free research; a false positive costs them money and trust.

`pnpm bench` downloads the embedding model on a cold cache (see the cost
table above) — that's why it's a separate script and never part of
`pnpm test`.

## No network in tests

`pnpm test` never touches the network or loads the real embedding runtime.
`rank.ts`, `normalize.ts` and `TrackerIndex` are tested with fixed synthetic
vectors and hand-built manifests; `embed.ts`'s own wrapping logic is tested
through the `loadPipeline` injection seam described above, never through
`localEmbedder()`'s default (real) path.
