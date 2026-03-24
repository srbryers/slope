# Sprint 76 Plan — The Referee (Advisory-to-Mechanical Guard Conversion)

**Par:** 4 (4 tickets)
**Slope:** 2 (cross-cutting: guard system, store, doctor CLI)
**Theme:** Convert advisory guards to write disk state so their warnings survive compaction

## Context

Guards that return only `context` (mapped to `additionalContext` in the guard runner) are *advisory* — their output is injected into the agent context window but lost on compaction. Guards that write disk state or return `blockReason`/`decision: 'block'` are *mechanical* — they survive context loss.

The `process-compaction` gotcha (last: S60) fires because advisory guards re-inject warnings after compaction but can't tell whether the agent already acted on them. Writing state to disk closes this gap.

**Guards to convert (identified from code):**
- `hazard.ts` — returns `{ additionalContext }` only; purely advisory, lost on compaction
- `scope-drift.ts` — returns `{ context }` only (NOT `blockReason`); also purely advisory, lost on compaction. The `GuardResult` interface distinguishes `context` (advisory injection) from `blockReason` (mechanical block).

**Existing patterns to follow:**
- `src/cli/guards/compaction.ts` — reference implementation for disk-state writes (writes to `.slope/handoffs/`)
- `src/core/guard.ts` — `GuardResult` interface (fields: `context`, `decision`, `blockReason`), `GUARD_DEFINITIONS`, guard runner
- `src/cli/commands/guard.ts` — guard management CLI (status, enable, disable)

**Guard count:** `GUARD_DEFINITIONS` has 28 entries across 29 guard files in `src/cli/guards/`. T1 must classify all of them.

## Tickets

### T1: Audit all advisory guards — classify mechanical vs advisory
**Club:** short_iron
**Files:** `src/cli/guards/` (read all 29 files), `src/core/guard.ts`

**Problem:** No canonical list of which guards are advisory vs mechanical. Before converting, we need a verified inventory so we don't miss any.

**Approach:**
- Read every file in `src/cli/guards/` (29 files) and classify each guard function by its return shape:
  - `mechanical`: returns `blockReason` or `decision: 'block'`, or writes to disk — survives compaction
  - `advisory`: returns only `context` or `additionalContext` — lost on compaction
  - `mixed`: returns context sometimes, blocks other times depending on conditions
- Add a `guardType?: 'mechanical' | 'advisory' | 'mixed'` field to `GuardDefinition` in `guard.ts` (optional to avoid breaking inline definitions)
- Populate `guardType` for all 28 entries in `GUARD_DEFINITIONS`
- This classification is used by T4's audit report and informs T2/T3

**Hazard watch:** 29 guard files is significant volume for a classification task. Use a quick heuristic first (grep for `blockReason`/`decision` vs `context`/`additionalContext` returns), then verify edge cases manually. Some guards like `sprint-completion` appear multiple times in `GUARD_DEFINITIONS` for different events — ensure consistent classification.

### T2: Convert hazard guard to write disk state
**Club:** short_iron
**Files:** `src/cli/guards/hazard.ts`, `tests/cli/guards/hazard.test.ts`

**Problem:** `hazardGuard()` returns `{ additionalContext: warnings }` only. When the context compacts, the injected warnings disappear. The agent resumes without knowing which files were flagged.

**Approach:**
- After computing `warnings`, write them to `.slope/guard-state/hazard.json`: `{ sprint, file, warnings, timestamp }`
- On the next invocation, read the state file first — if a warning for this file + sprint already exists on disk, include it regardless of whether the context still has it
- The state file acts as a persistent injection source that survives compaction
- Clear stale entries when sprint changes (different sprint number detected)
- Auto-prune entries older than 7 days on read to prevent disk accumulation
- Keep the existing `additionalContext` return — disk state supplements, doesn't replace

**Hazard watch:** `.slope/guard-state/` directory may not exist — create it with `mkdirSync(..., { recursive: true })`. State file writes must not throw on permission errors (wrap in try/catch, fail open).

### T3: Convert scope-drift guard to write disk state
**Club:** short_iron
**Files:** `src/cli/guards/scope-drift.ts`, `tests/cli/guards/scope-drift.test.ts`

**Problem:** `scopeDriftGuard()` returns `{ context: "SLOPE scope drift: ..." }` — purely advisory, NOT a block. When the store is unavailable after compaction, it falls through to `return {}` (fail-open, line 47). There's no disk-cached state to fall back on, and the advisory warning is lost.

**Approach:**
- After a successful store query that finds a drift violation, write the result to `.slope/guard-state/scope-drift.json`: `{ sprint, file, claim, timestamp }`
- On subsequent invocations, if the store is unavailable, read from the state file as fallback
- If the state file indicates a drift violation for the current file + sprint, return `context` from disk state (preserving advisory behavior — do NOT escalate to `blockReason` as this would be a behavioral change)
- Clear state file when the sprint changes or when a new successful store query returns in-scope
- Auto-prune entries older than 7 days on read — never act on ancient cached state
- If disk state is older than 24 hours, treat as stale and fail-open rather than injecting potentially outdated warnings

**Hazard watch:** The original guard is advisory (`context` only). Converting to `blockReason` would change behavior — edits that were previously allowed would start getting blocked. Keep as advisory with disk-backed persistence. If blocking is desired in the future, that's a separate decision.

### T4: Guard enforcement report — `slope guard audit`
**Club:** wedge
**Files:** `src/cli/commands/guard.ts`, `tests/cli/guards/guard-cmd.test.ts`

**Problem:** No way to see at a glance which guards are advisory vs mechanical without reading source code. After T1 adds `guardType` to `GUARD_DEFINITIONS`, we can surface this in the CLI.

**Approach:**
- Add a `slope guard audit` subcommand to `src/cli/commands/guard.ts` that reads `GUARD_DEFINITIONS` and groups guards by `guardType`
- Output a table: guard name | type | event | description
- Highlight advisory guards with a warning: "These guards lose state on compaction"
- This is a read-only reporting command — no side effects
- Use `slope guard audit` (not `slope doctor`) — doctor checks are hardcoded calls in `runDoctorChecks()` (lines 25-64 of doctor.ts), not a plugin system. Adding to doctor would require editing `doctor.ts` which is out of scope.

**Hazard watch:** Wire into existing guard subcommand routing in `guard.ts` — the router dispatches on subcommand name, add `'audit'` alongside existing `'status'`, `'enable'`, `'disable'`.

## Review Tier

**Standard** (2 rounds) — 4 tickets, guard system + store + CLI, disk state writes are higher-stakes than typical feature work.

## Dependencies

- T1 must complete first (classification needed for T2/T3/T4)
- T2 and T3 are independent after T1
- T4 depends on T1 (needs `guardType` in `GUARD_DEFINITIONS`)
