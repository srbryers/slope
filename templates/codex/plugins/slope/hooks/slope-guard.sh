#!/usr/bin/env bash
# SLOPE Codex plugin dispatcher.
# Metadata bundle only until Codex plugin_hooks becomes reliable.

set -euo pipefail

SLOPE_PROJECT_DIR="${CODEX_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

if [ ! -d "$SLOPE_PROJECT_DIR/.slope" ]; then
  exit 0
fi

if [ -x "$SLOPE_PROJECT_DIR/node_modules/.bin/slope" ]; then
  SLOPE_BIN="$SLOPE_PROJECT_DIR/node_modules/.bin/slope"
elif [ -f "$SLOPE_PROJECT_DIR/dist/cli/index.js" ] && [ -f "$SLOPE_PROJECT_DIR/package.json" ] && grep -q '"name": "@slope-dev/slope"' "$SLOPE_PROJECT_DIR/package.json"; then
  exec node "$SLOPE_PROJECT_DIR/dist/cli/index.js" guard "$@"
elif command -v slope >/dev/null 2>&1; then
  SLOPE_BIN="$(command -v slope)"
else
  SLOPE_BIN="npx --yes @slope-dev/slope"
fi

cd "$SLOPE_PROJECT_DIR"
exec "$SLOPE_BIN" guard "$@"
