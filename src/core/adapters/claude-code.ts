// SLOPE ClaudeCodeAdapter — adapts guard framework to Claude Code's hook system.

import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { HarnessAdapter, ToolNameMap } from '../harness.js';
import { CLAUDE_CODE_TOOLS, registerAdapter, SLOPE_BIN_PREAMBLE, writeOrUpdateManagedScript } from '../harness.js';
import type { GuardResult, AnyGuardDefinition, PreToolUseOutput, PostToolUseOutput, StopOutput, Suggestion } from '../guard.js';

/** Claude Code adapter — formats guard output for Claude Code's hook protocol. */
export class ClaudeCodeAdapter implements HarnessAdapter {
  readonly id = 'claude-code' as const;
  readonly displayName = 'Claude Code';
  readonly toolNames: ToolNameMap = CLAUDE_CODE_TOOLS;
  readonly supportedEvents = new Set(['PreToolUse', 'PostToolUse', 'Stop', 'PreCompact']);
  readonly supportsContextInjection = true;

  hooksConfigPath(cwd: string): string | null {
    return join(cwd, '.claude', 'settings.json');
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
      lines.push('', 'Present these options to the user using AskUserQuestion. Wait for their choice before proceeding.');
    }
    return lines.join('\n');
  }

  formatPreToolOutput(result: GuardResult): PreToolUseOutput {
    // blockReason takes precedence over suggestion (defensive)
    const suggestionText = result.suggestion && !result.blockReason
      ? this.formatSuggestion(result.suggestion) : undefined;
    const context = [result.context, suggestionText].filter(Boolean).join('\n\n') || undefined;
    const blockReason = result.blockReason ?? (
      result.suggestion?.requiresDecision && result.suggestion.priority === 'critical'
        ? suggestionText : undefined
    );

    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        ...(result.decision && { permissionDecision: result.decision }),
        ...(blockReason && { permissionDecisionReason: blockReason }),
        ...(context && { additionalContext: context }),
        // Critical suggestions with requiresDecision force a deny
        ...(result.suggestion?.requiresDecision && result.suggestion.priority === 'critical' && !result.decision && {
          permissionDecision: 'deny' as const,
        }),
      },
    };
  }

  formatPostToolOutput(result: GuardResult): PostToolUseOutput {
    const suggestionText = result.suggestion && !result.blockReason
      ? this.formatSuggestion(result.suggestion) : undefined;

    // Suggestions with requiresDecision become blockReason (forces agent to address)
    const effectiveBlockReason = result.blockReason ?? (
      result.suggestion?.requiresDecision ? suggestionText : undefined
    );

    if (effectiveBlockReason) {
      // Only include suggestion in context if it's not already captured in the blockReason
      const contextSuggestion = result.blockReason || result.suggestion?.requiresDecision ? undefined : suggestionText;
      const context = [result.context, contextSuggestion].filter(Boolean).join('\n\n') || undefined;
      return {
        decision: 'block',
        reason: effectiveBlockReason,
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          ...(context && { additionalContext: context }),
        },
      };
    }
    const context = [result.context, suggestionText].filter(Boolean).join('\n\n') || undefined;
    if (context) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: context,
        },
      };
    }
    return {};
  }

  formatStopOutput(result: GuardResult): StopOutput {
    const suggestionText = result.suggestion && !result.blockReason
      ? this.formatSuggestion(result.suggestion) : undefined;
    const effectiveBlockReason = result.blockReason ?? (
      result.suggestion?.requiresDecision ? suggestionText : undefined
    );
    if (effectiveBlockReason) {
      return { decision: 'block', reason: effectiveBlockReason };
    }
    return {};
  }

  generateHooksConfig(
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

  installGuards(cwd: string, guards: AnyGuardDefinition[]): void {
    const hooksDir = join(cwd, '.claude', 'hooks');
    mkdirSync(hooksDir, { recursive: true });

    // Create or update the guard dispatcher script (preserves user content after SLOPE END)
    const dispatcherPath = join(hooksDir, 'slope-guard.sh');
    const script = [
      '#!/usr/bin/env bash',
      '# SLOPE guard dispatcher — routes hook events to slope guard handlers',
      '# Auto-generated by slope hook add --level=full',
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

    // Generate the hooks config for .claude/settings.json
    const guardScript = '"$CLAUDE_PROJECT_DIR"/.claude/hooks/slope-guard.sh';
    const hooksConfig = this.generateHooksConfig(guards, guardScript);

    // Read and merge into .claude/settings.json
    const settingsPath = join(cwd, '.claude', 'settings.json');
    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      try {
        settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      } catch { /* start fresh */ }
    }

    // Merge hooks — remove stale SLOPE entries, preserve non-SLOPE hooks
    const existingHooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
    for (const [event, entries] of Object.entries(hooksConfig)) {
      if (!existingHooks[event]) {
        existingHooks[event] = [];
      }
      // Remove all existing SLOPE hook entries for this event (stale matchers, renamed guards)
      const existing = existingHooks[event] as Array<{ matcher?: string; hooks?: Array<{ command?: string }> }>;
      existingHooks[event] = existing.filter(e =>
        !e.hooks?.some(h => h.command?.includes('slope-guard.sh')),
      );
      // Add fresh SLOPE entries
      for (const entry of entries) {
        existingHooks[event].push(entry);
      }
    }
    settings.hooks = existingHooks;

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    console.log(`  Updated ${settingsPath} with guard hooks`);
  }

  detect(cwd: string): boolean {
    return existsSync(join(cwd, '.claude'));
  }
}

/** Singleton instance */
export const claudeCodeAdapter = new ClaudeCodeAdapter();

// Auto-register on import
registerAdapter(claudeCodeAdapter);
