## Sprint 105 Review: Guard Metric Silent Reasons

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 3 |
| Slope | 1 |
| Score | 3 |
| Label | Par |
| Fairway % | 100% (1/1) |
| GIR % | 100% (1/1) |
| Putts | 0 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 1)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S105-1 | Short Iron | Green | - | Added metric-only guard reason codes, reason aggregation in guard analytics, CLI reason counts, and focused tests for JSONL output shape plus guard-specific silent reasons. |

### Hazards Discovered

Known hazards for future sprints:

- Reason-only GuardResult fields must remain hook-internal; adapters and batched output should keep ignoring results without context, decisions, block reasons, or suggestions.
- review recommend can undercount ad hoc GitHub issue work when the active sprint has no roadmap or plan ticket entry.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Reason-only guard results need to remain invisible to hook output while still being captured in metrics. | Adapters and batched guard output still key off context, decisions, block reasons, and suggestions; metricReason is only consumed by recordGuardExecution. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | Focused guard/analytics tests, typecheck, build, guard metrics smoke, and full Vitest suite passed. |

### Course Management Notes

- Validation used pnpm vitest run tests/core/analytics.test.ts tests/cli/commands/guard.test.ts tests/cli/guards.test.ts tests/cli/guards/pr-review.test.ts tests/cli/guards/pr-review-recommend.test.ts.
- Additional validation used pnpm run typecheck, pnpm run build, node dist/cli/index.js guard metrics, and pnpm test.
- slope review recommend reported only optional code review for S105; manual code and architecture review found no issues.

### 19th Hole

- **How did it feel?** A compact telemetry change with clear acceptance criteria and useful immediate feedback from the live guard metrics file.
- **Advice for next player?** When adding guard result metadata, verify both direct guard tests and real guardCommand JSONL output so internal fields do not leak into hook responses.
- **What surprised you?** The live metrics immediately showed old adhoc suppressions and a new irrelevant-command reason, which confirms the CLI surface makes underutilization easier to diagnose.
- **Excited about next?** Use the new reason counts to decide whether hazard and other guards are redundant, underfed, or missing payload data.
