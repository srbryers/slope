# SLOPE Roadmap — Phase 6: Harness-Agnostic Guards + CaddyStack Integration

**Phase 6 (S34-S36):** Abstract SLOPE's guard/hook system from Claude Code, build adapters for other AI coding harnesses, and wire CaddyStack to the harness-neutral API.

**Prerequisite:** Phase 5 complete (S33 scored)

**Parallel tracks:**
- Adapter foundation: S34 (standalone, first)
- Research + additional adapters: S35 (depends on S34)
- CaddyStack integration: S36 (depends on S34, parallel with S35)

**Critical path:** S34 → S35 (2 sprints)
**Parallel:** S36 runs alongside S35

```
S34 ──→ S35
  └───→ S36
```

---

## Sprint 34 — The Universal Caddy

**Par:** 4 | **Slope:** 2 (`moderate: refactor existing code, no new external deps`) | **Type:** refactor

**Theme:** Extract a harness adapter interface from the existing Claude Code guard system. All existing functionality preserved — Claude Code works exactly as before, but through the new adapter layer.

### Tickets

| Ticket | Club | Summary |
|--------|------|---------|
| S34-1 | short_iron | Define `HarnessAdapter` interface + tool name mapping types |
| S34-2 | short_iron | Extract `ClaudeCodeAdapter` from existing guard.ts + hook.ts |
| S34-3 | short_iron | Refactor `slope hook add --level=full` to accept `--harness` flag |
| S34-4 | short_iron | Build `GenericAdapter` for shell-compatible guard scripts |
| S34-5 | wedge | `slope roadmap sync` CLI command — sync scorecards into roadmap.json |

#### S34-1: HarnessAdapter interface + tool name mapping
- **Club:** short_iron | **Complexity:** standard
- Create `src/core/harness.ts`
- Define `HarnessId` type: `'claude-code' | 'cursor' | 'cline' | 'windsurf' | 'continue' | 'aider' | 'generic'`
- Define `ToolCategory` enum: `read_file | write_file | search_files | search_content | execute_command | create_subagent | exit_plan`
- Guards with `toolCategories: undefined` (e.g., `transcript`) match all tools — adapter passes through with no matcher, same as today
- Define `ToolNameMap` type: `Record<ToolCategory, string>` — maps categories to harness-specific tool names
- Define `HarnessAdapter` interface:
  ```ts
  interface HarnessAdapter {
    id: HarnessId;
    displayName: string;
    toolNames: ToolNameMap;
    formatPreToolOutput(result: GuardResult): unknown;
    formatPostToolOutput(result: GuardResult): unknown;
    formatStopOutput(result: GuardResult): unknown;
    generateHooksConfig(guards: AnyGuardDefinition[], guardScriptPath: string): unknown;
    installGuards(cwd: string, guards: AnyGuardDefinition[]): void;
    detect(cwd: string): boolean;
  }
  ```
- Define `CLAUDE_CODE_TOOLS: ToolNameMap` with current mappings:
  - `read_file → 'Read'`, `write_file → 'Edit|Write'`, `search_files → 'Glob'`, `search_content → 'Grep'`, `execute_command → 'Bash'`, `create_subagent → 'Task'`, `exit_plan → 'ExitPlanMode'`
- Adapter registry: `registerAdapter()`, `getAdapter()`, `listAdapters()`, `detectAdapter()`
- Export from `src/core/index.ts`
- Tests: registry CRUD, tool name mapping validation

#### S34-2: Extract ClaudeCodeAdapter
- **Club:** short_iron | **Complexity:** standard
- Create `src/core/adapters/claude-code.ts`
- Move `formatPreToolUseOutput`, `formatPostToolUseOutput`, `formatStopOutput` from `guard.ts` into the adapter (keep the originals as thin wrappers that delegate to adapter for backwards compat)
- Move `generateClaudeCodeHooksConfig` into adapter's `generateHooksConfig` method
- Move `installClaudeCodeGuards` from `hook.ts` into adapter's `installGuards` method
- Add `toolCategories?: ToolCategory[]` field to `GuardDefinition` (keep `matcher?: string` for backwards compat + plugin system + display):
  - `explore`: `[read_file, search_files, search_content]`
  - `hazard/commit-nudge/scope-drift/stale-flows`: `[write_file]`
  - `push-nudge/version-check/pr-review/branch-before-commit`: `[execute_command]`
  - `subagent-gate`: `[create_subagent]`
  - `workflow-gate/review-tier`: `[exit_plan]`
