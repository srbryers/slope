# Sprint 80 Plan — The Watchtower (Worktree-Aware Guards)

**Par:** 4 (4 tickets)
**Slope:** 3 (cross-cutting: guards, worktrees, workflow engine, store)
**Theme:** Make SLOPE guards and workflow enforcement work across agent worktrees

## Problem

SLOPE guards are session-level hooks that only run in the main Claude Code session. Agents in isolated worktrees (via `isolation: "worktree"`) don't inherit hooks. This causes:
- Stop hook shows "No active sprint" while agents work in worktrees (#252)
- Commit discipline, scope drift, scorecard validation not enforced (#249)
- Workflow checkpoints not enforced for subagent work (#251)
- Phase boundary cleanup not mechanically enforced (#250)

## Tickets

### T1: Stop hook detects worktree agents (#252)
**Club:** short_iron
**Files:** `src/cli/guards/next-action.ts`, `src/cli/guards/stop-check.ts`

Stop hook currently checks main branch sprint state only. Fix:
- Run `git worktree list` to find active agent worktrees
- Check each worktree for unpushed commits / recent activity
- Report "N agent(s) active in worktrees" instead of "No active sprint"
- Show worktree branches and last commit times

### T2: Guard check CLI for worktree agents (#249)
**Club:** long_iron
**Files:** `src/cli/commands/guard.ts`, new `src/cli/guards/worktree-guard-check.ts`

Agents in worktrees can't use session hooks. Provide:
- `slope guard check` — runs key guards (commit discipline, typecheck, test) as a CLI command
- Designed to be called explicitly by subagent prompts before commits
- Returns structured pass/fail result
- Can be included in workflow step rules: "Run `slope guard check` before committing"

### T3: Workflow context for subagents (#251)
**Club:** short_iron
**Files:** `src/cli/commands/sprint.ts`

Subagents need workflow awareness without running the full engine. Add:
- `slope sprint context <sprint_id>` — outputs remaining workflow steps as structured text
- Include: current phase, remaining steps, completion conditions, rules
- Designed to be included in subagent prompts (~500 tokens)
- `slope sprint validate <sprint_id>` — post-hoc check that all steps completed

### T4: Phase boundary auto-detection guard (#250)
**Club:** short_iron
**Files:** `src/cli/guards/phase-boundary.ts`

Extend existing phase-boundary guard to auto-detect phase completion:
- When a scorecard is committed, check if it's the last sprint in its phase (via roadmap.json)
- If so, block next `slope sprint run` until phase boundary doc exists
- `docs/retros/phase-N-boundary.md` as the gate artifact

## Review Tier

**Standard** (2 rounds) — 4 tickets, slope 3, cross-cutting guard + workflow changes.

## Dependencies

- T1 is independent (quick fix)
- T2 is independent (new CLI command)
- T3 is independent (new CLI subcommand)
- T4 is independent (extend existing guard)
