# Runbook

**This document is the registry operator's.** It is one of three roles, and the
other two are shorter: an author publishes research and is paid royalties, a
buyer searches (free, with no account) and pays for what it buys. Neither of
them needs anything on this page, and both are in
[GETTING-STARTED.md](GETTING-STARTED.md). Section 1 below is shared by all three,
because every role's identity is the same kind of Hedera account.

## Getting a testnet identity

1. **Portal account** — [portal.hedera.com](https://portal.hedera.com), create an
   **ECDSA** testnet account. ECDSA specifically: the x402 Hedera signer calls
   `PrivateKey.fromStringECDSA`, and an ED25519 key fails at signing time with an
   error that reads like a facilitator fault.
2. **Derive the service accounts**
   ```bash
   pnpm --filter @carpool/registry create-accounts
   ```
3. **Associate USDC — do this before the faucet**
   ```bash
   pnpm --filter @carpool/registry associate
   ```
   **This is the step that wastes afternoons.** Circle's faucet mints only to an
   account already associated with the token. `maxAutomaticTokenAssociations`
   does *not* satisfy it: auto-association creates the relationship lazily, on
   first receipt, and the faucet checks for an existing one *before* it sends —
   so it declines silently. No transfer, no error, no explanation.
4. **Faucet** — [faucet.circle.com](https://faucet.circle.com), Hedera Testnet,
   token `0.0.429274`. Rate-limited per address per 2 hours, so if a window is
   burned, mint to a fresh associated account and sweep with
   `pnpm --filter @carpool/registry distribute`.
5. **Anchor topic** — `pnpm --filter @carpool/registry create-topic`.
6. **Check** — `pnpm --filter @carpool/registry preflight` should be all green.

## What has actually been run on a ledger

### v2 — one full run, 2026-09-12

v2 published, sold, settled and anchored on Hedera testnet, against the **real**
Blocky402 facilitator (`https://api.testnet.blocky402.com`) and the **real**
`@hiero-ledger/sdk`. No stubs, no mocks.

| what | id |
|---|---|
| artifact | `swarm:e38566220be6a9ddcbd11300bf3d16da6d41340a3dd7a6f94f16be3010b2bdf0` |
| x402 purchase, 110,000 µUSDC `0.0.10477413` → `0.0.10475802` | `0.0.7162784@1789202339.427560739` |
| settlement transfer, 109,500 µUSDC `0.0.10475802` → author `0.0.10475801` | `0.0.10475802@1789202482.460233839` (batch 1, `SUCCESS`, memo `carpool:batch:1:f25a8a34`) |
| HCS anchor, root `aa11de68…bb0c` | topic **`0.0.10496824`**, seq 1, consensus `1789202493.460038026` |

The batch carried a genuine author payout *and* the registry's own 500 µUSDC
`tracker_fee` row, whose payee is the batch payer: `settleChunk` netted that one
out of the transfer list and discharged it, so the batch is `SUCCESS` with a real
transaction id rather than `SETTLED_NO_TRANSFER`. A second `POST /settle` with
nothing owed returned `{"anchored":false,"skipped":"empty"}` and the topic still
holds exactly one message — the empty-epoch guard, confirmed against the real
network rather than a mock.

Everything above is verifiable from the mirror node independently of this
repository's logs. `docs/evidence/v2-first-testnet-run/` holds the raw responses
and `python3 docs/evidence/v2-first-testnet-run/verify.py` re-checks all of it
live, including re-deriving the anchored Merkle root from the epoch's three
leaves with its own Merkle implementation.

**What this run did *not* establish** — and what the second run did. The first
run was one purchase, one epoch, one author, one buyer, no concurrency and no
refund. On the same day a **second, full-feature run** covered all of it:

### v2 — the full-feature run, 2026-09-12

**27 real x402 purchases, 25 settlement batches, 15 HCS anchors on topic
`0.0.10497461`, 1,382,235 µUSDC of sales and 1,368,735 µUSDC of payouts, closing
to the µUSDC against the registry's balance on the mirror node.** Proven on chain:

| what | evidence |
|---|---|
| `POST /refund` inside the window, money back on chain | refund `{"ok":true}`, then batch 4 `0.0.10475802@1789205157.179586999` returning 5,000 µUSDC to the buyer; the refunded author holds **0 µUSDC and no USDC relationship at all** |
| `POST /refund` after the window | `409 refund window has closed` |
| a batch past one payee and past the 9-payee chunk boundary | **13 distinct payees in one epoch, two chunks**: `0.0.10475802@1789204986.055709931` (9 transfer-list entries) and `0.0.10475802@1789204990.217343218` (6) |
| `reconcile()` recovering a real batch | a real transfer with its receipt dropped, the batch left `pending`, and a restart's boot reconcile matching it by memo on the mirror node |
| a consensus-reached FAILURE → `failed`, rows back to claimable | five real `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT` transfers, each 1,337,809 tinybar and an empty transfer list |
| park → `POST /payouts/:id/unpark` → paid | parked at attempt 5, unparked, paid in batch 12 after the operator associated the account |
| the cross-process `settle_lease` | two processes entering `settle()` in the same millisecond over one `ledger.sqlite`: **one** transfer, **one** credit, 2,500 µUSDC and not 5,000 |
| all three `POST /batches/:id/resolve` actions | `paid` (against a transfer that really paid), `recheck`, `release` (against a memo the mirror node has no record of) |
| `POST /delist`, and purchases staying refundable after it | `410` on `/manifest` and `/artifact`, and a refund that still succeeded afterwards |
| `GET /owed` + `POST /owed/replay` | a real payment whose `onPaid` threw, recovered and its royalty paid in batch 21 |
| the `carpool_*` MCP tools | driven over stdio by the official MCP SDK client, including a real purchase |

`docs/evidence/v2-full-feature-run/` holds the raw responses, the drivers, and
`verify.py` — **61 checks, zero repo imports**, all live against the mirror node.

**What is still not established.** `EMPTY_CLAIM` and
`SUCCESS_BUT_MISSING_EXPECTED_OPERATION` never occurred; the
`DUPLICATE_TRANSACTION` branch of `reconcile` was not produced; no transfer list
reached the full 10 entries; the body-integrity `502` and `refundUndelivered` were
not exercised; and nothing has run at volume (27 purchases over two hours,
sequential) or against a hostile counterparty. Read the rest of this document as
procedure written from v1's operational experience plus these two v2 runs.

### v1 — the predecessor rail

The two incidents named under "Things that look inert and are not" are **v1's**
(`apps/settlement`, deleted in this restructure), as is the rest of this
repository's earlier testnet evidence: 60 paid requests settled, one batched
`TransferTransaction` `0.0.10475802@1789137942.760688301` (4 payees, `SUCCESS`,
1,591,862 tinybar in fees) and 13 HCS anchors on topic `0.0.10475805`, twelve of
them over empty epochs. Genuine, and not v2's.

## Custody, stated honestly

The registry holds buyer funds for **at most the refund window plus one
settlement epoch** — with two exceptions it would be dishonest to omit:

- balances under the dust threshold (500 µUSDC) carry forward indefinitely by
  design, and
- **while the settler is stopped, nothing is bounded.** If you stop the service,
  you are holding other people's money until you start it again.

## Delisting

`POST /delist { magnet, authorSig }` — the author's signature over
`sha256("<magnet>:delist")`. It stops new sales and nothing else: purchases inside
their refund window stay refundable, accrued royalties are still paid, the
manifest hash still anchors, and a buyer who already paid keeps their copy. No
rows are deleted (`delisted_at` is a tombstone, like `voided_at` on a payout), and
it is **final for that magnet** — republishing the identical manifest does not
relist it. There is deliberately no relist route. See CONTRACT.md.

If you are withdrawing because the *body* is gone, note the order: losing
`data/artifacts/<hash>` makes delivery fail with a 502 and an automatic
`refund_due`, which is correct but costs you every sale in flight. Delist first,
then remove the body.

## Restart

`reconcile()` runs at boot and matches pending batches against the mirror node
**by payer account**. Do not "fix" it to query network-wide: the last 100
transactions network-wide span about five seconds, so a batch is never among
them and recovery silently never works.

## Backup

Two things, and both matter:

- `data/ledger.sqlite` — **checkpoint the WAL first.** `ledger.sqlite` can be
  4 KB on disk with 2 MB of live data sitting in an uncheckpointed `-wal`. A
  backup that copies only the main file archives an empty database. Run
  `PRAGMA wal_checkpoint(TRUNCATE)`. Not hypothetical: the 2026-09-12 live run
  ended with the main file at **4,096 bytes** and **1,924,072 bytes** in
  `-wal`; after the checkpoint, 1,699,840 and 0.
- `data/artifacts/` — the bodies. Content-addressed by hash; losing one delists
  its artifact and freezes the remaining royalties.

## Things that look inert and are not

Two live-resource leaks have already happened in this project's history:

- A settlement server left running anchored an empty epoch to HCS **every 600
  seconds for two hours and seven minutes**, spending real HBAR to assert that
  nothing had changed. Empty epochs are now skipped (verified on the real
  network during the 2026-09-12 run: an idle `POST /settle` answers
  `{"anchored":false,"skipped":"empty"}` and submits nothing) — but check for
  stray processes before assuming a count is stable.
  `ps -eo pid,etime,command | grep -E "node .*(server|registry|settle)" | grep -v grep`.

  **And kill by PID, not by pattern.** The clean-up attempt for that incident
  was `pkill -f "apps/settlement/dist/server.js"`, which matched nothing and
  said nothing, because the process had been started as
  `cd apps/settlement && node dist/server.js` — its command line never
  contained the path. Capture `$!` at launch and kill that. The 2026-09-12 run
  did exactly that, and `grep -c ""`-clean process output is part of its
  evidence.
- A test inherited the repo-root `.env` operator key (dotenv fills gaps, it does
  not clear) and fired a **real testnet precheck** on every run. Blank
  credentials explicitly in tests; do not rely on them being unset.

## Running a live epoch without leaving one running

What the 2026-09-12 run did, and the shape to copy:

- a **scratch** `LEDGER_DB` and `ARTIFACT_STORE` outside `data/`, so no live run
  can be mistaken for production state, and a scratch env file outside the
  repository, so no key is ever written to a tracked path;
- `EPOCH_SECONDS=86400`, so the epoch timer cannot fire unattended — every
  settlement is an explicit, bounded `POST /settle` (or a direct
  `runSettleEpoch` call, which is exported for exactly this);
- the server started as `node --import tsx src/server.ts` with its PID captured
  at launch, and killed by that PID at the end;
- the author's royalty is `held` until the purchase's refund deadline
  (`ts + 120 s`), so a settle issued before then produces a fee-only batch and
  `SETTLED_NO_TRANSFER`. Poll `GET /payouts` until the royalty reads `claimable`
  and then settle once.

## Stopping

There is no graceful-drain path yet. Stopping the registry mid-epoch leaves
accrued payouts unpaid until it restarts — which is safe (the claim is
conditional and idempotent) but is not the same as settled.
