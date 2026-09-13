# ETHGlobal submission form

Copy each block into the matching field.

## If you have a demonstration, link to it here!

https://carpool-dashboard-plum.vercel.app

## Short description

AI agents buy research someone already did instead of redoing it. The author gets paid in USDC.

## Description

Carpool is a registry where AI agents buy and sell finished research.

Before an agent spends twenty minutes and a few dollars of tokens on a question, it searches Carpool. If someone has already answered it, the agent pays a small USDC fee over x402, gets the document, and skips the work. Whoever wrote it earns a royalty on every sale.

Each piece of research is addressed by a hash of its contents, so it can't be swapped after it's listed. Search matches on meaning, and ranks answers higher when they're fresher and more thorough. Prices fall as research ages. The author picks a half-life, the price halves on that schedule, and after three halvings the registry stops selling it, because a stale answer sold as current does more harm than having none.

Buyers have a two-minute refund window. The registry holds each payment for that window, then pays authors in batches with HTS transfers and posts a Merkle root of every batch to an HCS topic, so payouts can be audited.

Agents use it through an MCP server with four tools: search, fetch, publish and delist. It installs into Claude Code. Search is free and needs no account. Publishing always asks the user first, and it removes secrets and local file paths before anything is listed. Buyers can rate a purchase as worth it or not, one rating per purchase, signed by the key that paid.

Authors can also publish under their own ENS name. The name's records hold their Hedera payout account and signing key, and each sale looks up where to pay at the moment it happens, so an author can move payouts to a new account without republishing anything.

We measured one real case. Redoing an ETHOnline prize analysis cost at least $3.97 in tokens; buying the same document cost $0.44. We also ran every payment path on Hedera testnet: refunds, a 13-author payout split across two transactions, recovering a batch whose receipt was lost, and two settlement processes hitting the same batch at once, which still produced a single transfer.

## How it's made

TypeScript monorepo (pnpm and turbo) on Node 20, split into a payment package, a core model, a search package, the registry, the MCP server and a Next.js dashboard.

Payments: the paywall is built on @x402/core and @x402/hedera, and payments are verified and settled by the Blocky402 facilitator on testnet. Buyers pay the registry's account rather than the author's. That was a deliberate choice, since otherwise a refund would have nothing to pull back.

Hedera: settlement uses @hiero-ledger/sdk. Payouts go out as HTS token transfers with at most 9 authors per transaction, because a transfer list caps at 10 entries. Each batch's Merkle root is posted to an HCS topic. The mirror node is used to recover lost transactions by their memo, and a Python script re-checks 60 of our on-chain claims against it without importing any of our code. Money is Circle's testnet USDC.

Registry: Express with SQLite through better-sqlite3, sqlite-vec for the vector index, and MiniLM embeddings running locally through transformers.js. A lease row in SQLite stops two processes from settling the same batch twice. We found that bug in a simulation, where it paid one author twice, and then confirmed the fix on testnet.

MCP server: built on the official SDK. A Claude Code PreToolUse hook blocks publishing unless a person confirms it.

ENS: an author can publish as `name.eth` on the ENSv2 beta on Sepolia. Reads go through viem's Universal Resolver. The registry trusts the name only when three records agree (Hedera address, coin type 3030; the signing key; and a signature from that key over the name and account), then reads the payout account at purchase time and records how it paid. If ENS is slow or the records don't match, the sale still goes through and pays the backup account the author signed into the listing.

Things we ran into:
- Circle's faucet quietly refuses any account that hasn't associated the token yet, and automatic association doesn't count.
- The first payout to a brand-new author costs about 50 times more HBAR than later ones, because creating the token association is billed to the payer. That's about $0.05, set in USD by Hedera, to deliver a $0.0025 payout.
- An early server left running anchored empty batches to HCS every ten minutes for two hours. Empty epochs are skipped now.
- We ran a kill test before building search. It suggested people answer the same question at different depths, so ranking weighs how thorough an answer is, not only how similar it is.

The dashboard is Next.js and Tailwind with a hand-drawn SVG explainer, hosted on Vercel. The registry runs as a Docker container on Railway with a persistent volume.

---

# Hedera prize: AI & Agentic Payments

## Why are you eligible for this prize?

The track asks for a live x402-gated service on Hedera and something that pays it with real requests. Carpool has both parts.

The service is a research registry at https://carpool-registry-production.up.railway.app. `GET /artifact/:magnet` returns 402 with a USDC price. The paid retry is verified and settled by the Blocky402 facilitator on Hedera testnet, in testnet USDC (`0.0.429274`).

The client is an MCP server that agents add to Claude Code. It pays using `@x402/fetch` with the `@x402/hedera` signer, checks the file it receives against the hash in the listing, and saves it.

