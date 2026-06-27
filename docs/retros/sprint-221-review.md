## Sprint 221 Review: Codification Candidate Ledger and Sprint Model Clarity

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 4 |
| Slope | 3 |
| Score | 4 |
| Label | Par |
| Fairway % | 100% (4/4) |
| GIR % | 100% (4/4) |
| Putts | 0 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 4)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S221-1 | Short Iron | In the Hole | - | Review findings now support workaround entries with stable IDs, required recurrence and cost metadata, open codification status, shared helpers, help metadata, and focused CLI coverage. |
| S221-2 | Short Iron | Green | Rough: minor | Briefing now summarizes open codification candidates and low-cost codify-now items, while sprint closeout prompts explicitly ask agents to log recurring workarounds. |
| S221-3 | Short Iron | In the Hole | - | Findings resolve now marks codification candidates as paid_down or wontfix, records resolution timestamps, and supports codification-status filtering in the ledger. |
| S221-4 | Wedge | In the Hole | - | Interview prompts, generated roadmap language, getting-started docs, framework docs, tutorials, backlog docs, and start-sprint templates now describe SLOPE sprints as time-boxed or scope-based work units. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| Wind | moderate | The sprint touched the shared review findings schema, briefing output, workflow definition, CLI help, generated roadmap copy, docs, and templates. |

### Hazards Discovered

**Known hazards for future sprints:**
- New workflow steps must be reflected in workflow integration tests before closeout.
- Codification candidate metadata should stay constrained to recurring workaround findings until another finding type has a concrete need.
- Sprint terminology in generated docs should keep time-boxed and scope-based work units equally visible.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Recurring workarounds should live in the findings ledger instead of a parallel ad hoc system. | Workaround findings now carry recurrence, codification cost, status, and stable IDs through add, list, briefing, and resolve paths. |
| Lessons | Workflow definition changes need end-to-end workflow test updates. | The sprint-standard integration test now completes the codification_sweep step before update_map. |
| Lessons | SLOPE sprint copy should not imply calendar-only cadence. | User-facing setup, roadmap, and tutorial language now describes sprints as time-boxed or scope-based agent work units. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| Hydration | healthy | `./node_modules/.bin/tsc.cmd --noEmit` passed. |
| Diet | healthy | Focused findings, amend, review, help, briefing, interview, generator, and workflow integration suites passed while implementing the tickets. |
| Recovery | healthy | `./node_modules/.bin/vitest.cmd run tests/cli tests/core` passed: 224 files, 3451 tests. |
| Stretching | healthy | `node dist/cli/index.js roadmap validate` passed with only pre-existing warnings. |

### Course Management Notes

- GitHub issues #552 and #556 are addressed by commits 4d0c24d, 361b7a9, 5a7fa2f, a1786ba, and caf328d.
- The sprint intentionally leaves unrelated dirty hook and slope-loop files untouched.
- Closeout review gates are recorded as self_review because no independent reviewer or PR review evidence was run locally.

### 19th Hole

- **How did it feel?** This was a product-shaping sprint: small CLI primitives, but a meaningful shift from invisible workarounds to visible codification candidates.
- **Advice for next player?** When adding a workflow step, update both the prompts and the workflow execution tests in the same pass.
- **What surprised you?** The recurring workaround feature fit cleanly into the existing review findings surface once codification metadata was kept optional and narrow.
- **Excited about next?** S222 can publish the recovery train with #552 and #556 closed into a release-ready package.
