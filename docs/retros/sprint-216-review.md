## Sprint 216 Review: Roadmap Shipped-Signal Correctness

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 3 |
| Slope | 2 |
| Score | 4 |
| Label | Bogey |
| Fairway % | 100% (3/3) |
| GIR % | 100% (3/3) |
| Putts | 0 |
| Penalties | 0 |
| Hazard Penalties | 1 |

### Shot-by-Shot (Tickets Delivered: 3)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S216-1 | Short Iron | In the Hole | rough: The first pnpm verification path removed node_modules and hit better-sqlite3 native build approval in a noninteractive shell; repaired by reinstalling dependencies, approving builds, and rebuilding native bindings. | Bare sprint references now count as shipped evidence only when the commit subject has an implementation-shaped conventional type; nonzero ticket keys still count directly. |
| S216-2 | Short Iron | In the Hole | - | Roadmap and planning scoped bare sprint references are ignored when the subject is clearly reslotting, scoping, or triaging future work, while real implementation subjects still count. |
| S216-3 | Wedge | In the Hole | - | Added git-backed roadmap validate regressions proving docs-only planned references do not trigger shipped-sprint errors and real ticket-key commits still do. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| Wind | minor | Issue #573 exposed a signal-integrity bug: roadmap validation was treating docs and planning references as shipped sprint evidence. |

### Hazards Discovered

**Known hazards for future sprints:**
- Docs-only and roadmap-planning commits can mention sprint numbers without shipping sprint work.
- Bare sprint references need implementation-shaped subjects; ticket keys remain the stronger evidence.
- pnpm 11 build approval can block native dependencies in noninteractive repair paths after node_modules is removed.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Bare sprint references in git history need evidence before they can be treated as shipped work. | extractSprintReferences now requires implementation-shaped commit subjects for bare sprint refs, while preserving direct ticket-key detection. |
| Lessons | Planning and roadmap commits often mention future sprint numbers by design. | roadmap/planning scoped reslotting, scoping, spike, and triage subjects no longer create false shipped-sprint validation errors. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | `./node_modules/.bin/vitest.cmd run tests/core/analyzers/git.test.ts` passed after the shipped-reference detector changes. |
| testing | healthy | `./node_modules/.bin/vitest.cmd run tests/cli/roadmap.test.ts tests/core/analyzers/git.test.ts` passed: 2 files, 65 tests. |
| testing | healthy | `./node_modules/.bin/tsc.cmd --noEmit` passed. |
| process | rough | `pnpm install --frozen-lockfile` initially hit native build approval friction after node_modules was removed; `pnpm approve-builds --all` restored the better-sqlite3 binding and generated pnpm-workspace.yaml was removed. |

### Course Management Notes

- GitHub issue #573 is addressed by commits a2974a2, cd346c7, and 67208cd.
- The sprint intentionally leaves unrelated dirty hook and slope-loop files untouched.
- S216 closed the roadmap shipped-signal false positive before Phase 49 continues into workflow runtime recovery.

### 19th Hole

- **How did it feel?** A narrow but important signal repair: the roadmap was reading planning breadcrumbs as shipped reality.
- **Advice for next player?** When a validator consumes git history, separate exact ticket evidence from broad narrative mentions before making roadmap state decisions.
- **What surprised you?** The false positives came from useful planning commits, not bad data; the detector needed context instead of a broader regex.
- **Excited about next?** S217 can now tackle stale workflow cleanup without roadmap validation confusing recovery planning with completed implementation.
