#!/bin/bash
# slope-loop/continuous.sh — Run sprints in a loop, regenerating backlog when exhausted
# Usage: ./slope-loop/continuous.sh [--max=N] [--dry-run]
# Default safety limit: 10 sprints

set -euo pipefail

SLOPE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNNER="$SLOPE_DIR/slope-loop/run.sh"
BACKLOG="$SLOPE_DIR/slope-loop/backlog.json"
ANALYZE="$SLOPE_DIR/slope-loop/analyze-scorecards.ts"
RESULTS_DIR="$SLOPE_DIR/slope-loop/results"
LOG_DIR="$SLOPE_DIR/slope-loop/logs"

MAX_SPRINTS=10
DRY_RUN=""
PAUSE_BETWEEN=30  # seconds between sprints

for arg in "$@"; do
  case "$arg" in
    --max=*) MAX_SPRINTS="${arg#--max=}" ;;
    --dry-run) DRY_RUN="--dry-run" ;;
    --pause=*) PAUSE_BETWEEN="${arg#--pause=}" ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

mkdir -p "$RESULTS_DIR" "$LOG_DIR"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_DIR/continuous.log"; }

# ─── Count completed sprints from results ────────
# @description Count the number of completed sprints by checking result files
# @returns Number of .json files in the results directory
count_completed() {
  if [ -d "$RESULTS_DIR" ]; then
    find "$RESULTS_DIR" -name '*.json' -type f | wc -l | tr -d ' '
  else
    echo 0
  fi
}

# ─── Get remaining sprint IDs from backlog ───────
# @description Extract sprint IDs from backlog that don't have result files yet
# @returns Newline-separated list of unprocessed sprint IDs
remaining_sprints() {
  if [ ! -f "$BACKLOG" ]; then
    echo ""
    return
  fi
  local all_ids
  all_ids=$(jq -r '.sprints[].id' "$BACKLOG" 2>/dev/null)
  for sid in $all_ids; do
    if [ ! -f "$RESULTS_DIR/${sid}.json" ]; then
      echo "$sid"
    fi
  done
}

# ─── Regenerate backlog from fresh analysis ──────
# @description Rebuild the sprint backlog by analyzing existing scorecards
# @returns 0 on success, 1 if backlog.json was not created
regenerate_backlog() {
  log "Regenerating backlog from scorecard analysis..."
  cd "$SLOPE_DIR"
  pnpm build 2>&1 | tail -3
  npx tsx "$ANALYZE" 2>&1 | tee -a "$LOG_DIR/continuous.log"
  if [ ! -f "$BACKLOG" ]; then
    log "ERROR: Backlog regeneration failed — no backlog.json produced"
    return 1
  fi
  local count
  count=$(jq '.sprints | length' "$BACKLOG" 2>/dev/null || echo 0)
  log "Backlog regenerated: $count sprints available"
}

# ─── Main loop ───────────────────────────────────
log "=== Continuous Loop Starting ==="
log "Max sprints: $MAX_SPRINTS"
log "Pause between sprints: ${PAUSE_BETWEEN}s"
[ -n "$DRY_RUN" ] && log "DRY RUN mode"

completed=0
failures=0  # Track consecutive failures
start_count=$(count_completed)

while [ "$completed" -lt "$MAX_SPRINTS" ]; do
  # Check remaining sprints in current backlog
  remaining=$(remaining_sprints)

  if [ -z "$remaining" ]; then
    log "Backlog exhausted — regenerating..."
    if ! regenerate_backlog; then
      log "Backlog regeneration failed. Stopping."
      break
    fi
    remaining=$(remaining_sprints)
    if [ -z "$remaining" ]; then
      log "No sprints in regenerated backlog. Nothing to do."
      break
    fi
  fi

  # Pick next sprint
  next_sprint=$(echo "$remaining" | head -1)
  log "── Sprint $((completed + 1))/$MAX_SPRINTS: $next_sprint ──"

  # Run the sprint
  if "$RUNNER" "$next_sprint" $DRY_RUN 2>&1 | tee -a "$LOG_DIR/continuous.log"; then
    log "Sprint $next_sprint completed successfully"
    completed=$((completed + 1))
    failures=0  # Reset consecutive failure counter on success
  else
    log "Sprint $next_sprint failed (exit $?)"
    failures=$((failures + 1))
    completed=$((completed + 1))

    # Stop if 3+ consecutive failures
    if [ "$failures" -ge 3 ]; then
      log "3+ consecutive failures — stopping continuous loop for investigation"
      break
    fi
  fi

  # Pause between sprints (skip on last or dry-run)
  if [ "$completed" -lt "$MAX_SPRINTS" ] && [ -z "$DRY_RUN" ]; then
    log "Pausing ${PAUSE_BETWEEN}s before next sprint..."
    sleep "$PAUSE_BETWEEN"
  fi
done

# ─── Summary ─────────────────────────────────────
end_count=$(count_completed)
new_completions=$((end_count - start_count))

log "=== Continuous Loop Complete ==="
log "Sprints attempted: $completed"
log "New completions: $new_completions"
log "Failures: $failures"
log "Total sprints in results: $end_count"
