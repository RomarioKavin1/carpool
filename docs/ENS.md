# ENS authors

An author can publish under an ENS name instead of an unreadable
`0.0.x:<66 hex characters>`. The name is more than a label: its records decide,
at the moment of each sale, which Hedera account the royalty goes to, and the
registry shows the name as the author only when the name and the signing key
vouch for each other.

The registry is **read-only** toward Ethereum: it holds no Ethereum key and writes
to no Ethereum chain. The name's owner sets records in the ENS App or their own
wallet. (For the live proof below, the name was registered and its records set by
a separate script with the owner's Sepolia wallet; no Ethereum key was ever given
to the registry.)

## What ENSv2 is today, and what that means for this build

Researched on 2026-09-13 from ENS's own documentation and blog.

- **ENSv2 is a new set of ENS contracts:** a hierarchy of registries (each name
  can have its own subregistry) instead of one flat registry, a per-account
  resolver with per-record permissions, Name Wrapper features folded into a role
  system, and a new Universal Resolver as the single entry point for resolution.
  "The resolver interface remains the same." ([ENSv2 overview][overview])
- **It is not on mainnet.** The ENS App and Explorer entered public beta on
  **Ethereum Sepolia on 2026-08-12**, described as "the last major public testing
  phase on the path to mainnet", with no mainnet date. ([ENS blog][beta]) The docs
  say the contracts "are not yet final and may change prior to mainnet deployment."
  ([overview][overview])
- **There is no Namechain.** ENS Labs cancelled the planned L2 in February 2026;
  ENSv2 will deploy on Ethereum mainnet. ([The Block][block])
- **For a read-only app, ENSv2 support is a library version.** viem ≥ 2.35.0,
  ethers ≥ 6.17.0, ENSjs ≥ 4.2.3; "If your application only reads ENS data, you're
  done!" Do not hardcode a Universal Resolver address. ([readiness][readiness],
  [app developers][appdev]) This repo resolves with **viem 2.56.3**, whose chain
  config points both mainnet and Sepolia at the canonical proxy
  `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`.
- **Sepolia v2 beta contracts** used by the probe below (and only by the probe):
  RootRegistry `0x8115186e8f2e0b0281e86ab91f0f48ba90364354`, ETHRegistry
  `0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2`. ([deployments][deployments])
- **Records:** text records per ENSIP-5 (global keys such as `description`, `url`,
  `avatar`, `keywords`, service keys such as `com.github`, and reverse-dot keys a
  service owns, such as `io.carpool.*`) ([ENSIP-5][ensip5]); multichain addresses
  per ENSIP-9, `addr(node, coinType)` with SLIP-44 coin types, each stored in the
  chain's native binary form ([ENSIP-9][ensip9]). Hedera is **coin type 3030**,
  and ENS's own `address-encoder` encodes an account as **20 bytes: shard u32,
  realm u64, number u64, big endian** ([hbar.ts][hbar]). This build copies its test
  vectors.

**So, plainly:** the registry defaults to **Sepolia**, where ENSv2 is live in beta,
and the live evidence below (a read of an existing name, then a name registered,
verified and paid through) went through the ENSv2 hierarchy there. The same code pointed at mainnet (`CARPOOL_ENS_CHAIN=mainnet`)
resolves **ENSv1** today, because that is what mainnet runs. Nothing here uses a
v2-only API; the v2-specific part is the network and the contracts the read
traverses. The registration in the evidence did use the v2 ETHRegistrar and
PermissionedResolver, from outside the registry.

## What was built

