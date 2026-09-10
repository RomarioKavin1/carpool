# Money-path audit — can we lose money, double-pay, or strand a payee?

**Verdict: yes to all three, but only one is an everyday path.** The arithmetic
is sound and the conditional writes are sound; every defect found is in what
happens when something goes *wrong* — an unrecognised ledger code, a throwing
submit, a throwing `onPaid`. The single most likely real failure (paying an
author who is not associated with USDC) strands that batch permanently with no
recovery route, and a purchase whose `onPaid` throws serves the goods for free.

Scope: `packages/hedera-x402/src/{settler,sqlite-ledger,gate}.ts`,
`apps/registry/src/{ledger,settlement,server,config}.ts`, treated as one system.
Branch `feat/phase1-reproducibility` at `b99e22a`.

- **[V]** = verified by executing something. **[by reading]** = inferred.
- New probe tests: `packages/hedera-x402/src/audit-money.test.ts` (62),
  `apps/registry/src/audit-money.test.ts` (55),
  `apps/registry/src/audit-onpaid-throw.test.ts` (3).
- `pnpm -w test`: **626 tests, 11/11 tasks** (baseline 506 + 120 added).
  `pnpm -w typecheck`: 11/11. No production file was modified.
- Every probe **passes**, which means every defect below is reproduced, not
  hypothesised. Fixing one will fail its test; the test says why.

> **Note on the working tree.** During this audit, four production files
> (`settler.ts:331`, `gate.ts:161`, `ledger.ts:174`, `search.ts`) were silently
> mutated on disk by something outside this session — `matches` filter replaced
> with `true`, the `replay` lookup deleted, `splitSale`'s first guard turned into
> `if (false)`. Each was restored with `git checkout` and every result below was
> produced against a verified-clean tree (`git status` checked immediately before
> and after each run). If a mutation-testing job is running here, note that the
> property test in `apps/registry/src/audit-money.test.ts` kills the
> `splitSale` mutant.

---

## HIGH

### H1. A purchase whose `onPaid` throws serves the body for free, and the money is unrecoverable [V]

`apps/registry/src/server.ts:288-343` handles exactly two `onPaid` failures —
`ctx.payer === null` (line 293) and a vanished artifact (line 305). Any other
throw out of `onPaid` (`server.ts:258`) is swallowed by the gate
(`packages/hedera-x402/src/gate.ts:228-241`), which still returns
`{ kind: "paid" }` at line 242, and the route falls straight through to
`store.read` and a **200 with the body**.

Verified end-to-end in `apps/registry/src/audit-onpaid-throw.test.ts`: buyer
settles on-ledger, receives `200` + the full body, and afterwards

- `GET /state` has **no purchase row**,
- `GET /payouts` is **empty** — the author is owed nothing for a sale that happened,
- `POST /refund` returns **404 "no purchase recorded for tx …"**, so the buyer
  cannot reverse it either,
- the only record is the `owed_failure` row, and **no HTTP route reads that
  table** (verified: `/state`, `/batches`, `/events`, `/payouts`, `/health` all
  omit the txId). Recovery requires opening `ledger.sqlite` by hand. There is no
  replay loop; `db/schema.ts:70` still says "Task E *may* grow" one.

This also contradicts the contract `splitSale` documents for itself at
`apps/registry/src/ledger.ts:166-172` — "the buyer gets a 502 naming the txId".
The 502 does not exist for this branch.

Reachable triggers, in descending likelihood:

1. **`SQLITE_BUSY`** on `recordPurchase`'s write transaction. `openDb`
   (`packages/hedera-x402/src/db.ts:29`) sets `journal_mode = WAL` and **no
   `busy_timeout`**, so any concurrent writer — a second registry process, a
   rolling restart, `scripts/reset.ts`, an operator's `sqlite3` session — makes
   the write throw immediately rather than wait. [by reading]
2. `TRACKER_FEE_MICRO_USDC` set negative: `config.ts:36-42`'s `int()` truncates
   but never range-checks, so `-1` is accepted and `splitSale` throws on every
   single sale (`ledger.ts:177`). This is the trigger the test uses. [V]
3. The unique index `idx_purchase_txid` (`db/schema.ts:126`) firing across two
   processes. [by reading]

