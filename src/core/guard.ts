// SLOPE Guard Framework
// Types and utilities for agent guidance hooks.

import type { ToolCategory } from './harness.js';
import { getAdapter } from './harness.js';

/** Input from Claude Code PreToolUse/PostToolUse hooks (JSON on stdin) */
export interface HookInput {
  session_id: string;
  transcript_path?: string;
  cwd: string;
  permission_mode?: string;
  hook_event_name: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: Record<string, unknown>;
  tool_use_id?: string;
}

/** Output for PreToolUse hooks */
export interface PreToolUseOutput {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse';
    permissionDecision?: 'allow' | 'deny' | 'ask';
    permissionDecisionReason?: string;
    additionalContext?: string;
    updatedInput?: Record<string, unknown>;
  };
}

/** Output for PostToolUse hooks */
export interface PostToolUseOutput {
  decision?: 'block';
  reason?: string;
  hookSpecificOutput?: {
    hookEventName: 'PostToolUse';
    additionalContext?: string;
  };
}

/** Output for Stop hooks */
export interface StopOutput {
  decision?: 'block';
  reason?: string;
}

/** A structured option within a suggestion */
export interface SuggestionOption {
  id: string;
  label: string;
  description?: string;
  /** Slash command or CLI command to run if selected */
  command?: string;
}

/** A structured suggestion with options for the agent to present */
export interface Suggestion {
  id: string;
  title: string;
  context: string;
  options: SuggestionOption[];
  /** If true, agent must present and wait for user choice */
  requiresDecision: boolean;
  priority?: 'critical' | 'high' | 'normal';
}

/** A guard's response — what guidance to inject */
export interface GuardResult {
  /** Text injected into the agent's context */
  context?: string;
  /** For PreToolUse: permission decision */
  decision?: 'allow' | 'deny' | 'ask';
  /** For Stop/PostToolUse: block reason */
  blockReason?: string;
  /** Structured suggestion — adapter formats for platform */
  suggestion?: Suggestion;
}

/** Known guard names */
export type GuardName =
  | 'explore'
  | 'hazard'
  | 'commit-nudge'
  | 'scope-drift'
  | 'compaction'
  | 'stop-check'
  | 'subagent-gate'
  | 'push-nudge'
  | 'workflow-gate'
  | 'review-tier'
  | 'version-check'
  | 'stale-flows'
  | 'next-action'
  | 'pr-review'
  | 'transcript'
  | 'branch-before-commit'
  | 'worktree-check'
  | 'sprint-completion'
  | 'worktree-merge'
  | 'worktree-self-remove'
  | 'session-briefing'
  | 'post-push'
  | 'phase-boundary'
  | 'claim-required'
  | 'review-stale';

/** Guard registration entry */
export interface GuardDefinition {
  name: GuardName;
  description: string;
  /** Which hook event this guard fires on */
  hookEvent: 'PreToolUse' | 'PostToolUse' | 'Stop' | 'PreCompact';
  /** Harness-agnostic tool categories this guard matches (adapter resolves to tool names) */
  toolCategories?: ToolCategory[];
  /** Regex matcher for tool name (PreToolUse/PostToolUse only) — computed from toolCategories via adapter */
  matcher?: string;
  /** Which --level installs this guard */
  level: 'scoring' | 'full';
}

/** Guidance configuration fields for .slope/config.json */
export interface GuidanceConfig {
  /** Disabled guard names */
  disabled?: string[];
  /** File paths to check for codebase index (explore guard) */
  indexPaths?: string[];
  /** Number of sprints to look back for hazards (default 5) */
  hazardRecency?: number;
  /** Minutes before commit nudge fires (default 15) */
  commitInterval?: number;
  /** Minutes before push nudge fires (default 30) */
  pushInterval?: number;
  /** Enable scope drift detection (default true) */
  scopeDrift?: boolean;
  /** Max turns for Explore subagents (default 10) */
  subagentExploreTurns?: number;
  /** Max turns for Plan subagents (default 15) */
  subagentPlanTurns?: number;
  /** Models allowed for Explore/Plan subagents (default ['haiku']) */
  subagentAllowModels?: string[];
  /** Unpushed commit count before push nudge fires (default 5) */
  pushCommitThreshold?: number;
  /** Directory for compaction handoff files (default '.slope/handoffs') */
  handoffsDir?: string;
  /** Commit message patterns allowed on main/master (branch-before-commit guard) */
  allowMainCommitPatterns?: string[];
  /** Branch names treated as protected (default: ['main', 'master']) */
  protectedBranches?: string[];
  /** Commits behind before explore guard warns (default 11) */
  mapStaleWarnAt?: number;
  /** Commits behind before explore guard blocks Edit/Write (default 31) */
  mapStaleBlockAt?: number;
}

