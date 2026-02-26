# Sprint Plan Review Loop

After creating a sprint plan, run a structured review to catch issues before implementation.

## Review Tier Selection

| Tier | Rounds | When to use |
|------|--------|-------------|
| **Skip** | 0 | Research, infra, or docs-only sprints |
| **Light** | 1 | 1-2 tickets, familiar patterns, single-package |
| **Standard** | 2 | 3-4 tickets, multi-package, or schema/API changes |
| **Deep** | 3 | 5+ tickets, new infrastructure, architectural changes |

## Review Process

### Round 1 — Deep Review

Check the plan against the codebase:
- Does the plan duplicate existing infrastructure?
- Are dependencies correct and ordering optimal?
- Does the approach match codebase patterns?
- Are there scope gaps or underscoped complexity?
- Does it introduce unnecessary complexity?

### Round 2 — Delta Review (Standard+)

Review **only what changed** since Round 1:
- Were Round 1 findings addressed correctly?
- Did revisions introduce new issues?

### Round 3 — Final Sign-off (Deep only)

Delta review of Round 2 changes. Expected outcome: approval with minor notes.

## Implementation Review Findings

After implementation, reviews may discover issues in shipped code. These findings should be tracked as structured data and applied to the scorecard:

1. **Run `slope review recommend`** — Check which review types apply to the sprint
2. **Conduct reviews** — Run architect, code, ML, security, or UX reviews as recommended
3. **Record findings** — For each issue found: `slope review findings add --type=<type> --ticket=<key> --severity=<sev> --description="..."`
4. **Amend scorecard** — Run `slope review amend` to inject findings as hazards and recalculate score

Review types map to hazard types: architect→bunker, code→rough, ml-engineer→rough, security→water, ux→trees.

## Tool Priority

1. **Search** to check function signatures, type definitions, patterns
2. **Find** to verify file existence and related files
3. **Read** only when search can't answer (complex multi-line logic)
