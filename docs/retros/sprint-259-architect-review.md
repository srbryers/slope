# S259 Architect Review — Reconciliation Status Safety (#660)

- **Reviewer:** self-review (workflow-architecture lane) — no subagents per standing constraint
- **Lane:** architect (required)
- **Verdict:** APPROVED
- **Scope:** `completeRoadmapSourceSprint` was patching a source sprint to `status: complete` whenever a scorecard existed, ignoring the authored status — silently rewriting deliberate dispositions (absorbed/blocked/deferred/superseded/cancelled/skipped) and inflating completion stats.

## Findings

### 1. Promotable-status set — is it too aggressive? (primary risk)
The fix gates auto-promotion on `PROMOTABLE_TO_COMPLETE = ['', 'planned', 'active', 'in_progress', 'ready_for_pr']`. The architectural danger (cf. S254 hazard: "a protective check with a false positive blocks real work and pushes operators toward --force") is that a legitimate in-flight status omitted from the set would false-positive and force operators onto `slope roadmap complete`.

**Verified against the real closeout flow:**
- The only automated writer of a source sprint's status is `completeRoadmapSourceSprint` itself, which only ever writes `complete`. Source statuses are otherwise human-authored — there is no lifecycle step that stamps `scoring`/`in_review`/etc. into a source.
- Empirical tally of every status across the repo's own roadmap sources: `complete` 185, `superseded` 10, `in_progress` 7, `planned` 1. The only in-flight statuses that occur (`in_progress`, `planned`) are both promotable; `superseded` is correctly a deliberate conflict.
- Conclusion: no false positives on the normal "score → validate → complete" path. `active`/`ready_for_pr`/`''` are defensive additions.

**Residual note (rough, minor):** the roadmap `status` field is free-form (no enum). A future novel in-flight lifecycle status written into a source would be treated as a conflict until added to the set. This is the *safe* failure direction (refuse + point at the documented override), not the dangerous one (silent overwrite). Acceptable; tracked in the scorecard.

### 2. TOCTOU safety
The conflict is re-checked against freshly-loaded state inside the `.federation` file lock, so a concurrent edit that moves the status into a deliberate disposition after the pre-lock read cannot be clobbered. Correct.

### 3. Override path integrity
`slope roadmap complete` passes `force: true`, preserving the explicit operator override that `validate` advertises in its conflict hint. The automatic path never forces. Clean separation of automatic vs. intentional.

### 4. Blast radius of the `isRoadmapSprintPending` change (S259-4)
`deferred` now excluded from the selectable pool. All six non-test callers reviewed (next-sprint pickers, rollover target, current-sprint inference, `slope now` label, roadmap upcoming list) — each is a selection context where skipping a deliberately-postponed sprint is correct or an improvement (`slope now` now labels it `deferred` instead of `pending`). `deferred` remains non-terminal, so it is not counted as done and can be reactivated. Full suite (4255 tests) green.

## Required fixes
None. Design approved as shipped.

## Evidence
- Unit: `tests/cli/roadmap-sources.test.ts` (status-safety + override), `tests/cli/commands/validate-reconcile.test.ts` (validate reporting), `tests/core/roadmap.test.ts` (deferred non-selectable + findNextPlannedSprint skip).
- End-to-end: built-CLI reproduction of #660 — `slope validate` reports the conflict and leaves `absorbed` intact; `slope roadmap complete --sprint=9` forces it to `complete`.
- Full suite: 4255 passed / 25 skipped (PG), typecheck clean.
