#!/bin/bash
# Kill the registry by the PID captured at launch, never by pattern.
RUN="$(cd "$(dirname "$0")" && pwd)"
PID="$(cat "$RUN/logs/current.pid" 2>/dev/null || true)"
if [ -z "$PID" ]; then echo "no current.pid"; exit 0; fi
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  for i in $(seq 1 20); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
  if kill -0 "$PID" 2>/dev/null; then kill -9 "$PID"; echo "SIGKILL $PID"; else echo "stopped $PID"; fi
else
  echo "pid $PID already gone"
fi
rm -f "$RUN/logs/current.pid"
