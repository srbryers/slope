#!/bin/bash
# slope-loop/run.sh — Run a single sprint from the generated backlog
# Usage: ./slope-loop/run.sh [sprint-id] [--dry-run]
# If no sprint-id, picks the next unscored sprint

set -euo pipefail

# Portable timeout: macOS has gtimeout (from coreutils), Linux has timeout
if command -v timeout &>/dev/null; then
  TIMEOUT_CMD="timeout"
elif command -v gtimeout &>/dev/null; then
  TIMEOUT_CMD="gtimeout"
else
  echo "Error: 'timeout' command not found. Install coreutils: brew install coreutils"
  exit 1
fi

SLOPE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MAIN_REPO="$SLOPE_DIR"
BACKLOG="$SLOPE_DIR/slope-loop/backlog.json"
RESULTS_DIR="$SLOPE_DIR/slope-loop/results"
LOG_DIR="$SLOPE_DIR/slope-loop/logs"
AGENT_GUIDE="$SLOPE_DIR/slope-loop/slope-loop-guide/SKILL.md"
SPRINT_HISTORY="$SLOPE_DIR/slope-loop/slope-loop-guide/references/sprint-history.md"
BRANCH_PREFIX="slope-loop"

# ─── Model Tier Configuration ─────────────────────
MODEL_LOCAL="${MODEL_LOCAL:-ollama/qwen3-coder-next-fast}"
MODEL_API="${MODEL_API:-openrouter/anthropic/claude-haiku-4-5}"
export OLLAMA_API_BASE="${OLLAMA_API_BASE:-http://localhost:11434}"
export OLLAMA_FLASH_ATTENTION="${OLLAMA_FLASH_ATTENTION:-1}"
export OLLAMA_KV_CACHE_TYPE="${OLLAMA_KV_CACHE_TYPE:-q8_0}"
export AIDER_TIMEOUT="${AIDER_TIMEOUT:-3600}"
MODEL_API_TIMEOUT=1800                              # 30min for complex tickets
MODEL_LOCAL_TIMEOUT=1800                            # 30min for local (MoE prefill is slow)
ESCALATE_ON_FAIL="${ESCALATE_ON_FAIL:-true}"

# Agent guide token budget — keep SKILL.md under 5000 words per spec
AGENT_GUIDE_MAX_WORDS=5000

# Auto-regeneration threshold: if N+ new tickets logged since last model-config.json
MODEL_REGEN_THRESHOLD=10

# ─── Parse flags ──────────────────────────────────
DRY_RUN=false
SPRINT_ARG=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *) SPRINT_ARG="$arg" ;;
  esac
done

# ─── Helpers ──────────────────────────────────────

mkdir -p "$RESULTS_DIR" "$LOG_DIR"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_DIR/loop.log"; }

select_model() {
  local club="$1"
  local max_files="${2:-1}"
  local est_tokens="${3:-0}"

  # Token-based escalation: won't fit in Qwen 32K context
  if [ "$est_tokens" -gt 24000 ]; then
    echo "$MODEL_API"
    return
  fi

  # Multi-file routing: 2+ files -> escalate to API model
  # (lowered from 3 per ML review — Qwen struggles with multi-file coordination)
  if [ "$max_files" -ge 2 ]; then
    echo "$MODEL_API"
    return
  fi

  # Load data-driven overrides if they exist (from model-selector.ts)
  if [ -f "$SLOPE_DIR/slope-loop/model-config.json" ]; then
    local rec
    rec=$(jq -r ".recommendations.\"$club\".model // \"\"" "$SLOPE_DIR/slope-loop/model-config.json" 2>/dev/null)
    if [ "$rec" = "api" ]; then
      echo "$MODEL_API"
      return
    elif [ "$rec" = "local" ]; then
      echo "$MODEL_LOCAL"
      return
    fi
  fi

  case "$club" in
    putter|wedge|short_iron)
      echo "$MODEL_LOCAL"
      ;;
    long_iron|driver)
      echo "$MODEL_API"
      ;;
    *)
      echo "$MODEL_LOCAL"
      ;;
  esac
}

select_timeout() {
  local club="$1"
  case "$club" in
    long_iron|driver) echo "$MODEL_API_TIMEOUT" ;;
    *) echo "$MODEL_LOCAL_TIMEOUT" ;;
  esac
}

