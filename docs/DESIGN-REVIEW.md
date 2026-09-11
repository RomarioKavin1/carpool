# Design review — `apps/dashboard`

Reviewed 2026-09-12 against a **live registry on port 8404** holding 38 artifacts
published through the real `POST /publish` with real ECDSA signatures and the
real ONNX embedder (`Xenova/all-MiniLM-L6-v2`, 384d). Driven in Chrome.

Every finding is marked **[V]** — observed in a browser, with the measurement or
screenshot that produced it — or **[by reading]**. Line references are to the
tree as it stands *after* the fixes in this review; each fixed item says so.

---

## How the data under test was produced

This matters, because the rule this dashboard is built around is that a rendered
number must be traceable to something real.

**Real flows** (the registry's own routes, nothing hand-written into the
database):

- **38 artifacts** via `POST /publish` — bodies are this repo's own documents
  (`docs/PHASE0.md`, `docs/RUNBOOK.md`, `CONTRACT.md`, `README.md`,
  `docs/AB-MEASUREMENT.md`, `docs/SWARM.md`, `docs/RESTRUCTURE.md`,
  `docs/X402-RESEARCH.md`, `docs/AUDIT-MONEY.md`, `docs/AUDIT-CLAIMS.md`,
  `docs/FINAL-REVIEW.md`, split at `##` headings), with real `magnetOf`
  content addresses, real `signManifest` signatures over the manifest hash, and
  real `normalizeQuestion` output. The registry recomputed and accepted all of
  them; abstracts and source URLs are the documents' own.
- **1 withdrawal** via `POST /delist`, signed by the author over
  `sha256("<magnet>:delist")`.
- **Search ranking** via `GET /search?q=` — genuine ONNX cosine similarity. An
  exact-question query returned `similarity 1.000`, a near query `0.593`, and an
  off-topic query returned zero hits against the registry's own threshold.
- **Expiry** is real decay: six artifacts crossed ⅛ freshness on the registry's
  clock during the session, from real `halfLifeDays` and `producedAt`.

**Seeded** (written into the scratch SQLite, because a real x402 payment was not
practical here) — all of it through the registry's **own** `RegistryLedger`
class, so the rows have the shapes and invariants `onPaid` would produce:

- **23 purchases** (`recordPurchase`), spread over 10 buyer accounts and backdated
  so `refundState` covers `window`, `closed` and `refunded`.
- **1 refund** (`refundPurchase`), which voided its royalty row.
- **1 settlement batch** (`unsettled` → `claimBatch` → `markSettled`) carrying a
  Hedera transaction id, producing `settled` payout rows.

Net payout states observed: `held 1, claimable 23, settled 22, voided 1`.

**None of this touched the repo.** The ledger, artifact store and scripts live in
a scratch directory; the registry ran with `CARPOOL_PRIVATE_KEY` and
`HCS_TOPIC_ID` blanked (`creds: false`), against loopback stubs for the
facilitator and mirror node, so nothing could settle to testnet or anchor to HCS.
Port 8403 and `docs/evidence/` were not touched.

---

## Verdict

**This executes the torrent-client idea, and it is not a table with torrent
words on it.** Three things earn the metaphor rather than referencing it:

1. **The decay bar inverts a progress bar into a drain**, and then does real work
   on top of that: hairlines at ½/¼/⅛ are one half-life apart *by construction*,
   so the reader sees how many halvings remain rather than a percentage whose
   rate of change they must guess; the sub-⅛ dead zone is hatched, so the end of
   the artifact's sellable life is visible from the day it is published. Across
   38 rows the column reads as one picture — a swarm dying from the bottom up.
   No other element in this review comes close to it.
2. **SEED / PEER / RATE are not decoration.** They are holders, current demand and
   purchases-per-hour, each traced to a served field, and they genuinely
   disagree with each other on the data (`8 / 5 / 6/h` on the hot artifact) the
   way a real swarm does. A dead artifact keeps its row and is dimmed by a tinted
   background rather than by lowering text opacity, so its numbers stay readable
   — which is what a torrent client does with a stopped torrent.
