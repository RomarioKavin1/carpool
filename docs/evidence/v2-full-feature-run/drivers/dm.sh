#!/bin/bash
# Run a driver from apps/mcp with the scratch environment loaded.
set -euo pipefail
RUN="$(cd "$(dirname "$0")" && pwd)"
REPO=/Users/romariokavin/Documents/RandomClaudeSessions/carpool
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null; cd "$REPO"; nvm use >/dev/null
set -a; . "$RUN/env.sh"; set +a
export OUT_DIR="$REPO/docs/evidence/v2-full-feature-run"
cd "$REPO/apps/mcp"
exec npx tsx "$@"
