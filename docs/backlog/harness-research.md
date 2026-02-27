# Harness Hook Research — AI Coding Tool Compatibility

> Sprint 35 research: documenting hook systems across AI coding harnesses for SLOPE guard integration.

## 1. Overview — Compatibility Matrix

| Feature | Claude Code | Cursor | Windsurf | OpenCode | Generic |
|---------|------------|--------|----------|----------|---------|
| PreToolUse | ✓ | ✓ | ✓ (exit code) | ✗ | ✓ (JSON) |
| PostToolUse | ✓ | ✓ | ✓ | ✗ | ✓ |
| Stop | ✓ | ✓ | ✗ | ✗ | ✓ |
| Context injection | ✓ | ✓ | ✗ | ✗ | ✓ |
| Block/deny | ✓ | ✓ | ✓ | ✗ | ✓ |
| Ask decision | ✓ | ✗ | ✗ | ✗ | ✓ |
| Session events | ✓ | ✓ | ✓ | ✓ (plugin) | ✗ |

**Legend:** ✓ = fully supported, ✗ = not available, (exit code) = supported via exit-code protocol rather than JSON output.

**OpenCode note:** Has a plugin system (`.opencode/plugins/`) with session lifecycle events (`session.created`, `session.idle`, `session.deleted`, `session.compacted`) but no tool-level hooks. SLOPE already generates a session plugin via `slope init --opencode`. Guards use `GenericAdapter`. No dedicated adapter needed.

## 2. Cursor

**Feasibility: Full adapter** — Cursor has a comprehensive hooks system with 18+ lifecycle events, JSON stdin/stdout protocol, and the ability to block, modify, or inject context.

### Hook System

Cursor (v1.7+) supports lifecycle hooks configured in `.cursor/hooks.json`. Hooks receive JSON on stdin and return JSON on stdout.

