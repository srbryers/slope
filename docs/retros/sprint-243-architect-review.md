# Sprint 243 — Architect Review (Stale State & Guard Scoping, #621)

- **Reviewer / lane:** workflow-architecture-reviewer (architect)
- **Branch:** `feat/S243-stale-state-guard-scoping` vs `main`
- **Scope reviewed:** `src/cli/guards/workflow-step-gate.ts`, `src/cli/workflow-resync.ts`, `src/cli/commands/status.ts`, `src/cli/guards/phase-boundary.ts`, plus tests
- **Verification:** touched test files pass (69/69), `pnpm typecheck` clean

## Verdict: REQUEST CHANGES

The design direction is right on all four changes — repo scoping fails open, dead-session
evidence is preconditioned, the phase downgrade still surfaces a reconciliation path, and
pausing is lossless (`slope sprint resume` recovers phase/step/completed_steps;
`getExecutionBySprint` includes `paused`). But two findings are severe enough to block:
a sprint-id decoding bug that will mis-trigger the phase-boundary downgrade starting at
S245 in this very repo, and a heartbeat-lapse race that lets a peer pause a *live*
teammate's execution in shared-store (swarm) setups.

---

## Findings

### F1 — HIGH — Phase-boundary advisory uses raw `sprintOrderValue`, mis-decoding modern sprint ids ending in 5
**File:** `src/cli/guards/phase-boundary.ts:85` (and `:89` for scorecards)

`sprintOrderValue` treats any integer id in `[200, 1000)` ending in 5 as a legacy encoded
half-sprint (`src/core/roadmap.ts:95-107`): `sprintOrderValue(245) === 24.5`. This repo is
currently at **S243**. As soon as a roadmap phase's first sprint is 245 (or 255, 305, …),
`boundaryOrder` computes as 24.5 and `scorecardOrders.some(order => order >= 24.5)` is true
for essentially every scorecard in the repo — the deny **always** downgrades to an advisory
for that boundary, regardless of whether the prior phase is genuinely incomplete (fail-open).
Symmetrically, a scorecard numbered 245 orders as 24.5 and fails to count as legitimate
past-boundary evidence (fail-closed).

The codebase already has the roadmap-aware resolver built for exactly this ambiguity:
`roadmapSprintOrderValue(roadmap, id)` / `isEncodedInsertedSprintInRoadmap`
(`src/core/roadmap.ts:209-228`), and the guard has the parsed `roadmap` in hand.

**Required fix:** use `roadmapSprintOrderValue(roadmap, id)` for the target-phase sprint ids
and for scorecard `sprint_number`s (both are roadmap-context ids). Add a test with a phase
whose first sprint is ≥ S245.

### F2 — HIGH — Dead-session evidence can pause a live teammate's execution after a 10-minute heartbeat lapse
**Files:** `src/cli/workflow-resync.ts:157-163`, `src/cli/guards/workflow-step-gate.ts:31-34`

"Active session" here means "row exists in the sessions table" — `getActiveSessions()` does
no heartbeat filtering (`src/store/index.ts:472-475`; PG store identical). Rows are deleted
by `cleanStaleSessions(STALE_SESSION_THRESHOLD_MS = 600_000)` — **10 minutes**
(`src/core/constants.ts:54`) — which runs on every peer's tool call via the worktree-check
guard (`src/cli/guards/worktree-check.ts:92`) and on session/worktree commands. Heartbeats
are refreshed only by the PostToolUse transcript guard (`src/cli/guards/transcript.ts:84-92`).

