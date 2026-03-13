// SLOPE Harness Adapter Framework
// Abstracts guard/hook integration from Claude Code to support multiple AI coding harnesses.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { GuardResult, AnyGuardDefinition } from './guard.js';

// --- Types ---

/** Known AI coding harness identifiers (extensible via string for third-party adapters) */
export type HarnessId = 'claude-code' | 'cursor' | 'cline' | 'windsurf' | 'continue' | 'aider' | 'ob1' | 'generic' | (string & {});

/** Tool categories that guards can match against (harness-agnostic) */
export type ToolCategory =
  | 'read_file'
  | 'write_file'
  | 'search_files'
  | 'search_content'
  | 'execute_command'
  | 'create_subagent'
  | 'exit_plan';

/** All tool categories for iteration */
export const TOOL_CATEGORIES: ToolCategory[] = [
  'read_file',
  'write_file',
  'search_files',
  'search_content',
  'execute_command',
  'create_subagent',
  'exit_plan',
];

/** Maps tool categories to harness-specific tool name patterns */
export type ToolNameMap = Record<ToolCategory, string>;

/** Interface that all harness adapters must implement */
export interface HarnessAdapter {
  /** Unique identifier for this harness */
  id: HarnessId;
  /** Human-readable display name */
  displayName: string;
  /** Maps tool categories to harness-specific tool names */
  toolNames: ToolNameMap;
  /** Format a GuardResult for PreToolUse hook output */
  formatPreToolOutput(result: GuardResult): unknown;
  /** Format a GuardResult for PostToolUse hook output */
  formatPostToolOutput(result: GuardResult): unknown;
  /** Format a GuardResult for Stop hook output */
  formatStopOutput(result: GuardResult): unknown;
  /** Generate hooks configuration for this harness */
  generateHooksConfig(guards: AnyGuardDefinition[], guardScriptPath: string): unknown;
  /** Install guard hooks into the project for this harness */
  installGuards(cwd: string, guards: AnyGuardDefinition[]): void;
  /** Detect whether this harness is active in the given directory */
  detect(cwd: string): boolean;
  /** Hook events this harness supports (e.g. PreToolUse, PostToolUse, Stop, PreCompact) */
  readonly supportedEvents: ReadonlySet<string>;
  /** Whether the harness can inject additionalContext into the agent's context */
  readonly supportsContextInjection: boolean;
  /** Return the path to this harness's hooks config file, or null if N/A */
  hooksConfigPath(cwd: string): string | null;
}

// --- Claude Code Tool Name Map ---

/** Claude Code tool name mappings */
export const CLAUDE_CODE_TOOLS: ToolNameMap = {
  read_file: 'Read',
  write_file: 'Edit|Write',
  search_files: 'Glob',
  search_content: 'Grep',
  execute_command: 'Bash',
  create_subagent: 'Task',
  exit_plan: 'ExitPlanMode',
};

// --- Adapter Priority ---

/** Detection order for adapters. First match wins. Generic is always last (fallback). */
export const ADAPTER_PRIORITY: HarnessId[] = ['claude-code', 'cursor', 'windsurf', 'cline', 'ob1', 'generic'];

// --- Adapter Registry ---

const adapters = new Map<HarnessId, HarnessAdapter>();

/** Register a harness adapter. Idempotent — overwrites if id already registered. */
export function registerAdapter(adapter: HarnessAdapter): void {
  adapters.set(adapter.id, adapter);
}

/** Get a registered adapter by id. Returns undefined if not found. */
export function getAdapter(id: HarnessId): HarnessAdapter | undefined {
  return adapters.get(id);
}

/** List all registered adapter ids. */
export function listAdapters(): HarnessId[] {
  return [...adapters.keys()];
}

/**
 * Detect which harness is active in the given directory.
 * Iterates ADAPTER_PRIORITY in order; first match wins.
 * Falls back to generic if registered and no other adapter matches.
 * Adapters not in ADAPTER_PRIORITY are checked after priority list (before generic).
 */
