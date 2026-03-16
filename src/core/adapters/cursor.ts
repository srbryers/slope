// SLOPE CursorAdapter — adapts guard framework to Cursor's hook system.
// Cursor (v1.7+) uses JSON stdin/stdout protocol with .cursor/hooks.json config.

import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { HarnessAdapter, ToolNameMap } from '../harness.js';
import { registerAdapter, resolveToolMatcher, SLOPE_BIN_PREAMBLE, writeOrUpdateManagedScript } from '../harness.js';
import type { GuardResult, AnyGuardDefinition, Suggestion } from '../guard.js';

/** Cursor tool name mappings */
const CURSOR_TOOLS: ToolNameMap = {
  read_file: 'read_file',
  write_file: 'file_edit|create_file',
  search_files: 'list_directory',
  search_content: 'grep_search',
  execute_command: 'run_terminal_command',
  create_subagent: 'create_subagent',
  exit_plan: 'exit_plan',
};

/** Cursor hook entry in .cursor/hooks.json */
export interface CursorHookEntry {
  event: string;
  matcher?: string;
  command: string;
  timeout?: number;
  description?: string;
}

/** Cursor hooks config shape */
export interface CursorHooksConfig {
  hooks: CursorHookEntry[];
}

/** Cursor hook output protocol */
export interface CursorHookOutput {
  decision: 'allow' | 'block';
  reason?: string;
  context?: string;
}

/**
 * Map SLOPE hook events to Cursor hook events.
 * PreCompact is intentionally omitted — Cursor has no pre-compaction hook.
 */
const HOOK_EVENT_MAP: Partial<Record<'PreToolUse' | 'PostToolUse' | 'Stop' | 'PreCompact', string>> = {
  PreToolUse: 'pre-tool-use',
  PostToolUse: 'post-tool-use',
  Stop: 'on-stop',
};

/** Cursor adapter — formats guard output for Cursor's JSON hook protocol. */
export class CursorAdapter implements HarnessAdapter {
  readonly id = 'cursor' as const;
  readonly displayName = 'Cursor';
  readonly toolNames: ToolNameMap = CURSOR_TOOLS;
  readonly supportedEvents = new Set(['PreToolUse', 'PostToolUse', 'Stop']);
  readonly supportsContextInjection = true;

  hooksConfigPath(cwd: string): string | null {
    return join(cwd, '.cursor', 'hooks.json');
  }

  formatSuggestion(suggestion: Suggestion): string {
    const lines: string[] = [`SLOPE ${suggestion.title}: ${suggestion.context}`];
    if (suggestion.options.length > 0) {
      lines.push('', 'Options:');
      for (let i = 0; i < suggestion.options.length; i++) {
        const opt = suggestion.options[i];
        const desc = opt.description ? ` — ${opt.description}` : '';
        lines.push(`${i + 1}. ${opt.label}${desc}`);
      }
    }
    if (suggestion.requiresDecision) {
      lines.push('', 'Present these options to the user. Wait for their choice before proceeding.');
    }
    return lines.join('\n');
  }

  formatPreToolOutput(result: GuardResult): CursorHookOutput {
    const suggestionText = result.suggestion && !result.blockReason
      ? this.formatSuggestion(result.suggestion) : undefined;

    if (result.decision === 'deny' || result.blockReason) {
      return {
        decision: 'block',
        ...(result.blockReason && { reason: result.blockReason }),
        ...([result.context, suggestionText].filter(Boolean).length > 0 && {
          context: [result.context, suggestionText].filter(Boolean).join('\n\n'),
        }),
      };
    }
    // Critical suggestions with requiresDecision force a block
    if (result.suggestion?.requiresDecision && result.suggestion.priority === 'critical') {
      return {
        decision: 'block',
        reason: suggestionText,
        ...(result.context && { context: result.context }),
      };
    }
    return {
      decision: 'allow',
      ...([result.context, suggestionText].filter(Boolean).length > 0 && {
        context: [result.context, suggestionText].filter(Boolean).join('\n\n'),
      }),
    };
  }