- Keep `matcher` field populated on built-in guards (computed from `toolCategories` via adapter) — preserves CODEBASE.md map rendering (`map.ts:202`) and plugin compat
- `CustomGuardDefinition` unchanged — plugins keep using raw `matcher` strings, passed through by adapter
- `guard.ts` keeps its exports but delegates to adapter internally
- All existing Claude Code behavior preserved — pure refactor, no behavior change
- Tests: adapter produces identical output to current formatters, guard matchers resolve correctly

#### S34-3: Refactor hook installation with --harness flag
- **Club:** short_iron | **Complexity:** standard
- Update `slope hook add --level=full` to accept `--harness=<id>` (default: auto-detect)
- Auto-detect: use existing `detectProvider()` logic, extended to check adapter registry
- Refactor `installGuardHooks()` to call `adapter.installGuards()` instead of switching on provider
- Update `slope init` provider detection to use adapter registry's `detect()` methods
- Update help text and error messages
- Tests: `--harness=claude-code` produces same output as before, `--harness=generic` works, unknown harness errors

#### S34-4: GenericAdapter
- **Club:** short_iron | **Complexity:** standard
- Create `src/core/adapters/generic.ts`
- `detect()`: returns true if no other adapter detected (fallback)
- `formatPreToolOutput/formatPostToolOutput/formatStopOutput`: output simple JSON with `{ action: 'allow'|'deny'|'context', message: string }`
- `generateHooksConfig`: generates a `slopes-guards.json` manifest listing guard names, events, and shell commands
- `installGuards`: creates `.slope/hooks/` directory with:
  - `slope-guard.sh` dispatcher (already exists, reuse pattern)
  - `guards-manifest.json` listing all guards with their events and matchers
  - A README explaining how to wire guards into any harness
- Tool name map: use generic names that map to common patterns
- Tests: manifest generation, README generation, format output schema

### Execution Order

```
S34-1 → S34-2 → S34-3
S34-1 → S34-4
```

S34-1 (interface + registry) must land first. S34-2 (Claude Code adapter) and S34-4 (generic adapter) can run in parallel after S34-1. S34-3 (CLI flag) needs S34-2.

---

## Sprint 35 — The Equipment Room

**Par:** 4 | **Slope:** 3 (`elevated: external API research, unknown hook formats`) | **Type:** research + feature

**Theme:** Research hook/extension formats for Cursor, Cline, Windsurf, Continue, and Aider. Build adapters for the ones that have viable hook systems. Document limitations for the rest.

### Tickets

| Ticket | Club | Summary |
|--------|------|---------|
| S35-1 | long_iron | Research harness hook formats (Cursor, Cline, Windsurf, Continue, Aider) |
| S35-2 | short_iron | Build adapter for best-supported harness from research |
| S35-3 | short_iron | Build adapter for second-best harness or enhance generic |
| S35-4 | wedge | Docs: harness compatibility matrix, adapter authoring guide |

#### S35-1: Research harness hook formats
- **Club:** long_iron | **Complexity:** moderate (unknown territory, external docs)
- For each harness (Cursor, Cline, Windsurf, Continue, Aider):
  - Document hook/extension mechanism (if any)
  - Map tool names to `ToolCategory` enum
  - Assess feasibility: full adapter, partial adapter, or generic-only
  - Note limitations (e.g., no pre-tool hooks, different event model)
- Output: research doc in `docs/backlog/harness-research.md`
- Inform which adapters to build in S35-2 and S35-3

#### S35-2: First harness adapter
- **Club:** short_iron | **Complexity:** standard
- Build full adapter for the harness with best hook support from S35-1 research
- Follow `ClaudeCodeAdapter` pattern — implement all `HarnessAdapter` methods
- Tests: format output, config generation, detect, install

#### S35-3: Second harness adapter or enhanced generic
- **Club:** short_iron | **Complexity:** standard
- If a second harness has good hook support: build its adapter
- Otherwise: enhance `GenericAdapter` with research findings (better tool name defaults, improved README, harness-specific tips)
- Tests: same coverage as S35-2

#### S35-4: Documentation
- **Club:** wedge | **Complexity:** simple
- Create harness compatibility matrix (which harnesses support which guard events)
- Write adapter authoring guide for plugin authors
- Update CODEBASE.md with adapter architecture
- Tests: none (docs only)

### Execution Order

```
S35-1 → S35-2
S35-1 → S35-3
S35-1 → S35-4
```

S35-1 (research) gates everything else. S35-2, S35-3, and S35-4 can run in parallel after research.

---

## Sprint 36 — The Clubhouse Bridge

**Par:** 4 | **Slope:** 2 (`moderate: consuming existing API, web integration`) | **Type:** feature + integration

