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
elif command -v slope >/dev/null 2>&1; then
  SLOPE_BIN="$(command -v slope)"
else
  exit 0
fi

cd "$SLOPE_PROJECT_DIR"
exec "$SLOPE_BIN" guard "$@"
