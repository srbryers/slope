# Sprint 243 — Code Implementation Correctness Review

- **Reviewer / lane:** code-implementation-correctness-reviewer (adversarial correctness lane)
- **Scope:** `git diff main...feat/S243-stale-state-guard-scoping -- src/ tests/` (commits c040e30, 7b8a5b0, 5f07089)
- **Verification run:** `pnpm vitest run tests/cli/guards/ tests/cli/sprint-workflow.test.ts` — 24 files, 355 tests, all pass. `pnpm typecheck` clean. Edge cases probed with throwaway scripts (scratchpad only; none left in repo).

## Verdict: REQUEST CHANGES

Two findings gut the fixes they ship with: the phase-boundary staleness downgrade mis-decodes canonical sprint ids ≥ 200 ending in 5 (S235/S245 are in this repo's live roadmap **today**), and the dead-session staleness check can never fire in production because no shipped code path ever writes `session_id` onto a workflow execution. Both are invisible to the new tests because the fixtures use ids/session_ids that dodge the problem.

---

## Findings

### F1 — HIGH — phase-boundary downgrade mis-decodes canonical sprint ids (S235/S245-class), neutering the deny

**File:** `src/cli/guards/phase-boundary.ts:83-90`

The new staleness heuristic runs roadmap phase sprint ids and scorecard sprint numbers through the raw `sprintOrderValue()` (`src/core/roadmap.ts:102`), which decodes **any** integer in `[200, 1000)` ending in 5 as a legacy inserted half-sprint: `sprintOrderValue(245) === 24.5`. The roadmap-aware disambiguator `roadmapSprintOrderValue(roadmap, id)` (`src/core/roadmap.ts:226`) exists for exactly this and is exported from `src/core/index.ts:207`, but is not used.

**Failing input (probe-confirmed):** roadmap with `Phase 1 [243, 244]`, `Phase 2 [245, 246]`; only scorecard on disk is `sprint-243.json`; Phase 1 cleanup not recorded. `slope sprint start --sprint=245` should **deny** (no Phase-2 work exists), but boundaryOrder = min(24.5, 246) = **24.5**, `243 >= 24.5` → advisory downgrade fires and the command is allowed.

**This is not hypothetical:** the live `docs/backlog/roadmap.json` has `Phase 53 [233, 234, 235, 236]` and `Phase 54 [241, 242, 243, 244, 245]`, both containing mis-decodable ids (235, 245), and `docs/retros/` holds 193 scorecards — any scorecard ≥ S25 satisfies a 24.5/23.5 boundary. Every future phase containing a canonical id like 255, 265, 305 … has its boundary collapsed to ~1/10th, so the deny is effectively dead going forward. The scorecard side is also wrong in the other direction: `sprintOrderValue(card.sprint_number)` turns a real `sprint-235.json` into 23.5, understating evidence.

**Required fix:** use `roadmapSprintOrderValue(roadmap, id)` for the phase sprint ids, and compare scorecards using raw `card.sprint_number` (scorecards for inserted sprints are already stored as decimals, e.g. 43.5; if encoded scorecard ids exist, decode those roadmap-aware too). Add a regression test with a phase whose first sprint is 245.

### F2 — HIGH — dead-session staleness can never fire in production: `exec.session_id` is never set by any shipped code path

**Files:** `src/cli/workflow-resync.ts:154-163`, `src/cli/commands/sprint.ts:1287`, `src/cli/loop/workflow-adapter.ts:52`, `src/core/workflow-engine.ts:95`

The new reason requires `exec.session_id` to be truthy. `WorkflowEngine.start()` only sets it from `opts.session_id`, and neither production caller passes it — `slope sprint run` (`sprint.ts:1287`: `{ sprint_id, variables }`) nor the loop adapter (`workflow-adapter.ts:52`). Grep finds no other `engine.start` call site outside tests. So every real dangling execution — the exact #621 scenario this commit exists to fix — has `session_id: undefined` and is skipped by the guard clause. The new tests pass only because the fixtures fabricate `session_id: 'dead-session'`.

**Failing input:** start any sprint via `slope sprint run --workflow=sprint-standard --sprint=244`, kill the session, open a new session → `findStaleWorkflowExecutions` still reports nothing for the dead-session reason; the gate still blocks the new session (only the pre-existing scorecard/roadmap/age reasons can save it).

**Required fix:** plumb a session id into `engine.start` at both call sites (e.g., from the registered SLOPE session / harness hook `session_id` when available), or drop the `exec.session_id &&` precondition in favor of a different ownership signal. Either way, add an end-to-end test that goes through `slope sprint run` rather than a hand-built exec row.

### F3 — MEDIUM — once F2 is fixed: clean-Stop session removal + no-heartbeat-filter "active" set will pause **live** concurrent executions

**Files:** `src/cli/workflow-resync.ts:126-133`, `src/cli/guards/stop-check.ts:214-222`, `src/store/index.ts:472-475`

"Active" here means *row exists in the sessions table*: `SqliteSlopeStore.getActiveSessions()` is `SELECT * FROM sessions` with no heartbeat/ended filter. Meanwhile `stop-check` **deletes** the session row on every clean Stop (Claude Code fires Stop at the end of each turn, not at session end), and `worktree-check` re-registers it on the next tool use. So a live agent A routinely has no session row between turns.

**Failing sequence (multi-agent, shared store):** A owns running exec (session_id=A), ends a turn with a clean tree → row A deleted. B (registered) touches a file → workflow-step-gate → `reconcileWorkflowExecutions(currentSessionId=B)` → activeSessionIds = {B}, size ≥ 1, A ∉ set, A ≠ B → **A's live execution is paused** (`completeExecution(id,'paused')`), silently disabling A's gate and requiring manual resume. Same self-inflicted variant: A runs `slope sprint workflow resync` (sprint.ts:1359 passes no `currentSessionId`) while its own row is absent and any other row exists → A pauses its own execution.

Note also the inverse failure: crashed sessions leave rows behind (only `cleanStaleSessions` in worktree-check removes them), so a crashed owner is considered "active" and its exec is *not* flagged — under-detection in the primary #621 scenario.

**Required fix:** base liveness on heartbeat age (reuse `isStaleSession` / `STALE_SESSION_THRESHOLD_MS` from worktree-check) instead of raw row presence, and/or require a grace period (`exec.updated_at` older than N minutes) before dead-session evidence counts. Currently latent only because of F2 — fix them together.

### F4 — LOW/MEDIUM — `isWithinRepo` is lexical: symlink aliases and case-flips bypass the gate for in-repo files

**File:** `src/cli/guards/workflow-step-gate.ts:79-83`

`resolve()` does not canonicalize symlinks and `relative()` is case-sensitive. Probe-confirmed on this machine:

- `isWithinRepo('/private/tmp/…/repo', '/tmp/…/repo/file.ts')` → `false` (macOS `/tmp` → `/private/tmp`) — the same physical in-repo file is early-allowed, bypassing the gate. Same result for the reverse direction.
- `isWithinRepo('/Users/…/slope', '/users/…/slope/src/x.ts')` → `false` on case-insensitive APFS — bypass.

Prefix-sibling (`/a/repo` vs `/a/repo2`), parent, `..foo`-named files, and trailing-slash cases are all handled correctly. The gate fails open by design elsewhere, but this makes a deliberate bypass one path-alias away, and accidental bypass plausible when the harness reports `input.cwd` in symlinked form (e.g. launched from `/tmp/...`). Relative-path resolution against `cwd` is fine: guard.ts:140 sets `cwd = input.cwd`, and the guard already no-ops when `cwd` isn't the `.slope` root.

**Suggested fix:** canonicalize both sides with `realpathSync` (falling back to the lexical path for non-existent targets — resolve the deepest existing ancestor) before `relative()`.

### F5 — LOW — non-string `file_path` throws before the guard's try/catch

**File:** `src/cli/guards/workflow-step-gate.ts:18-19`

`input.tool_input?.file_path as string | undefined` is a cast, not a check. A non-string truthy value (number/object from a nonconforming harness) reaches `isAbsolute()` → TypeError, thrown *outside* the function's try/catch, and `guard.ts:236` does not wrap built-in handlers. Guard the check with `typeof targetPath === 'string'`. (Empty string correctly falls through to the normal gate. `NotebookEdit` is not matched by the `Edit|Write` matcher in `src/core/guard.ts:277`, so `notebook_path` is out of scope.)

### F6 — INFO (semantics question) — `>=` boundary lets a partial earlier attempt at the target phase's own first sprint downgrade the block

**File:** `src/cli/guards/phase-boundary.ts:90`

A scorecard for exactly the target phase's first sprint (e.g. from an earlier aborted attempt at that sprint that still ran post-hole) satisfies `order >= boundaryOrder` and converts a genuine deny into an advisory. Likewise a scorecard from any later sprint anywhere in the roadmap (parallel tracks) counts. This matches the commit's stated intent ("the boundary is history") and is defensible — a boundary scorecard means the sprint completed post-hole at least once — but confirm it's the desired semantic. Minor UX note: the advisory path drops the `pendingPhaseGates` list, so the user no longer sees *which* cleanup gates were skipped; consider appending them to the advisory.

### F7 — INFO — status uses `includeNewerRunning: true` (default), so a live parallel execution can be advertised as "dangling"

**File:** `src/cli/commands/status.ts:17-20`

With a shared store (PG) and two genuinely concurrent running sprints, `slope status` labels the older one "dangling … newer running sprint exists" and recommends `cleanup --stale`, which would pause a live run. This is consistent with `cleanup --stale`'s own pre-existing semantics (sprint.ts:1384 also uses the default), so it's note-only — but the gate deliberately uses `includeNewerRunning: false` for the same reason, and status is now the loudest advertiser of the cleanup command. Otherwise the status change is sound: single `store.close()` in the caller's `finally`, tolerant of stores lacking `listExecutions` (both SQLite and PG have it: `src/store-pg/index.ts:830`), and the catch-all matches the "diagnostics never break status" contract.

---

## Required fixes before merge

1. **F1:** roadmap-aware ordering in phase-boundary (`roadmapSprintOrderValue` for phase ids; raw `sprint_number` for scorecards) + regression test with a ≥200-ends-in-5 boundary sprint.
2. **F2:** set `session_id` on executions at `slope sprint run` / loop start (or rework the ownership signal), with an end-to-end test through the real start path.
3. **F3:** heartbeat-based (or grace-period) liveness before dead-session pausing — land with F2, not after it.

F4/F5 are recommended hardening; F6/F7 need only an explicit "yes, intended" from the sprint owner.

---

# Delta Re-Review Addendum (HEAD 74ac060)

- **Scope:** `git diff 5f07089..74ac060 -- src/ tests/` (commits fed16fd, 3807bee, 74ac060)
- **Verification:** `pnpm vitest run tests/cli/guards/ tests/cli/sprint-workflow.test.ts` — 24 files, **358/358 pass**. `pnpm typecheck` clean. Fixes re-probed with throwaway scripts (scratchpad only, removed afterward).

## Finding-by-finding disposition

### F1 (HIGH) — RESOLVED, and strengthened
`phase-boundary.ts` now routes all ordering through `roadmapSprintOrderValue` (local `orderOf`), and additionally requires the scorecard's order to match a **roadmap-member** sprint at/past the boundary. Probe-verified at HEAD with the original failing input (Phase 2 `[245, 246]`, only `sprint-243.json` on disk): now **denies**. `sprint-245.json` present → advisory, correctly. Stray `sprint-999.json` (non-roadmap) → still denies — the membership check closes an evidence leak I had not flagged. Committed regression tests (`tests/cli/guards/phase-boundary.test.ts`, `writeModernRoadmap` with `[243]/[245,246]`) cover all three cases. The new `roadmap.sprints.map(...)` sits inside the existing try/catch, so structural surprises fall through to the block (fail-safe).

### F2 (HIGH) — RESOLVED as designed, with a coverage caveat (R1, non-blocking)
`slope sprint run` (`sprint.ts:1292`) and the loop adapter (`workflow-adapter.ts:57`) now pass `session_id: process.env.SLOPE_SESSION_ID?.trim() || undefined` to `engine.start`. The mechanism is correct and fail-safe (unset env → `session_id` undefined → dead-session leg skips, exactly the pre-S243 behavior).

**Caveat R1:** nothing in the repo *exports* `SLOPE_SESSION_ID` — it is consumed by hook templates (`.claude/hooks/slope-session-end.sh`, opencode plugin template, `slope hook`/`init`/`doctor` snippets) but `slope session start` prints the id without exporting it, and `.claude/settings.json` has no `env` block. On a stock Claude Code setup the variable is typically unset, so executions remain unbound there and the dead-session leg stays dormant (the scorecard/roadmap/age/branch reasons still cover #621's common cases). This is a coverage gap, not a correctness bug. Suggested follow-up (separate ticket): export it via the generated hook/env templates, or document the requirement.

**Caveat R2 (Low):** two id namespaces now exist — `exec.session_id` comes from `SLOPE_SESSION_ID` (often a `randomUUID` from `slope session start`), while the gate's `currentSessionId` is the harness hook `input.session_id` (also what worktree-check registers). Where these differ, the gate's self-protection clause cannot match its own execution. Bounded by the F3 grace window plus the requirement that the owning session row be gone, so note-only.

### F3 (MEDIUM) — RESOLVED with an accepted residual (R3, Low)
Dead-session evidence now additionally requires the execution to be quiet for `DEAD_SESSION_GRACE_MS` (60 min, `workflow-resync.ts`), keyed off `exec.updated_at || started_at`. This covers the TTL/`cleanStaleSessions` legs and the ordinary between-turn stop-check row deletion; the committed test includes a 5-minute-old lapsed-session execution that must survive, and it does (358 pass).

**Residual R3:** `updated_at` only ticks on workflow state changes, not on tool activity. A live owner sitting in a single `agent_work` step for >60 min, whose session row happens to be absent between turns (stop-check deletes on every clean Stop), can still have its execution paused by a peer. Recoverable (`resume`/resync, visible reason string) and much narrower than before — acceptable; consider touching `updated_at` on heartbeat as future hardening.

### F4 (LOW/MED) — RESOLVED for symlinks; case-flip residual remains (R4, Low)
`isWithinRepo` now realpaths the cwd and the target's nearest existing ancestor, and **fails toward gating** on resolution errors. Probe-verified at HEAD: macOS `/tmp` vs `/private/tmp` aliasing now resolves in-repo in both directions, including not-yet-created targets; genuinely-outside and nonexistent-root paths still early-allow.

**Residual R4:** `realpathSync` does not canonicalize letter case on case-insensitive APFS (probe: `realpathSync('/USERS') === '/USERS'`), so a deliberately case-mangled in-repo path (`/users/...` for `/Users/...`) still bypasses the gate. Requires intentional mangling; fail-open only for this guard. Note-only.

### F5 (LOW) — RESOLVED
`typeof rawTarget === 'string' && rawTarget.trim() !== ''` replaces the cast; `notebook_path` accepted as a fallback target. Non-string inputs can no longer throw ahead of the try/catch.

### F6 (INFO) — CLOSED as intended
Owner confirms the `>=` boundary semantic (a scored attempt at the target phase's first sprint means the boundary was crossed). The advisory now lists the unrecorded pending gates and clarifies that `slope phase complete` is an unvalidated manual override — the UX note is addressed.

### F7 (INFO) — RESOLVED
`slope status` now passes `includeNewerRunning: false` and `currentSessionId`; CLI `resync`/`cleanup --stale` pass `currentSessionId`. Live parallel executions are no longer advertised as dangling. (`cleanup --stale` itself retains `includeNewerRunning: true` — pre-existing, explicitly invoked semantics; fine.)

## Final verdict: APPROVE (with notes)

All blocking findings (F1, F2, F3) are correctly addressed at 74ac060 and covered by committed regression tests; the probes that originally demonstrated F1 and F4 now pass. Residuals R1–R4 are non-blocking follow-up candidates — R1 (exporting `SLOPE_SESSION_ID` so execution-session binding is live on stock Claude Code setups) is the one most worth a ticket, since until then the dead-session leg is dormant on the primary harness.
