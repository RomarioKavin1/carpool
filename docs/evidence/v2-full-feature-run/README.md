# v2's full-feature testnet run — 2026-09-12

The [first real testnet run](../v2-first-testnet-run/) proved one purchase, one
settlement epoch, one payee and one anchor. Its own README said what it did not
establish: *"One purchase, one epoch, one author, one buyer, no concurrency, and
**no refund**."* Everything in that sentence is now proven on Hedera testnet, on
a fresh topic, with the raw mirror-node responses in this directory.

**27 real x402 purchases. 25 settlement batches. 15 HCS anchors. 1,382,235 µUSDC
of sales and 1,368,735 µUSDC of payouts, closing to the µUSDC against the
registry's balance on the mirror node.** No stubs and no mocks anywhere in the
path: the real Blocky402 facilitator, the real `@hiero-ledger/sdk`, the real
`Xenova/all-MiniLM-L6-v2` embedder, a real HCS topic.

## Check it yourself

```bash
python3 docs/evidence/v2-full-feature-run/verify.py
```

**61 checks, zero imports from this repository.** Standard library only; every
fact fetched live from `testnet.mirrornode.hedera.com`; the Merkle rules
re-implemented from `packages/hedera-x402/src/merkle.ts`'s documentation rather
than imported, so a bug in the production tree cannot make the anchor verify
against itself. It exits non-zero if any check stops being true.

## What this run proves, feature by feature

| feature | verdict | the evidence |
|---|---|---|
| `POST /refund` inside the window | **proven on chain** | purchase `0.0.7162784@1789205135.943665933`, `{"ok":true}`, royalty voided; the refund paid out in batch 4 `0.0.10475802@1789205157.179586999` — registry −5,000 → buyer +5,000 |
| `POST /refund` after the window | **proven on chain** | `409 refund window has closed`, 206 s after a purchase with a 120 s window |
| the author's royalty voided, not paid | **proven on chain** | the refunded author `0.0.10497456` holds **0 µUSDC and no USDC relationship at all** — no transfer ever reached it |
| >9 payees in one epoch, 2 chunks | **proven on chain** | **13 distinct payees**, batches 2+3: `0.0.10475802@1789204986.055709931` (9 entries) and `0.0.10475802@1789204990.217343218` (6 entries), each payee credited exactly 2,500 µUSDC |
| `reconcile()` recovering a real batch | **proven on chain** | a real transfer with the receipt dropped (`0.0.10475802@1789218820.213817468`); the batch left `pending` with a NULL tx_id; a restart's boot reconcile found it by memo and settled it |
| a consensus-reached FAILURE classified `failed` | **proven on chain** | **five** real `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT` transfers, each with an empty transfer list and a real 1,337,809 tinybar fee; payouts returned to claimable each time |
| park after `maxAttempts`, then `POST /payouts/:id/unpark` | **proven on chain** | parked at attempt 5 (`parkedAt` set, `state: "held"`), unparked, and paid in batch 12 `0.0.10475802@1789218547.837417951` after the operator associated the account |
| cross-process `settle_lease` | **proven on chain** | two processes entered `settle()` at the same millisecond over one `ledger.sqlite`; **one** transfer exists for the epoch's memo and **one** credit to the payee — 2,500 µUSDC, not 5,000 |
| `POST /batches/:id/resolve` `paid` | **proven on chain** | reconcile raced ahead of mirror ingestion and escalated a batch that HAD paid; the operator looked it up and asserted `paid` with the real id `0.0.10475802@1789219371.117722461` → `SETTLED_BY_OPERATOR` |
| `POST /batches/:id/resolve` `recheck` | **proven on chain** | `NEEDS_OPERATOR:UNCONFIRMED` → `pending`, `reconcileAttempts` reset to 0, then escalated again by three more real mirror-node passes |
| `POST /batches/:id/resolve` `release` | **proven on chain** | the mirror node holds **no record** for `carpool:batch:18:8bb0024a`; the operator released it and the next epoch paid the payee for real in batch 19 |
| `POST /delist` | **proven on chain** | `410` on `/manifest` and `/artifact`, dropped from search and browse, idempotent retry, and the existing purchase **still refunded successfully afterwards** |
| `GET /owed` + `POST /owed/replay` | **proven on chain** | a real 3,000 µUSDC payment (`0.0.7162784@1789219616.600692271`) whose `onPaid` threw; `GET /owed` showed the money taken and not recorded; after the cause was fixed `POST /owed/replay` recorded purchase 22 and its royalty was paid in batch 21 |
| `GET /payouts`, all four states at once | **proven on chain** | `71-payouts-four-states.json`: `held`, `claimable`, `settled` (with `settledBatchId` 20, whose batch row carries a real transaction), `voided` — plus `401` on the unscoped table without the operator secret |
| `GET /batches` | **proven on chain** | 7 of the 8 `BATCH_STATUS` values reached on a live ledger — see below |
| the empty-epoch anchor skip | **proven on chain** | `{"anchored":false,"skipped":"empty"}` with the topic holding the same message count before and after |
| the `carpool_*` MCP tools | **proven on chain** | driven over stdio by the official `@modelcontextprotocol/sdk` client against a spawned `apps/mcp/src/server.ts`: `carpool_publish` (consent diff, then a real publish), `carpool_search`, `carpool_fetch` (real purchase `0.0.7162784@1789219831.957808823`), `carpool_delist`, then a `carpool_fetch` that correctly fails |
| the publish-consent path | **proven off chain only** | `apps/mcp/hooks/pre-publish.mjs` executed as Claude Code executes it, 7 cases: subagent → `deny`, `bypassPermissions` → `deny`, `acceptEdits` → `deny`, `CARPOOL_PUBLISH_MODE=off` → `deny`, a typo'd mode → `deny`, unparseable input → `deny`, interactive default → `ask`. **There is nothing on chain to prove here** — it is a client-side hook, and the decision vocabulary has no `allow` member |
| the A/B buy side | **proven on chain** | re-measured on the wire: `docs/AB-MEASUREMENT.md` now quotes a purchase anyone can look up, `0.0.7162784@1789220203.068787609` |
| `EMPTY_CLAIM` | **not proven** | see "What is still not proven" |