/** All guard definitions */
export const GUARD_DEFINITIONS: GuardDefinition[] = [
  {
    name: 'explore',
    description: 'Suggest checking codebase index before deep exploration',
    hookEvent: 'PreToolUse',
    toolCategories: ['read_file', 'search_files', 'search_content', 'write_file'],
    matcher: 'Read|Glob|Grep|Edit|Write',
    level: 'full',
  },
  {
    name: 'hazard',
    description: 'Warn about known issues in file areas being edited',
    hookEvent: 'PreToolUse',
    toolCategories: ['write_file'],
    matcher: 'Edit|Write',
    level: 'full',
  },
  {
    name: 'commit-nudge',
    description: 'Nudge to commit/push after prolonged editing',
    hookEvent: 'PostToolUse',
    toolCategories: ['write_file'],
    matcher: 'Edit|Write',
    level: 'full',
  },
  {
    name: 'scope-drift',
    description: 'Warn when editing files outside claimed ticket scope',
    hookEvent: 'PreToolUse',
    toolCategories: ['write_file'],
    matcher: 'Edit|Write',
    level: 'full',
  },
  {
    name: 'compaction',
    description: 'Extract events before context compaction',
    hookEvent: 'PreCompact',
    level: 'full',
  },
  {
    name: 'stop-check',
    description: 'Check for uncommitted/unpushed work before session end',
    hookEvent: 'Stop',
    level: 'full',
  },
  {
    name: 'subagent-gate',
    description: 'Enforce model selection on Explore/Plan subagents',
    hookEvent: 'PreToolUse',
    toolCategories: ['create_subagent'],
    matcher: 'Agent',
    level: 'full',
  },
  {
    name: 'push-nudge',
    description: 'Nudge to push after git commits when unpushed count or time is high',
    hookEvent: 'PostToolUse',
    toolCategories: ['execute_command'],
    matcher: 'Bash',
    level: 'full',
  },
  {
    name: 'workflow-gate',
    description: 'Block ExitPlanMode until review rounds are complete',
    hookEvent: 'PreToolUse',
    toolCategories: ['exit_plan'],
    matcher: 'ExitPlanMode',
    level: 'full',
  },
  {
    name: 'review-tier',
    description: 'Suggest plan review with specialist reviewers after plan file write',
    hookEvent: 'PostToolUse',
    toolCategories: ['write_file'],
    matcher: 'Edit|Write',
    level: 'full',
  },
  {
    name: 'version-check',
    description: 'Block push to main when package versions have not been bumped',
    hookEvent: 'PreToolUse',
    toolCategories: ['execute_command'],
    matcher: 'Bash',
    level: 'full',
  },
  {
    name: 'stale-flows',
    description: 'Warn when editing files belonging to a stale flow definition',
    hookEvent: 'PreToolUse',
    toolCategories: ['write_file'],
    matcher: 'Edit|Write',
    level: 'full',
  },
  {
    name: 'next-action',
    description: 'Suggest next actions before session end',
    hookEvent: 'Stop',
    level: 'full',
  },
  {
    name: 'pr-review',
    description: 'Prompt for review workflow after PR creation',
    hookEvent: 'PostToolUse',
    toolCategories: ['execute_command'],
    matcher: 'Bash',
    level: 'full',
  },
  {
    name: 'transcript',
    description: 'Append tool call metadata to session transcript',
    hookEvent: 'PostToolUse',
    // no toolCategories, no matcher → fires on all tools
    level: 'full',
  },
  {
    name: 'branch-before-commit',
    description: 'Block git commit on main/master — create a feature branch first',
    hookEvent: 'PreToolUse',
    toolCategories: ['execute_command'],
    matcher: 'Bash',
    level: 'full',
  },
  {
    name: 'worktree-check',
    description: 'Block concurrent sessions without worktree isolation',
    hookEvent: 'PreToolUse',
    toolCategories: ['read_file', 'search_files', 'search_content', 'write_file', 'execute_command'],
    matcher: 'Read|Glob|Grep|Edit|Write|Bash',
    level: 'full',
  },
  {
    name: 'sprint-completion',
    description: 'Block PR creation when sprint gates are incomplete',
    hookEvent: 'PreToolUse',
    toolCategories: ['execute_command'],
    matcher: 'Bash',
    level: 'full',
  },
  {
    name: 'sprint-completion',
    description: 'Block session end when sprint gates are incomplete',
    hookEvent: 'Stop',
    level: 'full',
  },
  {
    name: 'sprint-completion',
    description: 'Auto-detect test pass and mark gate complete',
    hookEvent: 'PostToolUse',
    toolCategories: ['execute_command'],
    matcher: 'Bash',
    level: 'full',
  },
  {
    name: 'worktree-merge',
    description: 'Block gh pr merge --delete-branch in worktrees (causes false failure)',
    hookEvent: 'PreToolUse',
    toolCategories: ['execute_command'],
    matcher: 'Bash',
    level: 'full',
  },
  {
    name: 'worktree-self-remove',
    description: 'Block git worktree remove when targeting own cwd',
    hookEvent: 'PreToolUse',
    toolCategories: ['execute_command'],
    matcher: 'Bash',
    level: 'full',
  },
  // --- Suggestion Engine Guards ---
  {
    name: 'phase-boundary',
    description: 'Block starting sprint in new phase if previous phase cleanup incomplete',
    hookEvent: 'PreToolUse',
    toolCategories: ['execute_command'],
    matcher: 'Bash',
    level: 'full',
  },
  {
    name: 'claim-required',
    description: 'Warn when editing code without an active sprint claim',
    hookEvent: 'PreToolUse',
    toolCategories: ['write_file'],
    matcher: 'Edit|Write',
    level: 'full',
  },
  {
    name: 'post-push',
    description: 'Suggest next workflow step after git push',
    hookEvent: 'PostToolUse',
    toolCategories: ['execute_command'],
    matcher: 'Bash',
    level: 'full',
  },
  {
    name: 'session-briefing',
    description: 'Inject sprint context on first tool call of session',
    hookEvent: 'PostToolUse',
    // no toolCategories, no matcher → fires on all tools
    level: 'full',
  },
  {
    name: 'review-stale',
    description: 'Warn about scored sprints with missing reviews at session end',
    hookEvent: 'Stop',
    level: 'full',
  },
];

