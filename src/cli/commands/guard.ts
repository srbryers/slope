import { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync, statSync, realpathSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { GUARD_DEFINITIONS, formatPreToolUseOutput, formatPostToolUseOutput, formatStopOutput, getAllGuardDefinitions, getCustomGuard, loadPluginGuards, detectAdapter } from '../../core/index.js';
import { QUIET_STDIO } from '../../core/process.js';
import type { HookInput, GuardResult, GuardName, AnyGuardDefinition } from '../../core/index.js';
import { loadConfig } from '../config.js';
import { exploreGuard } from '../guards/explore.js';
import { hazardGuard } from '../guards/hazard.js';
import { commitNudgeGuard } from '../guards/commit-nudge.js';
import { scopeDriftGuard } from '../guards/scope-drift.js';
import { shellWriteGuard } from '../guards/shell-write.js';
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
import { roadmapEditShippedGuard } from '../guards/roadmap-edit-shipped.js';
import { postHoleEnforcementGuard } from '../guards/post-hole-enforcement.js';
import { formatGuardDocs } from '../guards/docs.js';
import { recordBaseline } from '../guards/git-utils.js';
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
  'shell-write': shellWriteGuard,
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
  'roadmap-edit-shipped': roadmapEditShippedGuard,
  'post-hole-enforcement': postHoleEnforcementGuard,
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

  const fallbackCwd = process.cwd();

  // Read hook input from stdin
  let input: HookInput;
  try {
    input = normalizeHookInput(await readStdin(), fallbackCwd);
  } catch {
    input = normalizeHookInput(null, fallbackCwd);
  }
  const cwd = input.cwd;
  const config = loadConfig(cwd);
  const disabled = config.guidance?.disabled ?? [];

  // Load custom guard plugins from the hook target workspace.
  loadPluginGuards(cwd, config.plugins);

  // Record git status baseline on first guard call for this session.
  // Used by stop-check to distinguish pre-existing dirty files from session changes.
  recordBaseline(input.session_id, cwd);

  if (name === '__batch' as GuardName) {
    await runGuardBatch(args.slice(1) as GuardName[], input, cwd, disabled);
    return;
  }

  const execution = await runGuardByName(name, input, cwd, disabled);
  if (!execution) return;
  writeGuardOutput(execution.def, execution.result);
}

async function runGuardBatch(names: GuardName[], input: HookInput, cwd: string, disabled: string[]): Promise<void> {
  const executions: Array<{ def: AnyGuardDefinition; result: GuardResult }> = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    const execution = await runGuardByName(name, input, cwd, disabled);
    if (execution) executions.push(execution);
  }
  if (executions.length === 0) return;

  const def = executions[0].def;
  const result = combineGuardResults(executions.map(e => e.result));
  writeGuardOutput(def, result);
}

async function runGuardByName(
  name: GuardName,
  input: HookInput,
  cwd: string,
  disabled: string[],
): Promise<{ def: AnyGuardDefinition; result: GuardResult } | null> {
  if (disabled.includes(name)) {
    // Silently exit — disabled guards produce no output
    return null;
  }

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

  // Skip most sprint-workflow guards in adhoc sessions. Guards with
  // suppressInAdhoc=false still run to steer implementation writes back into
  // an explicit sprint/claim flow.
  if (shouldSuppressGuardInAdhoc(name, cwd, input.session_id)) {
    recordGuardSuppression(cwd, name, input, 'adhoc-session');
    return null;
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
      return null;
    }
    // No handler registered — passthrough
    return null;
  }

  const result = await handler(input, cwd);

  // Record guard execution metrics (fire-and-forget)
  recordGuardExecution(cwd, name, input, result);

  return { def, result };
}

function combineGuardResults(results: GuardResult[]): GuardResult {
  const nonEmpty = results.filter(r => r.context || r.decision || r.blockReason || r.suggestion);
  if (nonEmpty.length === 0) return {};
  const blockReasons = nonEmpty.map(r => r.blockReason).filter(Boolean) as string[];
  const contexts = nonEmpty.map(r => r.context).filter(Boolean) as string[];
  const decisions = nonEmpty.map(r => r.decision).filter(Boolean);
  return {
    ...(contexts.length > 0 && { context: contexts.join('\n\n') }),
    ...(blockReasons.length > 0 && { blockReason: blockReasons.join('\n\n') }),
    ...(decisions.includes('deny') ? { decision: 'deny' as const } : decisions.includes('ask') ? { decision: 'ask' as const } : decisions.includes('allow') ? { decision: 'allow' as const } : {}),
    ...(nonEmpty.find(r => r.suggestion)?.suggestion && { suggestion: nonEmpty.find(r => r.suggestion)?.suggestion }),
  };
}

