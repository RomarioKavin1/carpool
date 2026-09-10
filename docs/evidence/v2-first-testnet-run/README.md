# v2's first real testnet run — 2026-09-12

Until this run, **v2 had never moved a cent.** Every purchase, refund, batch and
anchor in v2's tests and in `docs/AB-MEASUREMENT.md` was produced against a stub
facilitator and a mocked `@hiero-ledger/sdk`, in-process on 127.0.0.1. The
repository's genuine testnet evidence — 60 paid requests, one 4-payee
`TransferTransaction`, 13 HCS anchors — belonged to **v1's `apps/settlement`**,
deleted in the restructure.

On **2026-09-12** the v2 registry published, sold, settled and anchored on Hedera
testnet, against the **real** Blocky402 facilitator and the **real**
`@hiero-ledger/sdk`. This directory is the raw evidence. Nothing in it is
paraphrased from a log: every number below is either a mirror-node response
stored here verbatim or is re-derived by `verify.py`.

## Check it yourself

```bash
python3 docs/evidence/v2-first-testnet-run/verify.py
```

Standard library only, no repository imports, every fact fetched live from
`testnet.mirrornode.hedera.com`. It re-implements the Merkle rules from
`packages/hedera-x402/src/merkle.ts` rather than importing them, so a bug in the
production tree cannot make the anchor verify against itself. 19 checks; it
exits non-zero if any of them stops being true.

## The two transactions and the topic

| | |
|---|---|
| **x402 purchase** | `0.0.7162784@1789202339.427560739` |
| **settlement transfer** | `0.0.10475802@1789202482.460233839` |
| **HCS anchor topic** | `0.0.10496824` (created for v2 this day; message seq **1**) |
| **anchor consensus timestamp** | `1789202493.460038026` |
| **anchored Merkle root** | `aa11de684c48ef7fbf0f60c7a314c753e878ed0e7031318a563679c1a465bb0c` |
| **artifact magnet** | `swarm:e38566220be6a9ddcbd11300bf3d16da6d41340a3dd7a6f94f16be3010b2bdf0` |

The purchase's payer is the facilitator's fee payer `0.0.7162784`, which is why
the transaction id is not the buyer's: Blocky402 declares
`extra.feePayer: 0.0.7162784` on `hedera:testnet` and submits the buyer's signed
transfer itself. The *token* transfer inside it is the buyer's.

HashScan: `https://hashscan.io/testnet/transaction/<id>` for either transaction,
`https://hashscan.io/testnet/topic/0.0.10496824` for the anchor.

## The accounts

| role | account | why this one |
|---|---|---|
| registry settlement (`payTo`, settler debit) | `0.0.10475802` | `CARPOOL_ACCOUNT_ID` |
| author (royalty payee) | `0.0.10475801` | USDC-associated; `manifest.author` is `0.0.10475801:032d5e…c3f8bf` |
| buyer | `0.0.10477413` | USDC-associated, 3.0 USDC |
| operator (topic creation) | `0.0.10474951` | `OPERATOR_ACCOUNT_ID` |

All four were already associated with USDC `0.0.429274`. No faucet call was
needed, so the association-before-faucet trap in `docs/RUNBOOK.md` was not
re-tested here — which is, as it happens, what the artifact this run sold is
about.

## The money, to the µUSDC

```
priceNow                       110,000 µUSDC   (priceFloor 10,000 + priceBase 100,000 × freshness 0.9999994)
  buyer 0.0.10477413           -110,000        purchase tx, consensus 1789202354.038336026
  registry 0.0.10475802        +110,000

split (splitSale)
  tracker_fee   payout #2          500  ->  0.0.10475802  (the registry itself)
  author_royalty payout #1     109,500  ->  0.0.10475801
                               -------
                               110,000        the payout table sums to exactly what the sale received

batch 1 (memo carpool:batch:1:f25a8a34), settlement tx, consensus 1789202491.002441105
  author 0.0.10475801          +109,500       a real on-ledger HTS transfer
  registry 0.0.10475802        -109,500
  payout #2 (500)                              netted out: payee == payer, discharged without a transfer
```

Both payouts are in **one** batch: `groupAndChunk` batches up to 9 payees, and
`settleChunk` filters the payer out of the transfer list (`toMove`) while still
marking its row settled. So this batch is `SUCCESS` with a real transaction id
*and* it discharged a self-transfer — not `SETTLED_NO_TRANSFER`, which is what a
fee-only epoch would have been and which would not have demonstrated a payout at
all.

Balance deltas on the mirror node (`21-mirror-balances-after.json`) agree:
buyer 3,000,000 → 2,890,000; author 512,000 → 621,500; registry 5,004,002 →
5,004,502 (it kept its 500 fee).

