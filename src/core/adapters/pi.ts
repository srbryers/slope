// SLOPE PiAdapter — adapts guard framework to pi.dev's extension event system.
// Pi extensions use TypeScript event hooks (tool_call, tool_result, agent_end).
// Config: .pi/extensions/slope/ | Skills: .pi/skills/

import { existsSync, mkdirSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HarnessAdapter, ToolNameMap } from '../harness.js';
import { registerAdapter } from '../harness.js';
import type { GuardResult, AnyGuardDefinition, PreToolUseOutput, PostToolUseOutput, StopOutput, Suggestion } from '../guard.js';

const PI_TOOLS: ToolNameMap = {
  read_file: 'read',
  write_file: 'write|edit',
  search_files: 'glob',
  search_content: 'grep',
  execute_command: 'bash',
  create_subagent: 'agent',
  exit_plan: 'exit_plan',
  enter_worktree: 'enter_worktree',
};

export class PiAdapter implements HarnessAdapter {
  readonly id = 'pi' as const;
  readonly displayName = 'Pi';
  readonly toolNames: ToolNameMap = PI_TOOLS;
  readonly supportedEvents = new Set(['PreToolUse', 'PostToolUse', 'Stop']);
  readonly supportsContextInjection = true;

  hooksConfigPath(cwd: string): string | null {
    // Pi uses extensions directory, not a hooks config file
    return join(cwd, '.pi', 'extensions', 'slope', 'index.ts');
  }

  detect(cwd: string): boolean {
    return existsSync(join(cwd, '.pi'));
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
    return lines.join('\n');
  }

  formatPreToolOutput(result: GuardResult): PreToolUseOutput {
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
        ...(blockReason && { permissionDecision: 'deny', permissionDecisionReason: blockReason }),
        ...(context && { additionalContext: context }),
      },
    };
  }

  formatPostToolOutput(result: GuardResult): PostToolUseOutput {
    const suggestionText = result.suggestion && !result.blockReason
      ? this.formatSuggestion(result.suggestion) : undefined;
    if (result.blockReason) {
      return { decision: 'block', reason: result.blockReason };
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

  generateHooksConfig(): Record<string, unknown> {
    // Pi doesn't use a hooks config file — it uses TypeScript extensions
    // The extension is installed directly by installGuards
    return {};
  }

  installGuards(cwd: string, _guards: AnyGuardDefinition[]): void {
    // Copy the Pi extension to .pi/extensions/slope/
    const extDir = join(cwd, '.pi', 'extensions', 'slope');
    mkdirSync(extDir, { recursive: true });

    // Copy from packages/pi-extension/src/
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const srcExtension = join(__dirname, '..', '..', '..', 'packages', 'pi-extension', 'src', 'index.ts');

    if (existsSync(srcExtension)) {
      cpSync(srcExtension, join(extDir, 'index.ts'));
    }

    // Copy SLOPE skills to .pi/skills/
    const skillsSrc = join(cwd, '.claude', 'skills');
    const skillsDest = join(cwd, '.pi', 'skills');
    if (existsSync(skillsSrc) && !existsSync(skillsDest)) {
      mkdirSync(skillsDest, { recursive: true });
      try { cpSync(skillsSrc, skillsDest, { recursive: true }); } catch { /* best-effort */ }
    }
  }
}

// Auto-register on import
registerAdapter(new PiAdapter());