| where | what |
|---|---|
| `packages/carpool-core/src/ens.ts` | `EnsAuthor` (the identity `identity.ts` promised), the Hedera ENSIP-9 codec, `checkEnsBinding`, `resolveEnsPayout`, `signPayoutAttestation`. No network. |
| `apps/registry/src/ens.ts` | viem reader, ENSIP-15 normalisation at publish, `choosePayout` for `onPaid`, `identityView`. |
| `apps/registry/src/server.ts` | publish, delist and rate accept ENS authors; `onPaid` resolves the payee at purchase time. |
| `apps/registry/src/ens-routes.ts` | `GET /identity`, `GET /ens/:name`. |
| `purchase.payout_via` | how each sale's payee was chosen, pinned with it, served on `/state`. |
| `apps/mcp/src/publish.ts` | `CARPOOL_AUTHOR_ENS_NAME` publishes under a name. |
| `apps/dashboard/components/EnsAuthor.tsx` | the name, its verification in words, where the next sale pays, the checks and the profile, inside an opened artifact. |
| `pnpm --filter @carpool/registry ens:records` | prints the records an owner sets, signed offline. |
| `pnpm --filter @carpool/registry ens:check <name>` | the live probe. |

### The author string

```
ens:<name>:<fallbackAccountId>:<publicKeyHex>
```

All of it is inside the signed, content-addressed manifest. The signature is
checked against `publicKeyHex` with no network, so publish, delist and rate never
wait on Ethereum. `fallbackAccountId` is a Hedera account the author signed for.
The `ens:` prefix makes the old `"<accountId>:<publicKeyHex>"` parser fail closed
(it would read `ens` as the account and the rest as an invalid key), so an older
registry rejects the publish instead of paying an account called `ens`. Hedera
authors are unchanged.

## How verification works

Two directions, and both are needed.

1. **Key to name.** The manifest signature covers a string that contains the name.
   Only the private key holder can produce it.
2. **Name to key.** The name's `io.carpool.key` text record equals the signing key.
   Only whoever controls the name's records can set it.

That pair stops the obvious impersonation (publishing as `vitalik.eth` with your
own key) and it is what `GET /ens/:name` uses: it lists only artifacts claiming the
name **and** signed by the key the name names, and counts the rest as
`unverifiedClaims`.

It does not protect **money**, and this is the part a first design gets wrong. A
public key is public. Whoever gains control of a name's records (a sale, an expiry
and re-registration, which ENSv2's shorter 28-day grace period makes more likely,
or a resolver role grant under ENSv2's per-record permissions) can copy the key
into `io.carpool.key` and point the Hedera record at themselves. So a third record
is required before money follows the name:

3. **Payout attestation.** `io.carpool.payout-sig` is the author key's signature over
   `sha256("carpool:ens-payout:v1:<name>:<account>")`, where `account` is the
   name's current Hedera record. A new controller cannot sign a new account; an old
   attestation names the old account; an attestation for another name does not
   transfer.

`verified` means all three hold right now. `unbound` means the name answered and
something failed (each failure is named in `problems`). `unreachable` means the
name could not be read, which is reported apart from `unbound` because it is a fact
about the network, not the name.

### Payout at purchase time

In `onPaid`, after x402 settlement and immediately before the purchase row is
written:

- **verified:** the royalty pays the name's Hedera account; `payoutVia` is
  `ens:<name>`.
- **anything else:** the royalty pays the signed fallback; `payoutVia` is
  `ens-fallback:<name>`.

The asymmetry is deliberate. A false "verified" would send money to someone the
author never approved; a false fallback sends it to an account the author did
approve, just not their latest. Each case below is a test in
`apps/registry/src/ens-server.test.ts` or `packages/carpool-core/src/ens.test.ts`:

| case | result |
|---|---|
| owner rotates the Hedera record and attestation | next sale pays the new account; earlier sales keep theirs; nothing republished |
| records change between the 402 quote and settlement | the account current at settlement is paid |
| resolver down, or slower than `CARPOOL_ENS_TIMEOUT_MS` | fallback; the sale still records (no `owed_failure`), body served |
| no Hedera record, malformed record, key mismatch | fallback |
| controller copies the key, points the record at themselves | fallback |
| refund after a rotation | voids the royalty row that was pinned, not the name's current account |
| `onPaid` retried for a recorded `txId` | returns before any ENS read |
| `owed_failure` replay | fallback, `ens-fallback:<name>` (replay is synchronous) |
| Hedera author | unchanged, `payoutVia` null, zero ENS reads |

