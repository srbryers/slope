# Post-Sprint — Scorecard, Review, Distill

Run the complete post-sprint routine. This automates scorecard creation, validation, review generation, and common-issues distillation.

## Steps

### 1. Determine sprint number and gather context

- Run `slope next` to get the current sprint number, or check for an active sprint with `slope sprint status`
- Run `git log --oneline` to see all commits in the current sprint (since branching from main)
- Read the sprint plan if one exists in `.claude/plans/` or `docs/backlog/`

### 2. Build the scorecard

For each ticket/commit in this sprint, classify the shot:

- **Ticket key**: Extract from commit messages (e.g., `S21-1`)
- **Title**: Brief description of what was done
- **Club**: `driver` (risky/new), `long_iron` (multi-package), `short_iron` (standard), `wedge` (small), `putter` (trivial)
- **Result**: `fairway`, `green`, `in_the_hole`, or miss direction (`long`/`short`/`left`/`right`)
- **Hazards**: Any gotchas encountered (check commit messages and PR comments for clues)
- **Notes**: Key implementation details

Use the SLOPE MCP `execute` tool to build the scorecard programmatically:

```javascript
const scorecard = buildScorecard({
  sprint_number: N,
  theme: "Sprint theme from plan",
  par: computePar(ticketCount),
  slope: computeSlope(slopeFactors),
  date: new Date().toISOString().split('T')[0],
  shots: [/* classified shots */]
});
return JSON.stringify(scorecard, null, 2);
```

Write the scorecard to `docs/retros/sprint-N.json`.

### 3. Validate

Run `slope validate` to check the scorecard for errors and warnings. Fix any issues.

### 4. Generate review

Run `slope review` to generate the sprint review markdown. Share the output with the user.

### 5. Distill learnings

If any new recurring patterns were encountered during this sprint:
- Check `.slope/common-issues.json` for existing patterns
- Add new patterns or update `sprints_hit` arrays for existing ones

### 6. Update roadmap status

If a `docs/backlog/roadmap.json` exists:
- Update the current sprint's status to `"complete"`
- Check if this completes a phase — if so, update the phase status too

### 7. Prompt for PR

Ask the user if they'd like to create a PR. If yes, create one with the sprint review as the PR body.

## Important

- Always run `slope validate` after creating the scorecard — never skip this
- The scorecard must match the actual work done (commits), not the plan
- Record hazards honestly — they feed the handicap system and improve future guidance
- If the sprint had review findings, run `slope review amend` after adding findings
