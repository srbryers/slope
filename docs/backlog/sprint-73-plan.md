# Sprint 73 — The Caddy's Notes

## Theme
Cross-session memory system for SLOPE. Persistent learned patterns, user preferences, and project quirks that survive across Pi sessions and agent restarts.

## Goal
Build a lightweight but robust memory layer that:
1. Stores memories in `.slope/memories.json`
2. Surfaces relevant memories at session start via Pi extension
3. Provides CLI commands for manual memory management
4. Auto-captures patterns from guard corrections and workflow outcomes

## Par
5

## Tickets

### S73-1 — Memory Storage Core
**Club**: Short Iron | **Complexity**: Standard

- Schema: `.slope/memories.json` with version, memories array
- Each memory: `id`, `text`, `category` (workflow/style/project/hazard/other), `createdAt`, `updatedAt`, `weight` (1-10 relevance), `source` (manual/auto-guard/auto-workflow)
- Core API: `loadMemories(cwd)`, `saveMemories(cwd, memories)`, `addMemory()`, `removeMemory()`, `updateMemory()`, `searchMemories(query?)`
- Validation and migration from v1 schema
- Export types from `src/core/index.ts`

**Files**: `src/core/memory.ts`, `src/core/index.ts`

### S73-2 — Memory CLI
**Club**: Short Iron | **Complexity**: Standard

- `slope memory add <text> [--category=X] [--weight=N]` — add a memory
- `slope memory list [--category=X] [--limit=N]` — list memories with filters
- `slope memory remove <id>` — delete by ID
- `slope memory edit <id> <text>` — update text
- `slope memory search <query>` — fuzzy search across memory text
- `slope memory import <file>` / `slope memory export <file>` — JSON import/export
- Wire into `src/cli/index.ts` and registry

**Files**: `src/cli/commands/memory.ts`, `src/cli/index.ts`, `src/cli/registry.ts`

### S73-3 — Pi Extension Memory Integration
**Club**: Short Iron | **Complexity**: Standard

- Load memories on session start in `before_agent_start`
- Inject top-N most relevant memories into briefing context (weighted, recent first)
- Add `/slope-memory` slash command: interactive list/add via `ctx.ui`
- Add `slope_memory` tool: list, add, search, remove via tool calls
- Only activate when `memory` skill is enabled in Pi settings (reuses S72 settings system)

**Files**: `packages/pi-extension/src/index.ts`

### S73-4 — Auto-Memory from Guard Corrections & Workflow Outcomes
**Club**: Long Iron | **Complexity**: Moderate

- When user overrides a guard (e.g., commits to main despite warning), capture: "User overrode main-branch guard on 2026-04-22 — may prefer direct commits"
- When workflow completes, extract patterns from scorecard: "Test coverage consistently drops on wedge tickets — consider adding test ticket"
- When guard fires repeatedly on same pattern, auto-suggest memory
- Store `source: "auto-guard"` or `source: "auto-workflow"` with lower default weight (5 vs 8 for manual)
- Deduplication: don't create duplicate memories for same pattern within 7 days

**Files**: `src/core/memory.ts` (auto-capture logic), guard event handlers, workflow completion hook

### S73-5 — Test Coverage
**Club**: Wedge | **Complexity**: Small

- Unit tests for memory storage: CRUD, search, filtering, schema validation
- CLI tests for all `slope memory` subcommands
- Pi extension tests: memory injection in briefing, tool execution
- Auto-memory tests: guard override capture, workflow pattern extraction, deduplication

**Files**: `tests/core/memory.test.ts`, `tests/cli/commands/memory.test.ts`, `tests/packages/pi-extension-memory.test.ts`

## Hazard Watch
- **Scope creep**: Resist building a full vector DB or embedding search. Fuzzy string search + weight ranking is enough for v1.
- **Context bloat**: Cap injected memories to top 5 most relevant. Too many memories = noisy briefing.
- **Privacy**: Memories may contain sensitive info (API keys, internal URLs). Warn users in docs. Never auto-capture from file contents.
- **Duplication**: The settings system (S72) already has skill toggles. Memory skill should integrate cleanly, not rebuild toggles.

## Deliverables
- [ ] `src/core/memory.ts` with full CRUD + search
- [ ] `src/cli/commands/memory.ts` with all subcommands
- [ ] Pi extension updates for memory injection and tools
- [ ] Auto-memory capture from guards and workflows
- [ ] Tests: 3 test files, >90% coverage on memory module
- [ ] Updated `CODEBASE.md` with memory system docs
- [ ] Scorecard at `docs/retros/sprint-73.json`