3. **The status strip is the right borrowing.** Aggregates belong pinned at the
   window edge, permanently, not in a hero panel that pushes rows below the fold.

What it is *not* yet is evenly finished. The swarm view and the economics view
are strong; the seeding view — the one carrying the product's central claim that
authors get paid — shipped with its headline panel **permanently stuck on a
loading message in the default configuration**, and the search view told the
reader the opposite of what had happened whenever a ranked query returned
nothing. Both are fixed here. The honesty properties the UI claims are, with
those two exceptions, real: I verified them against the wire rather than
against the comments.

---

## What is genuinely well done — preserve this

- **`components/DecayBar.tsx`** in full. The half-life gradations, the hatched
  dead zone, the single moving drain head, and the legend that explains *why the
  spacing is the decay*. It is the one element doing conceptual work rather than
  reporting a number, and it survives 38 rows and a 390px viewport. **[V]**
- **The serif/mono split.** A serif for prose and mono for readouts is a real
  semantic boundary here, not a decorative one: on the economics view you can
  tell a human argument from a machine figure without reading either. It holds
  up in practice. **[V]**
- **The empty states.** `EmptySwarm` (`components/Chrome.tsx:210`) opens with
  "Nothing is wrong" over a hairline graph-paper grid — emptiness as a canvas,
  not a failure. Every subordinate panel has its own honest empty copy rather
  than collapsing. **[V]**
- **The three connection states are genuinely three.** Offline ("nothing is
  listening", with the command to fix it), refused ("the registry answered, and
  said:" with its message verbatim), and stale-but-live (data retained, amber
  banner, polling continues). Almost no dashboard gets this right; collapsing
  them into one "error" is the normal failure. **[V]**
- **Provenance marks and `NoData`.** Every economics figure carries `live` /
  `recorded` / `author-reported` / `at stated rates`, and the two things the
  registry structurally cannot see say "no source" with the reason in a tooltip
  and in `sr-only` text. The retraction is a full panel on the page, not a
  footnote. **[V]**
- **`min-w-0` discipline in `Panel`** (`components/primitives.tsx:41`), with the
  comment explaining it is load-bearing. Correct, and the reason the swarm view
  never scrolled sideways.
- **`lib/search.ts`'s refusal to read a rank the server did not send.**
  `rankingOf()` is all-or-nothing across the three fields, and it is the only
  place allowed to touch them. Verified on the wire. **[V]**
- **The activity rail.** A real transfer log: glyph, type, amount, buyer, tx,
  right-aligned timestamps, and the live `since=` cursor on display so the
  seconds-vs-milliseconds bug class is visible in one glance. **[V]**

---

## Honesty properties — verified

| Claim | Result |
|---|---|
| Ranked vs browse decided from the **response**, not the request | **Holds.** `lib/search.ts:53` inspects hits. **[V]** |
| Score columns **absent**, not dashed, in browse mode | **Holds.** Browse headers on the wire were exactly `question, age, life, health, size, fare` — `score`/`sim`/`depth` are not in the DOM. Ranked mode added all three. **[V]** |
| Zero-hit ranked search is described honestly | **Did not hold.** See H3 — fixed. **[V]** |
| "not observable" stamps present and legible | **Holds.** Three `NoData` stamps on the economics view, each with `sr-only` reason text; `drove alone` in the status strip; `anchored → not yet` on the manifest pane. **[V]** |
| Floor / local caveats not buried | **Holds.** Both amber caveat blocks sit *inside* the comparison columns they qualify (`components/EconomicsView.tsx:227`, `:260`), not in a footer, and the closing paragraph states plainly that no wall-clock ratio is claimed. **[V]** |
| `prefers-reduced-motion` gates the motion | **Holds.** See A4 for the method and its limit. **[V]** |

---

## Findings

### Critical

