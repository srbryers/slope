import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GUARD_DEFINITIONS, formatPreToolUseOutput, formatPostToolUseOutput, formatStopOutput, getAllGuardDefinitions, getCustomGuard, loadPluginGuards, detectAdapter } from '../../core/index.js';
import type { HookInput, GuardResult, GuardName, AnyGuardDefinition } from '../../core/index.js';
import { loadConfig } from '../config.js';
import { exploreGuard } from '../guards/explore.js';
import { hazardGuard } from '../guards/hazard.js';
import { commitNudgeGuard } from '../guards/commit-nudge.js';
import { scopeDriftGuard } from '../guards/scope-drift.js';
import { compactionGuard } from '../guards/compaction.js';
import { stopCheckGuard } from '../guards/stop-check.js';
import { subagentGateGuard } from '../guards/subagent-gate.js';
import { pushNudgeGuard } from '../guards/push-nudge.js';
import { workflowGateGuard } from '../guards/workflow-gate.js';
import { reviewTierGuard } from '../guards/review-tier.js';
import { versionCheckGuard } from '../guards/version-check.js';
import { nextActionGuard } from '../guards/next-action.js';
import { prReviewGuard } from '../guards/pr-review.js';
import { transcriptGuard } from '../guards/transcript.js';
import { branchBeforeCommitGuard } from '../guards/branch-before-commit.js';
import { execSync } from 'node:child_process';

// Side-effect imports: ensure all adapters are registered for detectAdapter()
import '../../core/adapters/claude-code.js';
import '../../core/adapters/cursor.js';
import '../../core/adapters/windsurf.js';
import '../../core/adapters/generic.js';

/**
 * Static map of which hook events each harness supports.
 * @deprecated Use `adapter.supportedEvents` instead. Will be removed in a future version.
 */
export const HARNESS_EVENT_SUPPORT: Record<string, Set<string>> = {
  'claude-code': new Set(['PreToolUse', 'PostToolUse', 'Stop', 'PreCompact']),
  'cursor':      new Set(['PreToolUse', 'PostToolUse', 'Stop']),
  'windsurf':    new Set(['PreToolUse', 'PostToolUse']),
  'generic':     new Set(['PreToolUse', 'PostToolUse', 'Stop']),
};

/**
 * Check if a hook event is supported by a given harness. Unknown harnesses default to supported.
 * @deprecated Use `adapter.supportedEvents.has(event)` instead. Will be removed in a future version.
 */
export function isEventSupported(harnessId: string, hookEvent: string): boolean {
  return HARNESS_EVENT_SUPPORT[harnessId]?.has(hookEvent) ?? true;
}

/**
 * Get the hooks config file path for a given harness. Returns null for unknown harnesses.
 * @deprecated Use `adapter.hooksConfigPath(cwd)` instead. Will be removed in a future version.
 */
export function getHooksConfigPath(cwd: string, harnessId: string): string | null {
  switch (harnessId) {
    case 'claude-code': return join(cwd, '.claude', 'settings.json');
    case 'cursor': return join(cwd, '.cursor', 'hooks.json');
    case 'windsurf': return join(cwd, '.windsurf', 'hooks.json');
    default: return null;
  }
}

type GuardHandler = (input: HookInput, cwd: string) => Promise<GuardResult>;

/** Registry of guard handler implementations */
const handlers: Partial<Record<GuardName, GuardHandler>> = {
  explore: exploreGuard,
  hazard: hazardGuard,
  'commit-nudge': commitNudgeGuard,
  'scope-drift': scopeDriftGuard,
  compaction: compactionGuard,
  'stop-check': stopCheckGuard,
  'subagent-gate': subagentGateGuard,
  'push-nudge': pushNudgeGuard,
  'workflow-gate': workflowGateGuard,
  'review-tier': reviewTierGuard,
  'version-check': versionCheckGuard,
  'next-action': nextActionGuard,
  'pr-review': prReviewGuard,
  transcript: transcriptGuard,
  'branch-before-commit': branchBeforeCommitGuard,
};

