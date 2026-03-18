---
name: slope-loop-guide
description: >
  Institutional knowledge for the Slope autonomous development loop.
  Use when executing automated sprints, reviewing loop results, analyzing
  model tier performance, or working on Slope's own codebase via the loop.
  Use when user says "run a sprint", "check loop status", "review sprint
  results", "model performance", "escalation patterns", or "agent guide".
  Do NOT use for general Slope CLI usage or manual development — those are
  covered by the main Slope skill and CLAUDE.md.
compatibility: >
  Requires Slope CLI (@slope-dev/slope v1.31.0+) and slope-loop/ directory.
  Best with Slope MCP server connected. Works in Claude Code (with hooks),
  claude.ai (upload as skill), and API (via /v1/skills endpoint).
metadata:
  author: srbryers
  version: 0.2.0
  mcp-server: slope
  category: workflow-automation
---

# Slope Loop — Agent Guide

Auto-injected into every automated sprint via Aider's `--read` flag. Supplements (does NOT replace) CLAUDE.md, .claude/rules/, or .claude/hooks/.

## File Map

| File | Purpose |
|------|---------|
| `SKILL.md` | This file — overview, execution protocol, quick reference |
| `gotchas.md` | Loop-specific hazards with prevention steps |
| `references/model-tier-rules.md` | Club-to-model mapping, escalation triggers, token thresholds |
| `references/error-recovery.md` | Troubleshooting guide for all loop error scenarios |
| `references/sprint-history.md` | Per-sprint learning archive (stub — populated by loop automation after each sprint) |
| `scripts/synthesize.sh` | Compacts SKILL.md when it exceeds 5000 words |

## Project Quick Reference
- SLOPE: Sprint Lifecycle & Operational Performance Engine
- Package: @slope-dev/slope (v1.31.0+)
- TypeScript monorepo, pnpm, vitest for tests, strict TypeScript
- 46 CLI commands, SQLite store, MCP server, 28 guard hooks
- Scoring: golf metaphors (handicap, par, birdie, bogey, hazards)

## Sprint Execution Protocol (Loop Context)

1. **Pre-sprint:** `slope briefing` shows hazards and nutrition trends
2. **Claim work:** `slope claim --target=<id>` to claim a ticket or area
3. **Focused changes:** Make minimal, targeted edits per ticket
4. **Validation:** Run `pnpm test` and `pnpm typecheck` before committing
5. **Commit:** Message format: `<ticket-id>: <description>`
6. **Release:** `slope release --target=<id>` to release the claim
7. **Post-sprint:** `slope auto-card --sprint=<id>` generates scorecard from git + CI signals
8. **Review:** `slope review` formats the sprint review

**Note:** Use `slope loop` CLI commands — do not invoke shell scripts directly.

## Model Tier Rules (Summary)

| Club | Model | Escalation |
|------|-------|-----------|
| Putter/Wedge | Local (configurable) | — |
| Short Iron | Local (configurable) | Escalate on failure |
| Long Iron/Driver | API (configurable) | — |
| Multi-file (2+) | API (always) | — |
| >24K tokens | API (always) | — |

See `references/model-tier-rules.md` for full routing rules and configuration.

## Testing Conventions
- Tests use vitest — look for `*.test.ts` files adjacent to source
- Prefer snapshot tests for complex output structures
- Property-based tests cover scoring math invariants
- **In loop context:** `pnpm test` runs before auto-card generation; failures block sprint completion

## Anti-Patterns
- Do not refactor unrelated code in a ticket
- Do not add dependencies without explicit acceptance criteria
- Do not modify test infrastructure unless the ticket specifically requires it
- Do not skip `pnpm typecheck` — strict TypeScript catches real bugs

See `gotchas.md` for loop-specific hazards. See `references/error-recovery.md` for troubleshooting.

## Loop Infrastructure (Reference)

- **Backlog generation:** `npx tsx slope-loop/analyze-scorecards.ts`
- **Sprint execution:** Aider with `--read slope-loop/slope-loop-guide/SKILL.md` + guard hooks
- **Result tracking:** `slope-loop/results/` (JSON)
- **Logging:** `slope-loop/logs/`

For full sprint-by-sprint history, see `references/sprint-history.md`.
