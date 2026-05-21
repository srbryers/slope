## Sprint 106 Review: Scorecard Hazard Fallback

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 4 |
| Slope | 1 |
| Score | 4 |
| Label | Par |
| Fairway % | 100% (1/1) |
| GIR % | 100% (1/1) |
| Putts | 0 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 1)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S106-1 | Short Iron | Green | - | Added a scorecard-derived fallback for hazard guard warnings when common issues do not match, preserved common-issues precedence, documented source ordering, and covered shot hazards plus bunker locations in tests. |

### Hazards Discovered

Known hazards for future sprints:

- Hazard guard fallback should keep common-issues.json as the first source and only read recent scorecards when no common issue matches the touched area.
- Scorecard-derived hazard matching should avoid generic path segments such as src, test, tests, package, and packages to prevent broad false positives.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Scorecard fallback matching needs to be narrower than common-issue matching so generic path segments do not create noisy guard warnings. | The fallback ignores generic and very short path segments unless the full touched area appears in the scorecard text. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | Focused guard and briefing tests, typecheck, build, guard docs smoke test, and full Vitest suite passed. |

### Course Management Notes

- Validation used pnpm vitest run tests/cli/guards.test.ts tests/cli/commands/guard.test.ts tests/core/briefing.test.ts.
- Additional validation used pnpm run typecheck, pnpm run build, node dist/cli/index.js guard docs hazard, and pnpm test.
- The fallback uses guidance.hazardRecency to limit recent scorecards and dedupes repeated scorecard warning text after sorting newest first.

### 19th Hole

- **How did it feel?** A targeted guard-feeding change with clear source precedence and enough tests to protect against both silence and warning spam.
- **Advice for next player?** When expanding guard inputs, keep the hook output compact and document precedence so richer context does not become surprising behavior.
- **What surprised you?** The existing hazard docs already claimed recent scorecard hazards were involved, so the implementation needed to make that contract true rather than introduce a new surface.
- **Excited about next?** Use this richer guard signal to evaluate whether remaining underused guards need better payload coverage or should be retired.