`splitSale`, the refund path, the settle lease and `classifyLedgerResult` are not
modified. The only change on the money path is which account string reaches
`recordPurchase`, and the new nullable column beside it.

## What a name owner sets

Run, with the author's Hedera ECDSA key:

```bash
CARPOOL_AUTHOR_PRIVATE_KEY=<hex> pnpm --filter @carpool/registry ens:records <name.eth> <payoutAccountId>
```

It prints exactly these, computed offline:

| record | key | value |
|---|---|---|
| address | coin type **3030** (HBAR) | the payout account, `shard.realm.num` (20 bytes on chain, as above) |
| text | `io.carpool.key` | raw compressed ECDSA public key, hex, 66 characters (`0x` optional) |
| text | `io.carpool.payout-sig` | hex signature over `sha256("carpool:ens-payout:v1:<name>:<account>")` |
| text, optional | `description`, `url`, `avatar`, `keywords`, `com.github` | shown as the author's profile; `keywords` is shown as topics |

Then publish with `CARPOOL_AUTHOR_ENS_NAME=<name.eth>` alongside the usual
`CARPOOL_AUTHOR_ACCOUNT_ID` (which becomes the fallback) and
`CARPOOL_AUTHOR_PRIVATE_KEY`. **To rotate the payout account**, re-run `ens:records`
with the new account and update the address record and `io.carpool.payout-sig`.