export function detectAdapter(cwd: string): HarnessAdapter | undefined {
  // Check priority-ordered adapters first (skip generic — it's the fallback)
  for (const id of ADAPTER_PRIORITY) {
    if (id === 'generic') continue;
    const adapter = adapters.get(id);
    if (adapter?.detect(cwd)) return adapter;
  }
  // Check any registered adapters not in the priority list (third-party)
  for (const adapter of adapters.values()) {
    if (adapter.id === 'generic') continue;
    if (ADAPTER_PRIORITY.includes(adapter.id)) continue;
    if (adapter.detect(cwd)) return adapter;
  }
  // Fall back to generic if registered
  return adapters.get('generic');
}

/** Clear all registered adapters (for testing). */
export function clearAdapters(): void {
  adapters.clear();
}

/**
 * Shell preamble that resolves the `slope` binary at runtime.
 * Checks: project node_modules → global PATH → npx fallback.
 * Defines a `slope()` shell function so all downstream `slope` calls just work.
 */
export const SLOPE_BIN_PREAMBLE: string[] = [
  '# Resolve slope binary: project node_modules → global PATH → npx fallback',
  'SLOPE_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"',
  'if [ -x "$SLOPE_PROJECT_DIR/node_modules/.bin/slope" ]; then',
  '  _SLOPE_BIN="$SLOPE_PROJECT_DIR/node_modules/.bin/slope"',
  'elif command -v slope >/dev/null 2>&1; then',
  '  _SLOPE_BIN="slope"',
  'else',
  '  _SLOPE_BIN="npx --yes @slope-dev/slope"',
  'fi',
  'slope() { "$_SLOPE_BIN" "$@"; }',
];

const MANAGED_START = '# === SLOPE MANAGED (do not edit above this line) ===';
const MANAGED_END = '# === SLOPE END ===';

/**
 * Write or update a SLOPE-managed shell script.
 * - New file: writes `fullScript` as-is.
 * - Existing file with markers: replaces content between MANAGED START and
 *   MANAGED END while preserving header (above START) and user content (below END).
 * - Existing file without markers: leaves unchanged (user fully customized).
 *
 * @param filePath  Path to the shell script
 * @param fullScript  Complete script content (used for new files)
 * @returns 'created' | 'updated' | 'unchanged'
 */
export function writeOrUpdateManagedScript(filePath: string, fullScript: string): 'created' | 'updated' | 'unchanged' {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, fullScript, { mode: 0o755 });
    return 'created';
  }

  const existing = readFileSync(filePath, 'utf8');
  const startIdx = existing.indexOf(MANAGED_START);
  const endIdx = existing.indexOf(MANAGED_END);
  if (startIdx === -1 || endIdx === -1) {
    // No markers — leave the file alone (user fully customized)
    return 'unchanged';
  }

  // Extract managed body from the new full script
  const newStartIdx = fullScript.indexOf(MANAGED_START);
  const newEndIdx = fullScript.indexOf(MANAGED_END);
  if (newStartIdx === -1 || newEndIdx === -1) return 'unchanged';

  const newManaged = fullScript.slice(newStartIdx + MANAGED_START.length, newEndIdx);
  const oldManaged = existing.slice(startIdx + MANAGED_START.length, endIdx);

  if (newManaged === oldManaged) return 'unchanged';

  // Preserve header + user content, replace only the managed section
  const header = existing.slice(0, startIdx + MANAGED_START.length);
  const userContent = existing.slice(endIdx); // includes MANAGED_END + everything after
  const updated = header + newManaged + userContent;
  writeFileSync(filePath, updated, { mode: 0o755 });
  return 'updated';
}

/**
 * Resolve tool categories to a matcher string for a specific harness.
 * If categories is undefined, returns undefined (match all tools).
 */
export function resolveToolMatcher(adapter: HarnessAdapter, categories: ToolCategory[] | undefined): string | undefined {
  if (!categories) return undefined;
  const names = new Set<string>();
  for (const cat of categories) {
    // Split pipe-separated names (e.g., 'Edit|Write') and add each
    for (const name of adapter.toolNames[cat].split('|')) {
      names.add(name);
    }
  }
  return [...names].join('|');
}
