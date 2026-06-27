## Sprint 217 Review: Workflow Runtime Cleanup and Guard Scope Recovery

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
| S217-1 | Short Iron | In the Hole | - | Workflow cleanup now derives sprint identity from both the persisted sprint_id column and workflow variables, so older or partially populated running executions can still be paused and labeled by sprint. |
| S217-2 | Short Iron | In the Hole | - | Phase-boundary now extracts target sprint only from explicit start/run/claim flags or positional ticket IDs, ignores narrative sprint mentions, and covers the front-door `slope start --ticket` command. |
| S217-3 | Short Iron | In the Hole | - | workflow-step-gate now fails open when the only running execution does not match current sprint or session context, and true validation-step blocks include cleanup/resync recovery commands. |
| S217-4 | Wedge | In the Hole | - | Added SQLite-backed regressions proving cleanup pauses all scorecarded roadmap-complete abandoned executions in one pass and workflow-step-gate pauses stale validation executions before they can block edits. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| Wind | minor | Issue #572 crossed cleanup and guard behavior: abandoned durable workflow executions could survive in the store and then surface as unrelated Bash/Edit blocking. |

### Hazards Discovered

**Known hazards for future sprints:**
- Older workflow execution rows may preserve sprint identity only in variables.sprint_id.
- A lone stale validation execution can be more dangerous than multiple stale executions if guard selection treats it as authoritative.
- Phase-boundary target parsing should read explicit command targets, not arbitrary narrative sprint mentions.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Workflow execution sprint identity should be read from all durable sources, not only the newest dedicated column. | cleanup/resync now uses a shared sprint extraction helper that falls back to workflow variables before deciding an execution is unidentifiable. |
| Lessons | Guard selection should require relevance when current sprint context is known. | workflow-step-gate no longer lets a lone stale validation execution override current sprint/session context; it fails open with explicit recovery commands. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | `./node_modules/.bin/vitest.cmd run tests/cli/sprint-workflow.test.ts tests/cli/guards/workflow-step-gate.test.ts tests/cli/guards/phase-boundary.test.ts` passed: 3 files, 53 tests. |
| testing | healthy | `./node_modules/.bin/tsc.cmd --noEmit` passed. |
| review | healthy | Code review and required architect review found no blockers; the shared recovery logic stays centralized in workflow-resync and the guards fail open when context is ambiguous or stale. |

### Course Management Notes

- GitHub issue #572 is addressed by commits 4f91649, aa1f41b, 43d810a, and 640acb1.
- The sprint intentionally leaves unrelated dirty hook and slope-loop files untouched.
- Roadmap validation will still warn that S217 is not on main until this branch is merged.

### 19th Hole

- **How did it feel?** A clean recovery sprint: the failure mode was frustrating, but the fix became straightforward once stale store state and guard selection were treated as one workflow problem.
- **Advice for next player?** When a guard blocks routine work, first ask whether the selected durable execution actually belongs to the current sprint or session.
- **What surprised you?** The single-active fallback was riskier than the multiple-execution case because ambiguity already failed open, while one stale validation execution looked authoritative.
- **Excited about next?** S218 can move into store/bootstrap portability with the workflow guard path less likely to trap recovery work.
