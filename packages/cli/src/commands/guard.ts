import { GUARD_DEFINITIONS, formatPreToolUseOutput, formatPostToolUseOutput, formatStopOutput, getAllGuardDefinitions, getCustomGuard, loadPluginGuards } from '@slope-dev/core';
import type { HookInput, GuardResult, GuardName, AnyGuardDefinition } from '@slope-dev/core';
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
import { execSync } from 'node:child_process';

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
