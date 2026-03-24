# Sprint 76 Plan — The Referee (Advisory-to-Mechanical Guard Conversion)

**Par:** 4 (4 tickets)
**Slope:** 2 (cross-cutting: guard system, store, doctor CLI)
**Theme:** Convert advisory guards to write disk state so their warnings survive compaction

## Context

Guards that return only `additionalContext` are *advisory* — their output is injected into the agent context window but lost on compaction. Guards that write disk state or return `blockReason` are *mechanical* — they survive context loss.

The `process-compaction` gotcha (last: S60) fires because advisory guards re-inject warnings after compaction but can't tell whether the agent already acted on them. Writing state to disk closes this gap.

**Guards to convert (identified from code):**
- `hazard.ts` — returns `additionalContext` only; injected hazard list is lost on compaction
- `scope-drift.ts` — returns `blockReason` but no disk state; drift warnings can't be restored after compaction

**Existing patterns to follow:**
- `src/cli/guards/compaction.ts` — reference implementation for disk-state writes
- `src/core/guard.ts` — `GUARD_RELEVANCE` map, `GUARD_DEFINITIONS`, guard runner
- `src/cli/commands/guard.ts` — guard management CLI (status, enable, disable)

## Tickets

### T1: Audit all advisory guards — classify mechanical vs advisory
**Club:** wedge
**Files:** `src/cli/guards/` (read-only audit), `src/core/guard.ts`

**Problem:** No canonical list of which guards are advisory vs mechanical. Before converting, we need a verified inventory so we don't miss any.

**Approach:**
- Read every file in `src/cli/guards/` and classify each guard function by its return shape:
  - `mechanical`: returns `blockReason` or writes to disk, survives compaction
  - `advisory`: returns only `additionalContext`, lost on compaction
  - `mixed`: returns context sometimes, blocks other times
- Add a `guardType: 'mechanical' | 'advisory' | 'mixed'` field to `GuardDefinition` in `guard.ts`
- Populate `guardType` for all entries in `GUARD_DEFINITIONS`
- This classification is used by T4's doctor check and informs T2/T3

**Hazard watch:** `GUARD_DEFINITIONS` is in `src/core/guard.ts` — adding a new required field will cause TypeScript errors for any inline guard definition that doesn't set it. Make it optional (`guardType?`) or provide a default.

### T2: Convert hazard guard to write disk state
**Club:** short_iron
**Files:** `src/cli/guards/hazard.ts`, `tests/cli/guards/hazard.test.ts`

**Problem:** `hazardGuard()` returns `{ additionalContext: warnings }` only. When the context compacts, the injected warnings disappear. The agent resumes without knowing which files were flagged.

**Approach:**
- After computing `warnings`, write them to `.slope/guard-state/hazard.json`: `{ sprint, file, warnings, timestamp }`
- On the next invocation, read the state file first — if a warning for this file + sprint already exists on disk, include it regardless of whether the context still has it
- The state file acts as a persistent injection source that survives compaction
- Clear stale entries when sprint changes (different sprint number detected)
- Keep the existing `additionalContext` return — disk state supplements, doesn't replace

**Hazard watch:** `.slope/guard-state/` directory may not exist — create it with `mkdirSync(..., { recursive: true })`. State file writes must not throw on permission errors (wrap in try/catch, fail open).

### T3: Convert scope-drift guard to write disk state
**Club:** short_iron
**Files:** `src/cli/guards/scope-drift.ts`, `tests/cli/guards/scope-drift.test.ts`

**Problem:** `scopeDriftGuard()` queries the store on every invocation. If the store is unavailable after compaction, it falls through to `return {}` (fail-open). There's no disk-cached state to fall back on.

**Approach:**
- After a successful store query that finds a drift violation, write the result to `.slope/guard-state/scope-drift.json`: `{ sprint, file, claim, timestamp }`
- On subsequent invocations, if the store is unavailable, read from the state file as fallback
- If the state file indicates a drift violation for the current file + sprint, return `blockReason` from disk state
- Clear state file when the sprint changes or when a new successful store query returns in-scope

**Hazard watch:** The guard already has a `return {}` catch path for store unavailability — the disk fallback replaces that silent pass with a cache-backed block. Be careful not to block on stale state from a previous sprint.

### T4: Guard enforcement report — `slope doctor` advisory vs mechanical check
**Club:** wedge
**Files:** `src/cli/commands/guard.ts`, `tests/cli/guards/guard-cmd.test.ts`

**Problem:** No way to see at a glance which guards are advisory vs mechanical without reading source code. After T1 adds `guardType` to `GUARD_DEFINITIONS`, we can surface this in the CLI.

**Approach:**
- Add a `slope guard audit` subcommand (or extend `slope doctor` if a doctor hook exists) that reads `GUARD_DEFINITIONS` and groups guards by `guardType`
- Output a table: guard name | type | event | description
- Highlight advisory guards with a warning: "These guards lose state on compaction"
- This is a read-only reporting command — no side effects

**Hazard watch:** If wiring into `slope doctor` rather than `slope guard audit`, check how doctor checks are registered (likely an array of check functions) before adding a new one to avoid duplicating existing guard-audit logic from S64/S65.

## Review Tier

**Standard** (2 rounds) — 4 tickets, guard system + store + CLI, disk state writes are higher-stakes than typical feature work.

## Dependencies

- T1 must complete first (classification needed for T2/T3/T4)
- T2 and T3 are independent after T1
- T4 depends on T1 (needs `guardType` in `GUARD_DEFINITIONS`)