## The two accounts you need, and the topic

| role | account | note |
|---|---|---|
| registry settlement (`payTo`, and the payer of every payout) | `0.0.10475802` | `CARPOOL_ACCOUNT_ID`, carried over from the first run |
| buyer | `0.0.10497426` | created for this run, funded with 2.0 USDC from the operator |
| operator (accounts, topic, HBAR top-up) | `0.0.10474951` | `OPERATOR_ACCOUNT_ID` |
| **anchor topic** | **`0.0.10497461`** | **created fresh for this run.** The first run's topic `0.0.10496824` still holds exactly one message, so its verifier still passes — prior evidence stays attributed to the run that produced it |

Twenty author payout accounts (`0.0.10497427` … `0.0.10497456`) and one
deliberately unpayable account (`0.0.10497457`) were created from the operator.
`92-mirror-balances-final.json` lists every one of them with its closing balance
and whether its USDC relationship was created automatically or explicitly.

## Why chunk 1 carried 8 payees and not 9

`MAX_PAYEES = 9`, and the first chunk of the 13-payee epoch has **9 rows claimed
but only 8 credits on chain**. This is not an off-by-one.

`groupAndChunk` chunks by *payee*, so chunk 1 held nine payees. One of them was
the registry's own `tracker_fee` group — twelve sales × 500 µUSDC = 6,000 µUSDC
payable to `0.0.10475802`, which **is the batch payer**. `settleChunk` filters
the payer out of the transfer list (`toMove`), because a payee that is the payer
is paying itself: the SDK nets the two entries to zero, the transaction moves
nothing, and it would still cost a fee and still let the ledger claim the row was
paid by a transaction whose transfer list contains no such movement
(`docs/AUDIT-MONEY.md` L1). So the transfer carries 8 credits plus the payer
debit — **9 of Hedera's 10-entry cap** — and the 6,000 µUSDC fee row is
discharged in the same batch without a transfer.

The cap is therefore respected with one entry to spare whenever the registry's
own fee row lands in a chunk, which for this design is most epochs. Chunk 2's
five payees plus the debit is 6 entries. `verify.py` checks both counts.

## The money, to the µUSDC

```
registry 0.0.10475802 opening                  5,004,502 µUSDC
  + every sale (27 purchases)                 +1,382,235      24 × 3,000 + 3 × 436,745
  − every payout to somebody else             −1,368,735
  = closing, on the mirror node                5,018,002      ✔ matches
```