function writeGuardOutput(def: AnyGuardDefinition, result: GuardResult): void {
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

type HookCwdSource = 'hook' | 'tool-workdir' | 'tool-path' | 'transcript' | 'remembered' | 'staged-worktree';

interface HookCwdResolution {
  cwd: string;
  source: HookCwdSource;
}

export function normalizeHookInput(input: HookInput | null, fallbackCwd: string): HookInput {
  const baseCwd = normalizeBaseCwd(input, fallbackCwd);
  const resolved = resolveEffectiveHookCwd(input, baseCwd, fallbackCwd);
  const normalized = {
    ...(input ?? {}),
    session_id: input?.session_id ?? '',
    cwd: resolved.cwd,
    hook_event_name: input?.hook_event_name ?? '',
  };

  if (input && resolved.source !== 'hook') {
    rememberCodexWorkdir(normalized, resolved);
  }

  return normalized;
}

function normalizeBaseCwd(input: HookInput | null, fallbackCwd: string): string {
  const raw = typeof input?.cwd === 'string' && input.cwd.trim().length > 0
    ? input.cwd.trim()
    : fallbackCwd;
  return normalizePath(raw, fallbackCwd);
}

function resolveEffectiveHookCwd(input: HookInput | null, baseCwd: string, fallbackCwd: string): HookCwdResolution {
  if (!input) return { cwd: baseCwd, source: 'hook' };

  const explicitWorkdir = extractToolInputWorkdir(input);
  if (explicitWorkdir) {
    return { cwd: normalizePath(explicitWorkdir, baseCwd), source: 'tool-workdir' };
  }

  const toolPathCwd = extractToolInputPathCwd(input, baseCwd);
  if (toolPathCwd) {
    return { cwd: toolPathCwd, source: 'tool-path' };
  }

  const transcriptCwd = extractTranscriptWorkdir(input, baseCwd);
  if (transcriptCwd) {
    return { cwd: transcriptCwd, source: 'transcript' };
  }

  const rememberedCwd = readRememberedCodexWorkdir(input, fallbackCwd);
  if (rememberedCwd) {
    return { cwd: rememberedCwd, source: 'remembered' };
  }

  const inferredWorktree = inferSingleStagedWorktree(input, baseCwd);
  if (inferredWorktree) {
    return { cwd: inferredWorktree, source: 'staged-worktree' };
  }

  return { cwd: baseCwd, source: 'hook' };
}

function normalizePath(rawPath: string, baseCwd: string): string {
  const absolute = isAbsolute(rawPath) ? rawPath : resolve(baseCwd, rawPath);
  return canonicalHookCwd(absolute);
}

function canonicalHookCwd(path: string): string {
  return resolveWorkspaceRoot(path) ?? path;
}

/**
 * Resolve a path to the workspace root that owns it — the nearest ancestor with
 * .slope/config.json, else the enclosing git toplevel. Returns null when the
 * path belongs to no workspace at all (e.g. a harness scratchpad under /tmp).
 *
 * Callers that *infer* a cwd must treat null as "no workspace" rather than
 * adopting the orphan directory: doing so would relocate every guard's notion
 * of the workspace to a directory with no .slope state, which both discards the
 * real sprint state and defeats repo-scoped path checks (GH #625).
 */
function resolveWorkspaceRoot(path: string): string | null {
  const start = existingDirectory(path);
  if (!start) return null;

  const slopeRoot = findAncestorWithSlopeConfig(start);
  if (slopeRoot) return slopeRoot;

  try {
    const toplevel = execFileSync('git', ['-C', start, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
    if (toplevel) return toplevel;
  } catch { /* not a git repo */ }

  return null;
}

function existingDirectory(path: string): string | null {
  let current = path;
  try {
    if (!existsSync(current)) return null;
    if (!statSync(current).isDirectory()) current = dirname(current);
    return current;
  } catch {
    return null;
  }
}

function findAncestorWithSlopeConfig(start: string): string | null {
  let current = start;
  while (true) {
    if (existsSync(join(current, '.slope', 'config.json'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function extractToolInputWorkdir(input: HookInput): string | null {
  const toolInput = input.tool_input;
  if (!toolInput || typeof toolInput !== 'object') return null;
  for (const key of ['workdir', 'cwd']) {
    const value = toolInput[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

function extractToolInputPathCwd(input: HookInput, baseCwd: string): string | null {
  const toolInput = input.tool_input;
  if (!toolInput || typeof toolInput !== 'object') return null;
  for (const key of ['file_path', 'path']) {
    const value = toolInput[key];
    if (typeof value !== 'string' || value.trim().length === 0) continue;
    const absolute = isAbsolute(value) ? value : resolve(baseCwd, value);
    if (!existingDirectory(dirname(absolute))) continue;
    // Only adopt a path-derived cwd when the target lives in a real workspace.
    // A write to a harness scratchpad outside any repo must not become the
    // guard's workspace root (GH #625).
    const workspace = resolveWorkspaceRoot(dirname(absolute));
    if (workspace) return workspace;
  }
  return null;
}

function extractTranscriptWorkdir(input: HookInput, baseCwd: string): string | null {
  const transcriptPath = typeof input.transcript_path === 'string' ? input.transcript_path.trim() : '';
  const toolUseId = typeof input.tool_use_id === 'string' ? input.tool_use_id.trim() : '';
  if (!transcriptPath || !toolUseId || !existsSync(transcriptPath)) return null;

  try {
    const lines = readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines.reverse()) {
      if (!line.includes(toolUseId)) continue;
      const fromJson = parseTranscriptLineForWorkdir(line, toolUseId);
      const rawWorkdir = fromJson ?? parseWorkdirFromLine(line);
      if (rawWorkdir) return normalizePath(rawWorkdir, baseCwd);
    }
  } catch { /* transcript lookup is best-effort */ }

  return null;
}

function parseTranscriptLineForWorkdir(line: string, toolUseId: string): string | null {
  try {
    return findWorkdirForToolUse(JSON.parse(line), toolUseId);
  } catch {
    return null;
  }
}

function findWorkdirForToolUse(value: unknown, toolUseId: string): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findWorkdirForToolUse(item, toolUseId);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  if (record.id === toolUseId || record.tool_use_id === toolUseId || record.call_id === toolUseId) {
    return findFirstWorkdir(record);
  }

  for (const child of Object.values(record)) {
    const found = findWorkdirForToolUse(child, toolUseId);
    if (found) return found;
  }
  return null;
}

function findFirstWorkdir(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstWorkdir(item);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  for (const key of ['input', 'tool_input', 'arguments', 'parameters']) {
    const nested = findFirstWorkdir(record[key]);
    if (nested) return nested;
  }
  const workdir = record.workdir;
  if (typeof workdir === 'string' && workdir.trim().length > 0) return workdir.trim();
  const cwd = record.cwd;
  if (typeof cwd === 'string' && cwd.trim().length > 0) return cwd.trim();

  for (const [key, child] of Object.entries(record)) {
    if (['input', 'tool_input', 'arguments', 'parameters', 'workdir', 'cwd'].includes(key)) continue;
    const found = findFirstWorkdir(child);
    if (found) return found;
  }
  return null;
}

function parseWorkdirFromLine(line: string): string | null {
  const match = line.match(/"(?:workdir|cwd)"\s*:\s*"((?:\\"|[^"])*)"/);
  if (!match) return null;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return match[1];
  }
}

function readRememberedCodexWorkdir(input: HookInput, fallbackCwd: string): string | null {
  const sessionId = typeof input.session_id === 'string' ? input.session_id.trim() : '';
  if (!sessionId) return null;
  const hookCwd = typeof input.cwd === 'string' && input.cwd.trim().length > 0
    ? normalizePath(input.cwd.trim(), fallbackCwd)
    : normalizePath(fallbackCwd, fallbackCwd);
  const launcherCwd = normalizePath(fallbackCwd, fallbackCwd);
  if (!samePath(hookCwd, launcherCwd)) return null;

  try {
    const path = codexWorkdirStatePath(sessionId);
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { cwd?: unknown };
    if (typeof parsed.cwd !== 'string' || parsed.cwd.trim().length === 0) return null;
    // Never replay a memo that does not resolve to a real workspace. A cache
    // written before this check (or by an older version) must not keep
    // relocating the workspace to an out-of-repo directory (GH #625).
    return resolveWorkspaceRoot(parsed.cwd.trim());
  } catch {
    return null;
  }
}

function samePath(left: string, right: string): boolean {
  return comparisonPath(left) === comparisonPath(right);
}

function comparisonPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function rememberCodexWorkdir(input: HookInput, resolution: HookCwdResolution): void {
  const sessionId = typeof input.session_id === 'string' ? input.session_id.trim() : '';
  if (!sessionId || resolution.source === 'remembered') return;
  // Only cache a cwd that belongs to a real workspace, so a single out-of-repo
  // tool call cannot pin the whole session to a non-workspace directory (#625).
  if (!resolveWorkspaceRoot(resolution.cwd)) return;

  try {
    const path = codexWorkdirStatePath(sessionId);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({
      session_id: sessionId,
      cwd: resolution.cwd,
      source: resolution.source,
      updated_at: new Date().toISOString(),
    }, null, 2) + '\n');
  } catch { /* best-effort recovery cache */ }
}

function codexWorkdirStatePath(sessionId: string): string {
  const dir = process.env.SLOPE_CODEX_WORKDIR_STORE ?? join(tmpdir(), 'slope-codex-workdirs');
  const key = createHash('sha256').update(sessionId).digest('hex').slice(0, 32);
  return join(dir, `${key}.json`);
}

function inferSingleStagedWorktree(input: HookInput, baseCwd: string): string | null {
  const command = getHookCommand(input);
  if (!/git\s+commit(\s|$)/.test(command)) return null;

  const entries = listWorktreeEntries(baseCwd);
  const candidates = entries
    .filter(entry => entry.path && entry.branch && !['main', 'master'].includes(entry.branch))
    .filter(entry => hasStagedChanges(entry.path));

  if (candidates.length !== 1) return null;
  return canonicalHookCwd(candidates[0].path);
}

function getHookCommand(input: HookInput): string {
  const toolInput = input.tool_input;
  if (!toolInput || typeof toolInput !== 'object') return '';
  for (const key of ['command', 'cmd', 'input']) {
    const value = toolInput[key];
    if (typeof value === 'string') return value;
  }
  return '';
}

interface WorktreeEntry {
  path: string;
  branch: string;
}

function listWorktreeEntries(cwd: string): WorktreeEntry[] {
  try {
    const raw = execFileSync('git', ['-C', cwd, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    const entries: WorktreeEntry[] = [];
    let currentPath = '';
    let currentBranch = '';

    const flush = () => {
      if (currentPath) entries.push({ path: currentPath, branch: currentBranch });
      currentPath = '';
      currentBranch = '';
    };

    for (const line of raw.split('\n')) {
      if (line.startsWith('worktree ')) {
        flush();
        currentPath = line.slice('worktree '.length).trim();
      } else if (line.startsWith('branch ')) {
        currentBranch = line.slice('branch '.length).replace(/^refs\/heads\//, '').trim();
      }
    }
    flush();
    return entries;
  } catch {
    return [];
  }
}

function hasStagedChanges(cwd: string): boolean {
  try {
    const staged = execFileSync('git', ['-C', cwd, 'diff', '--cached', '--name-only'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
    return staged.length > 0;
  } catch {
    return false;
  }
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
      const reasonRows = report.by_guard.flatMap(m =>
        Object.entries(m.reason_counts ?? {}).map(([reason, count]) => ({ guard: m.guard, reason, count })),
      );
      if (reasonRows.length > 0) {
        console.log('');
        console.log('  Reasons (silent/context/suppressed):');
        console.log('  Guard                 Reason                Count');
        console.log('  ────────────────────  ────────────────────  ─────');
        for (const row of reasonRows) {
          console.log(`  ${row.guard.padEnd(22)} ${row.reason.padEnd(20)}  ${String(row.count).padStart(5)}`);
        }
      }
      console.log('');
      break;
    }
    case 'check': {
      // Standalone guard checks for worktree agents (#249)
      // Runs key validations without session hooks
      const checks: Array<{ name: string; passed: boolean; message: string }> = [];

      // 1. Typecheck
      try {
        const { execSync } = await import('node:child_process');
        execSync('pnpm typecheck 2>&1', { cwd, encoding: 'utf8', timeout: 60000 });
        checks.push({ name: 'typecheck', passed: true, message: 'passed' });
      } catch (err) {
        checks.push({ name: 'typecheck', passed: false, message: 'failed' });
      }

      // 2. Tests
      try {
        const { execSync } = await import('node:child_process');
        execSync('pnpm test 2>&1', { cwd, encoding: 'utf8', timeout: 120000 });
        checks.push({ name: 'tests', passed: true, message: 'passed' });
      } catch {
        checks.push({ name: 'tests', passed: false, message: 'failed' });
      }

      // 3. Uncommitted changes
      try {
        const { execSync } = await import('node:child_process');
        const status = execSync('git status --porcelain', { cwd, encoding: 'utf8', timeout: 5000 }).trim();
        if (status) {
          checks.push({ name: 'uncommitted', passed: false, message: `${status.split('\n').length} file(s) uncommitted` });
        } else {
          checks.push({ name: 'uncommitted', passed: true, message: 'clean' });
        }
      } catch {
        checks.push({ name: 'uncommitted', passed: false, message: 'git status failed' });
      }

      // 4. Unpushed commits
      try {
        const { execSync } = await import('node:child_process');
        const log = execSync('git log --oneline @{u}..HEAD', { cwd, encoding: 'utf8', timeout: 5000, stdio: QUIET_STDIO }).trim();
        if (log) {
          checks.push({ name: 'unpushed', passed: false, message: `${log.split('\n').length} commit(s) unpushed` });
        } else {
          checks.push({ name: 'unpushed', passed: true, message: 'clean' });
        }
      } catch {
        checks.push({ name: 'unpushed', passed: true, message: 'no upstream (ok)' });
      }

      const allPassed = checks.every(c => c.passed);
      const red = '\x1b[31m';
      const green = '\x1b[32m';
      const reset = '\x1b[0m';

      if (name === '--json') {
        console.log(JSON.stringify({ passed: allPassed, checks }, null, 2));
      } else {
        console.log(`\n=== Guard Check === ${allPassed ? `${green}PASS${reset}` : `${red}FAIL${reset}`}\n`);
        for (const c of checks) {
          const icon = c.passed ? `${green}✓${reset}` : `${red}✗${reset}`;
          console.log(`  ${icon} ${c.name.padEnd(14)} ${c.message}`);
        }
        console.log('');
      }

      if (!allPassed) process.exit(1);
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
interface GuardRelevance {
  when: string;
  why: string;
  suppressInAdhoc?: boolean;
}

const GUARD_RELEVANCE: Record<string, GuardRelevance> = {
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
  'shell-write': { when: 'always', why: 'Shell escaping silently corrupts written file content' },
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
  'claim-required': { when: 'sprint-workflow', why: 'Warns when editing without sprint claim', suppressInAdhoc: false },
  'review-stale': { when: 'sprint-workflow', why: 'Catches scored sprints missing reviews' },
  'workflow-step-gate': { when: 'sprint-workflow', why: 'Blocks file edits outside agent_work workflow steps' },
};

export function shouldSuppressGuardInAdhoc(name: string, cwd: string, sessionId: string): boolean {
  const relevance = GUARD_RELEVANCE[name];
  return Boolean(
    relevance?.when === 'sprint-workflow' &&
    relevance.suppressInAdhoc !== false &&
    sessionId &&
    isAdhocSession(cwd, sessionId),
  );
}

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
      ...(shouldRecordMetricReason(decision, result.metricReason) ? { reason: result.metricReason } : {}),
    });
    appendFileSync(metricsPath, line + '\n');
  } catch { /* never block guard execution */ }
}

function shouldRecordMetricReason(decision: string, reason: string | undefined): boolean {
  return Boolean(reason && (decision === 'silent' || decision === 'context'));
}

function recordGuardSuppression(cwd: string, guardName: string, input: HookInput, reason: string): void {
  try {
    const metricsPath = join(cwd, '.slope', 'guard-metrics.jsonl');
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      guard: guardName,
      event: input.hook_event_name,
      tool: input.tool_name ?? '',
      decision: 'suppressed',
      reason,
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
