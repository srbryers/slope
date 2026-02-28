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

## Sprint Execution Protocol
1. Run `slope briefing` before starting any ticket
2. Claim tickets with `slope claim --target=<id>`
3. Make minimal, focused changes per ticket
4. Run `pnpm test` and `pnpm typecheck` before committing
5. Commit messages start with the ticket ID
6. Release tickets with `slope release --target=<id>`
7. After all tickets: `slope auto-card --sprint=<id>` then `slope review`

## Testing Conventions
- Tests use vitest — look for *.test.ts files adjacent to source
- Prefer snapshot tests for complex output structures
- Guard hooks run automatically during Claude Code sessions — respect their guidance
- Property-based tests cover scoring math invariants

## Model Tier Rules
- Putter/Wedge → local Qwen 32B (fast, free)
- Short Iron → local Qwen 32B (default), escalate to M2.5 on failure
- Long Iron/Driver → MiniMax M2.5 API (architect-level planning)
- Tickets touching 2+ files → always M2.5 regardless of club
- If local model fails → auto-escalate to M2.5 before marking as miss

## Known Hazards (auto-populated after each sprint)
<!-- Patterns that caused failures will appear here -->
<!-- Format: - [module]: [what went wrong] — [what to do differently] -->

## Anti-Patterns (auto-populated from failure analysis)
- Do not refactor unrelated code in a ticket
- Do not add dependencies without explicit acceptance criteria
- Do not modify test infrastructure unless the ticket specifically requires it
- Do not skip `pnpm typecheck` — strict TypeScript catches real bugs

## Error Handling
- If `slope auto-card` fails: check that the sprint has commits on the branch
- If `slope store status` reports issues: run `slope store backup` then `slope store restore`
- If Ollama returns empty responses: verify model is loaded with `ollama list`
- If aider edit blocks fail to parse: try `--edit-format diff` or `--edit-format whole`

For full sprint-by-sprint history, see `references/sprint-history.md`.
