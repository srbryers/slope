# SLOPE Roadmap — Phase 7: Hardening & Adoption

**Phase 7 (S37-S40):** Consolidate the adapter framework, harden the store layer, expand harness coverage, and prepare SLOPE for external adoption with better onboarding and documentation.

**Prerequisite:** Phase 6 complete (S36 scored)

**Parallel tracks:**
- Adapter enrichment: S37 (standalone, first)
- Store hardening: S38 (parallel with S37)
- Expanded harness coverage: S39 (depends on S37)
- Adoption readiness: S40 (depends on S37, S38)

**Critical path:** S37 → S39 → S40 (3 sprints)
**Parallel:** S38 runs alongside S37; S40 waits for both S37 and S38

```
S37 ──→ S39
  └────────→ S40
S38 ────────→ S40
```

---

## Sprint 37 — The Adapter Interface

**Par:** 4 | **Slope:** 2 (`moderate: interface evolution, migrating static maps onto adapter`) | **Type:** refactor

**Theme:** Enrich `HarnessAdapter` with capabilities that are currently static maps in `guard.ts`. Move `HARNESS_EVENT_SUPPORT` and `getHooksConfigPath` onto the adapter interface so each adapter owns its own metadata. Add adapter-level `supportedEvents` and `hooksConfigPath()` methods.

### Tickets

| Ticket | Club | Summary |
|--------|------|---------|
| S37-1 | short_iron | Add `supportedEvents` and `hooksConfigPath()` to `HarnessAdapter` interface |
| S37-2 | short_iron | Implement new methods on all 4 built-in adapters |
| S37-3 | short_iron | Migrate `guard status` and consumers to use adapter methods |
| S37-4 | wedge | Deprecate static maps, update docs + tests |

#### S37-1: Extend HarnessAdapter interface
- **Club:** short_iron | **Complexity:** standard
- Add to `HarnessAdapter` in `src/core/harness.ts`:
  ```ts
  supportedEvents: Set<string>;        // e.g., new Set(['PreToolUse', 'PostToolUse', 'Stop'])
  hooksConfigPath(cwd: string): string | null;  // e.g., '.claude/settings.json'
  ```
- Keep the interface backwards-compatible — both fields required for new adapters
- Export updated types from `src/core/index.ts` and `src/adapters.ts`
- Tests: type-level checks, interface contract tests

#### S37-2: Implement on built-in adapters
- **Club:** short_iron | **Complexity:** standard
- `ClaudeCodeAdapter`: `supportedEvents = new Set(['PreToolUse', 'PostToolUse', 'Stop', 'PreCompact'])`, `hooksConfigPath → .claude/settings.json`
- `CursorAdapter`: `supportedEvents = new Set(['PreToolUse', 'PostToolUse', 'Stop'])`, `hooksConfigPath → .cursor/hooks.json`
- `WindsurfAdapter`: `supportedEvents = new Set(['PreToolUse', 'PostToolUse'])`, `hooksConfigPath → .windsurf/hooks.json`
- `GenericAdapter`: `supportedEvents = new Set(['PreToolUse', 'PostToolUse', 'Stop'])`, `hooksConfigPath → null`
- Tests: each adapter returns correct values

#### S37-3: Migrate guard status to adapter methods
- **Club:** short_iron | **Complexity:** standard
- Update `guardManageCommand('status')` in `guard.ts` to call `adapter.supportedEvents.has(event)` instead of `isEventSupported()`
- Update `guardManageCommand('status')` to call `adapter.hooksConfigPath(cwd)` instead of `getHooksConfigPath()`
- Update any other consumers of the static maps
- Tests: guard status output unchanged, integration tests

#### S37-4: Deprecate static maps + docs
- **Club:** wedge | **Complexity:** small
- Mark `HARNESS_EVENT_SUPPORT`, `isEventSupported()`, `getHooksConfigPath()` as `@deprecated` with JSDoc comments pointing to adapter methods
- Do NOT remove yet — keep for one phase of backwards compat
- Update CODEBASE.md, harness-research.md authoring guide
- Tests: existing tests still pass (deprecated but not removed)

### Execution Order

```
S37-1 → S37-2 → S37-3 → S37-4
```

Sequential — each ticket builds on the previous.

---

## Sprint 38 — The Vault

**Par:** 4 | **Slope:** 2 (`moderate: store layer work, migration framework`) | **Type:** feature + infra

**Theme:** Harden the store layer for production use. Add PostgreSQL store to GA, improve migration framework, add store health checks and backup/restore utilities.

### Tickets

| Ticket | Club | Summary |
|--------|------|---------|
| S38-1 | short_iron | PostgreSQL store GA — migrate from experimental to production-ready |
| S38-2 | short_iron | Store migration framework — versioned schema migrations with rollback |
| S38-3 | short_iron | Store health check + diagnostics CLI (`slope store status`) |
| S38-4 | wedge | Backup/restore utilities + docs |