**Fix direction (not applied):** the route needs the same `purchaseByTxId(ctx.txId)`
check the integrity-failure branch already does at `server.ts:337` — if there is
no purchase row for a settled payment, 502 and do not serve. `gate.handle` could
also usefully distinguish "paid and recorded" from "paid, not recorded".

### H2. A real Hedera failure code outside the allow-list strands its payees forever, with no recovery route [V]

`classifyLedgerResult` (`settler.ts:109-114`) returns `unknown` for anything not
in `FAILED_RESULTS` (`settler.ts:80-106`, 25 codes) or `SUCCESS_RESULTS` (2).
The SDK defines **357** status codes (enumerated via `Status._fromCode`). The
`unknown` branch (`settler.ts:281-289`) leaves the batch `pending` with its rows
still claimed — so `unsettled()` never returns them again, and `reconcile()`
reading the same code reaches the same verdict every time.

24 real codes a fungible-token `TransferTransaction` can return, all of which
moved no value, none of which is allow-listed, are asserted in the probe. The
one that matters:

> **`NO_REMAINING_AUTOMATIC_ASSOCIATIONS` (262)** — what a USDC transfer to an
> author who is not associated with the token and whose auto-association slots
> are used up returns. For a marketplace paying arbitrary self-declared
> accounts (`identity.ts:16-26` takes the payout account straight out of the
> signed manifest, unvalidated), this is *the* likely payout failure.

Also absent: `ACCOUNT_EXPIRED_AND_PENDING_REMOVAL` (223),
`PAYER_ACCOUNT_DELETED` (256), `INVALID_PAYER_ACCOUNT_ID` (71),
`INVALID_PAYER_SIGNATURE` (43), `ACCOUNT_ID_DOES_NOT_EXIST` (60),
`RECEIVER_SIG_REQUIRED` (113), `TRANSFER_LIST_SIZE_LIMIT_EXCEEDED` (92 — the
allow-list has only its token-specific sibling 198), `THROTTLED_AT_CONSENSUS`
(366), `FAIL_INVALID` (23), `BUSY` (12), `PLATFORM_NOT_ACTIVE` (67),
`INVALID_ACCOUNT_AMOUNTS` (48), `TOKENS_PER_ACCOUNT_LIMIT_EXCEEDED` (166).

Verified (`F1`): after such a result, ten further epochs settle nothing, the
payout rows stay claimed and unvoided, and the batch's status is still the
string `"pending"` — **no status anywhere in the system says these payees were
not paid**. `reconcile()` over five passes changes nothing.

The conservative direction is defensible; what is missing is the other half of
it. Nothing turns an `unknown` batch into an operator's problem: no route, no
metric, no `NEEDS_OPERATOR` status, only a `console.error`. "Left pending for an
operator" (`settler.ts:284`, `358`) names a role the system gives no tools to.

### H3. A throwing `submit` aborts the whole epoch, not just its own batch [V]

`run()` awaits `submit` at `settler.ts:264` inside the chunk loop with no
`try`/`catch`. Verified (`F3`): with 10 payees (two chunks), a throw on chunk 1
rejects out of `settle()`, **chunk 2 is never attempted**, chunk 1's nine payees
are left claimed by a pending batch, and a subsequent successful run pays only
chunk 2's single payee. The nine are permanently in the H2 state.

`defaultSubmit` (`settler.ts:377-391`) converts a `ReceiptStatusError` into a
result only when `consensusFailure` recognises the code, so the throw is
reachable from:

- a **precheck** rejection out of `tx.execute` (line 381) — `PrecheckStatusError`
  is never inspected at all, so `INSUFFICIENT_PAYER_BALANCE` *at precheck*
  throws even though that exact code is allow-listed; [by reading]
- a `ReceiptStatusError` carrying an unlisted code — verified in `F3`;
- a receipt timeout, a gRPC error, a dropped connection.

This is also how H2's permanent strand is reached without any exotic status
code: the mirror node will never hold a record for a transaction that was
rejected at precheck, so `reconcile` logs "unconfirmed — left pending"
(`settler.ts:334`) on every pass, forever.

### H4. `reconcile()` is not serialised against `settle()`, and can release the rows of a transfer that is still in the air → real double payment [V]

`claimBatch` (`sqlite-ledger.ts:91-112`) inserts the batch as
`('pending', tx_id NULL)` **before** the transfer is submitted, and `pending()`
(`sqlite-ledger.ts:157-161`) selects exactly that shape. `reconcile()` has no
single-flight guard (contrast `Settler.settle()` at `settler.ts:217-223` and
`EpochRunner` at `settlement.ts:141-155`) and nothing serialises it against an
in-flight submit.