# ─── PR Structural Review ────────────────────────
# Returns finding count via echo; all log output goes to stderr to avoid
# corrupting the captured return value.
# Args: pr_url sprint_id sprint_num
review_pr() {
  local pr_url="$1"
  local sprint_id="$2"
  local sprint_num="${3:-0}"
  local finding_count=0

  # Get PR diff
  local pr_number
  pr_number=$(echo "$pr_url" | grep -o '[0-9]*$')
  if [ -z "$pr_number" ]; then
    log "   Warning: Could not extract PR number from $pr_url" >&2
    echo 0
    return 0
  fi

  local diff
  diff=$(gh pr diff "$pr_number" 2>/dev/null) || {
    log "   Warning: Could not fetch PR diff" >&2
    echo 0
    return 0
  }

  # Added lines only (lines starting with +, excluding +++ headers)
  local added_lines
  added_lines=$(echo "$diff" | grep '^+' | grep -v '^+++' || true)

  # Changed files
  local changed_files
  changed_files=$(echo "$diff" | grep '^diff --git' | sed 's|.*b/||' || true)

  local changed_ts_files
  changed_ts_files=$(echo "$changed_files" | grep '\.ts$' | grep -v '\.test\.ts$' | grep -v '\.d\.ts$' || true)

  local changed_test_files
  changed_test_files=$(echo "$changed_files" | grep '\.test\.ts$' || true)

  # --- Check: as any / @ts-ignore / @ts-expect-error ---
  local type_escapes
  type_escapes=$(echo "$added_lines" | { grep -cE '(as any|\b@ts-ignore\b|\b@ts-expect-error\b)' || true; })
  if [ "$type_escapes" -gt 0 ]; then
    slope review findings add \
      --type=code --ticket="${sprint_id}-0" --severity=minor \
      --description="$type_escapes type escape(s) found (as any / @ts-ignore)" \
      --sprint="$sprint_num" 2>/dev/null || true
    finding_count=$((finding_count + 1))
  fi

  # --- Check: console.log in production code ---
  local console_logs
  console_logs=$(echo "$diff" | awk '/^diff --git/{file=$0} /^\+.*console\.log/{if(file !~ /\.test\.ts/) print}' | wc -l | tr -d ' ')
  if [ "$console_logs" -gt 0 ]; then
    slope review findings add \
      --type=code --ticket="${sprint_id}-0" --severity=minor \
      --description="$console_logs console.log statement(s) in production code" \
      --sprint="$sprint_num" 2>/dev/null || true
    finding_count=$((finding_count + 1))
  fi

  # --- Check: changed source files without test changes ---
  if [ -n "$changed_ts_files" ]; then
    local untested_count=0
    while IFS= read -r src_file; do
      [ -z "$src_file" ] && continue
      local base_name
      base_name=$(basename "$src_file" .ts)
      if ! echo "$changed_test_files" | grep -qF "${base_name}.test.ts"; then
        untested_count=$((untested_count + 1))
      fi
    done <<< "$changed_ts_files"

    if [ "$untested_count" -gt 0 ]; then
      slope review findings add \
        --type=code --ticket="${sprint_id}-0" --severity=moderate \
        --description="$untested_count source file(s) changed without corresponding test changes" \
        --sprint="$sprint_num" 2>/dev/null || true
      finding_count=$((finding_count + 1))
    fi
  fi

  # --- Check: security-sensitive file changes ---
  local security_files
  security_files=$(echo "$changed_files" | grep -iE '(auth/|oauth|jwt|secret|crypto|password|credential)' || true)
  if [ -n "$security_files" ]; then
    local sec_count
    sec_count=$(echo "$security_files" | wc -l | tr -d ' ')
    slope review findings add \
      --type=security --ticket="${sprint_id}-0" --severity=moderate \
      --description="$sec_count security-sensitive file(s) changed" \
      --sprint="$sprint_num" 2>/dev/null || true
    finding_count=$((finding_count + 1))
  fi

  # --- Check: large file diffs (>500 additions per file) ---
  local large_files
  large_files=$(gh pr view "$pr_number" --json files \
    --jq '[.files[] | select(.additions > 500)] | .[].path' 2>/dev/null || true)
  if [ -n "$large_files" ]; then
    local large_count
    large_count=$(echo "$large_files" | wc -l | tr -d ' ')
    slope review findings add \
      --type=architect --ticket="${sprint_id}-0" --severity=minor \
      --description="$large_count file(s) with >500 lines added — review for scope creep" \
      --sprint="$sprint_num" 2>/dev/null || true
    finding_count=$((finding_count + 1))
  fi

  echo "$finding_count"
}

# Test command for the loop — excludes guards.test.ts which triggers
# false positives from stop-check detecting the loop's own uncommitted changes
LOOP_TEST_CMD="pnpm vitest run --exclude '**/guards.test.ts'"

