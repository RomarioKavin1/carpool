# x402 + Hedera — pinned integration facts (verified 2026-09-09)

Source of truth for all Hedera/x402 code. Facts verified by cloning `hedera-dev/x402-inference-pay-per-request-poc`, extracting npm tarballs, hitting live endpoints, and reading Hiero consensus-node source.

## Package versions (use these exact deps)
```
@x402/core     ^2.25.0
@x402/express  ^2.25.0
@x402/fetch    ^2.25.0
@x402/hedera   ^2.25.0
@hiero-ledger/sdk ^2.88.0
```
NOT the old unscoped `x402`/`x402-express`/`x402-fetch` (EVM/Solana only, no Hedera). NOT `@hashgraph/sdk` (use `@hiero-ledger/sdk`).

## Server side (provider middleware)
```ts
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import { ExactHederaScheme } from '@x402/hedera/exact/server';   // SERVER subpath
import { paymentMiddleware } from '@x402/express';

const facilitatorClient = new HTTPFacilitatorClient({ url: process.env.FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient)
  .register('hedera:*', new ExactHederaScheme({}));   // server config obj

app.use(paymentMiddleware({
  'GET /v1/pool.apy': {
    accepts: [{
      scheme: 'exact',
      network: 'hedera:testnet',
      payTo: (ctx) => resolvePayTo(ctx),          // DYNAMIC payTo — fn(HTTPRequestContext)
      price: async (ctx) => ({ asset: '0.0.429274', amount: computeUnits(ctx) }),  // DYNAMIC price
    }],
    description: '...', mimeType: 'application/json',
  },
}, resourceServer));
```
- `price` may be a Money string `'$0.001'` (USDC-denominated) OR AssetAmount `{ asset, amount }` (raw µUSDC string).
- `payTo` and `price` accept **functions** `(ctx: HTTPRequestContext) => value | Promise<value>`. `ctx.adapter.getQueryParam(name)` / `ctx.adapter.getBody()` read the request. This is how we do pioneer-vs-rider dynamic pricing.
- Lower-level (if needed): `new HTTPFacilitatorClient({url})` has `.verify()`, `.settle()`, `.getSupported()`; wire into `new x402ResourceServer(fc).register(network, scheme)`.

## Client side (fleet agent)
```ts
import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { ExactHederaScheme } from '@x402/hedera/exact/client';   // CLIENT subpath (different class, same name!)
import { createClientHederaSigner } from '@x402/hedera';
import { PrivateKey } from '@hiero-ledger/sdk';

const signer = createClientHederaSigner(accountId, PrivateKey.fromStringECDSA(pkHex), { network: 'hedera:testnet' });
const client = new x402Client().register('hedera:testnet', new ExactHederaScheme(signer));
const fetchWithPay = wrapFetchWithPayment(fetch, client);   // optional 3rd arg: { maxAmount }
const res = await fetchWithPay(url, { headers: {...} });
```
IMPORTANT: `ExactHederaScheme` has TWO exports w/ same name — `/exact/client` (takes signer) vs `/exact/server` (takes config). Import the right subpath.
Payment payload = partially-signed base64 `TransferTransaction`; facilitator co-signs as fee payer and submits → agents hold only USDC, no HBAR.

## Hedera SDK (`@hiero-ledger/sdk`)
- `Client.forTestnet().setOperator(operatorId, operatorKey)`
- `AccountCreateTransaction().setKeyWithoutAlias(pub).setInitialBalance(new Hbar(n)).setMaxAutomaticTokenAssociations(-1)` — auto-assoc so USDC transfers don't need explicit TokenAssociate.
- `TransferTransaction().addTokenTransfer(tokenId, accountId, amount)` — amount: number|Long|bigint. Debit = negative amount to carpool acct, credits = positive to payees.
- `TopicCreateTransaction()`, `TopicMessageSubmitTransaction().setTopicId(id).setMessage(json)`
- `TokenAssociateTransaction` (only for portal accounts that lack auto-assoc)
- `PrivateKey.fromStringECDSA(hex)`, `PrivateKey.generateECDSA()`
- **Transfer-list limit: max 10 token-transfer entries per tx** (Hiero consensus-node `ledger.tokenTransfers.maxLen=10`). So batch = 1 debit + **≤9 payees** → `MAX_PAYEES=9`. Also `ledger.xferBalanceChanges.maxLen=20` total. Verify on first live batch.

## Blocky402 facilitator (live 2026-09-09)
`GET https://api.testnet.blocky402.com/supported` returns `hedera:testnet` with `extra.feePayer: 0.0.7162784`. Endpoints: `GET /supported`, `POST /verify`, `POST /settle` (both expect `{paymentPayload, paymentRequirements}`). No API key. Fallback facilitator: `https://x402.org/facilitator` (also supports hedera:testnet, feePayer 0.0.9185802).

## Testnet USDC: token `0.0.429274`, 6 decimals, symbol USDC (mirror node confirmed). Circle faucet: https://faucet.circle.com (Hedera Testnet, 20 USDC / addr / 2h).

## Upstream shapes (live 2026-09-09)
- `GET https://yields.llama.fi/pools` → `{status,data:[{pool:"<uuid>", apy, apyBase, chain, project, symbol, tvlUsd, ...}]}`. Pool id field = `pool`, apy field = `apy`.
- `GET https://coins.llama.fi/prices/historical/{ts}/{coin}` → `{coins:{"<coin>":{price, symbol, decimals, timestamp, confidence}}}`. coin e.g. `ethereum:0x0000000000000000000000000000000000000000` or `coingecko:ethereum`.
- `GET https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd` → `{"ethereum":{"usd":2461.36}}`. Keyless, ~30/min.
- `GET https://sourcify.dev/server/v2/contract/{chainId}/{address}` (address must be full 42-char) → `{match:"match"|"exact_match", creationMatch, runtimeMatch, verifiedAt, matchId, chainId, address}`. 404 if unverified.

## Account bootstrap
Fully programmatic given a funded operator (AccountCreateTransaction). The ONLY manual step is creating the first operator account at https://portal.hedera.com (ECDSA testnet, auto-refilled to 1000 tHBAR) — this is the user's testnet identity. Everything else (fleet accounts, provider, carpool) can be script-created from the operator, or also made in the portal.

---

## Facilitator strict equality on the paid retry (verified)

`@x402/hedera/dist/esm/exact/facilitator/index.mjs` requires, at verify time:

```js
payload.accepted.amount === requirements.amount
payload.accepted.payTo  === requirements.payTo
```

Strict equality, both fields. The client signs over `accepted`, so the server
must verify against **the requirements it actually issued in the 402**, not
against a freshly computed quote.

This matters for Carpool specifically because the price is a function of `n`,
the number of consumers on the lineage so far. If `n` advances between the 402
and the paid retry — another agent opened or joined the lineage in between —
then a re-quote produces a different `amount`, verification fails on mismatch,
and the caller receives a second 402. `wrapFetchWithPayment` does not loop, so
the agent's request simply errors.

`quoteExpires` is already emitted in the `X-Carpool-Quote` header but is not
enforced anywhere. The fix (PLAN.md Phase 2.2) is to store issued quotes for
30 s and verify against the stored one, with a grace window for riders.