Network fees, all real HBAR: purchase 1,481,541 tinybar (paid by the
facilitator's fee payer, not by carpool), settlement transfer 1,346,855 tinybar
and the HCS submit, together 1,668,321 tinybar from `0.0.10475802`; topic
creation 13,468,557 tinybar from the operator.

## The anchor, and why the two roots differ

`GET /batches` serves `root` `f25a8a34c9bc9ebc93ac7efa7b8f626231f838d5e0b233273f7d19e4a64eb0e5`
and the HCS message carries `aa11de68…`. They are **different trees on purpose**
and neither is wrong:

- the **batch** root is over that batch's payee leaves only — it is what
  `claimBatch` committed to and what the memo's short hash comes from;
- the **anchor** root is over the whole epoch: every not-yet-anchored artifact's
  manifest hash *plus* every batch's payee leaves. Here that is three leaves —

```
e38566220be6a9ddcbd11300bf3d16da6d41340a3dd7a6f94f16be3010b2bdf0   the manifest hash
0.0.10475801:109500                                                the royalty
0.0.10475802:500                                                   the tracker fee
```

— sorted, hashed, promoted odd, giving `aa11de68…`. `verify.py` re-derives it.

## The empty-epoch guard, on a live ledger

A second `POST /settle` was issued with nothing owed and nothing unanchored
(`18-settle-idle-epoch.json`): `{"batches":[],"anchor":{"anchored":false,"skipped":"empty"}}`,
and the topic still holds exactly one message. This is the fix for v1's incident
— a settler left running anchored an *empty* epoch every 600 seconds for over two
hours, paying real HBAR to assert that nothing had changed — verified against the
real network rather than a mock.

## What the run exposed

Nothing failed, and the registry's log for the whole run is one line
(`@carpool/registry on :8403`) — no warnings, no errors, no `owed_failure` rows,
no `batch_conflict` rows. Four things are worth writing down anyway:

1. **`AnchorResult` carries no transaction id and no consensus timestamp.** The
   HCS submit's receipt is fetched and discarded (`anchor.ts`), so the only way
   to name *when* the root was timestamped is to go to the mirror node — which
   is how the timestamp in this document was obtained. `CONTRACT.md` is already
   honest that there is no anchor route and no stored sequence number; this run
   is the first time the cost was paid in practice, and it is small but real: the
   registry cannot tell a reader where its own anchor is.
2. **`refund_state` in the database still reads `window` after the window
   closed**, while `/state` serves `closed`. That is exactly what `CONTRACT.md`
   documents (nothing flips the column; the `closed` half is derived on read) and
   it held on a live run — `19-ledger-rows.txt` beside `16-state-after-settle.json`
   is the pair that shows it.
3. **`payFetch` reports body length in UTF-16 code units, not bytes.** The
   purchase result says `3362 bytes` for a body whose `bodyBytes` is `3374`; it
   is `res.body.length` on a JS string containing multi-byte characters. The
   integrity check itself is unaffected — it hashes the bytes and matched
   exactly — so this is a cosmetic label on one tool's output, not a money bug.
   It is recorded here rather than fixed silently.
4. **The WAL trap in `docs/RUNBOOK.md` is real and reproduced.** At the end of
   the run `ledger.sqlite` was **4,096 bytes** with **1,924,072 bytes** in
   `ledger.sqlite-wal`. After `PRAGMA wal_checkpoint(TRUNCATE)` the main file was
   1,699,840 bytes and the WAL zero. A backup taken before that checkpoint would
   have archived an empty database.

## How it was run

A scratch ledger (`LEDGER_DB` and `ARTIFACT_STORE` under a session scratchpad,
never `data/`) and a scratch environment file outside the repository, so no key
was ever written to a tracked path. `EPOCH_SECONDS=86400`, so the epoch timer
could not fire unattended and every settlement was an explicit bounded
`POST /settle`. The registry was launched as `node --import tsx src/server.ts`
with its PID captured at launch and killed by that PID at the end — the v1
incident happened because a `pkill -f` pattern silently matched nothing.

`live-run-driver.ts` is the exact driver used for the publish and the purchase.
It calls `publishArtifact` and `payFetch` from `apps/mcp/src` unchanged — the
shipped client code, not a bespoke script — and it lived at
`apps/mcp/live-run.ts` for the duration of the run. **No production code was
changed for this run.**

## Files

| file | what it is |
|---|---|
| `verify.py` | the independent verifier described above |
| `01-publish.json` | `POST /publish` response: the magnet, `duplicateOf: null` |
| `02-manifest.json` | `GET /manifest/:magnet` — the free half, incl. `bodyHash`, `author`, `priceNow` |
| `03-search.json` | `GET /search?q=…` ranked through the real ONNX embedder (cosine 0.8097, score 0.7389) |
| `04-402-headers.txt`, `04-402-body.json` | the unpaid `402`, with the `PAYMENT-REQUIRED` header and the quote that was later replayed |
| `05-purchase.json` | the paid result: tx id, `paid`, and `verification: verified` against the manifest |
| `06-state-after-purchase.json` | `GET /state` with the purchase in its refund window |
| `07-payouts-before-settle.json` | royalty `held` until the refund deadline, fee `claimable` |
| `08-mirror-purchase-tx.json` | mirror node, purchase transfer, verbatim |
| `09-settle-response.json` | `POST /settle`: the batch, the anchor, the root |
| `10-mirror-settlement-tx.json` | mirror node, settlement transfer, verbatim |
| `11-mirror-hcs-messages.json` | mirror node, the topic's messages — one, base64 |
| `12-batches.json` | `GET /batches`: `SUCCESS`, tx id, batch root, memo |
| `13-payouts-after-settle.json` | both payouts `settled`, `settledBatchId: 1` |
| `14-payouts-author-scoped.json` | the author's own open view of being paid |
| `15-owed.json` | empty: no settled-but-unrecorded payment, no batch conflict |
| `16-state-after-settle.json` | `anchoredAt: 1789202496`, `refundState: closed` |
| `17-events.json` | `GET /events?since=0` |
| `18-settle-idle-epoch.json` | the second, idle epoch: `skipped: "empty"` |
| `19-ledger-rows.txt` | the `purchase`, `payout`, `batch`, `artifact`, `peer` rows |
| `20-mirror-topic.json` | mirror node, the topic entity |
| `21-mirror-balances-after.json` | mirror node, all four accounts after the run |
| `artifact-body.txt` | the paid body, so `sha256(body) == bodyHash` is checkable |
| `live-run-driver.ts` | the driver, for reproduction |
