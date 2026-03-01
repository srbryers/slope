---
name: slope-sprint-workflow
version: "1.0"
description: Sprint lifecycle orchestration for SLOPE-managed projects
triggers:
  - "sprint"
  - "scorecard"
  - "slope card"
  - "pre-round"
  - "post-hole"
requires:
  - "@anthropic/slope-core"
context_files:
  - "CODEBASE.md"
  - ".slope/config.json"
---

# SLOPE Sprint Workflow

You are a sprint execution agent for a SLOPE-managed project. Follow the routine hierarchy precisely — each routine exists to prevent specific failure modes observed across 40+ sprints.

## Quick Reference

| Phase | Routine | Key Actions |
|-------|---------|-------------|
| Start | Pre-Round | `slope briefing`, verify last scorecard, set par/slope |
| Per-Ticket | Pre-Shot | Select club, check yardage book, scan hazards |
| Per-Ticket | Post-Shot | Score shot, record hazards, push |
| End | Post-Hole | Score hole, validate, review, distill, PR |

## Pre-Round Routine (Sprint Start)

Before writing any code:

1. **Run `slope briefing`** to get handicap snapshot, hazard index, and filtered gotchas
   - Add `--categories` or `--keywords` flags matching the sprint's work area
2. **Verify previous scorecard** — if the last sprint's scorecard is missing, create it now
3. **Branch hygiene** — confirm no stale branches from prior sprints
4. **Set par and slope:**
   - Par: 1-2 tickets = 3, 3-4 tickets = 4, 5+ tickets = 5
   - Slope: count complexity factors (new infra, multi-package, schema changes, external APIs)

## Pre-Shot Routine (Per-Ticket, Before Code)

1. **Select club** — declare complexity before writing code:
   - `driver` — risky, new architecture, unknown territory
   - `long_iron` — multi-package changes, significant refactoring
   - `short_iron` — standard feature work, well-understood patterns
   - `wedge` — small changes, config updates, docs
   - `putter` — trivial fixes, typos, one-line changes
2. **Check yardage book** — read relevant source files you'll modify
3. **Scan hazards** — check `bunker_locations` and common-issues for known gotchas
4. **Commit the club** — record it in your sprint tracking

## Post-Shot Routine (Per-Ticket, After Code)

1. **Score the shot:**
   - `fairway` / `green` / `in_the_hole` — on track or better
   - Miss directions: `long` (over-scoped), `short` (under-scoped), `left` (wrong approach), `right` (scope creep)
2. **Record hazards** — note any gotchas encountered (rough, bunker, water, trees)
3. **Check for penalties** — tests break? Reverts needed?
4. **Push** — the last push is the recovery point

## Post-Hole Routine (Sprint End)

1. **Score the hole** — audit commits, compute final score vs par
2. **Check reviews** — run `slope review recommend`
3. **Build scorecard** — create JSON in `docs/retros/sprint-N.json`, run `slope validate`
4. **Record review findings** — `slope review findings add` for each finding, then `slope review amend`
5. **Distill learnings** — update common-issues with new patterns
6. **Create PR and merge**

## Commit Discipline

**Commit triggers:** each new file, each feature, each migration, each doc update, each bug fix, before context switches, before risky operations, every ~15 minutes, session end.

**Push triggers:** after each ticket, every 30 minutes, before context compaction, before switching tickets, session end.

**Format:** `<type>(<ticket>): <imperative summary>`

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `wip`

## Hazard Types

| Hazard | Meaning | Common Cause |
|--------|---------|--------------|
| `rough` | Friction, wasted time | Unclear requirements, missing context |
| `bunker` | Architectural trap | Wrong abstraction, tech debt |
| `water` | Blocking issue | External dependency, infra failure |
| `trees` | UX/design issue | Poor user flow, accessibility gap |

## Anti-Patterns

- **Skipping pre-round** — leads to redundant work and missed hazards
- **Batching commits** — one crash loses all progress
- **Over-scoping tickets** — scope creep is a `right` miss; keep tickets focused
- **Ignoring hazard patterns** — recurring `rough` hazards signal systemic issues
- **Skipping reviews** — post-implementation reviews catch 15-20% of issues
