# Sprint 78 Plan — The Wiring (Fix Gaps)

**Par:** 4 (4 tickets)
**Slope:** 1 (small focused fixes on existing infrastructure)
**Theme:** Wire up unfinished features: forceApi retry, pause/resume, guard decision logging, CODEBASE.md

## Tickets

### T1: Wire forceApi in executor — make retry strategy 'model' functional
**Club:** short_iron
**Files:** `src/cli/loop/executor.ts`, `src/cli/loop/model-selector.ts`

The `retryStrategy: 'model'` config sets `forceApi: 'true'` in retry flags but processTicket/selectModel never reads it. Wire the flag through.

### T2: Implement workflow pause/resume
**Club:** short_iron
**Files:** `src/core/workflow-engine.ts`, `src/cli/commands/sprint.ts`

State machine defines `paused: ['running', 'failed']` but pause() is never implemented. Add pause/resume methods to WorkflowEngine and `slope sprint pause/resume` CLI.

### T3: Guard decision JSONL writer
**Club:** wedge
**Files:** `src/cli/commands/guard.ts`

`computeGuardMetrics()` reads guard decision JSONL but nothing writes it. After each guard runs, append a line to `.slope/guard-decisions.jsonl`. Add `slope guard metrics` CLI command.

### T4: Regenerate CODEBASE.md
**Club:** putter
**Files:** `CODEBASE.md`

18 commits stale. Run `slope map` and commit.
