#!/bin/bash
# DEPRECATED: Use `slope loop parallel` or `slope sprint run --workflow=sprint-autonomous` instead.
# This shell script is maintained for backward compatibility only.
#
# slope-loop/parallel.sh — Run two sprint streams with module overlap detection
#
# @description Runs two SLOPE sprints in parallel using git worktrees, with automatic
#              fallback to sequential execution if module overlap is detected.
echo "⚠ DEPRECATED: Use 'slope loop parallel' instead." >&2
# @usage ./slope-loop/parallel.sh [--dry-run]
# @param --dry-run Run without executing sprints
# @returns 0 on successful completion, 1 on error or if fallback to sequential occurs
#
# Falls back to sequential if module overlap is detected between sprints.

set -euo pipefail

# ─── Validate required tools ─────────────────────
# @description Check that all required tools are installed and functional
# @returns 0 if all tools work, exits with 1 if any are missing or broken
validate_tools() {
  local missing_tools=()
  for cmd in jq git pnpm; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      missing_tools+=("$cmd")
    fi
  done
  if [ "${#missing_tools[@]}" -gt 0 ]; then
    echo "Missing required tools: ${missing_tools[*]}"
    exit 1
  fi

  # Validate jq works (functional test in addition to command check)
  if ! echo '{}' | jq . >/dev/null 2>&1; then
    echo "ERROR: jq validation failed — jq may be broken or missing required dependencies"
    exit 1
  fi

  # Validate git works
  if ! git --version >/dev/null 2>&1; then
    echo "ERROR: git validation failed"
    exit 1
  fi
}

# Preflight: required tools and validation
validate_tools

SLOPE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNNER="$SLOPE_DIR/slope-loop/run.sh"
BACKLOG="$SLOPE_DIR/slope-loop/backlog.json"
RESULTS_DIR="$SLOPE_DIR/slope-loop/results"
LOG_DIR="$SLOPE_DIR/slope-loop/logs"

DRY_RUN=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN="--dry-run" ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

mkdir -p "$RESULTS_DIR" "$LOG_DIR"

log() { echo "[$(date '+%H:%M:%S')] [parallel] $*" | tee -a "$LOG_DIR/parallel.log"; }

# ─── Get modules for a sprint ID ─────────────────
# @description Extract unique module names for a given sprint from backlog
# @param sprint_id The sprint identifier to look up
# @returns Sorted list of unique module names, one per line
get_sprint_modules() {
  local sprint_id="$1"
  jq -r --arg sid "$sprint_id" '
    .sprints[] | select(.id == $sid) |
    .tickets[].modules[]? // empty
  ' "$BACKLOG" 2>/dev/null | sort -u
}

# ─── Check if two sprints have overlapping modules ─
# @description Determine if two sprints would conflict by touching the same modules
# @param sprint_a First sprint ID to compare
# @param sprint_b Second sprint ID to compare
# @returns "true" if modules overlap, "false" if safe to run in parallel
has_module_overlap() {
  local sprint_a="$1"
  local sprint_b="$2"

  local modules_a modules_b
  modules_a=$(get_sprint_modules "$sprint_a")
  modules_b=$(get_sprint_modules "$sprint_b")

  # If either sprint has no modules defined, assume no overlap
  if [ -z "$modules_a" ] || [ -z "$modules_b" ]; then
    echo "false"
    return
  fi

  # Check for intersection
  local overlap
  overlap=$(comm -12 <(echo "$modules_a") <(echo "$modules_b"))
  if [ -n "$overlap" ]; then
    echo "true"
  else
    echo "false"
  fi
}

# ─── Get next two unscored sprints ───────────────
# @description Find the next two sprints that don't have result files yet
# @returns Space-separated pair of sprint IDs, or single ID, or empty string
get_next_pair() {
  if [ ! -f "$BACKLOG" ]; then
    echo ""
    return
  fi
  local all_ids
  all_ids=$(jq -r '.sprints[].id' "$BACKLOG" 2>/dev/null)
  local pair=()
  for sid in $all_ids; do
    if [ ! -f "$RESULTS_DIR/${sid}.json" ]; then
      pair+=("$sid")
      if [ "${#pair[@]}" -ge 2 ]; then
        break
      fi
    fi
  done
  echo "${pair[*]}"
}

# ─── Main ────────────────────────────────────────
log "=== Parallel Runner Starting ==="
[ -n "$DRY_RUN" ] && log "DRY RUN mode"

pair=$(get_next_pair)
if [ -z "$pair" ]; then
  log "No sprints available in backlog."
  exit 0
fi

read -r sprint_a sprint_b <<< "$pair"

if [ -z "$sprint_b" ]; then
  log "Only one sprint available ($sprint_a) — running sequentially"
  "$RUNNER" "$sprint_a" $DRY_RUN 2>&1 | tee -a "$LOG_DIR/parallel.log"
  exit $?
fi

log "Candidate pair: $sprint_a + $sprint_b"

# Check module overlap
overlap=$(has_module_overlap "$sprint_a" "$sprint_b")
if [ "$overlap" = "true" ]; then
  log "Module overlap detected — falling back to sequential execution"
  log "Running $sprint_a first..."
  "$RUNNER" "$sprint_a" $DRY_RUN 2>&1 | tee -a "$LOG_DIR/parallel.log"
  log "Running $sprint_b second..."
  "$RUNNER" "$sprint_b" $DRY_RUN 2>&1 | tee -a "$LOG_DIR/parallel.log"