```
buyer 0.0.10497426 opening                     2,000,000 µUSDC
  − every purchase                            −1,382,235
  + every refund (3 × 2,500)                      +7,500
  = closing, on the mirror node                  625,265      ✔ matches
```

Eighteen authors hold exactly one 2,500 µUSDC royalty each. `author12`
(`0.0.10497443`) holds 1,311,235 — one fixture royalty plus three A/B royalties
of 436,245. `author13` holds 5,000 — two sales. The delist author holds nothing,
because its only sale was refunded. `verify.py` checks all of it.

## Statuses `GET /batches` actually served

Seven of the eight values in `BATCH_STATUS` were reached on this live ledger:

| status | batches | how |
|---|---|---|
| `pending` | 14, 16, 18 (transiently) | captured in `F-02`, `G-01`, `H-01` before reconcile ran |
| `SUCCESS` | 2, 3, 4, 5, 12, 14, 19, 21, 22, 24, 25 | a transfer that moved value |
| `SETTLED_NO_TRANSFER` | 1, 6, 13, 15, 17, 20, 23 | every payee in the batch was the payer |
| `FAILED:TOKEN_NOT_ASSOCIATED_TO_ACCOUNT` | 7, 8, 9, 10, 11 | reached consensus, moved nothing |
| `NEEDS_OPERATOR:UNCONFIRMED` | 16, 18 (transiently) | three fruitless reconcile passes |
| `SETTLED_BY_OPERATOR` | 16 | `resolve { action: "paid" }` |
| `RELEASED_BY_OPERATOR:NEEDS_OPERATOR:UNCONFIRMED` | 18 | `resolve { action: "release" }` |

`EMPTY_CLAIM` was **not** produced. The one plausible route to it was the
concurrency race — a second run claiming rows a first had already taken — and the
`settle_lease` refused the loser *before* it could claim anything, which is the
correct behaviour and is why the status did not occur. It remains test-only.

## What the run exposed

Five things. None of them was patched to make this run pass.

### 1. The first payout to a new author costs ~50× the fee of every later one, and the registry pays it

This is the largest finding and it is an economic one, not a bug.

| transfer | payees | fee |
|---|---|---|
| batch 2 — 8 payees, none had ever held USDC | 8 | **538,941,422 tinybar = 5.389 ℏ** |
| batch 3 — 5 payees, none had ever held USDC | 5 | 337,291,196 tinybar = 3.373 ℏ |
| batch 5 — 1 new author + 1 already-associated buyer | 2 | 68,558,392 tinybar = 0.686 ℏ |
| batch 12 — 1 payee, explicitly associated moments earlier | 1 | **1,337,809 tinybar = 0.0134 ℏ** |
| batch 4 — 1 payee (the buyer), already associated | 1 | 1,341,650 tinybar = 0.0134 ℏ |

**0.674 ℏ per never-associated payee, against 0.0134 ℏ for an associated one — 50×.**
The cause is HIP-904 automatic association: `create-accounts.ts` creates accounts
with `setMaxAutomaticTokenAssociations(-1)`, so the *payout transfer* creates the
token relationship, and the association fee is charged to the transaction payer —
which is the registry, not the author.

At a 2,500 µUSDC royalty and ~$0.20/ℏ, onboarding one author costs the registry
about **$0.135 of HBAR to deliver $0.0025 of USDC** — 54× the payout, and ~270×
the 500 µUSDC `tracker_fee` the registry earned on that sale. `docs/RUNBOOK.md`
says association costs "$0.05 per account per token, once", which is true and
says nothing about *who pays* when it happens automatically. Nothing in the repo
priced this before, because no live batch had ever paid a payee that had not
already been funded by hand.

It is bounded — once per author, for ever — but it inverts the unit economics of
the first sale, and a registry paying arbitrary self-declared accounts should
either require the author to associate (the payee pays $0.05 once) or price the
first payout accordingly.

### 2. `GET /batches` serves two different spellings of a Hedera transaction id

Batch 14 was confirmed by `reconcile()` and its `txId` is stored in the mirror
node's **dash** form:

```
14  SUCCESS  0.0.10475802-1789218820-213817468   ← reconcile(), from the mirror node
12  SUCCESS  0.0.10475802@1789218547.837417951   ← markSettled(), from the SDK receipt
```