**C1 · The payouts panel was permanently stuck loading in the default
configuration.** `app/page.tsx:226` (fixed) **[V]**

The seeding view's file header calls payouts "the point of this view now" — it is
where "authors get paid" stops being a claim and names a transaction. With no
`NEXT_PUBLIC_CARPOOL_AUTHOR` set (the default) it rendered
`Reading GET /payouts?payee=0.0.1102…` for ever, and every `royalty` and
`payout` cell in the sales ledger fell back to "no payout row was read".

Two independent derivations of "which seeder is open" disagreed. `SeedingView`
picks `findSeeder(…) ?? findSeeder(…) ?? seeders[0]`, and `findSeeder` correctly
guards `if (!key) return null`. `page.tsx` had its own `state.artifacts.find()`
against `selectedAuthor ?? SELF_AUTHOR_ACCOUNT` — **both null by default** — and
`parseAuthor(author).payoutAccount === null` is *true* for any author whose
string does not follow the `<account>:<key>` convention. So it matched the first
unparseable author, produced a payee of `null`, and `wantedPayees` never
requested anything. `GET /payouts?payee=0.0.1102` answered `200` with six rows
throughout; nothing ever asked for them.

*Fix:* `page.tsx` now derives the payee with the same `buildSeeders` +
`findSeeder` rule the view uses, so the two agree by construction. The panel now
renders "$0.4071 earned, of which $0.3915 has actually been paid out in 1 batch"
with a HashScan link to the transaction — the product's central claim, which was
invisible before. **[V]**

### High

**H1 · A false "you" badge on an account the app cannot identify.**
`components/SeedingView.tsx:108` (fixed) **[V]**

`isSelf = s.identity.payoutAccount === SELF_AUTHOR_ACCOUNT` is `null === null`
when no author is configured and the seeder's author string does not parse — so
the seeder list labelled `carpool-re…a9f6e0` **you**, eleven lines above its own
copy saying "this app has no wallet and cannot tell which account is yours". For
a dashboard whose discipline is never to claim what it cannot observe, this is
the worst possible thing to be wrong about.

*Fix:* require `SELF_AUTHOR_ACCOUNT !== null` before comparing. Observed: zero
"you" badges.

**H2 · A ranked query that returned nothing was labelled a browse.**
`components/SearchView.tsx:184` (fixed) **[V]**

Asking a real question that cleared no artifact produced a panel titled
**browse**, a `not observable` mark reading "The registry ranked nothing on this
request", the sentence "**Nothing was ranked**", and the advice "Ask a question
to get a ranking" — to a reader who had just asked one, which the registry *had*
ranked and rejected everything against. The correct paragraph
("Nothing cleared the registry's similarity threshold for …") sat two lines
below, directly contradicting the banner above it.

`searchMode([])` returning `"browse"` is right — zero hits carry no evidence of a
mode. The bug was the UI turning "no evidence" into a positive claim.

*Fix:* when the response is empty **and** a question was asked, the panel claims
neither mode: title "no results", and copy saying the response carries no
evidence of whether it ranked. The mode is still read off the response and never
off the request; `result.query` is used only to know which request was made,
which is legitimately known. Observed: title `no results`. **[V]**

**H3 · The whole document scrolled sideways at narrow widths.**
`components/SeedingView.tsx:94`, `app/page.tsx:338`,
`components/ArtifactDetail.tsx:187` (all fixed) **[V]**

`primitives.tsx:39` states the rule: only tables may scroll horizontally. At
741px the seeding view broke it by 33px, and at 390px the swarm view broke it by
121px.

Root cause, confirmed by bisection in the live page: a CSS grid track written
`1fr` — or left implicit, which is `auto` — is floored at its item's min/max-content
width, and **`min-w-0` on the grid *item* does not lower the *track***. So
`table.min-w-[760px]` escaped its own `overflow-x-auto` wrapper and widened the
column past the viewport; on the artifact pane it was `.prose-measure`'s
`max-width: 68ch` (~477px) doing the same. `max-width` is a cap on how wide prose
may get, never a demand for that much room.