After the refund window closes, the registry pays the author with an HTS transfer and posts a Merkle root of the batch to an HCS topic.

A purchase on the deployed registry, 13 Sep 2026:
- buyer pays 4,278 µUSDC: [0.0.7162784@1789276127.843209072](https://hashscan.io/testnet/transaction/0.0.7162784@1789276127.843209072)
- author receives 3,778 µUSDC, the registry keeps its 500 fee: [0.0.10513939@1789276261.161325440](https://hashscan.io/testnet/transaction/0.0.10513939@1789276261.161325440)
- batch anchored: [topic 0.0.10518035](https://hashscan.io/testnet/topic/0.0.10518035), sequence 1

Earlier testnet runs on 12 Sep covered 28 paid purchases, a refund, a 13-author payout split into two transactions, and a batch recovered from the mirror node after its receipt was lost. `docs/evidence/v2-full-feature-run/verify.py` re-checks 60 of those results against the mirror node.

This is testnet only, at low volume, with a single registry.

## Link to the code

- x402 paywall, facilitator verify and settle: [packages/hedera-x402/src/gate.ts#L230-L235](https://github.com/RomarioKavin1/carpool/blob/7da845aea3098b38a20da4587d996081162bcefa/packages/hedera-x402/src/gate.ts#L230-L235)
- paid route using the gate: [apps/registry/src/server.ts#L352-L353](https://github.com/RomarioKavin1/carpool/blob/7da845aea3098b38a20da4587d996081162bcefa/apps/registry/src/server.ts#L352-L353)
- buyer side, x402 client with the Hedera signer: [apps/mcp/src/pay.ts#L6-L8](https://github.com/RomarioKavin1/carpool/blob/7da845aea3098b38a20da4587d996081162bcefa/apps/mcp/src/pay.ts#L6-L8)
- HTS payout transfer: [packages/hedera-x402/src/settler.ts#L543-L545](https://github.com/RomarioKavin1/carpool/blob/7da845aea3098b38a20da4587d996081162bcefa/packages/hedera-x402/src/settler.ts#L543-L545)
- 9-payee cap (10-entry transfer list): [packages/hedera-x402/src/settler.ts#L5](https://github.com/RomarioKavin1/carpool/blob/7da845aea3098b38a20da4587d996081162bcefa/packages/hedera-x402/src/settler.ts#L5)
- which result codes mean no money moved: [packages/hedera-x402/src/settler.ts#L250](https://github.com/RomarioKavin1/carpool/blob/7da845aea3098b38a20da4587d996081162bcefa/packages/hedera-x402/src/settler.ts#L250)
- mirror node lookup for lost transactions: [packages/hedera-x402/src/settler.ts#L644](https://github.com/RomarioKavin1/carpool/blob/7da845aea3098b38a20da4587d996081162bcefa/packages/hedera-x402/src/settler.ts#L644)
- HCS anchor: [packages/hedera-x402/src/anchor.ts#L67](https://github.com/RomarioKavin1/carpool/blob/7da845aea3098b38a20da4587d996081162bcefa/packages/hedera-x402/src/anchor.ts#L67)
- on-chain evidence and verifier: [docs/evidence/v2-full-feature-run](https://github.com/RomarioKavin1/carpool/blob/7da845aea3098b38a20da4587d996081162bcefa/docs/evidence/v2-full-feature-run)

## Additional feedback

Things that cost us time, roughly in order of how long:

1. Circle's testnet faucet silently refuses accounts that haven't associated the token. Setting `maxAutomaticTokenAssociations` to -1 doesn't help, and there's no error message.
2. The first HTS transfer to an account that isn't associated yet charges the payer for the association (HIP-904). For us that was 0.674 ℏ per new author against 0.0134 ℏ for later payouts, about $0.05 to deliver a $0.0025 royalty. Makes sense once you know, but it's easy to miss when building payouts. A note next to the fee schedule would help.
3. An ED25519 key fails inside the x402 Hedera signer, which expects ECDSA, and the error looks like a facilitator problem.
4. Transaction IDs come in two formats, `0.0.x@s.n` from the SDK and `0.0.x-s-n` from the mirror node. We ended up storing both by accident.
5. The mirror node lagged about 4 seconds in our runs, so checking for a transaction right after submitting it came back empty.
6. The result code list doesn't say which failures are guaranteed to have moved no value. We had to decide that code by code before we could safely retry a failed payout.

What worked well: fees were small and predictable ($0.001 for a payout transfer), HCS worked on the first try, and Blocky402 settled every payment we sent it.

---

# ENS prize: Best Use of ENSv2

## Why are you eligible for this prize?

Carpool uses ENSv2 names as author identity for research sold on Hedera. It runs on the ENSv2 beta on Sepolia and is not hard-coded: any name whose owner sets three records works.

An author publishes as `name.eth`. The name holds:
- the Hedera account to pay, as a multichain address record (coin type 3030)
- `io.carpool.key`, the public key that signs the author's research
- `io.carpool.payout-sig`, that key's signature over the name and the account

The registry treats the name as verified only when all three agree. The signature is the part that matters: a public key is public, so someone who took over a name could copy it and point the address at themselves, but they can't sign for their own account.

The payout account is read from ENS when each sale happens and stored with the purchase, so an author can switch accounts by editing two records without republishing. A slow resolver or mismatched records never blocks a sale; it pays the backup account the author signed into the listing. `description`, `url`, `keywords` and `com.github` show as the author's profile.

Live proof, 13 Sep 2026:
- `remotemppp.eth` registered through the ENSv2 ETHRegistrar with a PermissionedResolver: [register tx](https://sepolia.etherscan.io/tx/0xb0bc488205203fd59503ec1cb2f3d5e0fcee2476928d6393660b7f3d524273a0)
- records set in one transaction: [records tx](https://sepolia.etherscan.io/tx/0xb16dc2219280b7c3cc0f8740e6312477e6ac105ce3909b26ae60cfc0fad7a645)
- a real Carpool sale then paid 21,500 µUSDC to the name's Hedera account, recorded as `payoutVia: "ens:remotemppp.eth"`: [0.0.10513939@1789304240.596100921](https://hashscan.io/testnet/transaction/0.0.10513939@1789304240.596100921)
- `docs/evidence/ensv2-live-payout/verify.mjs` re-checks the Sepolia records and the Hedera payout live, with no code from the repo

What we did not use: subregistries, record or namespace aliasing, and the role-based access control. The payout account in this demo is also the author's backup account, so the Hedera transfer on its own can't show which path paid; the recorded `payoutVia` and the registry log do.

## Link to the code

- ENS author, Hedera address encoding, three-record check: [packages/carpool-core/src/ens.ts#L240](https://github.com/RomarioKavin1/carpool/blob/5edaf489b728647281145ad60097a87b09535506/packages/carpool-core/src/ens.ts#L240)
- payout decision with fallback: [packages/carpool-core/src/ens.ts#L346](https://github.com/RomarioKavin1/carpool/blob/5edaf489b728647281145ad60097a87b09535506/packages/carpool-core/src/ens.ts#L346)
- Universal Resolver reads via viem: [apps/registry/src/ens.ts#L61](https://github.com/RomarioKavin1/carpool/blob/5edaf489b728647281145ad60097a87b09535506/apps/registry/src/ens.ts#L61)
- payout chosen at purchase time: [apps/registry/src/server.ts#L332](https://github.com/RomarioKavin1/carpool/blob/5edaf489b728647281145ad60097a87b09535506/apps/registry/src/server.ts#L332)
- publishing under a name from the MCP server: [apps/mcp/src/publish.ts#L66](https://github.com/RomarioKavin1/carpool/blob/5edaf489b728647281145ad60097a87b09535506/apps/mcp/src/publish.ts#L66)
- identity routes, `/identity` and `/ens/:name`: [apps/registry/src/ens-routes.ts#L11](https://github.com/RomarioKavin1/carpool/blob/5edaf489b728647281145ad60097a87b09535506/apps/registry/src/ens-routes.ts#L11)
- design notes and sources: [docs/ENS.md](https://github.com/RomarioKavin1/carpool/blob/5edaf489b728647281145ad60097a87b09535506/docs/ENS.md)
- live evidence and verifier: [docs/evidence/ensv2-live-payout](https://github.com/RomarioKavin1/carpool/tree/5edaf489b728647281145ad60097a87b09535506/docs/evidence/ensv2-live-payout)

## Additional feedback

1. Finding a name's resolver on the Sepolia beta: viem's Universal Resolver and the v2 registry agreed, which was reassuring, but it took reading contract events to confirm that reads really went through v2 and not v1.
2. We couldn't tell whether the beta ENS App lets you set a non-EVM address such as Hedera (coin type 3030), so we set records with a direct contract call.
3. Right after the register receipt, one `ownerOf` read returned the zero address; a few seconds later it returned the owner. A note on read-after-write timing would help.
4. The beta charges in MockUSDC that you mint yourself. That's easy once you know, but it isn't obvious from the app.
5. What worked well: the resolver interface is unchanged from v1, so existing viem code resolved v2 names with no changes, and ENSIP-9 plus the address-encoder test vectors made the Hedera encoding straightforward to get right.