// --- Custom Guard Support ---

/** A custom guard defined by a plugin (not constrained to GuardName union) */
export interface CustomGuardDefinition {
  name: string;
  description: string;
  hookEvent: 'PreToolUse' | 'PostToolUse' | 'Stop' | 'PreCompact';
  matcher?: string;
  /** Harness-agnostic tool categories this guard applies to */
  toolCategories?: ToolCategory[];
  level: 'scoring' | 'full';
  command: string;
}

/** Union type for functions that accept both built-in and custom guards */
export type AnyGuardDefinition = GuardDefinition | CustomGuardDefinition;

const customGuards: CustomGuardDefinition[] = [];

/** Register a custom guard plugin. Idempotent — skips if name already registered. */
export function registerCustomGuard(guard: CustomGuardDefinition): void {
  if (customGuards.some(g => g.name === guard.name)) return;
  customGuards.push(guard);
}

/** Returns all guard definitions: built-in + custom */
export function getAllGuardDefinitions(): AnyGuardDefinition[] {
  return [...GUARD_DEFINITIONS, ...customGuards];
}

/** Look up a custom guard by name */
export function getCustomGuard(name: string): CustomGuardDefinition | undefined {
  return customGuards.find(g => g.name === name);
}

/** Clear all custom guards (for testing) */
export function clearCustomGuards(): void {
  customGuards.length = 0;
}

// --- Formatters (delegates to ClaudeCodeAdapter via registry lookup) ---

function getClaudeCodeAdapter() {
  const adapter = getAdapter('claude-code');
  if (!adapter) throw new Error('ClaudeCodeAdapter not registered — ensure adapters/claude-code.js is imported');
  return adapter;
}

/** Format a GuardResult as PreToolUse JSON output */
export function formatPreToolUseOutput(result: GuardResult): PreToolUseOutput {
  return getClaudeCodeAdapter().formatPreToolOutput(result) as PreToolUseOutput;
}

/** Format a GuardResult as PostToolUse JSON output */
export function formatPostToolUseOutput(result: GuardResult): PostToolUseOutput {
  return getClaudeCodeAdapter().formatPostToolOutput(result) as PostToolUseOutput;
}

/** Format a GuardResult as Stop JSON output */
export function formatStopOutput(result: GuardResult): StopOutput {
  return getClaudeCodeAdapter().formatStopOutput(result) as StopOutput;
}

/**
 * Generate Claude Code settings.json hooks configuration for installed guards.
 * Delegates to ClaudeCodeAdapter.generateHooksConfig().
 */
export function generateClaudeCodeHooksConfig(
  guards: AnyGuardDefinition[],
  guardScriptPath: string,
): Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string; timeout?: number; statusMessage?: string }> }>> {
  return getClaudeCodeAdapter().generateHooksConfig(guards, guardScriptPath) as ReturnType<typeof generateClaudeCodeHooksConfig>;
}
