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
  Requires Slope CLI (@slope-dev/slope v1.13.1+) and slope-loop/ directory.
  Best with Slope MCP server connected. Works in Claude Code (with hooks),
  claude.ai (upload as skill), and API (via /v1/skills endpoint).
metadata:
  author: srbryers
  version: 0.1.0
  mcp-server: slope
  category: workflow-automation
---

# Slope Loop — Agent Guide

This skill is auto-injected into every automated sprint via Aider's `--read`
flag. It evolves automatically as the loop discovers patterns. It supplements
(does NOT replace) CLAUDE.md, .claude/rules/, or .claude/hooks/.

## Project Quick Reference
- SLOPE: Sprint Lifecycle & Operational Performance Engine
- Package: @slope-dev/slope (v1.13.1+)
- TypeScript monorepo, pnpm, vitest for tests, strict TypeScript
- 30 CLI commands, SQLite store, MCP server, 16 guard hooks
- Scoring: golf metaphors (handicap, par, birdie, bogey, hazards)

## Sprint Execution Protocol (Loop Context)
When running within the automated loop (via Aider with `--read` flag):

1. **Pre-sprint:** `slope briefing` shows hazards and nutrition trends
2. **Claim work:** `slope claim --target=<id>` to claim a ticket or area
3. **Focused changes:** Make minimal, targeted edits per ticket
4. **Validation:** Run `pnpm test` and `pnpm typecheck` before committing
5. **Commit:** Message format: `<ticket-id>: <description>`
6. **Release:** `slope release --target=<id>` to release the claim
7. **Post-sprint:** `slope auto-card --sprint=<id>` generates scorecard from git + CI signals
8. **Review:** `slope review` formats the sprint review

**Note:** The loop orchestrates sprint execution automatically. Do not manually invoke shell scripts (run.sh, continuous.sh, parallel.sh) — these are internal to the loop infrastructure.

## Testing Conventions
- Tests use vitest — look for *.test.ts files adjacent to source
- Prefer snapshot tests for complex output structures
- Guard hooks run automatically during Claude Code sessions — respect their guidance
- Property-based tests cover scoring math invariants
- **In loop context:** `pnpm test` runs before auto-card generation; failures block sprint completion

## Model Tier Rules
- Putter/Wedge → local Qwen 32B (fast, free)
- Short Iron → local Qwen 32B (default), escalate to M2.5 on failure
- Long Iron/Driver → MiniMax M2.5 API (architect-level planning)
- Tickets touching 2+ files → always M2.5 regardless of club
- If local model fails → auto-escalate to M2.5 before marking as miss

## Known Hazards (auto-populated after each sprint)
<!-- Patterns that caused failures will appear here -->
<!-- Format: - [module]: [what went wrong] — [what to do differently] -->

**Loop-specific hazards:**
- Do not assume shell script execution — the loop runs via Aider/Claude Code hooks
- Do not commit directly to main/master — the `branch-before-commit` guard blocks this
- Do not skip test validation — loop auto-card generation requires passing tests

## Anti-Patterns (auto-populated from failure analysis)
- Do not refactor unrelated code in a ticket
- Do not add dependencies without explicit acceptance criteria
- Do not modify test infrastructure unless the ticket specifically requires it
- Do not skip `pnpm typecheck` — strict TypeScript catches real bugs

## Error Handling (Loop Context)
- **If `slope auto-card` fails:** Check that the sprint has commits on the branch and tests pass
- **If `slope store status` reports issues:** Run `slope store backup` then `slope store restore`
- **If Ollama returns empty responses:** Verify model is loaded with `ollama list`
- **If aider edit blocks fail to parse:** Try `--edit-format diff` or `--edit-format whole`
- **If loop stalls:** Check guard output in transcript — guards may be blocking tool use
- **If escalation triggers:** Review `slope escalate` output and model tier rules (Putter/Wedge → local, Driver → M2.5)

## Loop Infrastructure (Reference)

The continuous loop is orchestrated by:
- **Backlog generation:** `npx tsx slope-loop/analyze-scorecards.ts` (regenerates sprint queue)
- **Sprint execution:** Aider runs with `--read slope-loop/slope-loop-guide/SKILL.md` and guard hooks
- **Result tracking:** Sprints stored in `slope-loop/results/` as JSON
- **Logging:** Session logs in `slope-loop/logs/`

Do not manually invoke `run.sh`, `continuous.sh`, or `parallel.sh` — these are internal orchestration scripts. Use `slope` CLI commands instead.

For full sprint-by-sprint history, see `references/sprint-history.md`.