# ─── Run a single ticket with a given model ───────
run_ticket_with_model() {
  local ticket_id="$1"
  local model="$2"
  local timeout_s="$3"
  local prompt="$4"
  local aider_log="$LOG_DIR/${ticket_id}-$(basename "$model").log"

  # Capture pre-Aider SHA so we can revert bad commits
  local pre_aider_sha
  pre_aider_sha=$(git rev-parse HEAD)

  local aider_args=(
    --model "$model"
    --message "$prompt"
    --auto-commits
    --yes
  )

  # Local model optimizations: no streaming, no model warnings, smaller repo-map,
  # and disable --auto-test (test output balloons context from ~40k to 126k+,
  # making the second prefill infeasible due to quadratic attention scaling).
  # The loop runs pnpm typecheck post-ticket as a guard equivalent.
  local is_local=false
  if [[ "$model" == *"ollama"* ]]; then
    aider_args+=(--no-stream --no-show-model-warnings --map-tokens 1024)
    is_local=true
  else
    aider_args+=(--auto-test --test-cmd "$LOOP_TEST_CMD")
  fi

  # Inject agent guide skill if within token budget (skip for local — saves ~5k tokens)
  if [ "$is_local" = "false" ] && [ -f "$AGENT_GUIDE" ]; then
    local guide_words
    guide_words=$(wc -w < "$AGENT_GUIDE")
    if [ "$guide_words" -le "$AGENT_GUIDE_MAX_WORDS" ]; then
      aider_args+=(--read "$AGENT_GUIDE")
    else
      log "   Warning: SKILL.md exceeds ${AGENT_GUIDE_MAX_WORDS} words — skipping injection"
    fi
  fi

  # Semantic context per ticket (fall back to CODEBASE.md)
  # Local models get tighter limits to keep prefill manageable
  local context_line_limit=500
  local context_top=8
  if [ "$is_local" = "true" ]; then
    context_line_limit=200
    context_top=4
  fi

  CONTEXT_FILE="$LOG_DIR/${ticket_id}-context.md"
  if pnpm slope context --ticket="$ticket_id" --format=snippets --top="$context_top" > "$CONTEXT_FILE" 2>/dev/null; then
    if [ -s "$CONTEXT_FILE" ]; then
      CONTEXT_LINES=$(wc -l < "$CONTEXT_FILE" | tr -d ' ')
      if [ "$CONTEXT_LINES" -le "$context_line_limit" ]; then
        aider_args+=(--read "$CONTEXT_FILE")
        log "   Injected semantic context ($CONTEXT_LINES lines)"
      else
        log "   Semantic context too large ($CONTEXT_LINES lines) — falling back to CODEBASE.md"
        [ -f "$SLOPE_DIR/CODEBASE.md" ] && aider_args+=(--read "$SLOPE_DIR/CODEBASE.md")
      fi
    else
      log "   Semantic context empty — falling back to CODEBASE.md"
      [ -f "$SLOPE_DIR/CODEBASE.md" ] && aider_args+=(--read "$SLOPE_DIR/CODEBASE.md")
    fi
  else
    log "   slope context failed — falling back to CODEBASE.md"
    [ -f "$SLOPE_DIR/CODEBASE.md" ] && aider_args+=(--read "$SLOPE_DIR/CODEBASE.md")
  fi

  # Generate prep plan per ticket (fall back silently)
  PREP_FILE="$LOG_DIR/${ticket_id}-prep.md"
  if pnpm slope prep "${ticket_id}" --top=5 > "${PREP_FILE}" 2>"${PREP_FILE}.err"; then
    if [ -s "${PREP_FILE}" ]; then
      # Token budget check: ~400 tokens max (~1600 words)
      PREP_WORDS=$(wc -w < "${PREP_FILE}" | tr -d ' ')
      if [ "${PREP_WORDS}" -lt 1600 ]; then
        aider_args+=(--read "${PREP_FILE}")
        log "   Injected prep plan (~$((PREP_WORDS / 4)) tokens)"
      else
        log "   Prep plan too large (~$((PREP_WORDS / 4)) tokens) — skipping"
      fi
    fi
  else
    log "   Warning: slope prep failed — continuing without plan"
    [ -s "${PREP_FILE}.err" ] && log "   $(head -1 "${PREP_FILE}.err")"
  fi

  # Fallback: if full prep failed or too large, get hazards + similar tickets only
  if [ ! -s "${PREP_FILE}" ] || [ "${PREP_WORDS:-0}" -ge 1600 ]; then
    LITE_FILE="$LOG_DIR/${ticket_id}-prep-lite.md"
    if pnpm slope prep "${ticket_id}" --lite > "$LITE_FILE" 2>/dev/null && [ -s "$LITE_FILE" ]; then
      aider_args+=(--read "$LITE_FILE")
      log "   Injected lite prep (hazards + similar tickets)"
    fi
  fi

  # Add primary files from enriched ticket as --file flags (editable context)
  if [ -n "${TICKET_PRIMARY_FILES:-}" ]; then
    local FILE_COUNT=0
    local MAX_EDIT_FILES=5
    while IFS= read -r f; do
      if [ "$FILE_COUNT" -ge "$MAX_EDIT_FILES" ]; then break; fi
      if [ -n "$f" ] && [ -f "$f" ] && [[ "$f" == *.ts || "$f" == *.js || "$f" == *.sh ]]; then
        aider_args+=(--file "$f")
        FILE_COUNT=$((FILE_COUNT + 1))
      fi
    done <<< "$TICKET_PRIMARY_FILES"
    if [ "$FILE_COUNT" -gt 0 ]; then
      log "   Added $FILE_COUNT primary files to Aider edit context"
    fi
  fi

  $TIMEOUT_CMD "$timeout_s" aider "${aider_args[@]}" \
    2>&1 | tee "$aider_log" || {
      log "   Warning: Aider timed out or errored on $ticket_id (model: $model)"
    }

  # Post-ticket guards: typecheck + tests are BLOCKING.
  # If either fails, revert Aider's commits to keep the branch clean.
  local post_aider_sha
  post_aider_sha=$(git rev-parse HEAD)

  # No commits = no-op, skip checks (nothing to revert)
  if [ "$pre_aider_sha" = "$post_aider_sha" ]; then
    return 0
  fi

  # Guard 1: Typecheck — catches wrong imports, missing types
  if ! pnpm typecheck > /dev/null 2>&1; then
    log "   REVERT: typecheck failing after $ticket_id — reverting $(git rev-list --count "$pre_aider_sha".."$post_aider_sha" 2>/dev/null || echo '?') commit(s)"
    git reset --hard "$pre_aider_sha"
    git clean -fd 2>/dev/null || true  # Remove untracked files Aider may have created
    return 1
  fi

  # Guard 2: Tests — catches broken behavior, removed used imports
  # Uses LOOP_TEST_CMD which excludes guards.test.ts (false positive from stop-check)
  if ! $LOOP_TEST_CMD > /dev/null 2>&1; then
    log "   REVERT: tests failing after $ticket_id — reverting $(git rev-list --count "$pre_aider_sha".."$post_aider_sha" 2>/dev/null || echo '?') commit(s)"
    git reset --hard "$pre_aider_sha"
    git clean -fd 2>/dev/null || true  # Remove untracked files Aider may have created
    return 1
  fi

  return 0
}

# ─── Pre-flight checks ───────────────────────────

if [ "$DRY_RUN" = "true" ]; then
  log "=== DRY RUN MODE ==="
fi

if ! [ -f "$BACKLOG" ]; then
  log "No backlog.json found. Run: npx tsx slope-loop/analyze-scorecards.ts"
  exit 1
fi

# Ollama health check (skip in dry-run)
if [ "$DRY_RUN" = "false" ]; then
  if ! curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; then
    log "Warning: Ollama is not running. Attempting to start..."
    ollama serve &
    sleep 5
    if ! curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; then
      log "Cannot reach Ollama. Please start it manually: ollama serve"
      exit 1
    fi
  fi

  if ! ollama list 2>/dev/null | grep -q "qwen2.5-coder:32b"; then
    log "Warning: Qwen model not found. Pulling..."
    ollama pull qwen2.5-coder:32b
  fi

  log "Ollama healthy, model available"
