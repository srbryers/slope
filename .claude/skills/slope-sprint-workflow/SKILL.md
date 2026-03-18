---
name: slope-sprint-workflow
version: "1.0"
description: >
  Sprint lifecycle orchestration for SLOPE-managed projects.
  Use when starting sprints, scoring tickets, building scorecards, running reviews,
  or following the routine hierarchy. Use when user says "sprint", "scorecard",
  "pre-round", "post-hole", "briefing", "review", "hazard", or "commit discipline".
triggers:
  - "sprint"
  - "scorecard"
  - "slope card"
  - "pre-round"
  - "post-hole"
  - "briefing"
  - "review"
context_files:
  - "CODEBASE.md"
  - ".slope/config.json"
---

# SLOPE Sprint Workflow

Sprint execution agent for SLOPE-managed projects. Follow the routine hierarchy precisely — each routine prevents specific failure modes observed across 60+ sprints.

## File Map

| File | Purpose |
|------|---------|
| `SKILL.md` | This file — overview and quick reference |
| `gotchas.md` | Top recurring hazards with prevention steps |
| `references/routines.md` | Full pre-round, pre-shot, post-shot, post-hole routines |
| `references/hazard-guide.md` | Hazard types with real sprint examples and prevention |
| `scripts/sprint-helpers.js` | execute() snippets for scorecard validation, briefing, branch hygiene |

## Quick Reference

| Phase | Routine | Key Actions |
|-------|---------|-------------|
| Start | Pre-Round | `slope briefing`, verify last scorecard, set par/slope |
| Per-Ticket | Pre-Shot | Select club, check yardage book, scan hazards |
| Per-Ticket | Post-Shot | Score shot, record hazards, push |
| End | Post-Hole | Score hole, validate, review, distill, PR |

## Par & Slope

- **Par:** 1-2 tickets = 3, 3-4 tickets = 4, 5+ tickets = 5
- **Slope:** Count complexity factors (new infra, multi-package, schema changes, external APIs, concurrent agents)

## Club Selection

| Club | Complexity | Examples |
|------|-----------|----------|
| `driver` | High risk, new territory | New infrastructure, unknown APIs |
| `long_iron` | Multi-package, significant | Cross-package refactors, schema migrations |
| `short_iron` | Standard feature work | Well-understood patterns, single package |
| `wedge` | Small changes | Config updates, docs, minor fixes |
| `putter` | Trivial | Typos, one-line changes |

## Commit Discipline

**Commit triggers:** each new file, each feature, each migration, each doc update, each bug fix, before context switches, every ~15 minutes, session end.

**Push triggers:** after each ticket, every 30 minutes, before compaction, session end.

**Format:** `<type>(<ticket>): <imperative summary>` — Types: feat, fix, refactor, docs, test, chore, wip

## Key CLI Commands

| Command | When |
|---------|------|
| `slope briefing` | Sprint start — handicap + hazards + nutrition |
| `slope validate` | After building scorecard JSON |
| `slope review recommend` | After all tickets — check which reviews apply |
| `slope review findings add` | Record each review finding |
| `slope review amend` | Apply findings as hazards to scorecard |
| `slope card` | View handicap card |
| `slope distill` | Promote patterns to common-issues |

Read `gotchas.md` before every sprint. Read `references/routines.md` for detailed routine steps.
