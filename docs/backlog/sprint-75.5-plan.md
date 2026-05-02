# Sprint 75.5 Plan — The Bug Clearing (CLI Bug Fixes)

**Par:** 3 (4 tickets)
**Slope:** 1 (focused CLI fixes, well-understood bugs)
**Theme:** Clear out accumulated CLI bugs from review and version commands

## Context

Four GitHub issues filed from external repos using SLOPE. All are CLI-layer bugs with clear repro steps. No architectural changes needed.

**What already exists:**
- `src/cli/commands/version.ts` — version command (reads from cwd package.json)
- `src/cli/commands/review.ts` — review command with findings subcommand
- Review findings state stored in `.slope/state.json` or similar
- Review formatter that generates shot-by-shot tables

## Tickets

### S75.5-1: Fix `slope version` to read from installed package (#300)
**Club:** wedge
**Files:** `src/cli/commands/version.ts`

**Problem:** `slope version` returns `vunknown` because it reads `package.json` from `process.cwd()` instead of the installed package location.

**Approach:**
- Use `import.meta.url` to resolve the CLI package's own `package.json`
- Fall back to `process.cwd()` only for bump/recommend subcommands
- Add try/catch with diagnostic message if resolution fails

**Hazard watch:** ESM import.meta.url resolution in CLI context. Test with both global and local install.

### S75.5-2: Fix review findings stale state (#297)
**Club:** short_iron
**Files:** `src/cli/commands/review.ts` (findings subcommand)

**Problem:** `slope review findings add` rejects new findings when stale findings from prior sprint exist. State not properly namespaced by sprint.

**Approach:**
- Auto-clear findings on `slope review start` OR namespace findings by sprint number
- Update findings storage to key by sprint: `findings: { [sprintId]: Finding[] }`
- `findings list` shows current sprint findings, `findings list --all` shows all
- `findings add` appends to current sprint's array

**Hazard watch:** Backward compat with existing flat findings array. Migrate on first read.

### S75.5-3: Fix review tickets display (#298)
**Club:** short_iron
**Files:** `src/cli/commands/review.ts` (formatter)

**Problem:** `slope review <path>` shows "Tickets Delivered: 0" and empty shot-by-shot table despite tickets array being populated in scorecard JSON.

**Approach:**
- Find the formatter that reads scorecard JSON
- Fix field name mismatch (likely reading `shots[]` instead of `tickets[]`)
- Ensure `Tickets Delivered: N` reflects `tickets.length`
- Populate shot-by-shot table with id, approach, result, hazards, notes

**Hazard watch:** May be schema version mismatch. Check if older scorecards use different field names.

### S75.5-4: Fix review findings --help (#299)
**Club:** wedge
**Files:** `src/cli/commands/review.ts` (findings subcommand router)

**Problem:** `slope review findings --help` returns "Unknown findings subcommand: --help"

**Approach:**
- Add `--help`/`-h` handler to findings subcommand router
- Print usage: `add`, `list`, `clear` with options
- Same pattern for any other multi-level subcommand routers

**Hazard watch:** Check if other subcommands have the same bug (--help handling)

## Review Tier

**Light** (1 round) — 4 small CLI fixes, no architectural changes.

## Dependencies

- All tickets independent
- S75.5-3 and S75.5-4 both touch review.ts but different functions
- Can be done in parallel