`reconcile` writes `paid.transaction_id` straight through, and the mirror node
spells ids `0.0.x-secs-nanos` while the SDK spells them `0.0.x@secs.nanos`. A
client that builds a HashScan URL, or compares a `/batches` id to one it got from
a receipt, handles one and mishandles the other. `CONTRACT.md` says `txId` "is a
public Hedera transaction anyone can read on a mirror node" and does not say
there are two spellings. Reported rather than patched: it is a one-line
normalisation, and it is the kind of thing that should be fixed with a test that
pins both paths, not inside an evidence run.

### 3. A settled purchase survived the test that failed on it

The first A/B wire attempt hit vitest's 5,000 ms default timeout mid-purchase.
The test reported a failure; the payment
(`0.0.7162784@1789220077.706052593`, 436,745 µUSDC) **settled anyway**, and the
registry recorded it correctly. Three A/B purchases therefore exist where two
were intended. Nothing was lost — `onPaid` ran, the royalty accrued, the batch
paid it — but it is worth stating plainly: a timeout in a test harness does not
cancel money that is already in flight, and the only reason this was recoverable
is that the registry's own recording path is idempotent and durable.

### 4. `reconcile()` can escalate a batch that has already paid — by design, and it is survivable

Three reconcile passes ran in 2.5 s while the mirror node had not yet ingested a
transfer that reached consensus 4 s after submission. `RECONCILE_ATTEMPTS_BEFORE_OPERATOR`
is 3, so the batch escalated to `NEEDS_OPERATOR:UNCONFIRMED` while the payee was
already paid. That is the *correct* conservative choice — settling on no evidence
strands payees, releasing pays them twice — and `POST /batches/:id/resolve` was
exactly the right tool. But note what makes it safe in practice: the threshold is
three passes *of the epoch loop*, which at the 600 s default is half an hour, not
2.5 s. A deployment that reconciles in a tight loop would escalate almost every
ambiguous batch to a human. The constant's docstring says "three at the 600 s
epoch default is half an hour"; nothing enforces the spacing.

### 5. The WAL trap is real, and its severity is not constant

Mid-run, with one long-lived registry process holding the database,
`ledger.sqlite` was **4,096 bytes** with **3,230,112 bytes** of live data in
`ledger.sqlite-wal`. A backup taken then would have archived an empty database.
By the end of the run the main file had grown to 1,740,800 bytes with 4,132,392
in the WAL, because each short-lived driver process closed its own connection and
checkpointed on the way out; `PRAGMA wal_checkpoint(TRUNCATE)` then added only
16 KB. The rule in `docs/RUNBOOK.md` stands — checkpoint before archiving — and
the reason is now sharper: an operator cannot tell from the file sizes which case
they are in. See `93-wal-checkpoint.json`.

## What a real purchase costs in wall-clock time

Twenty-three purchases were timed end to end through the shipped `payFetch`
(unpaid 402 → signed transfer → facilitator verify and settle → body):

```
min 3.23 s   median 5.97 s   max 13.00 s
```

The A/B measurement's recorded run is 7.70 s of that distribution (0.01 s search
+ 7.69 s fetch). It is **one sample** and the document says so. What it still
excludes is the settlement epoch that pays the author — a separate transfer,
minutes to a day later — and the HBAR fees above.

## What is still not proven

Stated so nobody reads the table too widely.

- **`EMPTY_CLAIM`.** Not reached; see above. Test-only.
- **`SUCCESS_BUT_MISSING_EXPECTED_OPERATION`**, and `NEEDS_OPERATOR` from an
  *unclassifiable ledger result code* (as opposed to from reconcile exhaustion).
  Both need the network to return a specific status this run never saw, and
  neither can be produced honestly by asking for it.
- **The `DUPLICATE_TRANSACTION` branch** of `reconcile`, which is the one case
  where a mirror-node record must not be read as a failure. Producing it means
  making the network see the same transaction id twice, which this run did not do.
- **A `502` from a body-integrity failure**, and the `refundUndelivered` path
  behind it. Not exercised: it needs the stored body to be corrupted between the
  quote and the delivery.
- **Load.** 27 purchases across ~2 hours, sequential. Nothing here says what
  happens at rate, and the two-process concurrency test is two processes, not ten.
- **A chunk of exactly 10 transfer-list entries.** Every multi-payee epoch in this
  run happened to include the registry's own fee row, which nets out, so the
  largest transfer list submitted was 9 entries. The 10-entry cap itself is
  therefore still only shown in test.
