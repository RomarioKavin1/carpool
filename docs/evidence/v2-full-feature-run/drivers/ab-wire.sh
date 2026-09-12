#!/bin/bash
# Re-measure the A/B buy side against the LIVE registry on :8403, the real
# Blocky402 facilitator and real Hedera testnet. Pass "write" to rewrite
# apps/bench/src/ab-measured.json and the generated figure block.
set -euo pipefail
RUN="$(cd "$(dirname "$0")" && pwd)"
REPO=/Users/romariokavin/Documents/RandomClaudeSessions/carpool
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null; cd "$REPO"; nvm use >/dev/null
set -a; . "$RUN/env.sh"; set +a

AUTHOR_ID=$(python3 -c "import json;print(json.load(open('$RUN/accounts.json'))['author12']['id'])")
AUTHOR_KEY=$(python3 -c "import json;print(json.load(open('$RUN/accounts.json'))['author12']['key'])")

export CARPOOL_AB_LIVE_REGISTRY=http://127.0.0.1:8403
export CARPOOL_AB_ARTIFACT=/Users/romariokavin/Documents/RandomClaudeSessions/ethonline2026/ETHOnline-2026-research.md
export CARPOOL_AB_STRICT=1
export CARPOOL_AB_OUT="$REPO/docs/evidence/v2-full-feature-run/72-ab-wire-report.txt"
export CARPOOL_AB_STATUS="$RUN/ab-status.json"
export CARPOOL_AUTHOR_ACCOUNT_ID="$AUTHOR_ID"
export CARPOOL_AUTHOR_PRIVATE_KEY="$AUTHOR_KEY"
export CARPOOL_MAX_MICRO_USDC=5000000
if [ "${1:-}" = "write" ]; then export CARPOOL_AB_WRITE=1; fi
exec pnpm --filter @carpool/bench ab:run