/** Register a guard handler */
export function registerGuard(name: GuardName, handler: GuardHandler): void {
  handlers[name] = handler;
}

/**
 * slope guard <name> — Execute a guard handler.
 * Reads hook JSON from stdin, runs the named guard, outputs response JSON.
 */
export async function guardCommand(args: string[]): Promise<void> {
  const name = args[0] as GuardName;

  if (!name || args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  // Check if guard is disabled
  const cwd = process.cwd();
  const config = loadConfig();
  const disabled = config.guidance?.disabled ?? [];
  if (disabled.includes(name)) {
    // Silently exit — disabled guards produce no output
    return;
  }

  // Load custom guard plugins
  loadPluginGuards(cwd, config.plugins);

  // Find guard definition (built-in or custom)
  const def: AnyGuardDefinition | undefined = getAllGuardDefinitions().find(d => d.name === name);
  if (!def) {
    console.error(`Unknown guard: "${name}". Available: ${getAllGuardDefinitions().map(d => d.name).join(', ')}`);
    process.exit(1);
  }

  // Read hook input from stdin
  let input: HookInput;
  try {
    input = await readStdin();
  } catch {
    // No stdin or invalid JSON — run with minimal input (for manual testing)
    input = {
      session_id: '',
      cwd,
      hook_event_name: def.hookEvent,
    };
  }

  // Find and run the handler
  const handler = handlers[name as GuardName];
  if (!handler) {
    // Check for custom guard plugin — shell out to its command
    const customDef = getCustomGuard(name);
    if (customDef) {
      try {
        const output = execSync(customDef.command, {
          cwd,
          input: JSON.stringify(input),
          encoding: 'utf8',
          timeout: 10000,
        });
        if (output.trim()) {
          process.stdout.write(output);
        }
      } catch { /* custom guard failed — silent passthrough */ }
      return;
    }
    // No handler registered — passthrough
    return;
  }

  const result = await handler(input, cwd);

  // Format output based on hook event type
  if (!result.context && !result.decision && !result.blockReason) {
    // No guidance to inject — silent passthrough
    return;
  }

  let output: unknown;
  switch (def.hookEvent) {
    case 'PreToolUse':
      output = formatPreToolUseOutput(result);
      break;
    case 'PostToolUse':
      output = formatPostToolUseOutput(result);
      break;
    case 'Stop':
      output = formatStopOutput(result);
      break;
    case 'PreCompact':
      // PreCompact doesn't return JSON — just run the handler for side effects
      return;
  }

  if (output && Object.keys(output as Record<string, unknown>).length > 0) {
    process.stdout.write(JSON.stringify(output));
  }
}

async function readStdin(): Promise<HookInput> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON on stdin'));
      }
    });
    process.stdin.on('error', reject);

    // Timeout if no stdin after 100ms (for manual/testing use)
    setTimeout(() => {
      if (data === '') reject(new Error('No stdin'));
    }, 100);
  });
}

function printUsage(): void {
  const allDefs = getAllGuardDefinitions();
  console.log(`
slope guard — Execute a SLOPE guidance hook

Usage:
  slope guard <name>          Run a guard (reads hook JSON from stdin)
  slope guard list            Show all available guards
  slope guard status          Show per-harness guard installation state
  slope guard enable <name>   Enable a disabled guard
  slope guard disable <name>  Disable a guard

Guards:
${allDefs.map(d => `  ${d.name.padEnd(16)} [${d.hookEvent}] ${d.description}`).join('\n')}
`);
}

/**
 * slope guard list/enable/disable subcommands
 */
