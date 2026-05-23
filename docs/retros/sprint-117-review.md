## Sprint 117 Review: Worktree Guard Hardening

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 3 |
| Slope | 2 |
| Score | 3 |
| Label | Par |
| Fairway % | 100% (1/1) |
| GIR % | 100% (1/1) |
| Putts | 0 |
| Penalties | 0 |
| Hazard Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 1)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S117-1 | Short Iron | In the Hole | - | Replaced per-call random fallback session ids with stable anonymous ids, expanded recovery command parsing to include Codex-style cmd payloads, and moved git rev-parse probes to execFileSync argv calls with regression coverage. |

### Hazards Discovered

No hazards recorded.

**Known hazards for future sprints:**
- Missing hook session_id must not create a fresh guard identity on every invocation.
- Worktree recovery command detection should read command text from command, cmd, and input payload fields.
- Guard git probes should use argv-based child process calls instead of shell strings.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Hook payloads can omit session_id; guard fallback ids must be stable across invocations. | worktree-check now derives anonymous ids from transcript_path or cwd so one unidentified session does not look like many concurrent sessions. |
| Lessons | Guard recovery commands need to account for harness payload shape differences. | worktree-check now reads command text from command, cmd, or input fields before deciding whether to allow worktree recovery. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | Focused worktree/stop-check guard tests, typecheck, build, and the full pnpm test suite passed. |
| workflow | healthy | S117 came from the SLOPE-generated local backlog after GitHub reported no open issues. |

### Course Management Notes

- GitHub issue queue was empty, so S117 used slope-loop/backlog.json item S-LOCAL-117.
- Added a cmd-payload recovery regression for git worktree add.
- Updated missing-session regression to prove the anonymous fallback is stable and sentinel caching prevents repeated self-registration.
- pnpm vitest run tests/cli/guards/worktree-check.test.ts tests/cli/guards/stop-check.test.ts passed: 38 tests.
- pnpm typecheck passed.
- pnpm build passed.
- pnpm test passed: 214 test files and 3472 tests.
- node dist/cli/index.js map --check passed before scorecard creation: Overall CURRENT.
- node dist/cli/index.js roadmap validate passed as structurally valid with only standing roadmap warnings plus expected branch-local S117 warnings before the PR reaches main.

### 19th Hole

- **How did it feel?** Small but useful: the local backlog pointed at exactly the kind of guard edge case that only shows up in real agent traffic.
- **Advice for next player?** When a guard tracks session identity, test missing-id behavior across repeated invocations, not only the first call.
- **What surprised you?** The old random fallback was meant to be safe, but it could turn a single anonymous session into a false multi-session conflict.
- **Excited about next?** The worktree guard is a little more tolerant of Codex-shaped payloads and less dependent on shell parsing.