#### S38-1: PostgreSQL store GA
- **Club:** short_iron | **Complexity:** standard
- Audit `src/store-pg` for production readiness: connection pooling, error handling, retry logic
- Add missing store methods if any diverge from SQLite implementation
- Ensure full parity with SQLite store test suite
- Add connection string validation and health check
- Tests: full parity test suite, connection error handling

#### S38-2: Store migration framework
- **Club:** short_iron | **Complexity:** standard
- Versioned schema migrations (sequential, idempotent, with rollback support)
- Migration table tracks applied versions
- `slope store migrate` CLI command (up/down/status)
- Works for both SQLite and PostgreSQL
- Tests: migration apply, rollback, idempotency, version tracking

#### S38-3: Store health check + diagnostics
- **Club:** short_iron | **Complexity:** standard
- `slope store status` — show store type, path/URL, schema version, row counts, last event timestamp
- Health check: verify connectivity, schema version, table existence
- Expose via MCP for programmatic access
- Tests: health check output, error scenarios

#### S38-4: Backup/restore + docs
- **Club:** wedge | **Complexity:** small
- `slope store backup` — SQLite: file copy; PG: pg_dump wrapper
- `slope store restore` — reverse of backup
- Document store configuration, migration workflow, backup strategy
- Tests: backup creates file, restore recovers data

### Execution Order

```
S38-1 → S38-2 → S38-3
S38-1 → S38-4
```

S38-1 (PG GA) first. Migration framework and health check build on it. Backup/restore can start after S38-1.

---

## Sprint 39 — The Open Field

**Par:** 4 | **Slope:** 3 (`elevated: new adapters for external platforms, unknown APIs`) | **Type:** feature

**Theme:** Expand harness coverage to Cline and Continue (or other emerging AI coding tools). Build on the enriched adapter interface from S37 so new adapters are self-describing with `supportedEvents` and `hooksConfigPath`.

### Tickets

| Ticket | Club | Summary |
|--------|------|---------|
| S39-1 | long_iron | Research Cline/Continue hook APIs (current state, feasibility) |
| S39-2 | short_iron | Build ClineAdapter (if viable) or enhance GenericAdapter for Cline |
| S39-3 | short_iron | Build ContinueAdapter (if viable) or document limitations |
| S39-4 | wedge | Update compatibility matrix, adapter authoring guide, CODEBASE.md |

#### S39-1: Research current hook APIs
- **Club:** long_iron | **Complexity:** moderate
- Cline: check for hook/extension API — MCP tool intercepts, custom commands, pre/post events
- Continue: check for extension hooks — config-based guards, middleware, lifecycle events
- Aider: quick re-check for any new hook capabilities since S35
- Output: updated `harness-research.md` with current findings
- Inform adapter decisions for S39-2 and S39-3

#### S39-2: ClineAdapter
- **Club:** short_iron | **Complexity:** standard
- If Cline has hook support: full adapter with `supportedEvents`, `hooksConfigPath()`, tool name map
- If no hook support: enhanced GenericAdapter configuration for Cline (auto-detect `.cline/` directory, Cline-specific tool names, custom README)
- Add `'cline'` to `HarnessId` type
- Tests: detect, format output, config generation

#### S39-3: ContinueAdapter
- **Club:** short_iron | **Complexity:** standard
- Same approach as S39-2 but for Continue
- If viable: full adapter. If not: GenericAdapter enhancement with Continue-specific tips
- Add `'continue'` to `HarnessId` type (if full adapter)
- Tests: detect, format output, config generation

#### S39-4: Documentation update
- **Club:** wedge | **Complexity:** small
- Update harness-research.md compatibility matrix with new findings
- Update adapter authoring guide with any new patterns discovered
- Regenerate CODEBASE.md
- Tests: none (docs only)

### Execution Order

```
S39-1 → S39-2
S39-1 → S39-3
S39-1 → S39-4
```

Research gates everything else. Adapter builds and docs run in parallel after research.

---

## Sprint 40 — The Welcome Mat

**Par:** 4 | **Slope:** 2 (`moderate: docs + UX polish, no new architecture`) | **Type:** docs + DX

**Theme:** Make SLOPE ready for external adoption. Improve onboarding (smart init with interview mode), write comprehensive getting-started docs, and create a "first sprint" tutorial that walks new users through the full workflow.

### Tickets

| Ticket | Club | Summary |
|--------|------|---------|
| S40-1 | short_iron | Enhanced `slope init` — interactive interview mode with adapter auto-detection |
| S40-2 | short_iron | Getting Started guide — end-to-end walkthrough for new users |
| S40-3 | short_iron | "Your First Sprint" tutorial — scaffolded sprint with example scorecard |
| S40-4 | wedge | README overhaul + npm package description + examples |