fi

# gh CLI check (non-blocking — PR creation is optional)
if ! command -v gh >/dev/null 2>&1; then
  log "Warning: gh CLI not found — PR creation will be skipped"
elif ! gh auth status >/dev/null 2>&1; then
  log "Warning: gh CLI not authenticated — PR creation will be skipped"
fi

# ─── Sprint selection ─────────────────────────────

get_sprint() {
  local sprint_id="${1:-}"
  if [ -n "$sprint_id" ]; then
    jq -r ".sprints[] | select(.id == \"$sprint_id\")" "$BACKLOG"
  else
    for id in $(jq -r '.sprints[].id' "$BACKLOG"); do
      # Atomic lock to prevent parallel race conditions
      if mkdir "$RESULTS_DIR/$id.lock" 2>/dev/null; then
        if [ ! -f "$RESULTS_DIR/$id.json" ]; then
          jq -r ".sprints[] | select(.id == \"$id\")" "$BACKLOG"
          return
        else
          rmdir "$RESULTS_DIR/$id.lock" 2>/dev/null || true
        fi
      fi
    done
    log "All sprints completed. Run analyze-scorecards.ts to generate new backlog."
    exit 0
  fi
}

# ─── Pre-Sprint Briefing ─────────────────────────

log "=== Pre-Sprint Briefing ==="
slope briefing 2>/dev/null | tee -a "$LOG_DIR/loop.log" || true
echo ""

# ─── Main ─────────────────────────────────────────

cd "$SLOPE_DIR"

SPRINT=$(get_sprint "$SPRINT_ARG")
SPRINT_ID=$(echo "$SPRINT" | jq -r '.id')
SPRINT_TITLE=$(echo "$SPRINT" | jq -r '.title')
SPRINT_STRATEGY=$(echo "$SPRINT" | jq -r '.strategy')
TICKET_COUNT=$(echo "$SPRINT" | jq -r '.tickets | length')

log "=== Starting Sprint: $SPRINT_ID — $SPRINT_TITLE ==="
log "Strategy: $SPRINT_STRATEGY | Tickets: $TICKET_COUNT"

if [ "$DRY_RUN" = "true" ]; then
  log "--- Dry run: would process $TICKET_COUNT tickets ---"
  echo "$SPRINT" | jq -r '.tickets[] | "  \(.key): \(.title) [club=\(.club), max_files=\(.max_files)]"'
  echo ""

  # Dry-run ticket validation
  log "--- Ticket validation ---"
  DRY_VALID=0
  DRY_SKIPPED=0
  while read -r TICKET; do
    TICKET_KEY=$(echo "$TICKET" | jq -r '.key')
    TICKET_TITLE=$(echo "$TICKET" | jq -r '.title')
    TICKET_MODULES=$(echo "$TICKET" | jq -r '.modules[]?' 2>/dev/null)

    if [ -z "$TICKET_MODULES" ]; then
      log "  SKIP $TICKET_KEY: no modules specified"
      DRY_SKIPPED=$((DRY_SKIPPED + 1))
      continue
    fi

    FOUND_FILE=false
    while IFS= read -r mod; do
      [ -z "$mod" ] && continue
      if [ -f "$mod" ]; then FOUND_FILE=true; break; fi
      if ! echo "$mod" | grep -q '/'; then
        MATCH=$(find . -name "$mod" -not -path '*/node_modules/*' -not -path '*/dist/*' -print -quit 2>/dev/null)
        if [ -n "$MATCH" ]; then FOUND_FILE=true; break; fi
      fi
    done <<< "$TICKET_MODULES"

    if [ "$FOUND_FILE" = "false" ]; then
      log "  SKIP $TICKET_KEY: no module files found on disk"
      DRY_SKIPPED=$((DRY_SKIPPED + 1))
      continue
    fi

    DRY_VALID=$((DRY_VALID + 1))
    TICKET_CLUB=$(echo "$TICKET" | jq -r '.club')
    TICKET_MAX_FILES=$(echo "$TICKET" | jq -r '.max_files // 1')
    TICKET_EST_TOKENS=$(echo "$TICKET" | jq -r '.estimated_tokens // 0')
    TICKET_MODEL=$(select_model "$TICKET_CLUB" "$TICKET_MAX_FILES" "$TICKET_EST_TOKENS")
    log "  VALID $TICKET_KEY -> model: $TICKET_MODEL (club=$TICKET_CLUB, files=$TICKET_MAX_FILES, tokens=$TICKET_EST_TOKENS)"
  done < <(echo "$SPRINT" | jq -c '.tickets[]')
  log "Validation: $DRY_VALID valid, $DRY_SKIPPED skipped"

  if [ "$DRY_VALID" -eq 0 ]; then
    log "All tickets would fail validation — sprint would be skipped"
  fi

  log "--- Dry run complete ---"
  rmdir "$RESULTS_DIR/$SPRINT_ID.lock" 2>/dev/null || true
  exit 0
fi

# Create working branch in a worktree (isolates from main repo)
BRANCH="$BRANCH_PREFIX/$SPRINT_ID"
WORKTREE_DIR="$SLOPE_DIR/.slope-loop-worktree-$SPRINT_ID"
git -C "$SLOPE_DIR" worktree prune 2>/dev/null || true

if [ -d "$WORKTREE_DIR" ]; then
  log "Reusing existing worktree: $WORKTREE_DIR"
  cd "$WORKTREE_DIR"
else
  git -C "$SLOPE_DIR" worktree add "$WORKTREE_DIR" -b "$BRANCH" 2>/dev/null || {
    log "Error: Failed to create worktree"
    rmdir "$RESULTS_DIR/$SPRINT_ID.lock" 2>/dev/null || true
    exit 1
  }
  cd "$WORKTREE_DIR"
  pnpm install --frozen-lockfile 2>/dev/null || true
  pnpm build 2>/dev/null || true