export async function guardManageCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const name = args[1];
  const cwd = process.cwd();

  switch (sub) {
    case 'list': {
      const config = loadConfig();
      const disabled = config.guidance?.disabled ?? [];

      // Load custom guard plugins
      loadPluginGuards(cwd, config.plugins);

      console.log('\nSLOPE Guards:\n');
      for (const d of GUARD_DEFINITIONS) {
        const status = disabled.includes(d.name) ? '[disabled]' : '[enabled] ';
        console.log(`  ${status} ${d.name.padEnd(16)} [${d.hookEvent}] ${d.description}`);
      }
      // Show custom guards
      const allDefs = getAllGuardDefinitions();
      const customDefs = allDefs.filter(d => !GUARD_DEFINITIONS.includes(d as typeof GUARD_DEFINITIONS[number]));
      for (const d of customDefs) {
        const status = disabled.includes(d.name) ? '[disabled]' : '[enabled] ';
        console.log(`  ${status} ${d.name.padEnd(16)} [${d.hookEvent}] ${d.description} [custom]`);
      }
      console.log('');
      break;
    }
    case 'status': {
      const adapter = detectAdapter(cwd);
      const harnessId = adapter?.id ?? 'unknown';
      const harnessName = adapter?.displayName ?? 'Unknown';

      console.log(`\nDetected harness: ${harnessName} (${harnessId})`);

      // Show hooks config path + entry count
      const configPath = adapter?.hooksConfigPath(cwd) ?? null;
      if (configPath && existsSync(configPath)) {
        try {
          const raw = JSON.parse(readFileSync(configPath, 'utf8'));
          const count = harnessId === 'claude-code'
            ? Object.keys(raw.hooks ?? {}).reduce((n: number, k: string) => n + (Array.isArray(raw.hooks[k]) ? (raw.hooks[k] as unknown[]).length : 0), 0)
            : Array.isArray(raw.hooks) ? raw.hooks.length : 0;
          console.log(`Hooks config: ${configPath} (${count} entries)`);
        } catch {
          console.log(`Hooks config: ${configPath} (unreadable)`);
        }
      } else if (configPath) {
        console.log(`Hooks config: ${configPath} (not found)`);
      } else {
        console.log('Hooks config: N/A');
      }

      // Show guard table
      const statusConfig = loadConfig();
      const statusDisabled = statusConfig.guidance?.disabled ?? [];
      loadPluginGuards(cwd, statusConfig.plugins);

      console.log('\nGuards:\n');
      for (const d of getAllGuardDefinitions()) {
        const disabled = statusDisabled.includes(d.name);
        const supported = adapter?.supportedEvents.has(d.hookEvent) ?? true;
        const marker = disabled ? '[-]' : !supported ? '[~]' : '[+]';
        const state = disabled ? 'disabled' : !supported ? 'unsupported' : 'active';
        console.log(`  ${marker} ${d.name.padEnd(22)} ${d.hookEvent.padEnd(13)} ${state}`);
      }

      // Show capabilities
      const hasContext = adapter?.supportsContextInjection ?? false;
      const hasStop = adapter?.supportedEvents.has('Stop') ?? false;
      const hasPreCompact = adapter?.supportedEvents.has('PreCompact') ?? false;

      console.log('\nCapabilities:');
      console.log(`  Context injection: ${hasContext ? 'yes' : 'no'}`);
      console.log(`  Block/deny:        yes`); // All harnesses can block
      console.log(`  Stop event:        ${hasStop ? 'yes' : 'no'}`);
      console.log(`  PreCompact:        ${hasPreCompact ? 'yes' : 'no'}`);

      console.log('\nLegend: [+] active  [-] disabled  [~] unsupported by harness\n');
      break;
    }
    case 'enable':
    case 'disable': {
      if (!name) {
        console.error(`Error: guard name required. Usage: slope guard ${sub} <name>`);
        process.exit(1);
      }

      // Load custom guard plugins to check against all guards
      const config = loadConfig();
      loadPluginGuards(cwd, config.plugins);

      if (!getAllGuardDefinitions().find(d => d.name === name)) {
        console.error(`Unknown guard: "${name}"`);
        process.exit(1);
      }
      console.log(`\nTo ${sub} the "${name}" guard, update .slope/config.json:`);
      console.log(`  "guidance": { "disabled": [${sub === 'disable' ? `"${name}"` : '...remove...'} ] }\n`);
      break;
    }
    default:
      printUsage();
  }
}
