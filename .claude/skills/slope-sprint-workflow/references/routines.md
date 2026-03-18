# Sprint Routines — Full Reference

Detailed steps for each routine in the SLOPE sprint hierarchy.

## Pre-Round Routine (Sprint Start)

Before writing any code in a new sprint:

1. **Run `slope briefing`** — Single command that outputs handicap snapshot, hazard index, nutrition alerts, filtered gotchas, and session continuity
   - Use `--categories=testing,api` or `--keywords=migration` to filter for the sprint's work area
2. **Verify previous scorecard exists** — If the last sprint's scorecard wasn't created, create it now
3. **Branch hygiene check** — `git branch -a` to confirm no stale branches remain
4. **Gap analysis** (if touching API or schema) — Read relevant docs and compare against implementation before writing code
5. **Set par and slope:**
   - Par from ticket count: 1-2 = 3, 3-4 = 4, 5+ = 5
   - Slope from complexity factors: new infra, multi-package, schema changes, external APIs, concurrent agents

## Pre-Shot Routine (Per-Ticket, Before Code)

Before starting each ticket:

1. **Select your club** — Declare approach complexity before writing code:
   - `driver` — risky/new, unknown territory
   - `long_iron` — multi-package changes, significant refactoring
   - `short_iron` — standard feature work, well-understood patterns
   - `wedge` — small changes, config updates, docs
   - `putter` — trivial fixes, typos, one-line changes
2. **Check the yardage book** — Review relevant codebase sections for files you'll modify
3. **Verify type shapes** — Before consuming any internal API or type, read the definition (LSP hover or source file). Do not assume property names or structure. This is the #1 recurring hazard source.
4. **Scan for hazards** — Check `bunker_locations` from recent scorecards and common issues for known gotchas
5. **Shell script check** — If the ticket touches `.sh` files, review for: destructive git ops, missing tool preflight checks, unsafe branch deletion (`-D` vs `-d`), unvalidated inputs
6. **Commit the club selection** — Note it in your sprint tracking before writing code

## Post-Shot Routine (Per-Ticket, After Completion)

After completing each ticket:

1. **Score the shot** — Determine result:
   - `fairway` — clean start, on track
   - `green` — landed correctly, near the hole
   - `in_the_hole` — perfect execution, no issues
   - Miss directions: `long` (over-scoped), `short` (under-scoped), `left` (wrong approach), `right` (scope creep)
2. **Record hazards** — Note any gotchas encountered:
   - `rough` — code friction, wasted time
   - `bunker` — architectural trap
   - `water` — blocking issue
   - `trees` — UX/design issue
3. **Check for penalties** — Tests break? Reverts needed? Each penalty adds to the score
4. **Mid-sprint review check** — After complex tickets (driver/long_iron club), run a quick self-review of the diff before moving on
5. **Update sprint tracking** — Mark ticket status
6. **Push** — The last push is the recovery point

## Post-Hole Routine (Sprint Completion)

After all tickets are complete:

1. **Score the hole** — Audit commits, compute final score vs par
2. **Check for reviews** — Run `slope review recommend` to see if implementation reviews are needed
3. **Build the SLOPE scorecard** — Create scorecard JSON in `docs/retros/sprint-N.json`. Run `slope validate` to confirm no errors
4. **Record review findings** — If reviews were done:
   - `slope review findings add --type=<type> --ticket=<key> --severity=<sev> --description="..."`
   - `slope review amend` to apply findings as hazards and recalculate score
5. **Distill learnings** — Update common-issues with new recurring patterns via `slope distill`
6. **Update codebase map** — Run `slope map` if any files, commands, or guards were added/removed. Commit the updated `CODEBASE.md`
7. **Create PR and merge** — All artifacts travel with the PR
8. **Review** — Run `slope review` to generate the sprint review markdown

## Post-Round Routine (Per-Phase)

At the end of each development phase:

1. **Compute handicap card** — Run `slope card` to see trending stats
2. **Review miss patterns** — Identify systemic issues from the handicap card
3. **Training program** — Based on trends, identify areas for focused practice sprints
