#!/usr/bin/env bash
# Proves a fresh clone builds: no stale dist/, no committed tsbuildinfo, no local .env.
# Usage: scripts/verify-clean-clone.sh [git-ref]
set -euo pipefail

REF="${1:-HEAD}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> cloning $REF into $TMP"
git clone --quiet --no-local "$REPO_ROOT" "$TMP/carpool"
git -C "$TMP/carpool" checkout --quiet "$REF"
cd "$TMP/carpool"

if git ls-files | grep -Eq 'tsbuildinfo|\.sqlite'; then
  echo "FAIL: build artifacts or databases are tracked in git" >&2
  git ls-files | grep -E 'tsbuildinfo|\.sqlite' >&2
  exit 1
fi

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
  nvm use >/dev/null
fi
echo "==> node $(node -v), pnpm $(pnpm -v)"

pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test

echo "==> clean clone OK"
