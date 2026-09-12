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
- The first payout to a brand-new author costs about 50 times more HBAR than later ones, because creating the token association is billed to the payer. At about $0.20 per HBAR that's roughly $0.13 to deliver a $0.0025 payout.
- An early server left running anchored empty batches to HCS every ten minutes for two hours. Empty epochs are skipped now.
- We ran a kill test before building search. It suggested people answer the same question at different depths, so ranking weighs how thorough an answer is, not only how similar it is.

The dashboard is Next.js and Tailwind, with a hand-drawn SVG explainer, deployed on Vercel.
