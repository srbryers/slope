---
generated_at: "2026-02-24T21:21:58.570Z"
git_sha: "79bd854cf7dd0848b8bc132a5abb864ff4598e02"
sprint: 29
source_files: 0
test_files: 0
packages: 0
cli_commands: 0
guards: 13
flows: 0
---

# SLOPE Codebase Map

Sprint Lifecycle & Operational Performance Engine — pluggable-metaphor sprint scoring.

## Package Inventory

<!-- AUTO-GENERATED: START packages -->

<!-- AUTO-GENERATED: END packages -->

## API Surface (core)

Re-exports from `packages/core/src/index.ts`:

<!-- AUTO-GENERATED: START api -->

<!-- AUTO-GENERATED: END api -->

## CLI Commands

<!-- AUTO-GENERATED: START cli -->

<!-- AUTO-GENERATED: END cli -->

## Guard Definitions

<!-- AUTO-GENERATED: START guards -->

| Guard | Hook Event | Matcher | Description |
|-------|-----------|---------|-------------|
| `explore` | PreToolUse | Read|Glob|Grep | Suggest checking codebase index before deep exploration |
| `hazard` | PreToolUse | Edit|Write | Warn about known issues in file areas being edited |
| `commit-nudge` | PostToolUse | Edit|Write | Nudge to commit/push after prolonged editing |
| `scope-drift` | PreToolUse | Edit|Write | Warn when editing files outside claimed ticket scope |
| `compaction` | PreCompact | — | Extract events before context compaction |
| `stop-check` | Stop | — | Check for uncommitted/unpushed work before session end |
| `subagent-gate` | PreToolUse | Task | Force haiku model and cap max_turns on Explore/Plan subagents |
| `push-nudge` | PostToolUse | Bash | Nudge to push after git commits when unpushed count or time is high |
| `workflow-gate` | PreToolUse | ExitPlanMode | Block ExitPlanMode until review rounds are complete |
| `review-tier` | PreToolUse | ExitPlanMode | Recommend review tier based on plan scope |
| `version-check` | PreToolUse | Bash | Block push to main when package versions have not been bumped |
| `stale-flows` | PreToolUse | Edit|Write | Warn when editing files belonging to a stale flow definition |
| `next-action` | Stop | — | Suggest next actions before session end |
<!-- AUTO-GENERATED: END guards -->

## MCP Tools

<!-- AUTO-GENERATED: START mcp -->

<!-- AUTO-GENERATED: END mcp -->

## Test Inventory

<!-- AUTO-GENERATED: START tests -->

<!-- AUTO-GENERATED: END tests -->

## Recent Sprint History

<!-- AUTO-GENERATED: START history -->

| Sprint | Theme | Tickets | Score |
|--------|-------|---------|-------|
| **25** | Hazard Severity Scoring | 4 | par |
| **26** | The Fairway Map — User Flow Tracking | 5 | bogey |
| **27** | The Clubhouse — Marketing Site & Design Tokens | 5 | par |
| **28** | The Pro Tour — Content & Interactive Features | 4 | par |
| **29** | Fix NPM Publishing Pipeline | 6 | par |
<!-- AUTO-GENERATED: END history -->

## Known Gotchas

Top recurring patterns from common-issues:

<!-- AUTO-GENERATED: START gotchas -->

- **Example pattern** (general, 1 sprint): This is an example recurring pattern. Replace with your own.
- **Run full Post-Hole routine after every sprint** (general, 1 sprint): After filing the scorecard, it's easy to skip validate + review + common-issues.
- **Workspace packages must use workspace:* protocol for local deps** (monorepo, 1 sprint): mcp-tools had @srbryers/core pinned to ^0.3.3 (npm), so TypeScript resolved the published version instead of the local workspace version with new exports.
- **Core package needs @types/node when importing node: modules** (monorepo, 1 sprint): Moving config.ts/loader.ts to core failed to compile because core didn't have @types/node — it had been a pure-logic package until now.
- **better-sqlite3 native build requires pnpm onlyBuiltDependencies approval** (monorepo, 1 sprint): pnpm ignores native build scripts by default. better-sqlite3 silently fails to compile, causing runtime errors. pnpm approve-builds is interactive and unusable in CI/agent contexts.
- **Making sync functions async breaks callers that don't await** (general, 1 sprint): Changing initCommand from sync to async caused 5 CLI tests to fail — they called initCommand() without await, so assertions ran before the async work completed.
- **tsconfig.json must exclude *.test.ts when tests live alongside source** (monorepo, 1 sprint): store-sqlite had tests in src/index.test.ts. The default include: ['src/**/*.ts'] pulled test files into the build, causing type errors from test-only types to surface during tsc.
- **TypeScript strict mode rejects interface-to-Record<string,unknown> cast** (typescript, 1 sprint): SlopeConfig interface has no index signature, so TypeScript strict mode rejects `config as Record<string, unknown>`. The workaround is double-cast via unknown, but the real fix is adding the field to the interface.
- **Async CLI commands need await/rejects in tests, not sync toThrow** (testing, 1 sprint): When a CLI command is async and mocks process.exit, using `expect(() => fn()).toThrow()` silently passes because the promise rejection is unhandled. Tests appear to pass but assertions never execute.
- **Telemetry tables should not have FK constraints to session tables** (database, 1 sprint): Events table initially had REFERENCES sessions(session_id). This prevented inserting events with session IDs that don't exist in the sessions table (e.g., from external tools or after session cleanup).
<!-- AUTO-GENERATED: END gotchas -->