Verified (`F4`) with a submit held open: `reconcile()` sees the batch, finds a
failed sibling for its memo, `markFailed` releases the row — and then the
in-flight transfer lands **SUCCESS**. The next epoch claims the released row and
pays the same 8 500 µUSDC a second time. The probe asserts the second on-chain
transfer with the identical leaf.

The timing window is real: mirror-node ingestion (~2 s) is faster than
`execute` + `getReceipt` (~5 s), so there are seconds in which the mirror shows
a record for a batch whose `submit` has not returned.

Preconditions, stated honestly: the only production `reconcile()` caller is the
un-awaited startup call at `server.ts:77-79`, whose `pending()` snapshot is
taken before any `settle()` in *that* process could have claimed anything. So a
single steady-state process does not hit this. It is reached by **two registry
processes over one `ledger.sqlite`** — a rolling restart, a `docker compose up`
over a still-draining container, an operator running a script — which nothing
forbids: the invariant the code documents is "one `Settler` per *process*"
(`settlement.ts:14-19`), and there is no file lock, no `busy_timeout`, and no
single-writer assertion. [V for the mechanism, by reading for the deployment]

---

## MEDIUM

### M1. A refund can return zero and still report `ok: true`, burning the buyer's only attempt [V]

`POST /publish` rejects `priceFloor < trackerFee` (`server.ts:372-378`) using
the fee **at publish time**. Raise `TRACKER_FEE_MICRO_USDC` afterwards and every
subsequent sale of an already-live artifact hits `splitSale`'s clamp
(`ledger.ts:180`): `fee = paid`, `royalty = 0`. `refundPurchase`
(`ledger.ts:595-627`) deliberately reverses only the royalty row — so it voids a
0 and accrues a **0 µUSDC `refund` row**, returns `{ ok: true }`, and writes
`refundState = 'refunded'` (`ledger.ts:620`), which permanently closes the only
refund path the buyer has.

Verified (`R1`): buyer pays 10 000, is refunded **0**, purchase is `refunded`,
registry keeps 10 000. And the arithmetic invariant still holds
(`fee 10 000 + refund 0 == paid 10 000`), which is exactly why nothing catches
it. `refundUndelivered` in the same state correctly returns the whole 10 000 —
the asymmetry is intentional per `ledger.ts:588-593`, but "buyer's remorse is
not a service failure" reads differently when the refund is literally nothing.

### M2. `recordPurchase` idempotency is entirely defeated by an empty `txId` [V]

`purchaseByTxId` short-circuits on a falsy txId (`ledger.ts:497`), the unique
index excludes it (`db/schema.ts:126`, `WHERE tx_id <> ''`), and
`gate.ts:218` assigns `txId: s.transaction` with **no check that the facilitator
returned one**. Verified (`R6`): three `recordPurchase` calls with `txId: ""`
produce three purchases and six payout rows, and `purchaseByTxId("")` cannot
even find them. The schema comment asserting this is "future-proofing, not
load-bearing today" (`db/schema.ts:121-125`) depends on a third-party
facilitator's response shape, not on anything in this repo.

### M3. `refundUndelivered` silently short-pays when the tracker-fee row was already claimed [V]

`tracker_fee` is accrued `availableAt: now` (`ledger.ts:562`), i.e. immediately
claimable, so an epoch can claim it between `onPaid` committing and the route's
`store.read` failing. `refundUndelivered` then voids only the royalty and
refunds only that (`ledger.ts:664`), while still writing
`refundState = 'refunded'` unconditionally — so it is never retried. Verified
(`R3`): buyer paid 10 000, nothing delivered, refunded **9 500**, permanently.
Narrow window, silent loss, no log.

### M4. `markSettled` is unconditional, and that erases the only evidence of a release [V]

