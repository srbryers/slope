# Sprint 34 — The Universal Caddy: Harness Adapter Interface

**Par:** 4 | **Slope:** 2 | **Type:** refactor

**Theme:** Extract a harness adapter interface from the existing Claude Code guard system. All existing functionality preserved — Claude Code works exactly as before, but through the new adapter layer.

## Tickets

| Ticket | Club | Summary |
|--------|------|---------|
| S34-1 | short_iron | Define `HarnessAdapter` interface + tool name mapping types |
| S34-2 | short_iron | Extract `ClaudeCodeAdapter` from existing guard.ts + hook.ts |
| S34-3 | short_iron | Refactor `slope hook add --level=full` to accept `--harness` flag |
| S34-4 | short_iron | Build `GenericAdapter` for shell-compatible guard scripts |

## Execution Order

```
S34-1 → S34-2 → S34-3
  ↘ S34-4
```

## Key Decisions

- Add `toolCategories?: ToolCategory[]` alongside existing `matcher?: string` — dual matcher fields preserve plugin compat and CODEBASE.md map rendering
- `HookInput` stays as-is — field names are generic enough, each adapter parses its harness's native stdin into `HookInput`
- `guard.ts` keeps current exports as thin wrappers delegating to adapter — no breaking changes
- `--harness` flag defaults to auto-detection, so existing `slope hook add --level=full` keeps working
- `GenericAdapter` is the fallback — SLOPE works with any harness, even without a dedicated adapter

## Ticket Details

### S34-1: HarnessAdapter interface + tool name mapping

**Club:** short_iron | **Complexity:** standard

Create `src/core/harness.ts`:

- `HarnessId` type: `'claude-code' | 'cursor' | 'cline' | 'windsurf' | 'continue' | 'aider' | 'generic'`
- `ToolCategory` enum: `read_file | write_file | search_files | search_content | execute_command | create_subagent | exit_plan`
- `ToolNameMap` type: `Record<ToolCategory, string>` — maps categories to harness-specific tool names
- `HarnessAdapter` interface with methods:
  - `formatPreToolOutput(result: GuardResult): unknown`
  - `formatPostToolOutput(result: GuardResult): unknown`
  - `formatStopOutput(result: GuardResult): unknown`
  - `generateHooksConfig(guards: AnyGuardDefinition[], guardScriptPath: string): unknown`
  - `installGuards(cwd: string, guards: AnyGuardDefinition[]): void`
  - `detect(cwd: string): boolean`
- `CLAUDE_CODE_TOOLS: ToolNameMap` — current Claude Code tool name mappings
- Adapter registry: `registerAdapter()`, `getAdapter()`, `listAdapters()`, `detectAdapter()`
- Export from `src/core/index.ts`

**Tests:** Registry CRUD, tool name mapping validation, unknown adapter errors.

**Files:**
- Create `src/core/harness.ts`
- Edit `src/core/index.ts` (add exports)
- Create `src/core/__tests__/harness.test.ts`

### S34-2: Extract ClaudeCodeAdapter

**Club:** short_iron | **Complexity:** standard

Create `src/core/adapters/claude-code.ts`:

- Move format functions from `guard.ts` into adapter (keep originals as thin wrappers)
- Move `generateClaudeCodeHooksConfig` into adapter's `generateHooksConfig`
- Move `installClaudeCodeGuards` from `hook.ts` into adapter's `installGuards`
- Add `toolCategories?: ToolCategory[]` to `GuardDefinition`:
  - `explore`: `[read_file, search_files, search_content]`
  - `hazard/commit-nudge/scope-drift/stale-flows`: `[write_file]`
  - `push-nudge/version-check/pr-review/branch-before-commit`: `[execute_command]`
  - `subagent-gate`: `[create_subagent]`
  - `workflow-gate/review-tier`: `[exit_plan]`
- Keep `matcher` field populated (computed from `toolCategories` via adapter)
- `CustomGuardDefinition` unchanged — plugins keep raw `matcher` strings

**Tests:** Adapter produces identical output to current formatters, guard matchers resolve correctly, all existing guard tests pass.

**Files:**
- Create `src/core/adapters/claude-code.ts`
- Edit `src/core/guard.ts` (delegate to adapter)
- Edit `src/core/hook.ts` (delegate to adapter)
- Edit `src/core/types.ts` (add `toolCategories` field)
- Create `src/core/adapters/__tests__/claude-code.test.ts`

### S34-3: Refactor hook installation with --harness flag

**Club:** short_iron | **Complexity:** standard

- Update `slope hook add --level=full` to accept `--harness=<id>` (default: auto-detect)
- Auto-detect: extend existing `detectProvider()` to check adapter registry
- Refactor `installGuardHooks()` to call `adapter.installGuards()`
- Update `slope init` provider detection to use adapter `detect()` methods
- Update help text and error messages

**Tests:** `--harness=claude-code` produces same output as before, `--harness=generic` works, unknown harness errors gracefully.

**Files:**
- Edit `src/cli/commands/hook.ts` (add `--harness` flag)
- Edit `src/cli/commands/init.ts` (use adapter detection)
- Edit `src/core/hook.ts` (refactor install logic)
- Edit/create tests for CLI flag behavior

### S34-4: GenericAdapter

**Club:** short_iron | **Complexity:** standard

Create `src/core/adapters/generic.ts`:

- `detect()`: returns true if no other adapter detected (fallback)
- `formatPreToolOutput/formatPostToolOutput/formatStopOutput`: simple JSON `{ action, message }`
- `generateHooksConfig`: generates `guards-manifest.json`
- `installGuards`: creates `.slope/hooks/` directory with:
  - `slope-guard.sh` dispatcher
  - `guards-manifest.json` listing guards, events, matchers
  - README explaining how to wire into any harness
- Tool name map: generic names mapping to common patterns

**Tests:** Manifest generation, README generation, format output schema.

**Files:**
- Create `src/core/adapters/generic.ts`
- Create `src/core/adapters/__tests__/generic.test.ts`

### S34-5: `slope roadmap sync` CLI command

**Club:** wedge | **Complexity:** small

Add `sync` subcommand to `src/cli/commands/roadmap.ts`:

- Reads all scorecards via `loadScorecards()`, maps to `RoadmapSprint` format
- Updates existing sprints in roadmap.json (preserves phases, dependencies, manually-authored fields)
- Adds new sprints from scorecards not yet in roadmap
- `--dry-run` flag shows diff without writing
- Wire into post-hole routine docs in `.claude/rules/sprint-checklist.md`

**Tests:** sync adds new sprint, sync updates existing sprint, dry-run doesn't write.

**Files:**
- Edit `src/cli/commands/roadmap.ts` (add `sync` subcommand)
- Create `src/core/__tests__/roadmap-sync.test.ts`

## Verification

- `pnpm build && pnpm test && pnpm typecheck` — all pass
- `slope hook add --level=full` on a Claude Code project produces identical `.claude/settings.json` as before
- `slope hook add --level=full --harness=generic` produces `.slope/hooks/` with manifest
- `slope guard explore` still works with stdin hook input
- Existing guard tests pass without modification
