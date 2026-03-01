#!/bin/bash
# slope-loop/run.sh — Run a single sprint from the generated backlog
# Usage: ./slope-loop/run.sh [sprint-id] [--dry-run]
# If no sprint-id, picks the next unscored sprint

set -euo pipefail

SLOPE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKLOG="$SLOPE_DIR/slope-loop/backlog.json"
RESULTS_DIR="$SLOPE_DIR/slope-loop/results"
LOG_DIR="$SLOPE_DIR/slope-loop/logs"
AGENT_GUIDE="$SLOPE_DIR/slope-loop/slope-loop-guide/SKILL.md"
SPRINT_HISTORY="$SLOPE_DIR/slope-loop/slope-loop-guide/references/sprint-history.md"
BRANCH_PREFIX="slope-loop"

# ─── Model Tier Configuration ─────────────────────
MODEL_LOCAL="${MODEL_LOCAL:-ollama/qwen2.5-coder:32b}"
MODEL_API="${MODEL_API:-openrouter/minimax/minimax-m2.5}"
MODEL_API_TIMEOUT=1800                              # 30min for complex tickets
MODEL_LOCAL_TIMEOUT=900                             # 15min for simple tickets
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

# ─── Run a single ticket with a given model ───────
run_ticket_with_model() {
  local ticket_id="$1"
  local model="$2"
  local timeout_s="$3"
  local prompt="$4"
  local aider_log="$LOG_DIR/${ticket_id}-$(basename "$model").log"

  local aider_args=(
    --model "$model"
    --message "$prompt"
    --auto-commits
    --auto-test
    --test-cmd "pnpm test"
    --yes
  )

  # Suppress streaming for local models (cleaner logs)
  if [[ "$model" == *"ollama"* ]]; then
    aider_args+=(--no-stream)
  fi

  # Inject agent guide skill if within token budget
  if [ -f "$AGENT_GUIDE" ]; then
    local guide_words
    guide_words=$(wc -w < "$AGENT_GUIDE")
    if [ "$guide_words" -le "$AGENT_GUIDE_MAX_WORDS" ]; then
      aider_args+=(--read "$AGENT_GUIDE")
    else
      log "   Warning: SKILL.md exceeds ${AGENT_GUIDE_MAX_WORDS} words — skipping injection"
    fi
  fi

  # Semantic context per ticket (fall back to CODEBASE.md)
  CONTEXT_FILE="$LOG_DIR/${ticket_id}-context.md"
  if pnpm slope context --ticket="$ticket_id" --format=snippets --top=8 > "$CONTEXT_FILE" 2>/dev/null; then
    if [ -s "$CONTEXT_FILE" ]; then
      aider_args+=(--read "$CONTEXT_FILE")
      log "   Injected semantic context ($(wc -l < "$CONTEXT_FILE" | tr -d ' ') lines)"
    else
      log "   Warning: slope context returned empty — falling back to CODEBASE.md"
      [ -f "$SLOPE_DIR/CODEBASE.md" ] && aider_args+=(--read "$SLOPE_DIR/CODEBASE.md")
    fi
  else
    log "   Warning: slope context failed — falling back to CODEBASE.md"
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

  timeout "$timeout_s" aider "${aider_args[@]}" \
    2>&1 | tee "$aider_log" || {
      log "   Warning: Aider timed out or errored on $ticket_id (model: $model)"
    }

  # Post-ticket guard equivalent: typecheck (Aider doesn't have SLOPE guard hooks)
  pnpm typecheck > /dev/null 2>&1 || log "   Warning: typecheck failing after $ticket_id"

  # Return test status
  if pnpm test > /dev/null 2>&1; then
    return 0
  else
    return 1
  fi
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
  echo "$SPRINT" | jq -c '.tickets[]' | while read -r TICKET; do
    TICKET_CLUB=$(echo "$TICKET" | jq -r '.club')
    TICKET_MAX_FILES=$(echo "$TICKET" | jq -r '.max_files // 1')
    TICKET_EST_TOKENS=$(echo "$TICKET" | jq -r '.estimated_tokens // 0')
    TICKET_MODEL=$(select_model "$TICKET_CLUB" "$TICKET_MAX_FILES" "$TICKET_EST_TOKENS")
    TICKET_KEY=$(echo "$TICKET" | jq -r '.key')
    log "  $TICKET_KEY -> model: $TICKET_MODEL (club=$TICKET_CLUB, files=$TICKET_MAX_FILES, tokens=$TICKET_EST_TOKENS)"
  done
  log "--- Dry run complete ---"
  rmdir "$RESULTS_DIR/$SPRINT_ID.lock" 2>/dev/null || true
  exit 0
fi

# Create working branch
BRANCH="$BRANCH_PREFIX/$SPRINT_ID"
git checkout -b "$BRANCH" 2>/dev/null || git checkout "$BRANCH"

# Ensure semantic index is current before starting tickets
CURRENT_SHA=$(git rev-parse HEAD)
INDEX_SHA=$(pnpm slope index --status --json 2>/dev/null | jq -r '.lastSha // empty' 2>/dev/null || true)
if [ "$CURRENT_SHA" != "$INDEX_SHA" ]; then
  log "Updating semantic index..."
  timeout 120 pnpm slope index 2>/dev/null || log "Warning: slope index failed — using stale index"
fi

# Enrich backlog if not already enriched (check for _enrichMeta version field)
ENRICH_VERSION=$(jq -r '._enrichMeta.version // 0' "$BACKLOG" 2>/dev/null)
if [ "$ENRICH_VERSION" -lt 1 ] 2>/dev/null; then
  log "Enriching backlog with file context..."
  timeout 120 pnpm slope enrich "$BACKLOG" 2>/dev/null || log "Warning: slope enrich failed"
fi

# Start Slope session
slope session start --sprint="$SPRINT_ID" 2>/dev/null || true

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

  PROMPT+="
START by reading the relevant source files, then implement the change."

  FINAL_MODEL="$TICKET_MODEL"
  ESCALATED="false"
  TESTS_PASSING="false"

  # Attempt 1: Primary model
  if run_ticket_with_model "$TICKET_KEY" "$TICKET_MODEL" "$TICKET_TIMEOUT" "$PROMPT"; then
    log "   Tests passing for $TICKET_KEY (model: $TICKET_MODEL)"
    TESTS_PASSING="true"
  else
    log "   Tests failing for $TICKET_KEY (model: $TICKET_MODEL)"

    # Attempt 2: Escalate to API if local model failed
    if [ "$ESCALATE_ON_FAIL" = "true" ] && [ "$TICKET_MODEL" = "$MODEL_LOCAL" ]; then
      log "   Escalating to $MODEL_API..."
      FINAL_MODEL="$MODEL_API"
      ESCALATED="true"

      # Reset changes from failed attempt (stash for recovery)
      log "   Stashing failed changes for recovery (git stash)"
      git stash push -m "slope-loop: failed $TICKET_KEY ($(date '+%Y%m%d-%H%M%S'))" 2>/dev/null || {
        log "   Warning: git stash failed, resetting"
        git checkout -- . 2>/dev/null || true
        git clean -fd 2>/dev/null || true
      }

      if run_ticket_with_model "$TICKET_KEY" "$MODEL_API" "$MODEL_API_TIMEOUT" "$PROMPT"; then
        log "   Tests passing for $TICKET_KEY after escalation to $MODEL_API"
        TESTS_PASSING="true"
      else
        log "   Tests still failing for $TICKET_KEY even after escalation"
      fi
    fi
  fi

  # Track model usage per ticket (JSONL)
  TICKET_RESULT="{\"ticket\":\"$TICKET_KEY\",\"title\":\"$TICKET_TITLE\",\"club\":\"$TICKET_CLUB\",\"max_files\":$TICKET_MAX_FILES,\"primary_model\":\"$TICKET_MODEL\",\"final_model\":\"$FINAL_MODEL\",\"escalated\":$ESCALATED,\"tests_passing\":$TESTS_PASSING}"
  echo "$TICKET_RESULT" >> "$LOG_DIR/${SPRINT_ID}-models.jsonl"
  TICKET_RESULTS=$(echo "$TICKET_RESULTS" | jq ". + [$TICKET_RESULT]")

  slope release --target="$TICKET_KEY" 2>/dev/null || true
  log "-- Ticket $TICKET_KEY complete --"
done < <(echo "$SPRINT" | jq -c '.tickets[]')

# ─── Post-Sprint: Score, Review & Evolve ──────────

log "=== Sprint $SPRINT_ID complete — scoring ==="

slope session end 2>/dev/null || true
slope auto-card --sprint="$SPRINT_ID" 2>/dev/null || {
  log "Auto-card generation failed — manual review needed"
}
slope review 2>/dev/null || true

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
  "tickets_passing": $(echo "$TICKET_RESULTS" | jq '[.[] | select(.tests_passing == true)] | length'),
  "tickets": $(echo "$TICKET_RESULTS" | jq '.')
}
EOF

# Clean up lock file
rmdir "$RESULTS_DIR/$SPRINT_ID.lock" 2>/dev/null || true

log "=== Sprint $SPRINT_ID done ==="
log "Review: slope card && git log --oneline $BRANCH"
log "Merge:  git checkout main && git merge $BRANCH"