`sqlite-ledger.ts:114-118` has no `WHERE status = 'pending'`, unlike `markFailed`
(line 139) and `void` (line 248). The previous agent's judgement — harmless
because the rows already live in another batch — is **correct about the money and
wrong about the record**. Verified (`R`/`F5`): after `markFailed(b1)` releases a
row that b2 then claims and pays, a late `markSettled(b1, tx, "SUCCESS")` flips
b1 from `FAILED:INSUFFICIENT_TOKEN_BALANCE` back to `SUCCESS` with a real txId.
Both batches now claim to have paid the same payee the same amount; the payout
row points only at b2; `sum()` reads 8 500 while two SUCCESS transfers exist on
chain. The FAILED status was the only in-database witness that a release
happened, and H4 is precisely the scenario that produces this pair. Make it
conditional and the same double-pay still occurs — this is a forensics defect,
not the cause — but it is the difference between a reconcilable ledger and one
that silently agrees with itself.

### M5. No attempt counter: a permanently-failing cause re-submits forever, and one bad payee blocks its whole chunk [V]

`markFailed` returns rows to claimable with no attempt count, no backoff, and no
quarantine. Verified (`F6`), 50 epochs against a payee whose account is deleted
(`ACCOUNT_DELETED`, allow-listed):

- **50 on-chain transactions**, one per epoch. A consensus-reached failure still
  charges the payer's transaction fee, so the bounded cost is
  `(86400 / EPOCH_SECONDS) × fee` per day, forever — at the 600 s default,
  144 transactions/day (~1–15 c/day of HBAR at typical testnet/mainnet transfer
  fees), never terminating.
- **50 `batch` rows** for one payout — unbounded table growth, and `GET /batches`
  serves all of them, newest first, with no limit.
- Nothing else degrades: after 50 cycles the amount is still exactly 8 500, the
  payout row count is still 1, no corruption, no crash.

The worse half (`F6`, second case): `groupAndChunk` (`settler.ts:142-162`) groups
up to 9 payees per transfer and `markFailed` releases **all** of them, so the
chunk re-forms identically every epoch. Verified: nine payees, one un-payable,
and after five epochs **all nine are unpaid**. Eight solvent authors are held
hostage by the ninth, permanently, with no per-payee isolation.

### M6. `reconcile`'s mirror window is one fixed 100-record page with no cursor [V]

`settler.ts:313` fetches `…?account.id=<payer>&limit=100&order=desc` once, with
no pagination and no timestamp bound. Verified (`F7`): if the payer account has
done 100 other things since, the pending batch's own record is off the page,
`matches.length === 0`, and it is logged "unconfirmed — left pending" on every
subsequent pass forever. This is the ceiling on crash recovery: a batch must be
reconciled within 100 payer transactions or it never can be. Note the fix for
v1's "last 100 network-wide" bug (same line) moved the window from ~5 seconds to
"100 payer transactions", which is much better and still finite.

---

## LOW / INFORMATIONAL

### L1. Every `tracker_fee` payout is a self-transfer that nets to zero [V]

`recordPurchase` accrues the fee to `cfg.registryAccount` (`ledger.ts:566`) and
`createRegistrySettler` passes **that same account** as the batch `payer`
(`settlement.ts:26`). Verified (`F8`) against the real SDK: a fee-only batch
encodes a transfer list with a single adjustment, `{registryAccount: "0"}`, yet
the ledger records 1 500 µUSDC as paid out, marks the row `settled`, and the
batch `SUCCESS` with a txId whose transfer contains no such movement. Since a
royalty is held 120 s while its fee is payable at once, a fee-only epoch is the
*ordinary* case right after a sale.

Consequences: a wasted on-chain transaction per fee-only epoch; `/payouts`'
"your payout was settled in batch X, check it on a mirror node" is false for
every `tracker_fee` row. I could **not** determine what Hedera returns for a
single zero-amount token adjustment without a network call — if it is
`INVALID_ACCOUNT_AMOUNTS` the batch strands (H2); if
`EMPTY_TOKEN_TRANSFER_ACCOUNT_AMOUNTS` it retries forever (M5); if `SUCCESS` it
is merely waste. The live `apps/registry/data/ledger.sqlite` is empty, so there
is no historical evidence either way. **Worth one testnet epoch to settle.**

### L2. `refundPurchase` decides from a stale snapshot [V]

`refundPurchase` checks `p.refundState` on the caller's object
(`ledger.ts:596`), and `POST /refund` awaits a mirror-node round-trip between
reading `p` and calling it (`server.ts:555-568`). `refundUndelivered` re-reads
inside its transaction (`ledger.ts:649`) precisely to avoid this;
`refundPurchase` does not. Verified (`R2`): two concurrent refunds are
nonetheless stopped — by `void()`'s conditionality, not by the guard — so no
money is lost. But the caller is told
`"royalty already claimed by a settlement batch"` when nothing was claimed and
the row was merely already voided, which is a wrong answer to a money question
and would send an operator to the batch table for a bug that is not there.