**Source:** [Cursor Hooks Documentation](https://docs.cursor.com/configuration/hooks) *(verify URL against current Cursor docs)*

### Config Schema — `.cursor/hooks.json`

```json
{
  "hooks": [
    {
      "event": "pre-tool-use",
      "matcher": "file_edit|create_file",
      "command": ".cursor/hooks/slope-guard.sh guard-name",
      "timeout": 10000,
      "description": "SLOPE guard: description"
    },
    {
      "event": "post-tool-use",
      "matcher": "run_terminal_command",
      "command": ".cursor/hooks/slope-guard.sh guard-name",
      "timeout": 10000,
      "description": "SLOPE guard: description"
    }
  ]
}
```

**Hook events:** `pre-tool-use`, `post-tool-use`, `on-stop`

### Tool Name Mappings → ToolCategory

| ToolCategory | Cursor Tool Name(s) |
|-------------|-------------------|
| `read_file` | `read_file` |
| `write_file` | `file_edit\|create_file` |
| `search_files` | `list_directory` |
| `search_content` | `grep_search` |
| `execute_command` | `run_terminal_command` |
| `create_subagent` | `create_subagent` |
| `exit_plan` | `exit_plan` |

### Hook Protocol

**Input (JSON on stdin):**
```json
{
  "event": "pre-tool-use",
  "tool_name": "file_edit",
  "tool_input": { "file_path": "src/index.ts", "content": "..." },
  "cwd": "/project"
}
```

**Output (JSON on stdout):**
```json
{
  "decision": "allow",
  "reason": "Guard passed",
  "context": "Additional context for the agent"
}
```

Decision values: `"allow"` (proceed), `"block"` (deny execution), `"modify"` (alter tool input).

### Limitations
- No `"ask"` decision — Cursor doesn't support prompting the user for confirmation
- `"modify"` decision allows tool input changes (SLOPE doesn't use this currently)

## 3. Windsurf

**Feasibility: Partial adapter** — Windsurf's Cascade hooks support pre/post events with exit-code-based blocking but no context injection.

### Hook System

Windsurf uses Cascade hooks — shell commands that run before/after tool execution. Pre-hooks can block via exit code 2. No JSON output protocol; the harness reads only the exit code.

**Source:** [Windsurf Cascade Documentation](https://docs.windsurf.com/cascade/hooks) *(verify URL against current Windsurf docs)*

### Config Schema

Windsurf hooks are configured in `.windsurf/hooks.json`:

```json
{
  "hooks": [
    {
      "event": "pre-tool-use",
      "matcher": "edit_file|create_file",
      "command": ".windsurf/hooks/slope-guard.sh guard-name",
      "timeout": 10000,
      "description": "SLOPE guard: description"
    }
  ]
}
```

### Tool Name Mappings → ToolCategory

| ToolCategory | Windsurf Tool Name(s) |
|-------------|---------------------|
| `read_file` | `read_file` |
| `write_file` | `create_file\|edit_file` |
| `search_files` | `find_files` |
| `search_content` | `search` |
| `execute_command` | `run_command` |
| `create_subagent` | `create_subagent` |
| `exit_plan` | `exit_plan` |

### Exit-Code Protocol

Windsurf reads the process exit code to determine the hook's decision:
- **Exit 0** — Allow (tool proceeds)
- **Exit 2** — Block (tool execution denied)
- **Any other exit** — Error (logged, tool proceeds)

The SLOPE dispatcher script (`.windsurf/hooks/slope-guard.sh`) wraps `slope guard`, reads the JSON stdout, and translates `action: "deny"` to exit code 2. The adapter itself stays JSON-in/JSON-out like all others.

### Limitations
- **No context injection** — Can block but can't add `additionalContext` to the agent's context
- **No `on-stop` event** — Can't guard session termination
- **No `"ask"` decision** — No user confirmation prompt
- **Exit-code only** — Stdout from hooks is not consumed by the harness

## 4. OpenCode

**Feasibility: Generic adapter only** — No dedicated adapter needed for guards.

### Plugin System

OpenCode uses a plugin system in `.opencode/plugins/` with session-level lifecycle events:
- `session.created` — New session started
- `session.idle` — Session idle
- `session.deleted` — Session deleted
- `session.compacted` — Context compacted

**Source:** [OpenCode Plugin Documentation](https://opencode.ai/docs/plugins) *(verify URL against current OpenCode docs)*

### Why No Dedicated Adapter

OpenCode has **no tool-level hooks** — plugins can't intercept tool calls, block execution, or inject guard context. The session events are useful for SLOPE session tracking (start/end/compact) but not for guard integration.

SLOPE already generates an OpenCode session plugin via `slope init --opencode`, which covers lifecycle tracking. For guard functionality, OpenCode users should use the `GenericAdapter` with manual hook integration.

### Coverage

| Feature | Coverage |
|---------|----------|
| Session lifecycle | ✓ via `slope init --opencode` plugin |
| Guard hooks | ✗ — use GenericAdapter |
| Context injection | ✗ |
| Tool blocking | ✗ |

## 5. Cline / Continue / Aider

**Feasibility: Generic adapter only** — These tools have no lifecycle hook systems.

### Cline
No hook system. Operates as a VS Code extension with chat-based interaction. No configuration points for pre/post tool interception. Use `GenericAdapter` for manual integration.

### Continue
No hook system. VS Code/JetBrains extension with chat-based interaction. Has a `config.json` for model/provider configuration but no lifecycle hooks. Use `GenericAdapter`.

### Aider
No hook system. CLI-based tool with `.aider.conf.yml` for configuration. No pre/post tool events. Aider's `/run` command could theoretically call `slope guard` but there's no automated hook mechanism. Use `GenericAdapter`.

## 6. Guard Execution Flow

```mermaid
flowchart TD
    A[Harness triggers hook event] --> B[Hook dispatches to slope guard]
    B --> C{slope guard evaluates}
    C --> D[GuardResult: decision + context + blockReason]
    D --> E{adapter.formatPreToolOutput}

    E --> F{Which adapter?}

    F -->|Claude Code| G["{ hookSpecificOutput: { permissionDecision, additionalContext } }"]
    F -->|Cursor| H["{ decision: allow|block, reason, context }"]
    F -->|Windsurf| I["{ action: allow|deny, message }"]
    F -->|Generic| J["{ action: allow|deny|context, message, reason }"]

    G --> K[Claude Code reads JSON stdout]
    H --> L[Cursor reads JSON stdout]
    I --> M[Dispatcher script translates to exit code 0 or 2]
    J --> N[Consumer reads JSON stdout]

    subgraph "Tool Name Resolution"
        O[Guard defines toolCategories] --> P[resolveToolMatcher adapter, categories]
        P --> Q{Adapter toolNames map}
        Q -->|Claude Code| R["write_file → Edit|Write"]
        Q -->|Cursor| S["write_file → file_edit|create_file"]
        Q -->|Windsurf| T["write_file → create_file|edit_file"]
        Q -->|Generic| U["write_file → write_file"]
    end
```

## 7. Adapter Authoring Guide

To add a new harness adapter to SLOPE:

### Step 1: Create the adapter file

Create `src/core/adapters/<id>.ts`. Follow the pattern from existing adapters:

```typescript
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { HarnessAdapter, ToolNameMap } from '../harness.js';
import { registerAdapter, resolveToolMatcher } from '../harness.js';
import type { GuardResult, AnyGuardDefinition } from '../guard.js';

const MY_TOOLS: ToolNameMap = {
  read_file: 'my_read',
  write_file: 'my_write',
  search_files: 'my_find',
  search_content: 'my_grep',
  execute_command: 'my_exec',
  create_subagent: 'my_subagent',
  exit_plan: 'my_exit',
};

export class MyAdapter implements HarnessAdapter {
  readonly id = 'my-harness' as const;
  readonly displayName = 'My Harness';
  readonly toolNames: ToolNameMap = MY_TOOLS;
  readonly supportedEvents = new Set(['PreToolUse', 'PostToolUse', 'Stop']);
  readonly supportsContextInjection = true;

  hooksConfigPath(cwd: string): string | null {
    return join(cwd, '.my-harness', 'hooks.json');
  }

  formatPreToolOutput(result: GuardResult): unknown { /* ... */ }
  formatPostToolOutput(result: GuardResult): unknown { /* ... */ }
  formatStopOutput(result: GuardResult): unknown { /* ... */ }
  generateHooksConfig(guards: AnyGuardDefinition[], guardScriptPath: string): unknown { /* ... */ }
  installGuards(cwd: string, guards: AnyGuardDefinition[]): void { /* ... */ }
  detect(cwd: string): boolean { return existsSync(join(cwd, '.my-harness')); }
}

export const myAdapter = new MyAdapter();
registerAdapter(myAdapter);
```

### Step 2: Register via side-effect import

Add to `src/adapters.ts` (the `./adapters` subpath barrel) and `src/cli/commands/hook.ts`:

```typescript
import '../../core/adapters/my-harness.js';
```

This ensures the adapter auto-registers when the hook command or barrel loads.

**Consumer access:** External tools can import the adapter framework via the lightweight subpath export:
```typescript
import { getAdapter, detectAdapter, listAdapters } from '@slope-dev/slope/adapters';

const adapter = getAdapter('my-harness');     // lookup by id
const detected = detectAdapter(process.cwd()); // auto-detect from project dir
```

### Step 3: Add to ADAPTER_PRIORITY

Add the adapter id to the `ADAPTER_PRIORITY` array in `src/core/harness.ts` (before `'generic'`).

### Step 4: Write tests

Create `tests/core/adapters/my-harness.test.ts` following the patterns in `claude-code.test.ts` and `generic.test.ts`. Test:
- `id` and `displayName`
- `supportedEvents` — contains expected events, does not contain unsupported ones
- `supportsContextInjection` — correct boolean value
- `hooksConfigPath(cwd)` — returns expected path or null
- `formatPreToolOutput` — all decision branches (allow, deny, context, empty)
- `formatPostToolOutput` — block, context, empty
- `formatStopOutput` — block, empty
- `generateHooksConfig` — produces valid config entries
- `installGuards` — creates expected files in tmp dir
- `detect` — returns true/false correctly
- `toolNames` — all categories mapped

### Step 5: Verify

```bash
pnpm build && pnpm test && pnpm typecheck
```

### Key Design Notes

- **`detect()` should return `false` if the harness is not present.** The `GenericAdapter` is the fallback — don't make your adapter a fallback.
- **Adapters are JSON-in/JSON-out.** If your harness uses a different protocol (like exit codes), handle the translation in the dispatcher script generated by `installGuards()`, not in the adapter formatting methods.
- **Tool names must match the harness's actual tool identifiers.** Verify against official documentation.
- **`resolveToolMatcher()`** handles the ToolCategory → harness tool name resolution. Use it in `generateHooksConfig()` for matcher values.