else
  log "No module overlap — running in parallel"

  # Run both sprints in parallel, each in its own git worktree
  # Worktree A
  WORKTREE_A="$SLOPE_DIR/.slope-loop-worktree-a"
  WORKTREE_B="$SLOPE_DIR/.slope-loop-worktree-b"

  # Clean up any stale worktrees
  git -C "$SLOPE_DIR" worktree prune 2>/dev/null || true

  current_branch=$(git -C "$SLOPE_DIR" branch --show-current)
  branch_a="slope-loop/${sprint_a}"
  branch_b="slope-loop/${sprint_b}"

  log "Creating worktree A: $branch_a"
  git -C "$SLOPE_DIR" worktree add "$WORKTREE_A" -b "$branch_a" 2>/dev/null || {
    log "Failed to create worktree A — falling back to sequential"
    "$RUNNER" "$sprint_a" $DRY_RUN 2>&1 | tee -a "$LOG_DIR/parallel.log"
    "$RUNNER" "$sprint_b" $DRY_RUN 2>&1 | tee -a "$LOG_DIR/parallel.log"
    exit $?
  }

  log "Creating worktree B: $branch_b"
  git -C "$SLOPE_DIR" worktree add "$WORKTREE_B" -b "$branch_b" 2>/dev/null || {
    log "Failed to create worktree B — cleaning up A, falling back to sequential"
    git -C "$SLOPE_DIR" worktree remove "$WORKTREE_A" --force 2>/dev/null || true
    git -C "$SLOPE_DIR" branch -d "$branch_a" 2>/dev/null || log "Note: branch $branch_a has unmerged changes, keeping"
    "$RUNNER" "$sprint_a" $DRY_RUN 2>&1 | tee -a "$LOG_DIR/parallel.log"
    "$RUNNER" "$sprint_b" $DRY_RUN 2>&1 | tee -a "$LOG_DIR/parallel.log"
    exit $?
  }

  # Install deps in worktrees
  (cd "$WORKTREE_A" && pnpm install --frozen-lockfile 2>/dev/null && pnpm build 2>/dev/null) &
  (cd "$WORKTREE_B" && pnpm install --frozen-lockfile 2>/dev/null && pnpm build 2>/dev/null) &
  wait

  # Run sprints in parallel
  log "Launching $sprint_a in worktree A..."
  (cd "$WORKTREE_A" && "$WORKTREE_A/slope-loop/run.sh" "$sprint_a" $DRY_RUN 2>&1 | tee -a "$LOG_DIR/parallel-${sprint_a}.log") &
  PID_A=$!

  log "Launching $sprint_b in worktree B..."
  (cd "$WORKTREE_B" && "$WORKTREE_B/slope-loop/run.sh" "$sprint_b" $DRY_RUN 2>&1 | tee -a "$LOG_DIR/parallel-${sprint_b}.log") &
  PID_B=$!

  # Wait for both
  exit_a=0
  exit_b=0
  wait $PID_A || exit_a=$?
  wait $PID_B || exit_b=$?

  log "Sprint A ($sprint_a): exit $exit_a"
  log "Sprint B ($sprint_b): exit $exit_b"

  # Copy results back to main repo
  for f in "$WORKTREE_A/slope-loop/results/"*.json; do
    [ -f "$f" ] && cp "$f" "$RESULTS_DIR/"
  done
  for f in "$WORKTREE_B/slope-loop/results/"*.json; do
    [ -f "$f" ] && cp "$f" "$RESULTS_DIR/"
  done

  # Copy logs back
  for f in "$WORKTREE_A/slope-loop/logs/"*.jsonl "$WORKTREE_A/slope-loop/logs/"*.log; do
    [ -f "$f" ] && cp "$f" "$LOG_DIR/"
  done
  for f in "$WORKTREE_B/slope-loop/logs/"*.jsonl "$WORKTREE_B/slope-loop/logs/"*.log; do
    [ -f "$f" ] && cp "$f" "$LOG_DIR/"
  done

  # Clean up worktrees
  log "Cleaning up worktrees..."
  git -C "$SLOPE_DIR" worktree remove "$WORKTREE_A" --force 2>/dev/null || log "Warning: failed to remove worktree A"
  git -C "$SLOPE_DIR" worktree remove "$WORKTREE_B" --force 2>/dev/null || log "Warning: failed to remove worktree B"
  
  # Only delete branches if they were successfully merged into current branch
  # Use -d (safe) which refuses to delete unmerged branches; never use -D
  if git -C "$SLOPE_DIR" branch -d "$branch_a" 2>/dev/null; then
    log "Deleted branch $branch_a"
  else
    log "Note: branch $branch_a has unmerged changes, keeping it for safety"
  fi

  if git -C "$SLOPE_DIR" branch -d "$branch_b" 2>/dev/null; then
    log "Deleted branch $branch_b"
  else
    log "Note: branch $branch_b has unmerged changes, keeping it for safety"
  fi

  log "=== Parallel Runner Complete ==="
  log "Sprint A ($sprint_a): $([ $exit_a -eq 0 ] && echo 'PASS' || echo 'FAIL')"
  log "Sprint B ($sprint_b): $([ $exit_b -eq 0 ] && echo 'PASS' || echo 'FAIL')"
fi