Registry configuration: `CARPOOL_ENS_CHAIN` (`sepolia` default, `mainnet`, `off`),
`CARPOOL_ENS_RPC_URL` (optional; viem's public endpoint otherwise),
`CARPOOL_ENS_TIMEOUT_MS` (default 3000).

## Proven live versus mocked

**Live, on Sepolia, read-only**, 2026-09-13, block 11,694,025:
[`docs/evidence/ensv2-sepolia-read/dustycarrrubens.eth.json`](evidence/ensv2-sepolia-read/dustycarrrubens.eth.json).
`dustycarrrubens.eth` is not ours; it was found by scanning `NameRegistered` events
emitted by the v2 ETHRegistry. With the registry's own `viemEnsReader`,
`readEnsProfile` and `checkEnsBinding`:

- `RootRegistry.getSubregistry("eth")` returned the ETHRegistry address the docs list;
- `ETHRegistry.getResolver("dustycarrrubens")` and viem's Universal Resolver call
  returned the **same per-name resolver**, `0x43Ea2ACE8745Bd3fA08DcdfE2f678Ee5D00a6a41`,
  so the read went through the ENSv2 hierarchy;
- ENSIP-5 `description` and `avatar` came back through that path;
- the binding check returned `unbound` for exactly the three missing Carpool
  records, which is what a live sale by such an author would pay: the fallback.

The same day, the real registry process (`tsx src/server.ts`,
`CARPOOL_ENS_CHAIN=sepolia`) answered `GET /identity` and `GET /ens/:name` for that
name over HTTP from live Sepolia:
[`identity-route.json`](evidence/ensv2-sepolia-read/identity-route.json) (unbound,
three problems, next sale pays the fallback, live `description`) and
[`ens-route.json`](evidence/ensv2-sepolia-read/ens-route.json) (no key record, so no
artifacts listed). The author string in the first is a throwaway key: it shows
what the registry would do, not a claim that the name's owner publishes here.

Reproduce: `CARPOOL_ENS_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com pnpm --filter @carpool/registry ens:check dustycarrrubens.eth`,
or `CARPOOL_ENS_LIVE=1` on `src/ens-live.test.ts` (skipped otherwise, so the suite
never needs the network).

**Live, a verified name and an ENS-paid sale**, 2026-09-13:
[`docs/evidence/ensv2-live-payout/`](evidence/ensv2-live-payout/README.md), re-checkable
with `node docs/evidence/ensv2-live-payout/verify.mjs` (standard library only, no
repository imports).

- `remotemppp.eth` was registered on the ENSv2 Sepolia beta through the documented
  ETHRegistrar (commit, 60 s minimum age, register paid in the beta's MockUSDC) with
  a per-account PermissionedResolver deployed through VerifiableFactory.
  `ETHRegistry.ownerOf` is the registering wallet.
- `ens:records` produced the three Carpool records for the author key of
  `0.0.10475801`; they and `description`, `keywords`, `url` were set in one resolver
  multicall on the resolver the name actually uses, read back through viem's
  Universal Resolver, and `checkEnsBinding` returned **verified**.
- A registry on this branch, run locally against real Blocky402 and Hedera testnet,
  sold one artifact published through the MCP path under that name. `onPaid`
  resolved the name at purchase time and pinned `payoutVia: "ens:remotemppp.eth"`.
  Settlement `0.0.10513939@1789304240.596100921` paid the 21,500 µUSDC royalty to
  `0.0.10475801`, `SUCCESS` on the mirror node, anchored on HCS topic `0.0.10523441`.
- The dashboard's ENS panel rendered the name as verified against that registry.

**Still only mocked:** rotation (the name's account changing between sales), a
takeover, resolver outage and timeout at purchase time, and every fallback case in
the table above. They run against an in-memory `EnsRecordReader` through the real
registry app, stub facilitator and real ledger.

## Known gaps

- **The live sale does not separate the name from the fallback by account.** The
  name's Hedera record and the manifest's signed fallback are both `0.0.10475801`, so
  the transfer alone looks the same either way; `payoutVia`, the registry's log line
  and the live binding check are what show the name was used. A live rotation to a
  different account has not been run.
- **One name, one sale, Sepolia beta.** Nothing on mainnet, where ENSv2 is not
  deployed.
- **Replay pays the fallback**, never the name, because `replayOwedFailures` is
  synchronous. Late, never misdirected.
- **Fallback is permanent per artifact.** An author who loses the fallback
  account's key relies on the name verifying at every sale.
- **The Hedera address record's account must hold the USDC association**, like any
  payee; if not, the transfer fails and the existing parking path applies.
- **The dashboard earnings view** finds an ENS author's payouts only by the Hedera
  account typed into its lookup; it does not group earnings under the name.
- **No reverse direction.** ENS primary names are keyed by EVM address, and Hedera
  accounts have none to reverse, so a Hedera author is not shown as a name.
- **The ENS App was not used.** Records were written by a direct resolver
  multicall; whether the App's Sepolia beta exposes an HBAR address field is still
  unchecked.
- **Namehash and normalisation** follow viem (ENSIP-15). A name with emoji or
  non-Latin labels was not tested live.
- **The Sepolia v2 beta contracts may change before mainnet.** The resolution code
  does not depend on their addresses; only the probe does.

[overview]: https://docs.ens.domains/ensv2/overview
[appdev]: https://docs.ens.domains/ensv2/tutorial-app-developers
[deployments]: https://docs.ens.domains/learn/deployments#sepolia-ensv2-beta
[readiness]: https://docs.ens.domains/web/ensv2-readiness
[beta]: https://ens.domains/blog/post/ensv2-beta-public-testing
[block]: https://www.theblock.co/post/388932/ens-labs-scraps-namechain-l2-shifts-ensv2-fully-ethereum-mainnet
[ensip5]: https://docs.ens.domains/ensip/5
[ensip9]: https://docs.ens.domains/ensip/9
[hbar]: https://github.com/ensdomains/address-encoder/blob/main/src/coin/hbar.ts
