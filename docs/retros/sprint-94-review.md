## Sprint 94 Review: Guard Enforcement Hardening

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 4 |
| Slope | 2 |
| Score | 4 |
| Label | Par |
| Fairway % | 100% (4/4) |
| GIR % | 100% (4/4) |
| Putts | 0 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 4)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S94-1 | Short Iron | Green | — | Commit 289714d covers real guardCommand stdin/stdout behavior, adhoc claim-required asks, suppressed workflow guard metrics, and batched write guard behavior. |
| S94-2 | Wedge | In the Hole | — | Commit 1c5acc5 locks claim-required into Codex write matcher coverage for generated configs, project installs, and user installs. |
| S94-3 | Short Iron | Green | Rough: Codex hook behavior can look current while resolving a stale project-local package or stale dev dist output. | Commit e803279 adds codex-runtime diagnostics for project-local package precedence and stale SLOPE dev dist output. |
| S94-4 | Short Iron | Green | — | Commit e0262ff adds guidance.requireSprintForImplementationWrites with ask, deny, and off modes. Commits 2f0c0f1 and 8a91f97 handled sprint scoping and stale Claude lock cleanup. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| Wind | moderate | The #368 emergency patch fixed the immediate no-sprint gap, but the larger guard contract needed coverage at the dispatcher, install, runtime, and config layers. |
| Pin Position | minor | The default behavior had to stay advisory enough for adhoc work while allowing strict repos to deny implementation writes outside sprint or claim flow. |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| Rough | S94-3 | Codex hook behavior can look current while resolving a stale project-local package or stale dev dist output. |

**Known hazards for future sprints:**
- Codex runtime resolution can prefer project-local node_modules/.bin/slope or SLOPE dev dist/cli/index.js before the global package.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Guard fixes need tests through the installed harness path, not only the guard helper function. | Added dispatcher-level and Codex install coverage so matcher or batch suppression regressions fail in tests. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| cleanup | healthy | Removed the stale .claude/scheduled_tasks.lock file requested at sprint start. |

### Course Management Notes

- Default no-sprint implementation writes ask for permission; strict mode denies; off mode allows outside-sprint implementation writes.
- Active implementing sprints still preserve the existing missing-claim advisory by default, with strict mode upgrading that path to deny.
- Full test suite passed after implementation: 199 test files, 3341 tests.

### 19th Hole

- **How did it feel?** A focused hardening sprint: small surface area, but the important path spans dispatcher output, installed matchers, runtime resolution, and config semantics.
- **Advice for next player?** When changing a workflow-control guard, add coverage for helper behavior, CLI dispatcher output, installed hook matchers, and the runtime binary that the hook will actually execute.
- **What surprised you?** The local auto-card path did not recognize the in-branch S94 roadmap entry and initially over-scanned history, so the reviewed scorecard needed manual correction.
- **Excited about next?** Use the new strictness knob in a real repo and decide whether SLOPE itself should default to ask or deny for source writes without claims.