Failure chain in a shared-store swarm (the sessions schema's explicit use case — `swarm_id`):

1. Agent A owns a running execution (`session_id = A`) and enters a single long tool call —
   a 15-minute build/test run, or an Aider leg where hooks don't fire at all (per the loop
   design, guard hooks don't run during Aider execution). No heartbeats for >10 min.
2. Agent B's worktree-check guard runs `cleanStaleSessions` → A's session row is deleted.
3. B's next Edit/Write hits workflow-step-gate → `reconcileWorkflowExecutions` → A's
   execution is flagged `owning session is no longer active` **on this evidence alone**
   (the new test fixture confirms a 1-hour-old execution is flagged) → auto-paused.
4. A's long call finishes; its next `engine.next()` throws
   `"execution is paused — resume before calling next()"` (`src/core/workflow-engine.ts:127`).
   Recoverable via `slope sprint resume`, but inside `slope loop` this throw is a failed
   ticket/sprint, not a graceful resume.

The `currentSessionId` exclusion protects the invoking session only — it does nothing for
third-party live sessions. The 7-day `staleAgeMs` default shows the intended tolerance for
execution staleness; a 10-minute heartbeat TTL is wildly asymmetric evidence.

Exposure note: `slope loop parallel` worktrees typically have separate `.slope/slope.db`
files (untracked), so the realistic blast radius is same-directory swarms and any future
shared-store (PG) team deployment — precisely the setups the memory notes flag as the
adoption target. Ship this now and it becomes a distributed-systems bug report later.

**Required fix:** dead-session evidence must be corroborated by execution age. Only add the
reason when `exec.updated_at || exec.started_at` is older than a grace window that is a
generous multiple of the heartbeat TTL (suggest 30–60 min, e.g.
`DEAD_SESSION_GRACE_MS = 6 * STALE_SESSION_THRESHOLD_MS`). Alternatively (better long-term),
key on session `last_heartbeat_at` age with a long threshold instead of row deletion, so the
evidence isn't coupled to whichever peer happened to run cleanup. Add a test: recent
execution + dead session → NOT stale; old execution + dead session → stale.

### F3 — MEDIUM — Advisory funnels users to a no-validation rubber stamp
**File:** `src/cli/guards/phase-boundary.ts:92` → `src/cli/phase-cleanup.ts` (`completePhase`)

`slope phase complete N` unconditionally sets all five gates true (`scorecards_verified`,
`regression_passed`, etc.) with zero verification. Pre-change, a stale ledger produced a hard
block that forced gate-by-gate completion; post-change, the recommended remediation is a
one-shot rubber stamp. The downgrade itself is justified (scorecards past the boundary are
real evidence), but the recommended command erases the distinction between "ledger was stale"
and "gates were actually done".

**Required fix (either):** (a) have the advisory recommend `slope phase status N` and the
specific pending gates alongside `phase complete`, or (b) make `phase complete` verify the
cheap gates (scorecards exist for the phase's sprints) before writing, with `--force` to
override.

### F4 — LOW — Downgrade evidence is `some(order >= boundary)`, so one stray high-numbered scorecard disables all earlier boundaries forever
**File:** `src/cli/guards/phase-boundary.ts:89-90`

A single out-of-band scorecard (hotfix/recovery sprints are a real pattern in this repo —
the S153/S154 recovery train) with a high `sprint_number` permanently downgrades every
boundary below it, including phases later inserted into the roadmap with lower sprint
numbers. Acceptable under the "ledger is history" rationale, but tightening the evidence to
"a scorecard exists for a sprint that is a **member** of the target phase or a later phase
in the roadmap" would be robust to misnumbered or out-of-order cards, and composes with the
F1 fix (roadmap membership sidesteps ordering entirely).

**Suggested, not required.**

### F5 — LOW — `isWithinRepo` doesn't canonicalize symlinks or filesystem case on POSIX
**File:** `src/cli/guards/workflow-step-gate.ts:79-83`

`resolve()` does not resolve symlinks. On macOS, `/tmp` → `/private/tmp` and default APFS is
case-insensitive: a target spelled through a symlink alias or with different case resolves
"outside" the repo and the gate is **silently skipped** for a file that is actually in-repo
(fail-open bypass of the very gate this sprint hardens). Windows is handled correctly —
`path.win32.relative` compares case-insensitively and cross-drive returns an absolute path,
which the `isAbsolute(rel)` clause catches; drive-letter case is likewise fine.

**Suggested fix:** `realpathSync.native` (with try/fallback to the resolved path for
not-yet-existing Write targets — realpath the deepest existing ancestor, or at minimum
realpath `cwd`).

### F6 — LOW — Unguarded early path check; non-string `file_path` throws outside the try/catch
**File:** `src/cli/guards/workflow-step-gate.ts:18-19`

`input.tool_input?.file_path as string` is an unchecked cast evaluated before the guard's
try/catch. A malformed hook payload (array/object) makes `resolve()` throw out of the guard.
Cheap fix: `typeof targetPath === 'string'`. Related: the guard matcher is `Edit|Write`
(unanchored regex, `src/core/guard.ts:277`), which also matches `NotebookEdit` in harnesses
that regex-match tool names — that tool uses `notebook_path`, so out-of-repo notebook edits
still take the full gate path. Inconsistent but safe; note it or normalize both params.

### F7 — INFO — Caller/signature compatibility: verified clean
- `src/cli/commands/sprint.ts:1359` (`slope sprint workflow resync`) and `:1384`
  (`cleanup --stale`) pass the full `SlopeStore` — structurally compatible with the widened
  `Partial<Pick<..., 'getActiveSessions'>>` param; options additions are optional. Typecheck
  passes. **Behavioral note:** these CLI paths now apply dead-session evidence with **no**
  `currentSessionId` — an agent following the guard's own "run `slope sprint workflow resync`"
  suggestion after its heartbeat lapsed will pause its *own* execution. The F2 grace window
  largely neutralizes this; otherwise consider threading `SLOPE_SESSION_ID` env through the
  CLI path.
- `src/cli/commands/status.ts` new caller is method-tolerant and failure-silent as claimed;
  correct that it stays advisory (no auto-pause — it calls `find`, not `reconcile`).
- PG store `getActiveSessions` has identical all-rows semantics — consistent cross-store.

### F8 — INFO — Design points that hold up
- **Pause is lossless:** `completeExecution(id, 'paused')` preserves `current_phase`,
  `current_step`, `completed_steps`; `paused → running` is a valid transition and
  `slope sprint resume <sprint>` finds paused executions (`getExecutionBySprint` filters
  only completed/failed). Nothing unrecoverable.
- **≥1-active-session precondition** correctly no-ops repos without session tracking
  (empty table → `size === 0` → evidence skipped), and `exec.session_id` falsy-skip covers
  executions started by `slope sprint run`, which sets no `session_id`
  (`src/cli/commands/sprint.ts:1287-1290`). The precondition is the right shape; it is the
  *liveness definition* behind it that F2 addresses.
- **Repo-scoping early return** happens before the store is even opened — cheap and fails
  open, the correct posture for a scoping check.

---

## Required fixes before merge
1. **F1** — switch phase-boundary ordering to `roadmapSprintOrderValue(roadmap, id)`; add an S245-class test.
2. **F2** — corroborate dead-session evidence with an execution-age grace window (or heartbeat-age keying); add recent-exec/dead-session negative test.
3. **F3** — stop recommending an unvalidated `phase complete` as the sole remediation (or add validation to it).

F4–F6 are recommended hardening; fine as fast-follows if ticketed.
