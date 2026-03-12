# Sprint 61 — The Terminal Caddy: OB1 Adapter

**Par:** 3 | **Slope:** 1 | **Type:** feature

**Theme:** Add OB1 terminal tool support to Slope's harness adapter framework. OB1 is an AI-powered CLI tool with a JSON stdin/stdout hook system in `.ob1/hooks/`. The adapter follows Slope's established patterns from Cline (per-event directory-based hooks) and Cursor (JSON protocol).

## Tickets

| Ticket | Club | Summary |
|--------|------|---------|
| S61-1 | short_iron | Create `OB1Adapter` implementing HarnessAdapter interface |
| S61-2 | wedge | Register OB1 in harness.ts (HarnessId, ADAPTER_PRIORITY) and adapters barrel |
| S61-3 | wedge | Create comprehensive test suite for OB1Adapter |

## Execution Order

```
S61-1 → S61-2 → S61-3
```

## Key Decisions

- **Output format:** OB1 uses `{output?, error?}` protocol (NOT Cursor's `{decision, reason, context}`)
  - Allow: `{}` or `{"output": "context message"}`
  - Block: `{"error": "block reason"}`
- **Hook naming:** Per OB1 conventions, use `pre_tool_slope.sh`, `post_tool_slope.sh` in `.ob1/hooks/`
- **Detection strategy:** Detect via `.ob1/hooks` directory (per-project hooks installation indicates OB1 is active for this project) — follows Cline's pattern
- **Stop hook:** OB1 has `post_agent` hooks; map Stop to post_agent for session-end guard checks
- **Tool mappings:** Include all OB1 subagent tools (`worker`, `general`, `explore`, `plan`, `codebase_investigator`, `browser`, `vision-analyzer`, `handoff_to_agent`, `web`)
- **exit_plan:** Map to empty string (no direct equivalent in OB1) — guards using this category are filtered out
- **Context injection:** Supported via `{output: "message"}` — set `supportsContextInjection = true`
- **PreCompact:** Not supported — OB1 has no context compaction hook

## Review Findings Addressed

| Finding | Severity | Resolution |
|---------|----------|------------|
| Output format wrong | CRITICAL | Use `{output, error?}` not `{decision, reason, context}` |
| Detection strategy | CRITICAL | Use `.ob1/hooks` directory, not `.ob1` |
| Missing subagent tools | IMPORTANT | Added all delegation tools to create_subagent mapping |
| exit_plan semantic mismatch | IMPORTANT | Map to empty string, skip guards requiring this category |
| Stop hook verification | IMPORTANT | Map to `post_agent` hook type |

## Ticket Details

### S61-1: OB1Adapter implementation

**Club:** short_iron | **Complexity:** standard

Create `src/core/adapters/ob1.ts`:

- Import `existsSync, writeFileSync, mkdirSync, chmodSync` from node:fs
- Define `OB1_TOOLS: ToolNameMap`:
  - `read_file → 'read_file'`
  - `write_file → 'replace|write_file|apply_patch'`
  - `search_files → 'glob|list_directory'`
  - `search_content → 'grep_search'`
  - `execute_command → 'run_shell_command'`
  - `create_subagent → 'worker|general|explore|plan|codebase_investigator|browser|vision-analyzer|handoff_to_agent|web'`
  - `exit_plan → ''` (empty — no OB1 equivalent)
- Define `OB1HookOutput` interface: `{ output?: string; error?: string }`
- Define `HOOK_EVENT_MAP`: `PreToolUse→'pre_tool'`, `PostToolUse→'post_tool'`, `Stop→'post_agent'`
- Implement `OB1Adapter` class:
  - `id = 'ob1'`, `displayName = 'OB1'`
  - `supportedEvents = new Set(['PreToolUse', 'PostToolUse', 'Stop'])` (no PreCompact)
  - `supportsContextInjection = true`
  - `hooksConfigPath()` → `null` (directory-based discovery)
  - `detect(cwd)` → `existsSync(join(cwd, '.ob1', 'hooks'))` (project hooks directory)
  - `formatPreToolOutput(result)`:
    - Block: `{ error: result.blockReason }`
    - Allow with context: `{ output: result.context }`
    - Allow: `{}`
  - `formatPostToolOutput(result)`: Same pattern
  - `formatStopOutput(result)`: Same pattern
  - `generateHooksConfig()`: Generate per-event script content (like Cline)
  - `installGuards(cwd, guards)`:
    - Create `.ob1/hooks/` directory
    - Generate `slope-guard.sh` dispatcher
    - Generate `pre_tool_slope.sh`, `post_tool_slope.sh`, `post_agent_slope.sh`
    - Generate `guards-manifest.json`
- Export singleton `ob1Adapter`, auto-register via `registerAdapter()`

**Files:**
- Create `src/core/adapters/ob1.ts`

### S61-2: Registry + barrel registration

**Club:** wedge | **Complexity:** small

- Edit `src/core/harness.ts`:
  - Add `'ob1'` to `HarnessId` type union (line 10)
  - Add `'ob1'` to `ADAPTER_PRIORITY` array before `'generic'` (line 66)
- Edit `src/adapters.ts`:
  - Add side-effect import: `import './core/adapters/ob1.js';`
  - Add named exports: `export { OB1Adapter, ob1Adapter } from './core/adapters/ob1.js';`
  - Add type export: `export type { OB1HookOutput } from './core/adapters/ob1.js';`

**Files:**
- Edit `src/core/harness.ts`
- Edit `src/adapters.ts`

### S61-3: Test suite

**Club:** wedge | **Complexity:** small

Create `tests/core/adapters/ob1.test.ts` following `cursor.test.ts` pattern:

- `id` and `displayName` assertions
- `formatPreToolOutput` tests:
  - Empty result → `{}`
  - Context only → `{ output: context }`
  - Deny decision → `{ error: blockReason }`
  - Block reason → `{ error: blockReason }`
- `formatPostToolOutput` tests: Same patterns
- `formatStopOutput` tests: Same patterns
- `generateHooksConfig` tests:
  - Generates entries for all guards
  - Skips PreCompact guards
  - Generates bash script content
- `installGuards` tests:
  - Creates `.ob1/hooks/` directory
  - Creates dispatcher + per-event scripts
  - Creates guards-manifest.json
  - Idempotent re-install
- `detect` tests:
  - True when `.ob1/hooks/` exists
  - False otherwise
- `toolNames` mapping validation
- `supportedEvents` assertions
- `supportsContextInjection = true` assertion
- `hooksConfigPath` returns null

**Files:**
- Create `tests/core/adapters/ob1.test.ts`

## Verification

- `pnpm build && pnpm test && pnpm typecheck` — all pass
- `slope hook add --level=full --harness=ob1` produces `.ob1/hooks/` with:
  - `slope-guard.sh` dispatcher
  - `pre_tool_slope.sh`, `post_tool_slope.sh`, `post_agent_slope.sh`
  - `guards-manifest.json`
- `detectAdapter()` picks OB1 when `.ob1/hooks/` exists
- Existing adapter tests still pass
- New OB1 tests pass