### L3. `config.ts:int()` range-checks nothing [V]

`trackerFee` and `epochSeconds` accept negatives and zero. A negative fee is H1's
trigger; `EPOCH_SECONDS=0` makes `setInterval` fire continuously.

### L4. Sub-dust payees are dropped from every batch and reported nowhere [V]

`groupAndChunk` returns `dropped` (`settler.ts:161`) and `run()` discards it
(`settler.ts:227`). Verified (`F9`): a payee owed 499 µUSDC is never paid across
20 epochs, no batch is even created, and nothing logs it. Bounded at
`< DUST` (500 µUSDC) per payee and clears the moment they earn again — this is
the documented design (`settler.ts:5`), and correct; it is listed only because
`/payouts` shows such a row as `claimable` indefinitely with no explanation.

### L5. Delisting does not stop a purchase whose 402 was already issued [V]

The gate replays the requirements it issued and never re-quotes (`gate.ts:152-165`),
and `onPaid` checks only `getArtifact() != null`, never `isLive()`
(`server.ts:263-264`). Verified (`R5`): a sale recorded after a delist accrues
and pays out normally. Bounded by `DEFAULT_QUOTE_TTL_MS` (30 s) and arguably
correct — the buyer did hold a good quote — but `/delist`'s response promises
"New sales are stopped" (`server.ts:522`) without the 30-second caveat.

---

## No defect found — what I tried and could not break

**The arithmetic invariants hold.** A property test
(`apps/registry/src/audit-money.test.ts`, `R7`) runs 40 seeds × 60 random
operations over `publish / purchase / refund / refundUndelivered / delist /
settle / clock-tick / fee-change` against the real SQLite ledger, asserting
after **every single operation**:

- `sum(non-voided payouts) <= sum(purchase.paid)`,
- no negative payout amount,
- no row both voided and claimed,
- and per sale, at the row level, `fee + royalty == paid` exactly —

and at the end of every sequence, **exact** conservation
(`sum(live payouts) == sum(receipts)`). The submit stub randomly succeeds, fails
on-ledger, and returns unclassifiable results, and `TRACKER_FEE_MICRO_USDC` is
changed mid-sequence to `{0, 1, 500, 2 000, 50 000}` — including values above
the sale price, exercising the clamp. **Nothing violated any invariant.**
`splitSale` is also exhaustively checked over every integer pair in `[0,40]²`.

**`fee + royalty == paid` survives a fee change between purchase and refund.**
This is the specific regression `amountOf` was added for, and it holds: both
refund paths read the row (`ledger.ts:605`, `659-661`) rather than recomputing
from today's environment. I could not construct a sequence in which a fee change
moved a refund by one µUSDC.

**The allow-list contains no code under which value could have moved.** I checked
all 25 (`F2`). Every one is either a precheck rejection (never reached consensus)
or a handle-stage rejection of an atomic HAPI `CryptoTransfer`, whose transfer
list is all-or-nothing. `TRANSACTION_EXPIRED` was the best candidate and is
clean: it means consensus was *not* reached. `DUPLICATE_TRANSACTION`'s exclusion
is correct and load-bearing. **The double-pay direction of the allow-list is
safe; only the strand direction (H2) is wrong.** I looked for this hard, and it
is not there.

**Conditional claim and conditional void are genuinely correct.** `claimBatch`
(`sqlite-ledger.ts:100-108`) claims per row with
`WHERE settled_batch_id IS NULL AND voided_at IS NULL` and reports what it won;
`run()` then rebuilds the transfer from `claimed`, never from what it read
(`settler.ts:243-253`). `void` (`sqlite-ledger.ts:244-253`) and `markFailed`
(`sqlite-ledger.ts:136-155`) are both conditional and both transactional. I
tried refund-then-claim, claim-then-refund, double refund, refund mid-`EpochRunner`
run, and `markFailed` over a batch containing a row voided in the meantime
(`R2`, `R4`, `F5`): **every one is refused correctly and no money is invented.**

