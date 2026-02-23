// SLOPE Guard Framework
// Types and utilities for agent guidance hooks.

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

/** A guard's response — what guidance to inject */
export interface GuardResult {
  /** Text injected into the agent's context */
  context?: string;
  /** For PreToolUse: permission decision */
  decision?: 'allow' | 'deny' | 'ask';
  /** For Stop/PostToolUse: block reason */
  blockReason?: string;
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
  | 'workflow-gate';

/** Guard registration entry */
export interface GuardDefinition {
  name: GuardName;
  description: string;
  /** Which hook event this guard fires on */
  hookEvent: 'PreToolUse' | 'PostToolUse' | 'Stop' | 'PreCompact';
  /** Regex matcher for tool name (PreToolUse/PostToolUse only) */
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
}

/** All guard definitions */
export const GUARD_DEFINITIONS: GuardDefinition[] = [
  {
    name: 'explore',
    description: 'Suggest checking codebase index before deep exploration',
    hookEvent: 'PreToolUse',
    matcher: 'Read|Glob|Grep',
    level: 'full',
  },
  {
    name: 'hazard',
    description: 'Warn about known issues in file areas being edited',
    hookEvent: 'PreToolUse',
    matcher: 'Edit|Write',
    level: 'full',
  },
  {
    name: 'commit-nudge',
    description: 'Nudge to commit/push after prolonged editing',
    hookEvent: 'PostToolUse',
    matcher: 'Edit|Write',
    level: 'full',
  },
  {
    name: 'scope-drift',
    description: 'Warn when editing files outside claimed ticket scope',
    hookEvent: 'PreToolUse',
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
    description: 'Force haiku model and cap max_turns on Explore/Plan subagents',
    hookEvent: 'PreToolUse',
    matcher: 'Task',
    level: 'full',
  },
  {
    name: 'push-nudge',
    description: 'Nudge to push after git commits when unpushed count or time is high',
    hookEvent: 'PostToolUse',
    matcher: 'Bash',
    level: 'full',
  },
  {
    name: 'workflow-gate',
    description: 'Block ExitPlanMode until review rounds are complete',
    hookEvent: 'PreToolUse',
    matcher: 'ExitPlanMode',
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

// --- Formatters ---

/** Format a GuardResult as PreToolUse JSON output */
export function formatPreToolUseOutput(result: GuardResult): PreToolUseOutput {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      ...(result.decision && { permissionDecision: result.decision }),
      ...(result.blockReason && { permissionDecisionReason: result.blockReason }),
      ...(result.context && { additionalContext: result.context }),
    },
  };
}

/** Format a GuardResult as PostToolUse JSON output */
export function formatPostToolUseOutput(result: GuardResult): PostToolUseOutput {
  if (result.blockReason) {
    return {
      decision: 'block',
      reason: result.blockReason,
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        ...(result.context && { additionalContext: result.context }),
      },
    };
  }
  if (result.context) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: result.context,
      },
    };
  }
  return {};
}

/** Format a GuardResult as Stop JSON output */
export function formatStopOutput(result: GuardResult): StopOutput {
  if (result.blockReason) {
    return { decision: 'block', reason: result.blockReason };
  }
  return {};
}

/**
 * Generate Claude Code settings.json hooks configuration for installed guards.
 * Returns the `hooks` object to merge into .claude/settings.json.
 */
export function generateClaudeCodeHooksConfig(
  guards: AnyGuardDefinition[],
  guardScriptPath: string,
): Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string; timeout?: number; statusMessage?: string }> }>> {
  const config: Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string; timeout?: number; statusMessage?: string }> }>> = {};

  // Group guards by hookEvent + matcher
  const groups = new Map<string, AnyGuardDefinition[]>();
  for (const g of guards) {
    const key = `${g.hookEvent}::${g.matcher ?? ''}`;
    const list = groups.get(key) || [];
    list.push(g);
    groups.set(key, list);
  }

  for (const [key, defs] of groups) {
    const [hookEvent, matcher] = key.split('::');
    if (!config[hookEvent]) config[hookEvent] = [];

    const hooks = defs.map(d => ({
      type: 'command' as const,
      command: `${guardScriptPath} ${d.name}`,
      timeout: 10,
      statusMessage: `SLOPE: ${d.description}`,
    }));

    const entry: { matcher?: string; hooks: typeof hooks } = { hooks };
    if (matcher) entry.matcher = matcher;
    config[hookEvent].push(entry);
  }

  return config;
}
