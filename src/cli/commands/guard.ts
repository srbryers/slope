import { existsSync, readFileSync, appendFileSync } from 'node:fs';
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
import { worktreeCheckGuard } from '../guards/worktree-check.js';
import { sprintCompletionGuard } from '../guards/sprint-completion.js';
import { worktreeMergeGuard } from '../guards/worktree-merge.js';
import { worktreeSelfRemoveGuard } from '../guards/worktree-self-remove.js';
import { worktreeReuseGuard } from '../guards/worktree-reuse.js';
import { sessionBriefingGuard } from '../guards/session-briefing.js';
import { postPushGuard } from '../guards/post-push.js';
import { phaseBoundaryGuard } from '../guards/phase-boundary.js';
import { claimRequiredGuard } from '../guards/claim-required.js';
import { reviewStaleGuard } from '../guards/review-stale.js';
import { workflowStepGateGuard } from '../guards/workflow-step-gate.js';
import { formatGuardDocs } from '../guards/docs.js';
import { recordBaseline } from '../guards/git-utils.js';
import { execSync } from 'node:child_process';
import { isAdhocSession } from '../session-state.js';

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
  'worktree-check': worktreeCheckGuard,
  'sprint-completion': sprintCompletionGuard,
  'worktree-merge': worktreeMergeGuard,
  'worktree-self-remove': worktreeSelfRemoveGuard,
  'session-briefing': sessionBriefingGuard,
  'post-push': postPushGuard,
  'phase-boundary': phaseBoundaryGuard,
  'claim-required': claimRequiredGuard,
  'review-stale': reviewStaleGuard,
  'worktree-reuse': worktreeReuseGuard,
  'workflow-step-gate': workflowStepGateGuard,
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

  // Read hook input from stdin
  let input: HookInput;
  try {
    input = await readStdin();
    // Backfill required fields that Claude Code may omit from hook JSON
    if (!input.session_id) input.session_id = '';
    if (!input.cwd) input.cwd = cwd;
    if (!input.hook_event_name) input.hook_event_name = '';
  } catch {
    input = {
      session_id: '',
      cwd,
      hook_event_name: '',
    };
  }

  // Record git status baseline on first guard call for this session.
  // Used by stop-check to distinguish pre-existing dirty files from session changes.
  recordBaseline(input.session_id, cwd);

  // Find guard definition (built-in or custom).
  // When multiple definitions share a name (e.g. sprint-completion fires on
  // PreToolUse, PostToolUse, and Stop), prefer the one matching the actual
  // hook_event_name from stdin so the output formatter is correct.
  const allDefs = getAllGuardDefinitions().filter(d => d.name === name);
  if (allDefs.length === 0) {
    console.error(`Unknown guard: "${name}". Available: ${getAllGuardDefinitions().map(d => d.name).join(', ')}`);
    process.exit(1);
  }
  const hookEvent = input.hook_event_name.replace(/:.*$/, ''); // "PreToolUse:Bash" → "PreToolUse"
  const def = allDefs.find(d => d.hookEvent === hookEvent) ?? allDefs[0];

  // If hook_event_name was missing from stdin, fill from the guard definition
  if (!hookEvent) {
    input.hook_event_name = def.hookEvent;
  }

  // Skip sprint-workflow guards in adhoc sessions
  const relevance = GUARD_RELEVANCE[name];
  if (relevance?.when === 'sprint-workflow' && input.session_id && isAdhocSession(cwd, input.session_id)) {
    return;
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

  // Record guard execution metrics (fire-and-forget)
  recordGuardExecution(cwd, name, input, result);

  // Format output based on hook event type
  if (!result.context && !result.decision && !result.blockReason && !result.suggestion) {
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
  slope guard recommend       Show missing guards with relevance
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
      // Deduplicate multi-hook guards (e.g. sprint-completion fires on 3 events)
      const seen = new Set<string>();
      for (const d of GUARD_DEFINITIONS) {
        if (seen.has(d.name)) continue;
        seen.add(d.name);
        const status = disabled.includes(d.name) ? '[disabled]' : '[enabled] ';
        const events = GUARD_DEFINITIONS.filter(g => g.name === d.name).map(g => g.hookEvent);
        const eventStr = events.length > 1 ? `[${events.join(',')}]` : `[${d.hookEvent}]`;
        console.log(`  ${status} ${d.name.padEnd(22)} ${eventStr.padEnd(35)} ${d.description}`);
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
      const statusSeen = new Set<string>();
      for (const d of getAllGuardDefinitions()) {
        if (statusSeen.has(d.name)) continue;
        statusSeen.add(d.name);
        const disabled = statusDisabled.includes(d.name);
        const allEvents = getAllGuardDefinitions().filter(g => g.name === d.name).map(g => g.hookEvent);
        const supported = allEvents.some(e => adapter?.supportedEvents.has(e) ?? true);
        const marker = disabled ? '[-]' : !supported ? '[~]' : '[+]';
        const state = disabled ? 'disabled' : !supported ? 'unsupported' : 'active';
        const eventStr = allEvents.length > 1 ? allEvents.join(',') : d.hookEvent;
        console.log(`  ${marker} ${d.name.padEnd(22)} ${eventStr.padEnd(35)} ${state}`);
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
    case 'recommend': {
      guardRecommendCommand(cwd);
      break;
    }
    case 'docs': {
      formatGuardDocs(name);
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
    case 'metrics': {
      const metricsPath = join(cwd, '.slope', 'guard-metrics.jsonl');
      if (!existsSync(metricsPath)) {
        console.log('\nNo guard metrics found. Metrics are recorded automatically after guards fire.\n');
        break;
      }
      const { computeGuardMetrics } = await import('../../core/index.js');
      const raw = readFileSync(metricsPath, 'utf8').trim();
      const lines = raw.split('\n').filter(Boolean);
      const report = computeGuardMetrics(lines);

      console.log(`\n=== Guard Metrics === (${report.total_executions} executions)\n`);
      if (report.most_active) console.log(`  Most active: ${report.most_active}`);
      if (report.most_blocking) console.log(`  Most blocking: ${report.most_blocking}`);
      console.log('');
      console.log('  Guard                 Total  Allow  Deny   Context  Silent  Block%');
      console.log('  ────────────────────  ─────  ─────  ─────  ───────  ──────  ──────');
      for (const m of report.by_guard) {
        console.log(`  ${m.guard.padEnd(22)} ${String(m.total).padStart(5)}  ${String(m.allow).padStart(5)}  ${String(m.deny).padStart(5)}  ${String(m.context).padStart(7)}  ${String(m.silent).padStart(6)}  ${String(m.block_rate.toFixed(0)).padStart(5)}%`);
      }
      console.log('');
      break;
    }
    case 'audit': {
      console.log('\n=== Guard Enforcement Audit ===\n');
      const seen = new Set<string>();
      const groups: Record<string, Array<{ name: string; event: string; description: string }>> = {
        mechanical: [],
        advisory: [],
        mixed: [],
        unclassified: [],
      };

      for (const d of GUARD_DEFINITIONS) {
        if (seen.has(d.name)) continue;
        seen.add(d.name);
        const gType = d.guardType ?? 'unclassified';
        const events = GUARD_DEFINITIONS.filter(g => g.name === d.name).map(g => g.hookEvent);
        groups[gType].push({ name: d.name, event: events.join(','), description: d.description });
      }

      for (const [type, guards] of Object.entries(groups)) {
        if (guards.length === 0) continue;
        const warning = type === 'advisory' ? ' \x1b[33m⚠ lose state on compaction\x1b[0m' : '';
        console.log(`  ${type.toUpperCase()} (${guards.length})${warning}`);
        for (const g of guards) {
          console.log(`    ${g.name.padEnd(22)} [${g.event.padEnd(30)}] ${g.description}`);
        }
        console.log('');
      }
      break;
    }
    default:
      printUsage();
  }
}

/** Guard relevance metadata: when each guard is useful and why */
const GUARD_RELEVANCE: Record<string, { when: string; why: string }> = {
  'explore': { when: 'always', why: 'Prevents unnecessary codebase exploration when map is available' },
  'hazard': { when: 'always', why: 'Warns about known issues before editing affected files' },
  'commit-nudge': { when: 'always', why: 'Prevents lost work from uncommitted changes' },
  'branch-before-commit': { when: 'always', why: 'Enforces branch discipline — never commit to main' },
  'push-nudge': { when: 'always', why: 'Ensures work is pushed for recovery' },
  'stop-check': { when: 'always', why: 'Catches uncommitted/unpushed work before session end' },
  'worktree-check': { when: 'multi-session', why: 'Required for concurrent agent sessions' },
  'worktree-merge': { when: 'multi-session', why: 'Prevents gh pr merge failures in worktrees' },
  'worktree-self-remove': { when: 'multi-session', why: 'Prevents shell breakage from self-removing worktree' },
  'scope-drift': { when: 'sprint-workflow', why: 'Keeps work focused on claimed tickets' },
  'sprint-completion': { when: 'sprint-workflow', why: 'Blocks PR until tests pass and scorecard exists' },
  'review-tier': { when: 'sprint-workflow', why: 'Prompts for plan review after writing plan files' },
  'workflow-gate': { when: 'sprint-workflow', why: 'Blocks plan exit until review rounds complete' },
  'pr-review': { when: 'sprint-workflow', why: 'Prompts for implementation review after PR creation' },
  'next-action': { when: 'sprint-workflow', why: 'Suggests next steps at session end' },
  'version-check': { when: 'monorepo', why: 'Blocks push when package versions not bumped' },
  'stale-flows': { when: 'has-flows', why: 'Warns when editing files in stale flow definitions' },
  'subagent-gate': { when: 'always', why: 'Caps subagent model/turns to control cost' },
  'compaction': { when: 'always', why: 'Extracts events before context window compression' },
  'transcript': { when: 'always', why: 'Records tool call metadata for session replay' },
  'session-briefing': { when: 'always', why: 'Injects sprint context on session start for continuity' },
  'post-push': { when: 'sprint-workflow', why: 'Suggests next workflow step after pushing' },
  'phase-boundary': { when: 'sprint-workflow', why: 'Prevents starting new phase without cleanup' },
  'claim-required': { when: 'sprint-workflow', why: 'Warns when editing without sprint claim' },
  'review-stale': { when: 'sprint-workflow', why: 'Catches scored sprints missing reviews' },
  'workflow-step-gate': { when: 'sprint-workflow', why: 'Blocks file edits outside agent_work workflow steps' },
};

/** Detect which workflow profiles apply to this repo */
function detectWorkflowProfiles(cwd: string): Set<string> {
  const profiles = new Set<string>();

  // multi-session: worktree dirs exist
  try {
    const gitDir = join(cwd, '.git', 'worktrees');
    if (existsSync(gitDir)) profiles.add('multi-session');
  } catch { /* ignore */ }

  // sprint-workflow: roadmap.json + scorecards exist
  if (existsSync(join(cwd, 'docs', 'backlog', 'roadmap.json')) &&
      existsSync(join(cwd, 'docs', 'retros'))) {
    profiles.add('sprint-workflow');
  }

  // monorepo: packages/ dir or workspaces in package.json
  if (existsSync(join(cwd, 'packages'))) {
    profiles.add('monorepo');
  } else {
    try {
      const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
      if (pkg.workspaces) profiles.add('monorepo');
    } catch { /* no package.json */ }
  }

  // has-flows: .slope/flows.json exists and non-empty
  try {
    const flowsPath = join(cwd, '.slope', 'flows.json');
    if (existsSync(flowsPath)) {
      const flows = JSON.parse(readFileSync(flowsPath, 'utf8'));
      if (Array.isArray(flows) ? flows.length > 0 : Object.keys(flows).length > 0) {
        profiles.add('has-flows');
      }
    }
  } catch { /* ignore */ }

  return profiles;
}

/** slope guard recommend — show missing guards with relevance */
function guardRecommendCommand(cwd: string): void {
  const config = loadConfig();
  const disabled = config.guidance?.disabled ?? [];

  // Load custom guard plugins
  loadPluginGuards(cwd, config.plugins);

  // Detect workflow profiles
  const profiles = detectWorkflowProfiles(cwd);

  // Deduplicate guard names
  const seen = new Set<string>();
  const allGuards: Array<{ name: string; description: string }> = [];
  for (const d of getAllGuardDefinitions()) {
    if (seen.has(d.name)) continue;
    seen.add(d.name);
    allGuards.push({ name: d.name, description: d.description });
  }

  // Find missing guards with relevance
  const missing: Array<{ name: string; relevant: boolean; when: string; why: string }> = [];
  for (const guard of allGuards) {
    if (disabled.includes(guard.name)) continue;
    const relevance = GUARD_RELEVANCE[guard.name];
    if (!relevance) continue;

    // Check if installed — guard names in hooks.json may differ from guard names
    // (hooks.json uses hook event names like "session-start", not guard names)
    // Check if the guard is configured in the harness hooks config
    const isInstalled = isGuardInstalled(cwd, guard.name);
    if (isInstalled) continue;

    const relevant = relevance.when === 'always' || profiles.has(relevance.when);
    missing.push({ name: guard.name, relevant, when: relevance.when, why: relevance.why });
  }

  if (missing.length === 0) {
    console.log('\nAll relevant guards are installed. Nothing to recommend.\n');
    return;
  }

  // Sort: relevant first, then alphabetical
  missing.sort((a, b) => {
    if (a.relevant !== b.relevant) return a.relevant ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const profileList = profiles.size > 0 ? [...profiles].join(', ') : 'none detected';
  console.log(`\nWorkflow profiles: ${profileList}\n`);
  console.log('Missing guards:\n');
  console.log(`  ${'Guard'.padEnd(24)} ${'Relevant'.padEnd(10)} ${'When'.padEnd(18)} Why`);
  console.log(`  ${'─'.repeat(24)} ${'─'.repeat(10)} ${'─'.repeat(18)} ${'─'.repeat(40)}`);

  for (const g of missing) {
    const marker = g.relevant ? 'YES' : 'no';
    console.log(`  ${g.name.padEnd(24)} ${marker.padEnd(10)} ${g.when.padEnd(18)} ${g.why}`);
  }

  const relevantCount = missing.filter(g => g.relevant).length;
  if (relevantCount > 0) {
    console.log(`\n  ${relevantCount} guard${relevantCount > 1 ? 's' : ''} recommended for your workflow.`);
    console.log('  Run `slope hook add --level=full` to install all guards.\n');
  } else {
    console.log('\n  No guards are specifically recommended for your detected workflow.\n');
  }
}

/** Record a guard execution to the metrics JSONL file. Fire-and-forget with try/catch. */
function recordGuardExecution(cwd: string, guardName: string, input: HookInput, result: GuardResult): void {
  try {
    const metricsPath = join(cwd, '.slope', 'guard-metrics.jsonl');
    // Derive decision: explicit decision takes precedence, then infer from result fields.
    // Note: a guard can return decision='allow' AND context='...' (allow with guidance).
    // We record the explicit decision when present; 'context' only when there's no decision.
    const decision = result.decision ?? (result.blockReason ? 'deny' : result.context ? 'context' : 'silent');
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      guard: guardName,
      event: input.hook_event_name,
      tool: input.tool_name ?? '',
      decision,
    });
    appendFileSync(metricsPath, line + '\n');
  } catch { /* never block guard execution */ }
}

/** Check if a guard is installed in the harness hooks config */
function isGuardInstalled(cwd: string, guardName: string): boolean {
  const adapter = detectAdapter(cwd);
  if (!adapter) return false;

  const configPath = adapter.hooksConfigPath(cwd);
  if (!configPath || !existsSync(configPath)) return false;

  try {
    const raw = readFileSync(configPath, 'utf8');
    // Check if the guard name appears in the hooks config (e.g. slope-guard.sh <name>)
    return raw.includes(`slope-guard.sh ${guardName}`) || raw.includes(`guard ${guardName}`);
  } catch {
    return false;
  }
}
