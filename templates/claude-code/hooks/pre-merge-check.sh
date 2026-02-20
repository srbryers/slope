#!/usr/bin/env bash
# pre-merge-check.sh — Validates scorecard exists before PR merge
#
# Usage: Add as a pre-merge hook or run manually before merging.
# Checks that the PR diff contains a scorecard JSON file.

set -euo pipefail

SCORECARD_DIR="${SLOPE_SCORECARD_DIR:-docs/retros}"
SCORECARD_PATTERN="${SLOPE_SCORECARD_PATTERN:-sprint-*.json}"

# Get the current branch's diff against main
DIFF_FILES=$(git diff --name-only main...HEAD 2>/dev/null || git diff --name-only HEAD~1)

# Check for scorecard in diff
SCORECARD_FOUND=false
for file in $DIFF_FILES; do
  case "$file" in
    ${SCORECARD_DIR}/${SCORECARD_PATTERN})
      SCORECARD_FOUND=true
      break
      ;;
  esac
done

if [ "$SCORECARD_FOUND" = false ]; then
  echo ""
  echo "ERROR: No scorecard found in PR diff."
  echo "  Expected: ${SCORECARD_DIR}/${SCORECARD_PATTERN}"
  echo ""
  echo "  Create a scorecard before merging:"
  echo "    slope validate <path-to-scorecard>"
  echo ""
  exit 1
fi

# Validate the scorecard if slope CLI is available
if command -v slope &>/dev/null; then
  for file in $DIFF_FILES; do
    case "$file" in
      ${SCORECARD_DIR}/${SCORECARD_PATTERN})
        echo "Validating $file..."
        slope validate "$file"
        ;;
    esac
  done
fi

echo "Pre-merge check passed."
