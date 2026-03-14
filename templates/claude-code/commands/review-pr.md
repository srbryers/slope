# Review PR — Structured Implementation Review

Run a structured implementation review with finding tracking and scorecard amendment.

## Arguments

- `$ARGUMENTS` — optional: PR number, file path, or review tier override (light/standard/deep)

## Steps

### 1. Determine review scope

- If a PR number was provided, use `gh pr view <number>` to get the diff
- Otherwise, use `git diff main...HEAD` to see all changes on the current branch
- Count tickets, packages touched, and complexity factors

### 2. Get review recommendations

Run `slope review recommend` to see which review types are suggested based on the sprint characteristics. The output will suggest review types like:
- `architect` — module boundaries, data model, coupling, integration points
- `code` — correctness, edge cases, bugs, unused code, runtime safety
- `security` — auth, injection, secrets, OWASP top 10
- `ux` — user experience, accessibility, flow coherence

### 3. Start review tracking

Run `slope review start` to initialize review state. This auto-detects the tier from the plan, or you can override with `--tier=<tier>`.

### 4. Run reviews

Launch review agents in parallel based on the recommendations. For each review type:

1. **Code Quality Review** (always): Staff engineer perspective — correctness, edge cases, bugs, unused code, runtime safety, error handling
2. **Architecture Review** (if recommended): Staff architect perspective — module boundaries, data model extensibility, coupling, constants management, integration points, testing strategy
3. **Specialist Reviews** (if recommended): Domain-specific reviews based on the sprint's work area

Each review agent should:
- Read all changed files
- Analyze against its specialty area
- Produce findings with: review_type, ticket_key, severity (minor/moderate/major/critical), description

### 5. Record findings

For each finding from the reviews, run:

```
slope review findings add --type=<type> --ticket=<key> --severity=<sev> --description="<desc>"
```

### 6. Complete review round

Run `slope review round` to mark the review round complete.

### 7. Amend scorecard

If findings were recorded, run `slope review amend` to inject them as hazards into the scorecard. This may adjust the sprint score.

### 8. Present consolidated results

Present all findings to the user in a table:

| # | Type | Ticket | Severity | Description | Action |
|---|------|--------|----------|-------------|--------|

For each finding, recommend one of:
- **Fix now** — fix in the current sprint before merge
- **Defer** — track with `slope review defer --from=<current> --to=<target> --severity=<sev> --description="<desc>"` for a future sprint
- **Accept** — acknowledged risk, no action needed

All findings must be explicitly addressed — no unacknowledged findings.

## Important

- Save individual review agent outputs to `docs/reviews/` before consolidating
- Never skip the `slope review findings add` step — findings feed the handicap system
- All findings must be addressed (fix, defer, or accept) before the PR can merge
