
## Sprint 254 Review: Stop Asking the Operator

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 4 |
| Slope | 3 |
| Score | 4 |
| Label | Par |
| Fairway % | 100% (5/5) |
| GIR % | 100% (5/5) |
| Putts | 0 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 5)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S254-1 | Short Iron | In the Hole | Bunker: This exact change was attempted in S252 and reverted because it appeared to break deny. It had not: the earlier check went through the CLI, and the failure was a probe artifact. Calling the guard directly shows deny blocking on both non-implementing branches. An hour was lost to an unverified revert that a direct-call harness would have settled immediately. | Keyed off the policy rather than the session mode: deny blocks, off returns early, default ask becomes advisory context addressed to the agent, once per session. Verified through the real hook path in this repo — no output reaches the operator. |
| S254-2 | Wedge | Green | -- | The coverage whose absence made the S252 revert unresolvable. Five existing tests asserted the old ask contract, two of them added by me in S249 and S253; all updated to the intended behaviour. |
| S254-3 | Short Iron | In the Hole | Rough: The guard caught its own author within a minute of being wired up, on an inline python file write — the fourth occurrence of a hazard first recorded in S248 and re-documented in #653 the same day. Confirms the mechanism was the right call over another note, and that the signal now reaches the agent rather than the operator. | Keyed on the file-write call, not the interpreter, so read-only inline scripting stays silent. 11/11 against three real failures and six legitimate patterns. |
| S254-4 | Wedge | Green | Rough: Two registration assumptions were wrong and only typecheck caught them: toolCategories has no 'run_command' (it is 'execute_command'), and GuardHandler requires a Promise return. The docs entry shape was also different from what I assumed and had to be read first. Eight registration sites for one guard is a lot of coupling. | slope hook add generates hook config from the registry, so the registry entry covers new installs; this repo's .claude/settings.json was patched directly to take effect now. |
| S254-5 | Short Iron | Green | Bunker: Re-planning this phase mid-sprint renamed it, which blocked slope roadmap compile: my own #637 divergence check matched phases by name, so a rename looked like authored content vanishing. A false positive in a data-protection check is expensive — it blocks legitimate work and trains operators to reach for --force, which is exactly what the check exists to prevent. | Divergence now requires an orphaned sprint, so a phase whose sprints still compile is treated as renamed. The original #637 case (a phase plus six sprints existing only in the projection) is still caught, as is a projection-only phase declaring no sprints. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| undefined | undefined | undefined |
| undefined | undefined | undefined |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| Bunker | S254-1 | This exact change was attempted in S252 and reverted because it appeared to break deny. It had not: the earlier check went through the CLI, and the failure was a probe artifact. Calling the guard directly shows deny blocking on both non-implementing branches. An hour was lost to an unverified revert that a direct-call harness would have settled immediately. |
| Rough | S254-3 | The guard caught its own author within a minute of being wired up, on an inline python file write — the fourth occurrence of a hazard first recorded in S248 and re-documented in #653 the same day. Confirms the mechanism was the right call over another note, and that the signal now reaches the agent rather than the operator. |
| Rough | S254-4 | Two registration assumptions were wrong and only typecheck caught them: toolCategories has no 'run_command' (it is 'execute_command'), and GuardHandler requires a Promise return. The docs entry shape was also different from what I assumed and had to be read first. Eight registration sites for one guard is a lot of coupling. |
| Bunker | S254-5 | Re-planning this phase mid-sprint renamed it, which blocked slope roadmap compile: my own #637 divergence check matched phases by name, so a rename looked like authored content vanishing. A false positive in a data-protection check is expensive — it blocks legitimate work and trains operators to reach for --force, which is exactly what the check exists to prevent. |

**Known hazards for future sprints:**
- src/core/roadmap-sources.ts findRoadmapProjectionDivergence: a protective check with a false positive blocks real work and pushes operators toward --force.
- Adding a guard touches eight registration sites; toolCategories and GuardHandler shapes are easy to get wrong and only typecheck catches them.

### Course Management Notes

- Two hazards this sprint were process failures documentation had already been written for. Both are now mechanical. Where a rule has failed twice, stop writing rules.
- Never revert on an unverified failure. Build the direct harness first — the S252 revert cost real time and the regression was never there.

