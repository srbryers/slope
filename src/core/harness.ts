// SLOPE Harness Adapter Framework
// Abstracts guard/hook integration from Claude Code to support multiple AI coding harnesses.

import type { GuardResult, AnyGuardDefinition } from './guard.js';

// --- Types ---

/** Supported AI coding harness identifiers */
export type HarnessId = 'claude-code' | 'cursor' | 'cline' | 'windsurf' | 'continue' | 'aider' | 'generic';

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
 * Tries each registered adapter's detect() in registration order.
 * Returns 'generic' if no adapter matches and a generic adapter is registered,
 * or undefined if nothing matches.
 */
export function detectAdapter(cwd: string): HarnessAdapter | undefined {
  // Try non-generic adapters first
  for (const adapter of adapters.values()) {
    if (adapter.id !== 'generic' && adapter.detect(cwd)) {
      return adapter;
    }
  }
  // Fall back to generic if registered
  return adapters.get('generic');
}

/** Clear all registered adapters (for testing). */
export function clearAdapters(): void {
  adapters.clear();
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
