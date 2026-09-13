# carpool-mcp

The MCP server for [Carpool](https://carpool-dashboard-plum.vercel.app): before your agent spends
dollars on deep research, it searches for research someone already did, and buys it for a fraction
of the cost over x402 on Hedera. Authors earn a royalty on every sale.

Four tools:

- `carpool_search(question)`: free. Call it before starting deep research.
- `carpool_fetch(magnet)`: pays, verifies the body against the manifest hash, writes it to a file.
- `carpool_publish(...)`: lists research you already did. Asks for approval every time.
- `carpool_delist(magnet)`: withdraws something you published from sale.

Requires Node 20.19 or newer.

## Install in Claude Code

Search only (no keys, nothing is paid):

```bash
claude mcp add carpool \
  -e CARPOOL_REGISTRY_URL=https://carpool-registry-production.up.railway.app \
  -- npx -y carpool-mcp
```

Buyer (a funded Hedera testnet ECDSA account holding test USDC):

```bash
claude mcp add carpool \
  -e CARPOOL_REGISTRY_URL=https://carpool-registry-production.up.railway.app \
  -e CARPOOL_BUYER_ACCOUNT_ID=0.0.xxxxx \
  -e CARPOOL_BUYER_PRIVATE_KEY=<testnet ECDSA key> \
  -- npx -y carpool-mcp
```

Author (royalties are paid to this account):

```bash
claude mcp add carpool \
  -e CARPOOL_REGISTRY_URL=https://carpool-registry-production.up.railway.app \
  -e CARPOOL_AUTHOR_ACCOUNT_ID=0.0.xxxxx \
  -e CARPOOL_AUTHOR_PRIVATE_KEY=<testnet ECDSA key> \
  -- npx -y carpool-mcp
```

## Associate your account with test USDC

An account must be associated with the USDC token before it can receive a royalty or faucet USDC.
The key is read from the environment only, never from arguments, and is never printed:

```bash
HEDERA_ACCOUNT_ID=0.0.xxxxx HEDERA_PRIVATE_KEY=<testnet ECDSA key> npx carpool-mcp associate
```

It checks the account on the mirror node first, and refuses ED25519 keys: the x402 Hedera signer
needs ECDSA. Create an ECDSA testnet account at portal.hedera.com.

## Consent hook for publishing

An MCP server cannot tell it is running inside a subagent, so the client enforces it. Add this
PreToolUse hook to your Claude Code settings. It denies subagents, non-prompting permission modes
and `CARPOOL_PUBLISH_MODE=off`, otherwise asks. It fails closed.

```json
"hooks": {
  "PreToolUse": [{
    "matcher": "mcp__carpool__carpool_publish",
    "hooks": [{ "type": "command", "command": "npx -y carpool-mcp consent-hook" }]
  }]
}
```

## Keys: a caution

Values passed with `claude mcp add -e` are stored in plaintext in Claude Code's configuration.
Use testnet-only keys that hold nothing you would mind losing.

## Privacy of searches

This package does not ship the optional local embedder (about 240 MB of ONNX). Searches therefore
send your question text to the registry, which can read and log it, and every search result says so.

## Other settings

- `CARPOOL_ARTIFACT_DIR`: where bought artifacts are written (default: a folder in your temp dir).
- `CARPOOL_MAX_MICRO_USDC`: per-payment spend cap in micro-USDC (default 500000, $0.50).
- `CARPOOL_AUTHOR_ENS_NAME`: publish under an ENS name.

## Links

- Live site: https://carpool-dashboard-plum.vercel.app
- Source, and the contributor setup: https://github.com/RomarioKavin1/carpool

MIT licensed.
