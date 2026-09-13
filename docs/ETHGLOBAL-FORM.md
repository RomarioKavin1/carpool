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

We measured one real case. Redoing an ETHOnline prize analysis cost at least $3.97 in tokens; buying the same document cost $0.44. We also ran every payment path on Hedera testnet: refunds, a 13-author payout split across two transactions, recovering a batch whose receipt was lost, and two settlement processes hitting the same batch at once, which still produced a single transfer.

## How it's made

TypeScript monorepo (pnpm and turbo) on Node 20, split into a payment package, a core model, a search package, the registry, the MCP server and a Next.js dashboard.

Payments: the paywall is built on @x402/core and @x402/hedera, and payments are verified and settled by the Blocky402 facilitator on testnet. Buyers pay the registry's account rather than the author's. That was a deliberate choice, since otherwise a refund would have nothing to pull back.

Hedera: settlement uses @hiero-ledger/sdk. Payouts go out as HTS token transfers with at most 9 authors per transaction, because a transfer list caps at 10 entries. Each batch's Merkle root is posted to an HCS topic. The mirror node is used to recover lost transactions by their memo, and a Python script re-checks 60 of our on-chain claims against it without importing any of our code. Money is Circle's testnet USDC.

Registry: Express with SQLite through better-sqlite3, sqlite-vec for the vector index, and MiniLM embeddings running locally through transformers.js. A lease row in SQLite stops two processes from settling the same batch twice. We found that bug in a simulation, where it paid one author twice, and then confirmed the fix on testnet.

MCP server: built on the official SDK. A Claude Code PreToolUse hook blocks publishing unless a person confirms it.

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