  formatPostToolOutput(result: GuardResult): CursorHookOutput {
    const suggestionText = result.suggestion && !result.blockReason
      ? this.formatSuggestion(result.suggestion) : undefined;
    const effectiveBlockReason = result.blockReason ?? (
      result.suggestion?.requiresDecision ? suggestionText : undefined
    );

    if (effectiveBlockReason) {
      return {
        decision: 'block',
        reason: effectiveBlockReason,
        ...(result.context && { context: result.context }),
      };
    }
    return {
      decision: 'allow',
      ...([result.context, suggestionText].filter(Boolean).length > 0 && {
        context: [result.context, suggestionText].filter(Boolean).join('\n\n'),
      }),
    };
  }

  formatStopOutput(result: GuardResult): CursorHookOutput {
    const suggestionText = result.suggestion && !result.blockReason
      ? this.formatSuggestion(result.suggestion) : undefined;
    const effectiveBlockReason = result.blockReason ?? (
      result.suggestion?.requiresDecision ? suggestionText : undefined
    );
    if (effectiveBlockReason) {
      return {
        decision: 'block',
        reason: effectiveBlockReason,
      };
    }
    return { decision: 'allow' };
  }

  generateHooksConfig(guards: AnyGuardDefinition[], guardScriptPath: string): CursorHooksConfig {
    const hooks: CursorHookEntry[] = [];

    for (const g of guards) {
      const cursorEvent = HOOK_EVENT_MAP[g.hookEvent];
      if (!cursorEvent) continue; // Skip unsupported hook events

      const matcher = resolveToolMatcher(this, 'toolCategories' in g ? g.toolCategories : undefined) ?? g.matcher;

      const entry: CursorHookEntry = {
        event: cursorEvent,
        command: `${guardScriptPath} ${g.name}`,
        timeout: 10000,
        description: `SLOPE: ${g.description}`,
      };
      if (matcher) entry.matcher = matcher;
      hooks.push(entry);
    }

    return { hooks };
  }

  installGuards(cwd: string, guards: AnyGuardDefinition[]): void {
    const hooksDir = join(cwd, '.cursor', 'hooks');
    mkdirSync(hooksDir, { recursive: true });

    // Create or update the guard dispatcher script (preserves user content after SLOPE END)
    const dispatcherPath = join(hooksDir, 'slope-guard.sh');
    const script = [
      '#!/usr/bin/env bash',
      '# SLOPE guard dispatcher — routes hook events to slope guard handlers',
      '# Auto-generated by slope hook add --level=full --harness=cursor',
      '#',
      '# Cursor passes JSON on stdin and reads JSON from stdout.',
      '',
      '# === SLOPE MANAGED (do not edit above this line) ===',
      ...SLOPE_BIN_PREAMBLE,
      '',
      'slope guard "$@"',
      '# === SLOPE END ===',
      '',
    ].join('\n');
    const result = writeOrUpdateManagedScript(dispatcherPath, script);
    if (result !== 'unchanged') {
      console.log(`  ${result === 'created' ? 'Created' : 'Updated'} ${dispatcherPath}`);
    }

    // Generate hooks config and merge into .cursor/hooks.json
    // Command paths are relative to the project root (cwd), not the hooks.json file
    const guardScript = '.cursor/hooks/slope-guard.sh';
    const hooksConfig = this.generateHooksConfig(guards, guardScript);

    const configPath = join(cwd, '.cursor', 'hooks.json');
    let existing: CursorHooksConfig = { hooks: [] };
    if (existsSync(configPath)) {
      try {
        existing = JSON.parse(readFileSync(configPath, 'utf8'));
        if (!Array.isArray(existing.hooks)) existing.hooks = [];
      } catch { /* start fresh */ }
    }

    // Merge — avoid duplicates by checking command
    for (const entry of hooksConfig.hooks) {
      const isDuplicate = existing.hooks.some(
        e => e.command === entry.command && e.event === entry.event,
      );
      if (!isDuplicate) {
        existing.hooks.push(entry);
      }
    }

    writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n');
    console.log(`  Updated ${configPath} with guard hooks`);
  }

  detect(cwd: string): boolean {
    return existsSync(join(cwd, '.cursor'));
  }
}

/** Singleton instance */
export const cursorAdapter = new CursorAdapter();

// Auto-register on import
registerAdapter(cursorAdapter);