#### S40-1: Enhanced slope init
- **Club:** short_iron | **Complexity:** standard
- `slope init --smart` already exists from S31 — extend with adapter-aware interview
- Auto-detect harness via adapter framework, present to user for confirmation
- Generate harness-specific templates based on detection (or `--harness` override)
- Show summary of what was installed (guards, templates, MCP config, hooks)
- Tests: interview flow, adapter detection integration, template generation

#### S40-2: Getting Started guide
- **Club:** short_iron | **Complexity:** standard
- `docs/getting-started.md` — comprehensive walkthrough:
  - Installation (`npm install -g @slope-dev/slope`)
  - `slope init` for your harness (Claude Code, Cursor, Windsurf, etc.)
  - Understanding guards and how they help
  - Running your first sprint with `slope session start`
  - Filing a scorecard with `slope auto-card` or manual `slope validate`
  - Reading your handicap card with `slope card`
- Include harness-specific sections for each supported adapter
- Tests: none (docs only), but verify all CLI commands mentioned actually work

#### S40-3: First Sprint tutorial
- **Club:** short_iron | **Complexity:** standard
- `docs/tutorial-first-sprint.md` — guided tutorial:
  - Create a sample project with `.slope/config.json`
  - Walk through each sprint checklist step (Pre-Round → Per-Shot → Post-Hole)
  - Include example scorecard JSON with explanations
  - Show how to interpret the handicap card output
  - Link to advanced topics (metaphors, plugins, multi-agent, flows)
- Tests: none (docs only)

#### S40-4: README overhaul
- **Club:** wedge | **Complexity:** small
- Rewrite top-level README.md for external audience:
  - Clear value proposition: what SLOPE does, who it's for
  - Quick start (3 commands)
  - Feature overview with links to detailed docs
  - Harness compatibility matrix (from harness-research.md)
  - Contributing guide
- Update `package.json` description and keywords for npm discovery
- Tests: none (docs only)

### Execution Order

```
S40-1 (parallel)
S40-2 (parallel)
S40-3 (parallel, references S40-2)
S40-4 (parallel)
```

All tickets are largely independent. S40-3 may reference patterns from S40-2 but can be written in parallel.

---

## Summary

| Sprint | Theme | Par | Slope | Tickets | Key Deliverable | Depends On |
|--------|-------|-----|-------|---------|-----------------|------------|
| **S37** | The Adapter Interface | 4 | 2 | 4 | Enrich HarnessAdapter with supportedEvents + hooksConfigPath, deprecate static maps | — |
| **S38** | The Vault | 4 | 2 | 4 | PG store GA, migration framework, store health check + backup | — |
| **S39** | The Open Field | 4 | 3 | 4 | Cline + Continue adapters (or enhanced generic), updated compatibility matrix | S37 |
| **S40** | The Welcome Mat | 4 | 2 | 4 | Enhanced onboarding, getting-started guide, first sprint tutorial, README overhaul | S37, S38 |

**Total:** 16 tickets across 4 sprints. Critical path: S37 → S39 → S40 (3 sprints).

### Key Architectural Decisions

1. **Adapter interface enrichment over static maps**: Move per-harness metadata (supported events, config paths) onto the `HarnessAdapter` interface. This eliminates the duplication flagged in S36 review and makes adapters fully self-describing.
2. **Deprecate-then-remove**: Static helpers (`isEventSupported`, `getHooksConfigPath`, `HARNESS_EVENT_SUPPORT`) get `@deprecated` markers in S37 but stay for one phase. Removal happens in a future cleanup sprint.
3. **PG store GA**: The PostgreSQL store has been experimental since S6. Phase 7 promotes it to production-ready with proper migrations, health checks, and backup/restore.
4. **Adapter-first onboarding**: `slope init` uses the adapter framework for detection and template generation, making the init experience consistent regardless of harness.
5. **Documentation as a deliverable**: S40 treats docs as first-class sprint work — not an afterthought. External adoption requires clear onboarding paths.

### What Changes for Users

| Before Phase 7 | After Phase 7 |
|----------------|---------------|
| `HARNESS_EVENT_SUPPORT` is a static map in guard.ts | Each adapter declares its own `supportedEvents` |
| PG store is experimental | PG store is GA with migrations + health checks |
| Only 4 harness adapters (claude-code, cursor, windsurf, generic) | Up to 6 adapters (+ cline, continue) depending on hook API availability |
| Minimal getting-started docs | Comprehensive onboarding: guide, tutorial, README overhaul |
| `slope init` asks which provider | `slope init` auto-detects adapter, presents for confirmation |
| Store management is manual | `slope store status/migrate/backup/restore` CLI commands |
