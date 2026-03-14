# Start Sprint — Pre-Sprint Setup and Briefing

Run the complete pre-sprint routine: verify prior sprint hygiene, get briefing, create branch, and initialize sprint state.

## Arguments

- `$ARGUMENTS` — optional: sprint number (auto-detected if omitted)

## Steps

### 1. Determine sprint number

- If a number was provided as an argument, use it
- Otherwise, run `slope next` to auto-detect the next sprint number

### 2. Verify prior sprint scorecard

Check that the previous sprint's scorecard exists at `docs/retros/sprint-{N-1}.json`:
- If missing, **stop and create it first** using `/post-sprint`
- If it exists, continue

### 3. Branch hygiene

- Run `git branch` to check for stale branches from prior sprints
- If stale branches exist, warn the user
- Create a new feature branch: `feat/sprint-{N}-<theme-slug>`

### 4. Run briefing

Run `slope briefing` to get:
- Handicap snapshot (rolling performance stats)
- Hazard index (recent gotchas by area)
- Filtered common issues relevant to this sprint's work area
- Session continuity (any handoffs from prior sessions)

If you know the sprint's work area, add filters:
```
slope briefing --categories=<area> --keywords=<topic>
```

### 5. Initialize sprint state

Run `slope sprint start --number={N}` to create the sprint state file with gate tracking.

### 6. Set par and slope

Based on the sprint plan:
- **Par**: 1-2 tickets = 3, 3-4 tickets = 4, 5+ tickets = 5
- **Slope**: Count complexity factors:
  - New infrastructure or architecture (+1)
  - Multi-package changes (+1)
  - Schema or API changes (+1)
  - External API integration (+1)
  - Learning curve / unfamiliar territory (+1)

### 7. Prior art research

Before implementation begins, search for existing solutions:
- How have other projects solved this problem?
- Are there standard algorithms or approaches?
- Any relevant GDC talks, blog posts, or papers?

Save findings to `docs/` for reference during implementation.

### 8. Present sprint summary

Show the user:
- Sprint number and theme
- Par and slope
- Ticket list with planned clubs
- Key hazards to watch for (from briefing)
- Any deferred findings from prior sprints targeting this sprint

## Important

- Never skip the prior scorecard verification — this prevents the "batch without reflection" problem
- The briefing output contains critical context; read it carefully before starting
- If the codebase map is stale, run `slope map` to refresh it