fi
SLOPE_DIR="$WORKTREE_DIR"

# Ensure semantic index is current before starting tickets
CURRENT_SHA=$(git rev-parse HEAD)
INDEX_SHA=$(pnpm slope index --status --json 2>/dev/null | jq -r '.lastSha // empty' 2>/dev/null || true)
if [ "$CURRENT_SHA" != "$INDEX_SHA" ]; then
  log "Updating semantic index..."
  $TIMEOUT_CMD 120 pnpm slope index 2>/dev/null || log "Warning: slope index failed — using stale index"
fi

# Enrich backlog if not already enriched (check for _enrichMeta version field)
ENRICH_VERSION=$(jq -r '._enrichMeta.version // 0' "$BACKLOG" 2>/dev/null)
if [ "$ENRICH_VERSION" -lt 1 ] 2>/dev/null; then
  log "Enriching backlog with file context..."
  $TIMEOUT_CMD 120 pnpm slope enrich "$BACKLOG" 2>/dev/null || log "Warning: slope enrich failed"
fi

# Start Slope session
slope session start --sprint="$SPRINT_ID" 2>/dev/null || true

# ─── Pre-Sprint Ticket Validation ────────────────

VALID_TICKETS="[]"
SKIPPED=0

while read -r TICKET; do
  TICKET_KEY=$(echo "$TICKET" | jq -r '.key')
  TICKET_TITLE=$(echo "$TICKET" | jq -r '.title')
  TICKET_MODULES=$(echo "$TICKET" | jq -r '.modules[]?' 2>/dev/null)

  # Check 1: Has modules
  if [ -z "$TICKET_MODULES" ]; then
    log "   SKIP $TICKET_KEY: no modules specified"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # Check 2: At least one module file exists on disk
  FOUND_FILE=false
  while IFS= read -r mod; do
    [ -z "$mod" ] && continue
    if [ -f "$mod" ]; then
      FOUND_FILE=true
      break
    fi
    # Try finding bare basenames in the repo
    if ! echo "$mod" | grep -q '/'; then
      MATCH=$(find . -name "$mod" -not -path '*/node_modules/*' -not -path '*/dist/*' -print -quit 2>/dev/null)
      if [ -n "$MATCH" ]; then
        FOUND_FILE=true
        break
      fi
    fi
  done <<< "$TICKET_MODULES"

  if [ "$FOUND_FILE" = "false" ]; then
    log "   SKIP $TICKET_KEY: no module files found on disk"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  VALID_TICKETS=$(echo "$VALID_TICKETS" | jq ". + [$(echo "$TICKET" | jq -c '.')]")
  log "   VALID $TICKET_KEY: $TICKET_TITLE"
done < <(echo "$SPRINT" | jq -c '.tickets[]')

VALID_COUNT=$(echo "$VALID_TICKETS" | jq 'length')
log "Ticket validation: $VALID_COUNT valid, $SKIPPED skipped"

if [ "$VALID_COUNT" -eq 0 ]; then
  log "All tickets failed validation — skipping sprint $SPRINT_ID"
  slope session end 2>/dev/null || true
  cd "$MAIN_REPO"
  git -C "$MAIN_REPO" worktree remove "$WORKTREE_DIR" --force 2>/dev/null || true
  git -C "$MAIN_REPO" branch -D "$BRANCH" 2>/dev/null || true
  rmdir "$RESULTS_DIR/$SPRINT_ID.lock" 2>/dev/null || true
  exit 0
fi

# ─── Process Each Ticket ──────────────────────────

TICKET_RESULTS="[]"

while read -r TICKET; do
  TICKET_KEY=$(echo "$TICKET" | jq -r '.key')
  TICKET_TITLE=$(echo "$TICKET" | jq -r '.title')
  TICKET_DESC=$(echo "$TICKET" | jq -r '.description')
  TICKET_ACCEPTANCE=$(echo "$TICKET" | jq -r '.acceptance_criteria | join("; ")')
  TICKET_CLUB=$(echo "$TICKET" | jq -r '.club')
  TICKET_MAX_FILES=$(echo "$TICKET" | jq -r '.max_files // 1')
  EST_TOKENS=$(echo "$TICKET" | jq -r '.estimated_tokens // 0')
  # Extract primary files from enriched ticket (set by slope enrich)
  TICKET_PRIMARY_FILES=$(echo "$TICKET" | jq -r '.files.primary[]? // empty' 2>/dev/null)

  log "-- Ticket: $TICKET_KEY — $TICKET_TITLE --"
  log "   Club: $TICKET_CLUB (max_files: $TICKET_MAX_FILES, est_tokens: $EST_TOKENS)"

  TICKET_MODEL=$(select_model "$TICKET_CLUB" "$TICKET_MAX_FILES" "$EST_TOKENS")
  TICKET_TIMEOUT=$(select_timeout "$TICKET_CLUB")
  log "   Model: $TICKET_MODEL (timeout: ${TICKET_TIMEOUT}s)"

  slope claim --target="$TICKET_KEY" 2>/dev/null || true

  # Build prompt
  PROMPT="You are working on the SLOPE project (Sprint Lifecycle & Operational Performance Engine).
This is a TypeScript monorepo using pnpm, vitest for tests, and strict TypeScript.

TICKET: $TICKET_TITLE
DESCRIPTION: $TICKET_DESC
ACCEPTANCE CRITERIA: $TICKET_ACCEPTANCE

RULES:
- Make minimal, focused changes — do not refactor unrelated code
- Read the relevant source files FIRST before making changes
- Run 'pnpm test' to verify your changes
- Run 'pnpm typecheck' to check types
- Commit with a message starting with '$TICKET_KEY:'
"

  # Model-specific instructions
  if [[ "$TICKET_MODEL" == *"minimax"* ]]; then
    PROMPT+="
