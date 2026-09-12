#!/bin/bash
# Foreground registry server, started via Bash(run_in_background) so the harness
# owns the process. Writes its own PID (which IS the node process, via exec) to
# logs/current.pid — killing is by that PID and never by pattern.
set -euo pipefail
RUN="$(cd "$(dirname "$0")" && pwd)"
REPO=/Users/romariokavin/Documents/RandomClaudeSessions/carpool
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null; cd "$REPO"; nvm use >/dev/null
set -a; . "$RUN/env.sh"; set +a
LABEL="${1:-server}"
cd "$REPO/apps/registry"
echo "$$" >"$RUN/logs/current.pid"
echo "$$" >>"$RUN/logs/pids.txt"
exec node --import tsx src/server.ts >>"$RUN/logs/$LABEL.log" 2>&1