**`available_at` is the right mechanism and the boundary is not off by one.** A
royalty is unclaimable until `refundDeadline` (`sqlite-ledger.ts:77`) and
refundable until `now <= refundDeadline` (`ledger.ts:598`), so the overlap is
the single second `now == deadline` — and at that second `claimBatch` and
`void()` are mutually exclusive, so one of them simply loses (`R2`). A refund
after a batch claimed the row is *denied*, not silently swallowed, and the
purchase stays `window` rather than being marked refunded — the safe direction.

**`EpochRunner`'s single-flight covers settle *and* anchor.** Verified (`R4`):
three concurrent `run()` calls produce **one** submit and the **same** result
object, and the guard is per-in-flight-run rather than a one-shot latch. The
`if (this.running === started)` check at `settlement.ts:150` correctly avoids
clearing a successor's promise. `markAnchored` is called only on
`anchor.anchored` (`settlement.ts:93`), so a skipped anchor retries rather than
losing artifacts.

**Delist is a tombstone and it holds.** Verified (`R5`): a purchase inside its
window is still refundable after a delist; a royalty accrued before the delist is
still paid after it (`[author, 9 500]` in the batch leaves); the manifest still
appears in `unanchoredManifests()`; delist is idempotent and reports the original
timestamp. `refundPurchase` never consults the artifact at all, which is what
makes this work.

**`recordPurchase` is genuinely idempotent on a real txId** (`R6`): a retried
`onPaid` returns the original purchase and accrues nothing, and better-sqlite3's
synchronous transactions make the read-then-insert atomic within a process.

**The SDK nets the payer debit against a payee credit for the same account**
(`F8`), so a batch containing the registry's own fee is still zero-sum with no
repeated account — `TRANSFERS_NOT_ZERO_SUM_FOR_TOKEN` and
`ACCOUNT_REPEATED_IN_ACCOUNT_AMOUNTS` are both avoided. Worth knowing that this
is the SDK's aggregation doing it, not anything the settler asserts.

## Well-built code worth naming

- **`amountOf` and both refund paths reading the row instead of recomputing it**
  (`sqlite-ledger.ts:232`, `ledger.ts:605`/`659-661`). This is the cleanest fix in
  the money path: it converts a class of silent drift into a read, and the
  property test confirms it holds under adversarial fee changes.
- **`splitSale`'s clamp-and-assert** (`ledger.ts:173-198`). Clamping the fee rather
  than flooring the royalty makes the sum an *identity* instead of an inequality,
  and the post-condition is checked rather than commented. Total over every input
  I could generate. (Its doc comment overstates what happens on a throw — see H1 —
  but the function is right.)
- **The three-way `LedgerOutcome`** (`settler.ts:61`). Refusing to collapse
  "unknown" into "failed" is correct, and the reasoning in the comment is the real
  reasoning. The defect is the missing operator surface for the third case, not
  the third case.
- **`claimBatch` reporting what it won, and `run()` rebuilding from `claimed`**
  (`settler.ts:243-253`). The one place a concurrency bug here would cost real
  money, done properly.
- **`EpochRunner` existing at all** (`settlement.ts:110-155`) — the comment
  explaining why the guard belongs above `Settler` rather than inside it is
  exactly right, and the "two HCS messages for one epoch" leak it closes is the
  same class as the v1 incident it cites.
- **`markFailed`'s two conditions in one transaction** (`sqlite-ledger.ts:136-155`).
  The `voided_at IS NULL` half is easy to forget and is present.
- **The `available_at` hold-back** (`sqlite-ledger.ts:20`). One column that makes
  a refund window possible without a scheduler, a sweeper, or a second clock.

## Suggested priority

1. **H1** — the only defect on an everyday path that gives away both the goods
   and the author's money. One `purchaseByTxId` check in the route.
2. **H2 + H3** — together they are "any unexpected failure strands its payees
   silently, forever". Needs an operator surface (a `NEEDS_OPERATOR` batch status
   and a route that can release or force-settle one) more than it needs a longer
   allow-list; a longer allow-list alone would trade H2 for M5.
3. **M5** — an attempt counter and per-payee quarantine, so one dead account
   stops costing fees forever and stops holding eight authors hostage.
4. **H4 / M4** — a `busy_timeout`, a single-writer assertion, and making
   `markSettled` conditional. Cheap; the double-pay it prevents is expensive.
5. **M1, M2, M3, L3** — small, independent, each a few lines.
6. **L1** — one testnet epoch to find out which of three outcomes this actually is.