- **Two ambiguous injections.** Two of the six batch-level scenarios were reached
  by injecting `SettlerDeps.submit` — the seam the shipped code already has for
  it — rather than by a real crash: `drop` executes the transfer for real and
  discards the response before the receipt is read, and `nosubmit` throws before
  `execute`. Everything downstream of the injection is real: the transfer, the
  mirror-node queries, the escalation, the operator's decision, and the transfer
  that finally paid. The trigger is not.

## How it was run

- A scratch `LEDGER_DB` and `ARTIFACT_STORE` under a session scratchpad, never
  `data/`, and a scratch environment file outside the repository, so no key was
  ever written to a tracked path. The archived drivers in `drivers/` reference
  environment variables and contain no key.
- `EPOCH_SECONDS=86400`, so the epoch timer could not fire unattended. **Every
  settlement in this run was an explicit bounded `POST /settle`** or a one-shot
  driver process; nothing anchored on a timer.
- Port **8403**. A sibling agent's registry was on 8404 with no credentials.
- Every registry PID captured at launch and killed by that PID, never by pattern
  (`docs/RUNBOOK.md`: a `pkill -f` once matched nothing and said nothing). The
  server was restarted five times during the run — twice deliberately, to make
  boot `reconcile()` do the recovering, and three times because the host killed it
  under memory pressure. The restarts are visible in the evidence and changed
  nothing: the ledger is durable and `reconcile()` is what a restart is for.
- **No production code was changed to make any of the on-chain work above
  happen.** Every route, every settle, every refund and every resolve ran against
  the code as shipped; the only injection is `SettlerDeps.submit`, a seam the
  shipped code already exposes, used by two of the batch-level scenarios and
  declared above.

  Code *was* changed to re-measure the A/B buy side on the wire, and here is the
  complete list, because "we changed nothing" is the kind of claim that should be
  checkable:

  | file | change | why |
  |---|---|---|
  | `apps/bench/src/ab.ts` | `renderAb` prints a `WIRE MEASUREMENT:` scope block when the latency is not a floor, and the buy column's header reads `BUY (measured, on the wire)` | a wire number with no statement of scope is the overclaim in the other direction; the renderer already refused to print a floor without its caveat |
  | `apps/bench/src/ab-run.test.ts` | a `CARPOOL_AB_LIVE_REGISTRY` mode; the price assertions bracket `priceAt()` over the interval the call measured instead of comparing to one sample; a 300 s timeout for the live round trip; the stub transaction-id pin removed | the old assertion asserted that the round trip took no time, which is exactly what a wire measurement stops claiming. The pin existed to keep a *stub* figure reproducible; with the record now a wire measurement, leaving the stub reporting a real-length id makes both modes produce the same 90 |
  | `apps/bench/src/ab.test.ts` | asserts the wire scope block is present when the floor flag is false | the guard has to be symmetric |
  | `apps/bench/src/ab-measured.json` | rewritten by `CARPOOL_AB_WRITE=1`, never by hand | it is the machine-written record the doc and the dashboard are checked against |
  | `docs/AB-MEASUREMENT.md`, `README.md` | the figure block regenerated; the prose updated for the three figures that moved, with the superseded stub reading kept | the 25 guarded figures fail on a hand edit |
  | `apps/dashboard/lib/measured.ts` | the recorded `BUY` figures; `LOCAL_LATENCY_CAVEAT` → `LATENCY_CAVEAT`, rewritten for a wire number; the auto-association fee in `NOT_SHOWN` | the dashboard renders these and its own test compares them to the record |
  | `apps/dashboard/lib/measured.test.ts` | the latency guard now asserts the record says which kind of number it is (and that a wire run names its transaction), and the µUSDC window guard asserts the property it existed for — that 436,700 is still excluded — instead of a fixed width | a fixed width was asserting that the measurement stayed a loopback |
  | `apps/dashboard/components/EconomicsView.tsx` | the renamed constant | one caller |

## Files

