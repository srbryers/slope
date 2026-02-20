# Sprint Checklists (SLOPE Routine Hierarchy)

The SLOPE framework organizes sprint work into a hierarchy of routines, mirroring golf's structured approach to each shot, hole, and round.

## Pre-Round Routine (Sprint Start)

Before writing any code in a new sprint:

1. **Run `slope briefing`** — Single command that outputs handicap snapshot, hazard index, nutrition alerts, filtered gotchas, and session continuity
   - Use `--categories=testing,api` or `--keywords=migration` to filter for the sprint's work area
2. **Verify previous scorecard exists** — If the last sprint's scorecard wasn't created, create it now
3. **Branch hygiene check** — `git branch -a` to confirm no stale branches remain
4. **Gap analysis** (if touching API or schema) — Read relevant docs and compare against implementation before writing code
5. **Set par and slope** — Par from ticket count (1-2=3, 3-4=4, 5+=5), slope from complexity factors

## Pre-Shot Routine (Per-Ticket, Before Code)

Before starting each ticket:

1. **Select your club** — Declare approach complexity: driver (risky/new), long_iron (multi-package), short_iron (standard), wedge (small), putter (trivial)
2. **Check the yardage book** — Review relevant codebase sections for files you'll modify
3. **Scan for hazards** — Check `bunker_locations` from recent scorecards and common issues for known gotchas
4. **Commit the club selection** — Note it in your sprint tracking before writing code

## Post-Shot Routine (Per-Ticket, After Completion)

After completing each ticket:

1. **Score the shot** — Determine result: fairway (clean start), green (landed correctly), in_the_hole (perfect), or miss direction (long/short/left/right)
2. **Record hazards** — Note any gotchas encountered
3. **Check for penalties** — Tests break? Reverts needed? Each penalty adds to the score
4. **Update sprint tracking** — Mark ticket status
5. **Push** — The last push is the recovery point

## Post-Hole Routine (Sprint Completion)

After all tickets are complete:

1. **Score the hole** — Audit commits, compute final score vs par
2. **Build the SLOPE scorecard** — Create scorecard JSON in your retros directory. Run `slope validate` to confirm no errors
3. **Distill learnings** — Update common-issues with new recurring patterns
4. **Create PR and merge** — All artifacts travel with the PR
5. **Review** — Run `slope review` to generate the sprint review markdown

## Post-Round Routine (Per-Phase)

At the end of each development phase:

1. **Compute handicap card** — Run `slope card` to see trending stats
2. **Review miss patterns** — Identify systemic issues from the handicap card
3. **Training program** — Based on trends, identify areas for focused practice sprints
