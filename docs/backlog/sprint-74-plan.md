# Sprint 74 Plan — The Assembly Line (Batch Sprint Execution)

**Par:** 4 (4 tickets)
**Slope:** 3 (cross-cutting: loop orchestration, roadmap integration, worktree management)
**Theme:** Dependency-aware batch sprint execution with failure recovery

## Context

The loop currently has two execution modes:
- **Continuous** (`src/cli/loop/continuous.ts`): sequential sprint loop, no dependency awareness
- **Parallel** (`src/cli/loop/parallel.ts`): dual-sprint parallel, module overlap detection only

Neither mode reads `roadmap.json` for `depends_on` relationships. The backlog format (`BacklogSprint`) has no dependency field. Sprints run in backlog order regardless of prerequisites.

**What already exists:**
- `src/core/roadmap.ts` — full dependency types, validation, critical path analysis
- `src/cli/loop/backlog.ts` — sprint locking (mkdir-based), validation, remaining sprint detection
- `src/cli/loop/executor.ts` — single sprint runner with escalation (local→API)
- `src/cli/loop/worktree.ts` — create, mirror, cleanup

**Key design decision:** add `depends_on` to `BacklogSprint` rather than reading roadmap.json directly. This keeps the loop self-contained — the backlog is the single source of truth for execution. Roadmap dependencies can be propagated to backlog at generation time.

## Tickets

### T1: Dependency-aware sprint scheduling — respect depends_on in continuous mode
**Club:** long_iron
**Files:** `src/cli/loop/types.ts`, `src/cli/loop/continuous.ts`, `src/cli/loop/backlog.ts`, `tests/cli/loop/backlog.test.ts`

**Problem:** Continuous mode runs sprints in backlog order. If S74 depends on S73, but backlog has them reversed, S74 runs first and fails.

**Approach:**
- Add optional `depends_on?: string[]` field to `BacklogSprint` (sprint IDs like `"S73"`)
- Add `getReadySprints(backlog, completedIds)` to `backlog.ts` — returns sprints whose dependencies are all in `completedIds`
- Update `continuous.ts` to use `getReadySprints()` instead of sequential iteration
- If no sprints are ready (all blocked by deps), log warning and exit
- `completedIds` derived from existing result files in `config.resultsDir`

**Hazard watch:** `getRemainingSprintIds` already filters by result files — `getReadySprints` should compose with it, not duplicate. The atomic lock in `selectNextSprint` must still work (pick first ready sprint, lock it).

### T2: Parallel worktree management — auto-create/cleanup for N sprints
**Club:** short_iron
**Files:** `src/cli/loop/parallel.ts`, `tests/cli/loop/parallel.test.ts`

**Problem:** Parallel mode is hardcoded to 2 sprints. With dependency-aware scheduling, we can identify independent sprint groups and run more in parallel.

**Approach:**
- Refactor `parallel.ts` to accept N ready sprints (from T1's `getReadySprints`)
- Group ready sprints by module non-overlap: greedily build groups where no two sprints share modules
- Execute each group concurrently via `Promise.allSettled` (existing pattern)
- After each group completes, recompute ready sprints (newly completed deps may unblock more)
- Continue until no sprints remain or all are blocked
- Default max concurrency: 3 (configurable via `LoopConfig.maxParallelSprints`)

**Hazard watch:** Each parallel sprint needs its own worktree. Worktree creation is ~5s (pnpm install + build). With 3+ parallel sprints, startup time dominates. Keep existing "preserved on failure" behavior.

### T3: Sprint failure recovery — auto-retry with different strategy
**Club:** short_iron
**Files:** `src/cli/loop/executor.ts`, `src/cli/loop/types.ts`, `tests/cli/loop/executor.test.ts`

**Problem:** When all tickets in a sprint fail, the sprint is marked as done with 0 passing. There's no retry with a different approach. The existing escalation only changes the model (local→API), not the strategy.

**Approach:**
- Add `retryStrategy` to `LoopConfig`: `'none' | 'replan' | 'model'` (default: `'model'`)
  - `'none'`: no retry (current behavior)
  - `'model'`: retry with API model (current escalation, now explicit)
  - `'replan'`: regenerate the execution plan with a different prompt emphasis before retrying
- Add `max_retries` to `LoopConfig` (default: 1)
- Track retry count in `SprintResult` (`retries?: number`)
- On sprint failure (0 passing tickets): check retry budget → if available, revert all commits, regenerate plan, re-execute
- Result files include retry metadata so `slope loop results` shows retry history

**Hazard watch:** Revert-before-retry must be clean — use the pre-sprint SHA saved at worktree creation. `replan` strategy needs access to the failure log from the first attempt to generate a better prompt.

### T4: Batch execution report — summary of all sprints run in a batch
**Club:** wedge
**Files:** `src/cli/commands/loop.ts`, `tests/cli/loop/loop-cmd.test.ts`

**Problem:** After running `slope loop continuous` or `slope loop parallel`, there's no consolidated summary. Results are written per-sprint.

**Approach:**
- Add `slope loop results --batch` flag that aggregates all results from `config.resultsDir`
- Output: total sprints, passing/failing, total tickets, per-sprint summary line
- Include timing data (total duration from first to last `completed_at`)
- Add `--json` flag for machine-readable output
- Optionally filter by date range: `--since=2026-03-24`

**Hazard watch:** Result files may include stale results from previous batches. `--since` filtering avoids showing ancient data. Default (no filter) shows all results.

## Review Tier

**Standard** (2 rounds) — 4 tickets, slope 3, cross-cutting loop orchestration changes. T1 is the riskiest (changes scheduling logic).

## Dependencies

- T1 must complete first (T2 uses `getReadySprints`)
- T2 depends on T1
- T3 is independent (modifies executor, not scheduling)
- T4 is independent (read-only results aggregation)
