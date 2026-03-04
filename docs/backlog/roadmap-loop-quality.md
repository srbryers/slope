# Loop Quality Roadmap

Inspired by [Cursor's Scaling Agents](https://cursor.com/blog/scaling-agents) and [GSD (Get Shit Done)](https://github.com/gsd-build/get-shit-done).

## Completed (v1.17.0)

- **Structured prompts** — GSD-style specificity: target files, checkbox acceptance criteria, verification commands, model-specific approach
- **Substantiveness guard** — Detects and reverts comment-only/whitespace-only changes before running typecheck/tests
- **Actionable ticket descriptions** — Backlog generation includes explicit action instructions and requires substantive code changes

## Medium-Effort, High-Value

### Context budget per ticket
Inject a "you have N tokens, focus on the core change" instruction into the Aider prompt based on club/model. Local models need tighter budgets than API models.

**Files:** `src/cli/loop/executor.ts` (buildPrompt)

### Planner/executor separation
Instead of one Aider call per ticket, do two: (1) `slope prep` generates a concrete plan with exact files/functions/changes, (2) Aider executes the plan. We already have `slope prep` but it's optional and often fails on missing index.

**Files:** `src/cli/loop/executor.ts` (processTicket), `src/core/prep.ts`

### Analysis paralysis timeout
If Aider produces no file changes within the first 50% of the timeout, kill early and escalate rather than waiting for the full timeout. Saves 15+ minutes per stuck ticket.

**Files:** `src/cli/loop/executor.ts` (runAider)

## Longer-Term

### Context monitoring hook
GSD's approach: a PostToolUse hook tracks remaining context and injects warnings at 35%/25% thresholds. Could adapt for our guard system to warn agents about context pressure during Aider execution.

**Files:** new `src/cli/guards/context-monitor.ts`, hook registration

### Wave-based parallelism
Replace binary overlap detection (overlap → sequential fallback) with dependency graphs across tickets. Tickets with no shared modules run in parallel waves, maximizing throughput.

**Files:** `src/cli/loop/parallel.ts`

### Planner/worker hierarchy (Cursor pattern)
Separate planning from execution into distinct agent roles with different models. Planner generates detailed task specs, workers execute them. Different models may excel at each role.

**Files:** new architecture — would require significant refactor of executor.ts