| file | what it is |
|---|---|
| `verify.py` | the independent verifier described above — 61 live checks, zero repo imports |
| `00-*` | the smoke publish, its manifest, the unpaid `402`, and the first real purchase |
| `01-settle-fee-only.json` | `SETTLED_NO_TRANSFER`: the only claimable payee was the payer |
| `10-chunk-publishes.json` | the 12 authors and magnets of the chunk-boundary epoch |
| `11-chunk-purchases.json` | 12 real x402 purchases, with the buyer's opening balances |
| `12-payouts-during-window.json` | every royalty `held`, every fee `claimable` |
| `13-settle-two-chunks.json` | the two-chunk settle response, with both transaction ids |
| `14-chunk-settlement-mirror.json` | the two transfers verbatim from the mirror node, and the balances after |
| `15-chunk-payouts-after.json` | every row `settled`, each naming its batch |
| `20-*` … `24-*` | the refund story: publish, refund inside the window, the money returned on chain, and the refusal afterwards |
| `30-delist.json`, `31-delist-state.json` | `POST /delist`, the 410s, and the refund that still worked afterwards |
| `40-*` … `43-*` | the unpayable payee: five consensus failures, the park, the unpark, the operator's association, and the payment |
| `50-concurrent-settle.json`, `50-concurrent-console.txt` | two processes, one ledger, one epoch — including the loser's own log line |
| `60-owed-failure.json`, `61-owed-replay.json`, `62-owed-royalty-paid.json` | a settled payment the ledger could not record, and its recovery |
| `64-mcp-tools.json` | the `carpool_*` tools over a real stdio MCP session |
| `65-consent-hook.json` | the publish-consent hook, 7 cases |
| `70-empty-epoch.json` | the idle epoch: `skipped: "empty"`, topic unchanged |
| `71-payouts-four-states.json` | all four `PayoutState` values at one instant, plus the access rule |
| `72-ab-wire-report.txt` | the A/B runner's own output for the wire measurement |
| `80-mirror-hcs-messages.json`, `81-mirror-topic.json` | the anchor topic and all 15 messages |
| `90-final-state.json` | `GET /state`, `/payouts`, `/batches`, `/owed`, `/events`, `/.well-known/carpool`, `/health` at the end |
| `91-ledger-rows.txt` | every row of every table in the run's database |
| `92-mirror-balances-final.json` | every account this run touched, from the mirror node |
| `93-wal-checkpoint.json` | the WAL trap, measured |
| `94-process-hygiene.txt` | every registry PID launched, how each one ended, and the final `ps`/`lsof` output |
| `server-logs/` | the registry's own stdout for all five processes — including `reconcile: batch 14 confirmed paid as …` and `markFailed: parked 1 payout(s) after 5 failed attempt(s)` |
| `F-*` | `reconcile()` recovering a real batch |
| `G-*` | `NEEDS_OPERATOR` → `resolve { action: "paid" }` |
| `H-*` | `NEEDS_OPERATOR` → `recheck` → `release` → paid |
| `J-00-purchase.json` | the purchase the concurrency race contested |
| `timeline.jsonl` | every publish, purchase, refund, settle and resolve, in order, as it happened |
| `drivers/` | every script used, archived verbatim — see below |

## Reproducing it

`drivers/` holds the exact scripts. They are archived here rather than left in
`apps/` because they are not product code: they drive the shipped code from
outside it. `drivers/run.ts` is the subcommand driver (`smoke`, `chunks-publish`,
`chunks-buy`, `chunks-settle`, `refund-*`, `delist`, `unpayable-*`, `unpark`,
`isolated`, `resolve`, `owed-*`, `empty-epoch`, `snapshot`, `topic`);
`drivers/lib.ts` calls `publishArtifact`, `payFetch` and `delistArtifact` from
`apps/mcp/src` unchanged. `drivers/drop-submit.ts` and `drivers/reconcile.ts` are
the ambiguous-submit and reconcile drivers; `drivers/concurrent.ts` spawns the two
racing processes; `drivers/live-mcp.ts` is the MCP client; `drivers/mk-accounts.ts`
creates and funds the accounts.

You need your own accounts and your own topic — see `docs/RUNBOOK.md` — and an
`env.sh` exporting `CARPOOL_ACCOUNT_ID`/`CARPOOL_PRIVATE_KEY`,
`OPERATOR_ACCOUNT_ID`/`OPERATOR_PRIVATE_KEY`, `HCS_TOPIC_ID`, `LEDGER_API_KEY`,
`LEDGER_DB`, `ARTIFACT_STORE`, `REGISTRY_PORT=8403` and
`EPOCH_SECONDS=86400`. Never in the repository.