APPROACH: Plan before coding. List files to modify, changes per file, verification steps. Then execute step by step."
  else
    PROMPT+="
APPROACH: Make the smallest possible change. Focus on a single file at a time. Keep edits minimal."
  fi

  # Add file guidance if enriched files are available
  if [ -n "$TICKET_PRIMARY_FILES" ]; then
    PROMPT+="

FILES TO MODIFY:
$(echo "$TICKET_PRIMARY_FILES" | head -5 | sed 's/^/- /')"
  fi

  PROMPT+="
START by reading the relevant source files, then implement the change."

  FINAL_MODEL="$TICKET_MODEL"
  ESCALATED="false"
  TESTS_PASSING="false"
  TICKET_START=$(date +%s)

  # Capture pre-Aider SHA to detect no-ops (Aider uses --auto-commits,
  # so git diff HEAD is always empty after a successful run)
  PRE_AIDER_SHA=$(git rev-parse HEAD)

  # Attempt 1: Primary model
  NOOP="false"
  if run_ticket_with_model "$TICKET_KEY" "$TICKET_MODEL" "$TICKET_TIMEOUT" "$PROMPT"; then
    log "   Tests passing for $TICKET_KEY (model: $TICKET_MODEL)"
    TESTS_PASSING="true"

    # Check if Aider actually made code changes (compare commit SHAs)
    POST_AIDER_SHA=$(git rev-parse HEAD)
    if [ "$PRE_AIDER_SHA" = "$POST_AIDER_SHA" ]; then
      log "   WARNING: No code changes produced for $TICKET_KEY (no-op)"
      NOOP="true"
    else
      COMMIT_COUNT=$(git rev-list --count "$PRE_AIDER_SHA".."$POST_AIDER_SHA")
      log "   $COMMIT_COUNT commit(s) produced for $TICKET_KEY"
    fi
  else
    log "   Tests failing for $TICKET_KEY (model: $TICKET_MODEL)"

    # Attempt 2: Escalate to API if local model failed
    if [ "$ESCALATE_ON_FAIL" = "true" ] && [ "$TICKET_MODEL" = "$MODEL_LOCAL" ]; then
      log "   Escalating to $MODEL_API (reason: primary model failed on $TICKET_KEY)"
      FINAL_MODEL="$MODEL_API"
      ESCALATED="true"

      # run_ticket_with_model already reverted commits via git reset --hard,
      # but clean up any untracked files that survived the reset
      git clean -fd 2>/dev/null || true

      PRE_ESCALATION_SHA=$(git rev-parse HEAD)
      if run_ticket_with_model "$TICKET_KEY" "$MODEL_API" "$MODEL_API_TIMEOUT" "$PROMPT"; then
        log "   Tests passing for $TICKET_KEY after escalation to $MODEL_API"
        TESTS_PASSING="true"

        # Check if escalated model actually made code changes (compare commit SHAs)
        POST_ESCALATION_SHA=$(git rev-parse HEAD)
        if [ "$PRE_ESCALATION_SHA" = "$POST_ESCALATION_SHA" ]; then
          log "   WARNING: No code changes produced for $TICKET_KEY after escalation (no-op)"
          NOOP="true"
        else
          COMMIT_COUNT=$(git rev-list --count "$PRE_ESCALATION_SHA".."$POST_ESCALATION_SHA")
          log "   $COMMIT_COUNT commit(s) produced for $TICKET_KEY after escalation"
        fi
      else
        log "   Tests still failing for $TICKET_KEY even after escalation"
      fi
    fi
  fi

  TICKET_END=$(date +%s)
  TICKET_ELAPSED=$((TICKET_END - TICKET_START))
  log "   Completed in ${TICKET_ELAPSED}s"

  # Track model usage per ticket (JSONL)
  TICKET_RESULT="{\"ticket\":\"$TICKET_KEY\",\"title\":\"$TICKET_TITLE\",\"club\":\"$TICKET_CLUB\",\"max_files\":$TICKET_MAX_FILES,\"primary_model\":\"$TICKET_MODEL\",\"final_model\":\"$FINAL_MODEL\",\"escalated\":$ESCALATED,\"tests_passing\":$TESTS_PASSING,\"noop\":$NOOP}"
  echo "$TICKET_RESULT" >> "$LOG_DIR/${SPRINT_ID}-models.jsonl"
  TICKET_RESULTS=$(echo "$TICKET_RESULTS" | jq ". + [$TICKET_RESULT]")

  slope release --target="$TICKET_KEY" 2>/dev/null || true

  # Push after each ticket — last push is the recovery point
  git push -u origin "$BRANCH" 2>/dev/null || log "   Warning: git push failed for $TICKET_KEY"

  log "-- Ticket $TICKET_KEY complete --"
done < <(echo "$VALID_TICKETS" | jq -c '.[]')

# ─── Post-Sprint: Score, Review & Evolve ──────────

log "=== Sprint $SPRINT_ID complete — scoring ==="

slope session end 2>/dev/null || true

# Detect next available numeric sprint number (avoids colliding with main sprint scorecards)
SPRINT_NUM=$(slope next 2>/dev/null | grep -o 'Next sprint: S[0-9]*' | grep -o '[0-9]*')
SPRINT_NUM="${SPRINT_NUM:-0}"

if [ "$SPRINT_NUM" -gt 0 ]; then
  slope auto-card --sprint="$SPRINT_NUM" --theme="$SPRINT_TITLE" --branch="main..$BRANCH" 2>/dev/null || {
    log "Auto-card generation failed — manual review needed"
  }
else
  log "Warning: could not detect next sprint number — skipping auto-card"
fi
slope review 2>/dev/null || true