**Theme:** Wire CaddyStack to consume SLOPE's harness-neutral API. Non-technical users interact through CaddyStack's UI, which calls SLOPE core functions through the adapter layer.

### Tickets

| Ticket | Club | Summary |
|--------|------|---------|
| S36-1 | short_iron | Export harness adapter types + factory from npm package |
| S36-2 | short_iron | CaddyStack: harness selection in onboarding flow |
| S36-3 | short_iron | CaddyStack: guard status dashboard (show active guards per harness) |
| S36-4 | wedge | CaddyStack: "Install SLOPE" flow that runs `slope init --harness=X` |

#### S36-1: Export adapter types from npm package
- **Club:** short_iron | **Complexity:** standard
- Ensure `HarnessAdapter`, `HarnessId`, `ToolCategory`, `ToolNameMap` are exported from the published package
- Export `createAdapter(id: HarnessId): HarnessAdapter` factory function
- Export `listAdapters()`, `detectAdapter()` for programmatic use
- Tests: import paths resolve, factory creates correct adapter type

#### S36-2: CaddyStack harness selection
- **Club:** short_iron | **Complexity:** standard
- Add harness picker to CaddyStack onboarding (dropdown or card selector)
- Show detected harness with option to override
- Store harness preference in CaddyStack project config
- Tests: selection UI, detection integration, preference persistence

#### S36-3: Guard status dashboard
- **Club:** short_iron | **Complexity:** standard
- CaddyStack dashboard panel showing:
  - Active guards per harness
  - Guard event types (pre-tool, post-tool, stop)
  - Last triggered timestamp (from SLOPE events)
- Reads from SLOPE store + adapter registry
- Tests: dashboard data fetching, guard status rendering

#### S36-4: Install SLOPE flow
- **Club:** wedge | **Complexity:** simple
- CaddyStack "Install SLOPE" button that:
  - Runs `slope init --harness=<selected>` via shell
  - Shows progress and output
  - Verifies installation success
- Tests: install flow execution, error handling

### Execution Order

```
S36-1 → S36-2
S36-1 → S36-3
S36-1 → S36-4
```

S36-1 (exports) first. S36-2, S36-3, S36-4 are parallel after that.

**Note:** S36 is directional — CaddyStack is a separate repo. Ticket details will be refined once S34 ships and CaddyStack's current architecture is assessed.

---

## Summary

| Sprint | Theme | Par | Slope | Tickets | Key Deliverable | Depends On |
|--------|-------|-----|-------|---------|-----------------|------------|
| **S34** | The Universal Caddy | 4 | 2 | 4 | Harness adapter interface + Claude Code adapter + generic adapter + `--harness` flag | — |
| **S35** | The Equipment Room | 4 | 3 | 4 | Harness research + adapters for best-supported platforms + compatibility docs | S34 |
| **S36** | The Clubhouse Bridge | 4 | 2 | 4 | CaddyStack integration: harness selection, guard dashboard, install flow | S34 |

**Total:** 12 tickets across 3 sprints. Critical path: S34 → S35 (2 sprints).

### Key Architectural Decisions

1. **Dual matcher fields**: `toolCategories?: ToolCategory[]` alongside existing `matcher?: string`. Built-in guards get both; adapters resolve `toolCategories` to harness-specific `matcher` strings. Preserves plugin compat, CODEBASE.md rendering, and existing test assertions.
2. **`HookInput` stays as-is**: Field names (`hook_event_name`, `tool_name`, etc.) are generic enough. Each future adapter parses its harness's native stdin into `HookInput`. No 15-file rename.
3. **Backwards compatibility**: `guard.ts` keeps its current exports as thin wrappers — no breaking changes for existing installations.
4. **Auto-detect default**: `--harness` flag defaults to auto-detection, so `slope hook add --level=full` keeps working without changes for existing users.
5. **Generic as fallback**: The generic adapter ensures SLOPE works with any harness, even ones without dedicated adapters.
6. **S36 is directional**: CaddyStack is a separate repo; ticket details TBD once S34 ships and CaddyStack architecture is assessed.

### What Changes for Users

| Before Phase 6 | After Phase 6 |
|----------------|---------------|
| Guards only work with Claude Code | Guards work with any supported harness via adapters |
| `slope hook add` assumes Claude Code | `slope hook add --harness=X` targets any harness (auto-detect default) |
| Guard output format is Claude Code-specific | Each adapter formats output for its harness's schema |
| No way to use guards without Claude Code | `GenericAdapter` provides shell scripts + manifest for any tool |
| CaddyStack can't configure guards | CaddyStack UI for harness selection, guard status, and installation |
| Plugin guards use Claude Code tool names | Plugin guards keep using raw `matcher` strings (unchanged) |
