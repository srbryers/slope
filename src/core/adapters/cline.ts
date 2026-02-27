// SLOPE ClineAdapter — adapts guard framework to Cline's per-event hook system.
// Cline (v3.36+) uses per-event executable scripts in .clinerules/hooks/.
// Each script receives JSON on stdin and returns JSON on stdout.
//
// Source: https://docs.cline.bot/features/hooks
// Verified against Cline v3.68.0 (2026-02-27), github.com/cline/cline

import { existsSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import type { HarnessAdapter, ToolNameMap } from '../harness.js';
import { registerAdapter, resolveToolMatcher } from '../harness.js';
import type { GuardResult, AnyGuardDefinition } from '../guard.js';

/**
 * Cline tool name mappings — verified from Cline v3.68.0 system prompt.
 *
 * CAUTION: Cline's `search_files` is a content search (regex grep), NOT file listing.
 * `list_files` is file/directory listing. This is the opposite of what the names suggest.
 */
const CLINE_TOOLS: ToolNameMap = {
  read_file: 'read_file',
  write_file: 'write_to_file|replace_in_file',
  search_files: 'list_files',          // file discovery, NOT content search
  search_content: 'search_files',       // content grep, NOT file listing
  execute_command: 'execute_command',
  create_subagent: 'use_mcp_tool',
  exit_plan: 'plan_mode_response',
};

/**
 * Cline hook output protocol.
 * Source: src/core/hooks/hook-factory.ts (validateHookOutput)
 */
export interface ClineHookOutput {
  cancel?: boolean;
  /** Injected into agent's live context. Truncated to 50KB by Cline. */
  contextModification?: string;
  /** User-visible denial message when cancel is true. */
  errorMessage?: string;
}

/**
 * Map SLOPE hook events to Cline hook event names (PascalCase, matching script filenames).
 *
 * TaskComplete is intentionally NOT mapped to Stop — a completed task already finished
 * and can't be blocked. Only TaskCancel maps to Stop because cancellation can be intercepted.
 */
const HOOK_EVENT_MAP: Partial<Record<'PreToolUse' | 'PostToolUse' | 'Stop' | 'PreCompact', string>> = {
  PreToolUse: 'PreToolUse',
  PostToolUse: 'PostToolUse',
  Stop: 'TaskCancel',
  PreCompact: 'PreCompact',
};

/** Cline adapter — formats guard output for Cline's per-event script protocol. */
export class ClineAdapter implements HarnessAdapter {
  readonly id = 'cline' as const;
  readonly displayName = 'Cline';
  readonly toolNames: ToolNameMap = CLINE_TOOLS;
  readonly supportedEvents = new Set(['PreToolUse', 'PostToolUse', 'Stop', 'PreCompact']);
  readonly supportsContextInjection = true;

  hooksConfigPath(_cwd: string): string | null {
    // Cline uses directory-based hook discovery (per-event scripts), not a single config file.
    // Returning null matches GenericAdapter pattern and avoids breaking readFileSync callers.
    return null;
  }

  formatPreToolOutput(result: GuardResult): ClineHookOutput {
    if (result.decision === 'deny' || result.blockReason) {
      return {
        cancel: true,
        ...(result.blockReason && { errorMessage: result.blockReason }),
        ...(result.context && { contextModification: result.context }),
      };
    }
    // 'ask' maps to cancel: false — Cline has no user-confirmation prompt
    return {
      cancel: false,
      ...(result.context && { contextModification: result.context }),
    };
  }

  formatPostToolOutput(result: GuardResult): ClineHookOutput {
    if (result.blockReason) {
      return {
        cancel: true,
        errorMessage: result.blockReason,
        ...(result.context && { contextModification: result.context }),
      };
    }
    return {
      cancel: false,
      ...(result.context && { contextModification: result.context }),
    };
  }

  formatStopOutput(result: GuardResult): ClineHookOutput {
    if (result.blockReason) {
      return {
        cancel: true,
        errorMessage: result.blockReason,
      };
    }
    return { cancel: false };
  }

  /**
   * Generate per-event dispatcher script content for a set of guards.
   * Cline has no hooks.json — each event has a single script that must handle
   * all guards for that event, including tool name filtering.
   */
  generateHooksConfig(guards: AnyGuardDefinition[], guardScriptPath: string): Record<string, string> {
    const scripts: Record<string, string> = {};

    // Group guards by Cline event
    const guardsByEvent = new Map<string, AnyGuardDefinition[]>();
    for (const g of guards) {
      const clineEvent = HOOK_EVENT_MAP[g.hookEvent];
      if (!clineEvent) continue;

      let list = guardsByEvent.get(clineEvent);
      if (!list) {
        list = [];
        guardsByEvent.set(clineEvent, list);
      }
      list.push(g);
    }

    for (const [event, eventGuards] of guardsByEvent) {
      const guardCalls = eventGuards.map(g => {
        const matcher = resolveToolMatcher(this, 'toolCategories' in g ? g.toolCategories : undefined);
        if (matcher) {
          // Filter by tool name — Cline has no built-in matcher, so we filter in the script
          const tools = matcher.split('|').map(t => `"${t}"`).join(' ');
          return [
            `# Guard: ${g.name} — ${g.description}`,
            `TOOLS=(${tools})`,
            `if tool_matches "$TOOL_NAME" "\${TOOLS[@]}"; then`,
            `  run_guard "${guardScriptPath}" "${g.name}"`,
            `fi`,
          ].join('\n');
        }
        // No matcher — runs for all tools
        return [
          `# Guard: ${g.name} — ${g.description}`,
          `run_guard "${guardScriptPath}" "${g.name}"`,
        ].join('\n');
      });

      scripts[event] = [
        '#!/usr/bin/env bash',
        `# SLOPE guard dispatcher for Cline ${event} event`,
        '# Auto-generated by slope hook add --level=full --harness=cline',
        '#',
        '# Cline passes JSON on stdin. This script routes to matching SLOPE guards',
        '# and returns JSON on stdout with { cancel, contextModification, errorMessage }.',
        '',
        '# === SLOPE MANAGED (do not edit above this line) ===',
        '',
        '# Read stdin once and cache it',
        'INPUT=$(cat)',
        '',
        '# Extract tool name from stdin JSON (for PreToolUse/PostToolUse filtering)',
        'TOOL_NAME=$(echo "$INPUT" | grep -o \'"tool"[[:space:]]*:[[:space:]]*"[^"]*"\' | head -1 | sed \'s/.*"\\([^"]*\\)"$/\\1/\')',
        '',
        '# Track combined result',
        'CANCELLED=false',
        'ERROR_MSG=""',
        'CONTEXT=""',
        '',
        'tool_matches() {',
        '  local tool="$1"; shift',
        '  for t in "$@"; do',
        '    [ "$tool" = "$t" ] && return 0',
        '  done',
        '  return 1',
        '}',
        '',
        'run_guard() {',
        '  local script="$1" guard="$2"',
        '  local result',
        '  result=$(echo "$INPUT" | "$script" "$guard" 2>/dev/null) || return 0',
        '  ',
        '  # Check if guard wants to cancel',
        '  local cancel',
        '  cancel=$(echo "$result" | grep -o \'"cancel"[[:space:]]*:[[:space:]]*true\' | head -1)',
        '  if [ -n "$cancel" ]; then',
        '    CANCELLED=true',
        '    local msg',
        '    msg=$(echo "$result" | grep -o \'"errorMessage"[[:space:]]*:[[:space:]]*"[^"]*"\' | head -1 | sed \'s/.*"\\([^"]*\\)"$/\\1/\')',
        '    [ -n "$msg" ] && ERROR_MSG="${ERROR_MSG:+$ERROR_MSG; }$msg"',
        '  fi',
        '  ',
        '  # Accumulate context',
        '  local ctx',
        '  ctx=$(echo "$result" | grep -o \'"contextModification"[[:space:]]*:[[:space:]]*"[^"]*"\' | head -1 | sed \'s/.*"\\([^"]*\\)"$/\\1/\')',
        '  [ -n "$ctx" ] && CONTEXT="${CONTEXT:+$CONTEXT\\n}$ctx"',
        '}',
        '',
        ...guardCalls,
        '',
        '# Output combined result',
        'if [ "$CANCELLED" = "true" ]; then',
        '  if [ -n "$CONTEXT" ]; then',
        '    printf \'{"cancel":true,"errorMessage":"%s","contextModification":"%s"}\\n\' "$ERROR_MSG" "$CONTEXT"',
        '  else',
        '    printf \'{"cancel":true,"errorMessage":"%s"}\\n\' "$ERROR_MSG"',
        '  fi',
        'elif [ -n "$CONTEXT" ]; then',
        '  printf \'{"cancel":false,"contextModification":"%s"}\\n\' "$CONTEXT"',
        'else',
        '  printf \'{"cancel":false}\\n\'',
        'fi',
        '',
        '# === SLOPE END ===',
        '',
      ].join('\n');
    }

    return scripts;
  }

  installGuards(cwd: string, guards: AnyGuardDefinition[]): void {
    const hooksDir = join(cwd, '.clinerules', 'hooks');
    mkdirSync(hooksDir, { recursive: true });

    // Create the guard dispatcher (used by per-event scripts)
    const dispatcherPath = join(hooksDir, 'slope-guard.sh');
    if (!existsSync(dispatcherPath)) {
      const script = [
        '#!/usr/bin/env bash',
        '# SLOPE guard dispatcher — called by per-event hook scripts',
        '# Auto-generated by slope hook add --level=full --harness=cline',
        '#',
        '# Receives JSON on stdin, passes to slope guard, returns JSON on stdout.',
        '',
        '# === SLOPE MANAGED (do not edit above this line) ===',
        'slope guard "$@"',
        '# === SLOPE END ===',
        '',
      ].join('\n');
      writeFileSync(dispatcherPath, script, { mode: 0o755 });
      console.log(`  Created ${dispatcherPath}`);
    }

    // Generate per-event scripts
    const guardScript = join('.clinerules', 'hooks', 'slope-guard.sh');
    const eventScripts = this.generateHooksConfig(guards, guardScript) as Record<string, string>;

    for (const [event, content] of Object.entries(eventScripts)) {
      const scriptPath = join(hooksDir, event);
      // Always overwrite event scripts (they're fully generated)
      writeFileSync(scriptPath, content);
      chmodSync(scriptPath, 0o755);
      console.log(`  Created ${scriptPath}`);
    }

    console.log(`  Installed ${Object.keys(eventScripts).length} Cline hook scripts to ${hooksDir}`);
  }

  detect(cwd: string): boolean {
    // Only detect if hooks directory exists (not just .clinerules/)
    // Prevents false-positives on Cline projects that use rules without SLOPE hooks
    return existsSync(join(cwd, '.clinerules', 'hooks'));
  }
}

/** Singleton instance */
export const clineAdapter = new ClineAdapter();

// Auto-register on import
registerAdapter(clineAdapter);