# ─── Create Pull Request ─────────────────────────

PASSING_COUNT=$(echo "$TICKET_RESULTS" | jq '[.[] | select(.tests_passing == true and .noop != true)] | length')
NOOP_COUNT=$(echo "$TICKET_RESULTS" | jq '[.[] | select(.noop == true)] | length')

if [ "$PASSING_COUNT" -gt 0 ] && command -v gh >/dev/null 2>&1; then
  # Check if branch has commits ahead of main
  AHEAD=$(git rev-list --count main.."$BRANCH" 2>/dev/null || echo 0)
  if [ "$AHEAD" -gt 0 ]; then
    # Build PR body from ticket results
    PR_BODY="## Sprint $SPRINT_ID — $SPRINT_TITLE

**Strategy:** $SPRINT_STRATEGY | **Tickets:** $TICKET_COUNT | **Passing:** $PASSING_COUNT | **No-ops:** $NOOP_COUNT

### Tickets
$(echo "$TICKET_RESULTS" | jq -r '.[] | "- **\(.ticket)**: \(.title) — \(if .noop then "no-op" elif .tests_passing then "pass" else "fail" end) (\(.final_model | split("/") | last))"')

### Verification
- Tests: $([ "$PASSING_COUNT" -gt 0 ] && echo 'passing' || echo 'failing')
- Generated by autonomous loop (\`slope-loop/run.sh\`)"

    PR_URL=$(gh pr create \
      --base main \
      --head "$BRANCH" \
      --title "feat($SPRINT_ID): $SPRINT_TITLE" \
      --body "$PR_BODY" 2>&1) || {
      log "Warning: PR creation failed — create manually"
      PR_URL=""
    }

    if [ -n "$PR_URL" ]; then
      PR_NUMBER=$(echo "$PR_URL" | grep -o '[0-9]*$')
      log "PR created: $PR_URL (PR #$PR_NUMBER)"
    fi
  else
    log "No commits ahead of main — skipping PR creation"
  fi
else
  if [ "$PASSING_COUNT" -eq 0 ]; then
    log "No passing tickets — skipping PR creation"
  else
    log "Warning: gh CLI not available — skipping PR creation"
  fi
fi

# ─── Post-PR Review & Merge ──────────────────────

if [ -n "${PR_URL:-}" ] && [ -n "${PR_NUMBER:-}" ]; then
  log "=== Running structural review ==="

  # Clear any stale findings
  slope review findings clear 2>/dev/null || true

  # Run structural review
  FINDING_COUNT=$(review_pr "$PR_URL" "$SPRINT_ID" "${SPRINT_NUM:-0}")
  log "Structural review: $FINDING_COUNT finding(s)"

  # Amend scorecard with findings (if any)
  if [ "$FINDING_COUNT" -gt 0 ]; then
    slope review amend --sprint="${SPRINT_NUM:-0}" 2>/dev/null && log "Scorecard amended with review findings" || \
      log "Warning: scorecard amendment failed"
  fi

  # ─── Auto-Merge Safeguards ───────────────────
  MERGE_OK=true
  MERGE_BLOCK_REASON=""

  # Safeguard 1: No critical or major findings
  if [ "$FINDING_COUNT" -gt 0 ]; then
    CRITICAL_MAJOR=$(slope review findings list 2>/dev/null | { grep -cE '\b(critical|major)\b' || true; })
    CRITICAL_MAJOR="${CRITICAL_MAJOR:-0}"
    if [ "$CRITICAL_MAJOR" -gt 0 ]; then
      MERGE_OK=false
      MERGE_BLOCK_REASON="$CRITICAL_MAJOR critical/major finding(s)"
    fi
  fi

  # Safeguard 2: Tests still pass (filtered — excludes guards.test.ts false positive)
  if [ "$MERGE_OK" = "true" ]; then
    if ! $LOOP_TEST_CMD > /dev/null 2>&1; then
      MERGE_OK=false
      MERGE_BLOCK_REASON="tests failing"
    fi
  fi

  # Safeguard 3: Typecheck passes
  if [ "$MERGE_OK" = "true" ]; then
    if ! pnpm typecheck > /dev/null 2>&1; then
      MERGE_OK=false
      MERGE_BLOCK_REASON="typecheck failing"
    fi
  fi

  # Safeguard 4: PR is not too large (< 20 files changed)
  if [ "$MERGE_OK" = "true" ]; then
    FILES_CHANGED=$(gh pr view "$PR_NUMBER" --json changedFiles --jq '.changedFiles' 2>/dev/null || echo 0)
    FILES_CHANGED="${FILES_CHANGED:-0}"
    if [ "$FILES_CHANGED" -gt 20 ]; then
      MERGE_OK=false
      MERGE_BLOCK_REASON="$FILES_CHANGED files changed (threshold: 20)"
    fi
  fi

  # Safeguard 5: Must have at least one passing non-noop ticket
  if [ "$MERGE_OK" = "true" ] && [ "$PASSING_COUNT" -eq 0 ]; then
    MERGE_OK=false
    MERGE_BLOCK_REASON="no passing tickets"
  fi

  # Merge or flag
  MERGED=false
  if [ "$MERGE_OK" = "true" ]; then
    log "All safeguards passed — auto-merging"
    if gh pr merge "$PR_NUMBER" --squash --delete-branch > /dev/null 2>&1; then
      log "PR merged successfully"
      MERGED=true
    else
      log "Warning: auto-merge failed — merge manually"
    fi
  else
    log "Auto-merge blocked: $MERGE_BLOCK_REASON"
    log "Manual review required: $PR_URL"
    gh pr comment "$PR_NUMBER" --body "Auto-merge blocked: $MERGE_BLOCK_REASON. Manual review required." 2>/dev/null || true
  fi
fi

# ─── Auto-evolve agent guide skill ────────────────

MODELS_LOG="$LOG_DIR/${SPRINT_ID}-models.jsonl"
if [ -f "$MODELS_LOG" ]; then
  FAILED_TICKETS=$(grep '"tests_passing":false' "$MODELS_LOG" || true)
  ESCALATED_TICKETS=$(grep '"escalated":true' "$MODELS_LOG" || true)

  if [ -n "$FAILED_TICKETS" ] || [ -n "$ESCALATED_TICKETS" ]; then
    # Tier 2: Full detail -> references/sprint-history.md (unlimited)
    {
      echo ""
      echo "## Sprint $SPRINT_ID ($(date '+%Y-%m-%d'))"
      echo ""
      if [ -n "$ESCALATED_TICKETS" ]; then
        echo "**Escalated** (local model failed, M2.5 attempted):"
        echo "$ESCALATED_TICKETS" | jq -r '"- \(.ticket): \(.title) [\(.club)]"' 2>/dev/null || true
        echo ""
      fi
      if [ -n "$FAILED_TICKETS" ]; then
        echo "**Failed** (investigate patterns):"
        echo "$FAILED_TICKETS" | jq -r '"- \(.ticket): \(.title)"' 2>/dev/null || true
        echo ""
      fi
    } >> "$SPRINT_HISTORY"
    log "Sprint history updated: references/sprint-history.md"

    # Tier 1: Compact one-liners -> SKILL.md "Known Hazards"
    if [ -n "$FAILED_TICKETS" ]; then
      echo "$FAILED_TICKETS" | jq -r '.ticket + " " + .title' 2>/dev/null | while read -r line; do
        TICKET_ID_SHORT=$(echo "$line" | cut -d' ' -f1)
        TICKET_TITLE_SHORT=$(echo "$line" | cut -d' ' -f2-)
        sed -i '' "/^## Anti-Patterns/i\\
- [$SPRINT_ID] $TICKET_ID_SHORT: $TICKET_TITLE_SHORT — failed" "$AGENT_GUIDE" 2>/dev/null || true
      done
    fi
    if [ -n "$ESCALATED_TICKETS" ]; then
      echo "$ESCALATED_TICKETS" | jq -r '.ticket + " " + .club' 2>/dev/null | while read -r line; do
        TICKET_ID_SHORT=$(echo "$line" | cut -d' ' -f1)
        CLUB=$(echo "$line" | cut -d' ' -f2)
        sed -i '' "/^## Anti-Patterns/i\\
- [$SPRINT_ID] $TICKET_ID_SHORT: escalated from local [$CLUB]" "$AGENT_GUIDE" 2>/dev/null || true
      done
    fi
    log "SKILL.md hazards updated with sprint $SPRINT_ID"

    # Check if SKILL.md exceeds recommended limit
    GUIDE_WORDS=$(wc -w < "$AGENT_GUIDE" 2>/dev/null || echo 0)
    if [ "$GUIDE_WORDS" -gt "$AGENT_GUIDE_MAX_WORDS" ]; then
      log "Warning: SKILL.md is ${GUIDE_WORDS} words (limit: ${AGENT_GUIDE_MAX_WORDS}) — needs synthesis"
      log "  Run: slope-loop/slope-loop-guide/scripts/synthesize.sh"
    fi
  fi

  # Auto-regeneration: if enough new tickets, re-run model-selector
  TOTAL_LOGGED=$(wc -l "$LOG_DIR"/*-models.jsonl 2>/dev/null | tail -1 | awk '{print $1}' || echo 0)
  if [ -f "$SLOPE_DIR/slope-loop/model-config.json" ]; then
    LAST_COUNT=$(jq -r '.ticket_count // 0' "$SLOPE_DIR/slope-loop/model-config.json" 2>/dev/null)
    DELTA=$((TOTAL_LOGGED - LAST_COUNT))
    if [ "$DELTA" -ge "$MODEL_REGEN_THRESHOLD" ]; then
      log "Auto-regenerating model-config.json ($DELTA new tickets since last run)"
      npx tsx "$SLOPE_DIR/slope-loop/model-selector.ts" 2>/dev/null || true
    fi
  fi
fi

# Save structured sprint result
cat > "$RESULTS_DIR/$SPRINT_ID.json" << EOF
{
  "sprint_id": "$SPRINT_ID",
  "title": "$SPRINT_TITLE",
  "strategy": "$SPRINT_STRATEGY",
  "completed_at": "$(date -Iseconds)",
  "branch": "$BRANCH",
  "tickets_total": $TICKET_COUNT,
  "tickets_passing": $(echo "$TICKET_RESULTS" | jq '[.[] | select(.tests_passing == true and .noop != true)] | length'),
  "tickets_noop": $(echo "$TICKET_RESULTS" | jq '[.[] | select(.noop == true)] | length'),
  "tickets": $(echo "$TICKET_RESULTS" | jq '.')
}
EOF

# Clean up lock file
rmdir "$RESULTS_DIR/$SPRINT_ID.lock" 2>/dev/null || true

# Return to main after merge — clean up worktree
if [ "${MERGED:-false}" = "true" ]; then
  cd "$MAIN_REPO"
  git -C "$MAIN_REPO" worktree remove "$WORKTREE_DIR" --force 2>/dev/null || true
  git -C "$MAIN_REPO" branch -d "$BRANCH" 2>/dev/null || true
  git -C "$MAIN_REPO" pull 2>/dev/null || true
  log "=== Sprint $SPRINT_ID done (merged, worktree cleaned) ==="
else
  log "=== Sprint $SPRINT_ID done ==="
  log "Worktree preserved at: $WORKTREE_DIR"
  log "To merge manually:"
  log "  cd $MAIN_REPO && git merge $BRANCH"
  log "  git worktree remove $WORKTREE_DIR"
fi