Verified in-browser before fixing: setting `gridTemplateColumns: minmax(0,1fr)`
on the offending container dropped `documentElement.scrollWidth` from 774 to 741
(= `clientWidth`).

*Fix:* every bracket-notation grid track in the app is now `minmax(0, …)` at both
the base and the breakpoint. Post-fix sweep, all four views, page-level
horizontal scroll: **360px ok · 390px ok · 768px ok · 1024px ok**. **[V]**

**H4 · The stale-read banner's clock advanced while the data did not.**
`app/page.tsx:302` (fixed) **[V]**

The disconnected banner rendered `new Date(nowMs)`, and `nowMs` is set at the top
of every poll whether or not that poll succeeded. Observed across one outage: the
banner read "as of 18:24:51", then "as of 18:24:57", over identical figures. A
timestamp that moves beside data that has not is exactly the quietly-wrong number
this project exists to avoid.

*Fix:* a `lastGoodMs` set only when `/state` actually answers, and copy that says
the figures "have not changed since". (The sentence also no longer runs on — the
registry's verbatim message now gets its own clause instead of being spliced
mid-line, which produced "…cannot reach http://127.0.0.1:8404 Polling
continues".)

### Medium

**M1 · One measured contrast failure, in a token the palette's own audit does not
cover.** `components/Chrome.tsx:99`, `components/ActivityRail.tsx:68`,
`components/SearchView.tsx:82` (fixed) **[V, measured]**

`tailwind.config.ts:18` claims "every text token clears WCAG AA (4.5:1) at the
11px sizes this UI actually uses, with margin". True of the solid tokens —
measured against composited backgrounds, the worst was `debit` at 6.15:1. But the
**alpha variants are not in that audit**: `text-mute/70` at 10px measures
**4.29:1**, below AA.

Method: computed colour and the full composited background chain read off the
live DOM, alpha-blended, WCAG relative luminance. Post-fix: **0 failures below
4.5:1** across every distinct colour/size pair on screen.

**M2 · The ARIA tab pattern was half-implemented.**
`components/ArtifactDetail.tsx:95` (fixed) **[V]**

`role="tablist"` and four `role="tab"` with `aria-selected`, and — measured in the
DOM — **zero `role="tabpanel"`**, no `aria-controls`, no `id`, no roving
`tabindex`. A screen reader announced "tab, 1 of 4" and then found no panel any
tab governed, and a keyboard user had to step through all four to leave the
strip.

*Fix:* completed rather than removed — `id`/`aria-controls`/`aria-labelledby`, a
real `tabpanel`, roving `tabindex`, and Left/Right arrow keys per the APG.
Observed: 1 tabpanel, `tabindex` `[0,-1,-1,-1]`, all four `aria-controls`
resolving.

**M3 · The only column that identifies an artifact truncated with no way to read
it.** `components/SwarmTable.tsx:125` (fixed) **[V]**

The name cell is `max-w-[34ch]` + `truncate` and carried **no `title`** at any
level — measured: `scrollWidth > clientWidth` on every row, `title` null on the
cell, the button and the span. The full question was unreadable anywhere in the
swarm view. `SearchView`'s equivalent cell already had one, so this was an
inconsistency rather than a policy.

**M4 · A long registry error swallowed the top bar.**
`components/Chrome.tsx:89` (fixed) **[V]**

`detail` is the registry's own message passed through verbatim — good policy —
but it was rendered untruncated in the header. A realistic message ("ledger is
locked: another process holds the write lease on ledger.sqlite") wrapped the
header onto a second line and pushed the poll interval and registry URL off it
entirely. Now `max-w-[40ch] truncate` with the full text in `title`; the error
screen still shows it in full.

**M5 · `KV` broke prose mid-word.** `components/primitives.tsx:116` (fixed) **[V]**

`break-all` is right for a 64-hex magnet and wrong for everything else: the
normalised question rendered as `…"units, stated once" establ / ish`.
`break-words` still breaks an unbreakable magnet but respects word boundaries
otherwise.

**M6 · The offline screen printed the same URL twice.**
`components/Chrome.tsx:183` (fixed) **[V]**

"Nothing is listening on `http://127.0.0.1:8404` — cannot reach
`http://127.0.0.1:8404`." `api.ts`'s offline detail already embeds the URL. The
detail is now appended only when it says something the sentence does not.

**M7 · The search view opened onto nothing.**
`components/SearchView.tsx:150` (fixed) **[V]**

Landing on `search` gave a form, a privacy caveat, and ~700px of empty page —
saying neither what the two buttons do differently nor that the difference is the
entire point of the view. Now an initial panel in the same graph-paper treatment
as `EmptySwarm`, naming the two modes in the same terms the result panels use.

### Low / judgement calls — not implemented

**L1 · At wide widths the most information-dense column stops growing.** **[V]**
`SwarmTable.tsx:103` caps the name at `max-w-[34ch]`, so at 1440px the surplus
width is absorbed by numeric columns that do not need it — ~100px of air opens
between `health` and `seed` while the question stays truncated. The more screen
you give this table, the more it wastes. *Suggestion:* let the name column take
the slack (drop the cap, or raise it at `xl`). Left out because the cap is what
keeps row heights uniform, and that is a real competing value in a dense table —
this is a taste call for whoever owns the view.

**L2 · `▼` and the credit/debit pair mean two different things on one screen.** **[V]**
In the status strip, `▲ published` is `credit` and `▼ purchased` is `debit` — an
upload/download reading. In the activity rail (`ActivityRail.tsx:80`) a
`purchase` is `▼` in **credit**, a money-in reading. Same glyph, same two colours,
opposite semantics, both visible at once. Not wrong so much as two conventions
sharing one palette; worth picking one. Left out because choosing changes the
meaning of the footer, which is a product decision.

**L3 · The A/B comparison loses its A/B below `md`.** **[V]**
`EconomicsView.tsx:201` is `md:grid-cols-2`; below 768px "redoing it" and
"buying it" stack, and the `h3`s (`:203`, `:236`) are `text-xs text-mute` —
the same weight as the `Figure` labels beneath them. Two columns *are* the
argument; stacked, "buying it" becomes a faint 11px label mid-scroll with nothing
marking the boundary. *Suggestion:* strengthen those two headings so they read as
headings when the spatial separation is gone. Left out as a typographic judgement
call on a view whose restraint is deliberate.

**L4 · The status strip costs four lines on a phone.** **[V]**
At 390px the sticky footer wraps to ~4 lines (~11% of an 844px viewport),
permanently. Correct content, but the aggregate that earns a permanent edge on a
desktop may not earn one there.

**L5 · On a phone the fare is 565px off-screen.** **[V]**
The swarm table scrolls inside its container (correct — the page does not), but
the price is the last of nine columns and there is no affordance saying the table
scrolls. A torrent client on a phone would prioritise differently. Any fix is a
real design decision about column priority, so it is a recommendation, not a
change.

**L6 · Author-supplied abstracts render verbatim, markdown and all.** **[by reading]**
`ArtifactDetail.tsx` prints `manifest.abstract` as text, so a real document's
abstract shows `- **Events:** 8, …`. Rendering untrusted author markdown would be
worse; noted only so it is a known trade rather than an oversight.

---

## Appendix — methods, including the ones that failed

**A1 · Phone width. Observed, not asserted.** The earlier passes were right that
`mcp__claude-in-chrome__resize_window` does not work: it returns
`Successfully resized window … to 1600x1100` while `window.innerWidth` stays
pinned at **750** and `outerWidth` at **750**. I confirmed that twice.

The method that does work: a **same-origin `<iframe>` injected into the running
app**, sized to the target viewport. A framed document gets its own CSS viewport,
so Tailwind's `sm/md/lg/xl` media queries and every `max-width` evaluate against
the iframe's width exactly as they would on a device — and because it is
same-origin, `contentDocument` can be measured directly. Reported viewports were
verified from inside (`contentWindow.innerWidth === 390`).

What this method does **not** emulate: device pixel ratio, touch input, mobile
UA, and on-screen-keyboard viewport resizing. It is an accurate test of layout
and breakpoints, and not a substitute for a real handset.

Widths swept: **360 · 390 · 414 · 768 · 1024 · 1440**, across swarm, search,
seeding and economics.

**A2 · Many artifacts.** 38 published (30+ requested). The table holds: rows stay
19px, the decay column reads as a single gradient from full to hatched, the six
expired rows and the one withdrawn row are distinguishable at a glance, and
sorting stays total (ties fall back to health then magnet, so a poll that changes
nothing never reshuffles rows under the cursor — `lib/derive.ts:157`). **[V]**

**A3 · Edge cases exercised.** A **366-character** question; a **43-character**
account id (`0.0.987654321098765432109876543210987654321`, truncated correctly in
the 272px seeder column and in the swarm row); an author string that does not
follow the `<account>:<key>` convention (`carpool-research-collective:…`, which
surfaced C1 and H1, and whose payouts panel correctly refuses to guess a payee
rather than inventing one); an artifact with **zero sources** ("The author
recorded no sources."); **30 zero-buyer artifacts**; six expired; one withdrawn;
one refunded sale; a settled batch carrying a transaction id. **[V]**

**A4 · `prefers-reduced-motion`.** The OS setting on this machine is off
(`matchMedia('(prefers-reduced-motion: reduce)').matches === false`), so I could
not observe the reduced state directly. I read the **compiled rule out of the
CSSOM** instead, which is stronger than reading the source:

```
@media (prefers-reduced-motion: reduce) {
  .tick { animation: auto ease 0s 1 normal none running none; }
  *, ::before, ::after { transition-duration: 1ms !important; }
}
```

That is `animation: none` on the fare tick, and the `!important` blanket covers
both remaining animations — the decay bar's drain (measured `transitionDuration:
1s`) and the health meter (`0.5s`). The claim holds. Stated precisely: **rule
verified, reduced state not rendered.**

**A5 · Keyboard and focus.** Focus order is DOM order and is sensible: view tabs →
sortable column headers → one control per row → artifact panes → rail links.
The focus ring is a single global treatment (`app/globals.css:37`, 2px `wire`)
and is clearly visible — screenshotted on a column header. Search is fully
operable from the keyboard: the input is labelled (`sr-only` label, `htmlFor`),
Enter submits, and `rank` is disabled while the draft is empty. Sortable headers
are real `<button>`s inside `<th scope="col">` carrying `aria-sort`
(`ascending`/`descending`/`none`), both tables have `sr-only` `<caption>`s, and
the decay and health bars are `role="meter"` with `aria-valuenow` and a labelled
stage ("past two half-lives"). One caveat: with 38 rows a keyboard user passes 38
row buttons before reaching the artifact panel — inherent to a dense table, and
not something to fix by removing the per-row control. **[V]**

**A6 · The fare tick is rarer than feared.** With 38 rows decaying continuously I
expected the "one orchestrated motion" to become a constant shimmer. Sampled: 3
of 38 cells animating at a given moment. It reads as occasional movement, not
noise. No change needed. **[V]**

---

## Changed files

`app/page.tsx` · `components/SearchView.tsx` · `components/SeedingView.tsx` ·
`components/ArtifactDetail.tsx` · `components/Chrome.tsx` ·
`components/SwarmTable.tsx` · `components/ActivityRail.tsx` ·
`components/primitives.tsx`

No change alters what data may be rendered, introduces a fallback value, or adds
a module edge — `lib/fixtures-unreachable.test.ts` stays green (20 tests).
