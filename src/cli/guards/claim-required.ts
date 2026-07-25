import { execSync } from 'node:child_process';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { formatSprintLabel } from '../../core/index.js';
import type { HookInput, GuardResult, SprintClaim } from '../../core/index.js';
import { loadConfig } from '../config.js';
import { inferSprintContext } from '../sprint-inference.js';
import { loadSprintState } from '../sprint-state.js';
import { isAdhocSession, loadSessionState, updateSessionState } from '../session-state.js';
import { resolveStore } from '../store.js';
import { normalizeTouchedPath, resolveTouchedPaths, toAbsoluteTouchedPath } from './hook-input.js';

const IMPLEMENTATION_DIRS = [
  'app/',
  'client/',
  'components/',
  'lib/',
  'packages/',
  'scripts/',
  'server/',
  'src/',
  'templates/',
  'tests/',
  'workers/',
];

const NON_IMPLEMENTATION_DIRS = [
  '.git/',
  '.slope/',
  'docs/retros/',
  'node_modules/',
];

const IMPLEMENTATION_FILES = new Set([
  'astro.config.mjs',
  'package-lock.json',
  'package.json',
  'pnpm-lock.yaml',
  'rollup.config.js',
  'tsconfig.json',
  'vite.config.ts',
  'vitest.config.ts',
  'webpack.config.js',
  'yarn.lock',
]);

const IMPLEMENTATION_EXTENSIONS = new Set([
  '.astro',
  '.c',
  '.cjs',
  '.cpp',
  '.cs',
  '.css',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.kt',
  '.mjs',
  '.php',
  '.py',
  '.rb',
  '.rs',
  '.scss',
  '.sh',
  '.svelte',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.vue',
  '.yaml',
  '.yml',
]);

type ImplementationWritePolicy = 'ask' | 'deny' | 'off';

/**
 * Claim-required guard: fires PreToolUse on Edit|Write.
 * Warns (not blocks) when editing code without an active sprint claim.
 * Also detects cross-session claim overlaps for multi-agent coordination.
 * Uses session dedup — warns once per session only.
 */
export async function claimRequiredGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const sessionId = input.session_id;
  if (!sessionId) return {};

  const policy = getImplementationWritePolicy(cwd);

  // Adhoc mode advertises "sprint-workflow guards silenced", so this guard must
  // not gate the host there. It still runs — the missing-claim signal is useful —
  // but it emits advisory context instead of ask/deny, and only once per session.
  // Previously every implementation write in an adhoc session raised a host
  // permission prompt (GH #643).
  const advisoryOnly = isAdhocSession(cwd, sessionId);

  // Check if there's an active sprint with claims
  const sprintState = loadSprintState(cwd);
  if (sprintState && sprintState.phase === 'implementing') {
    // Session dedup for the advisory missing-claim warning only.
    if (policy !== 'deny') {
      const sessionState = loadSessionState(cwd);
      if (sessionState.claim_warned_session_id === sessionId) return {};
    }

    // Active sprint in implementing phase — check for claims
    const claims = await loadSprintClaims(cwd, sprintState.sprint);
    if (claims.length > 0) {
      // Has claims — check for cross-session overlaps
      const overlapWarning = await detectCrossSessionOverlap(input, cwd, sprintState.sprint);
      if (overlapWarning) return { context: overlapWarning };
      return {}; // No overlaps
    }
  } else if (!sprintState) {
    const relativePath = findImplementationWritePath(input, cwd);
    if (!relativePath || !isImplementationWritePath(relativePath)) return {};
    if (advisoryOnly && alreadyWarned(cwd, sessionId)) return {};

    const hint = inferMissingSprintHint(cwd);
    return implementationWritePolicyResult(policy, [
      `SLOPE claim-required: ${relativePath} looks like an implementation edit, but there is no active sprint state.`,
      ...(hint ? [`Detected likely sprint context: ${hint.label} (${hint.source}).`] : []),
      'Start or resume a sprint and claim the work before editing, or get explicit user approval to continue as adhoc work.',
      hint
        ? `Suggested commands: \`slope sprint start --number=${hint.sprint} --phase=implementing\` then \`slope claim --target=<path> --ticket=<ticket>\`.`
        : 'Suggested commands: `slope sprint start --number=<N> --phase=implementing` then `slope claim --target=<path> --ticket=<ticket>`.',
    ], { advisoryOnly, cwd, sessionId });
  } else {
    const relativePath = findImplementationWritePath(input, cwd);
    if (!relativePath || !isImplementationWritePath(relativePath)) return {};
    if (advisoryOnly && alreadyWarned(cwd, sessionId)) return {};

    return implementationWritePolicyResult(policy, [
      `SLOPE claim-required: ${relativePath} looks like an implementation edit, but sprint ${sprintState.sprint} is in ${sprintState.phase} phase.`,
      'Implementation edits should happen during the implementing phase with a claim, or with explicit user approval to continue outside the sprint workflow.',
      'Suggested command: `slope sprint start --number=<N> --phase=implementing` or update the current sprint phase before editing.',
    ], { advisoryOnly, cwd, sessionId });
  }

  if (policy === 'deny') {
    return {
      decision: 'deny',
      blockReason: [
        'SLOPE claim-required: No active sprint claim for this implementation edit.',
        'Run `slope claim --target=<path> --ticket=<ticket>` before editing, or set `guidance.requireSprintForImplementationWrites` to "ask" or "off".',
      ].join('\n'),
    };
  }

  // Mark as warned
  updateSessionState(cwd, 'claim_warned_session_id', sessionId);

    return {
      context: [
        'SLOPE advisory (non-blocking) — no active sprint claim covers this implementation edit.',
        'A claim records sprint scope; it does not grant or deny the host tool permission. Consider running `slope claim` to track the work.',
      ].join('\n'),
    };
}

function inferMissingSprintHint(cwd: string): { sprint: number; label: string; source: string } | null {
  try {
    const inferred = inferSprintContext(cwd);
    if (inferred.source === 'roadmap') {
      return { sprint: inferred.sprint, label: inferred.label, source: 'pending roadmap sprint' };
    }
  } catch { /* fall through */ }

  const branch = readGit(cwd, 'rev-parse --abbrev-ref HEAD');
  const branchSprint = parseSprintReference(branch);
  if (branchSprint != null) {
    return { sprint: branchSprint, label: formatSprintLabel(branchSprint), source: `branch ${branch}` };
  }

  const subject = readGit(cwd, 'log -1 --format=%s');
  const commitSprint = parseSprintReference(subject);
  if (commitSprint != null) {
    return { sprint: commitSprint, label: formatSprintLabel(commitSprint), source: 'latest commit' };
  }

  return null;
}

function readGit(cwd: string, command: string): string {
  try {
    return execSync(`git ${command}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function parseSprintReference(text: string): number | null {
  const match = text.match(/\bS(\d+(?:\.\d+)?)\b/i);
  if (!match) return null;
  const sprint = Number.parseFloat(match[1]);
  return Number.isFinite(sprint) && sprint > 0 ? sprint : null;
}

function getImplementationWritePolicy(cwd: string): ImplementationWritePolicy {
  const value = loadConfig(cwd).guidance?.requireSprintForImplementationWrites;
  return value === 'deny' || value === 'off' || value === 'ask' ? value : 'ask';
}

/** True when this session has already been warned about a missing claim. */
function alreadyWarned(cwd: string, sessionId: string): boolean {
  return loadSessionState(cwd).claim_warned_session_id === sessionId;
}

interface PolicyResultContext {
  /** Adhoc session — emit context, never gate the host (GH #643). */
  advisoryOnly: boolean;
  cwd: string;
  sessionId: string;
}

function implementationWritePolicyResult(
  policy: ImplementationWritePolicy,
  lines: string[],
  ctx?: PolicyResultContext,
): GuardResult {
  if (policy === 'off') return {};

  // Adhoc sessions get the signal without the gate. Recorded once per session so
  // a long adhoc session is not narrated on every write.
  if (ctx?.advisoryOnly) {
    updateSessionState(ctx.cwd, 'claim_warned_session_id', ctx.sessionId);
    return {
      context: [
        'SLOPE advisory (non-blocking) — adhoc session, so sprint-workflow gating is off.',
        ...lines,
        'Run `slope sprint start` to re-enter the sprint workflow if this is sprint work.',
      ].join('\n'),
    };
  }

  if (policy === 'deny') {
    return {
      decision: 'deny',
      blockReason: [
        ...lines,
        'Strict mode is enabled by `guidance.requireSprintForImplementationWrites: "deny"`.',
      ].join('\n'),
    };
  }
  return {
    decision: 'ask',
    context: [
      'SLOPE permission request — the configured implementation-write policy is "ask".',
      ...lines,
      'A SLOPE claim records work scope but does not replace the host permission policy; the host decides whether to allow this edit.',
    ].join('\n'),
  };
}

function findImplementationWritePath(input: HookInput, cwd: string): string | null {
  for (const touchedPath of resolveTouchedPaths(input)) {
    if (!isTouchedPathInsideRoot(touchedPath, cwd)) continue;
    const relativePath = normalizeTouchedPath(touchedPath, cwd);
    if (relativePath && isImplementationWritePath(relativePath)) return relativePath;
  }
  return null;
}

function isTouchedPathInsideRoot(touchedPath: string, cwd: string): boolean {
  const root = resolve(cwd);
  const absolutePath = toAbsoluteTouchedPath(touchedPath, cwd);
  const rel = relative(root, absolutePath);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

export function isImplementationWritePath(relativePath: string): boolean {
  const path = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!path || path.endsWith('/')) return false;
  if (NON_IMPLEMENTATION_DIRS.some(dir => path.startsWith(dir))) return false;
  if (path === 'README.md' || path.endsWith('.md')) return false;

  const fileName = path.split('/').at(-1) ?? path;
  if (IMPLEMENTATION_FILES.has(fileName)) return true;
  if (IMPLEMENTATION_DIRS.some(dir => path.startsWith(dir))) return true;

  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex === -1) return false;
  return IMPLEMENTATION_EXTENSIONS.has(fileName.slice(dotIndex));
}

/**
 * Pure overlap predicate for a single claim. Anchors area-scope prefix matches
 * with a path separator so a claim on "src/core" does NOT match edits in
 * "src/core-helpers". Exported for unit testing.
 */
export function claimOverlapsPath(
  scope: string,
  target: string,
  relativePath: string,
  fileArea: string,
): boolean {
  if (scope !== 'area') return relativePath === target;
  if (isWholeSprintClaim(target)) return true;
  const areaPrefix = target.endsWith('/') ? target : `${target}/`;
  return (
    relativePath === target || relativePath.startsWith(areaPrefix) ||
    fileArea === target || fileArea.startsWith(areaPrefix)
  );
}

/**
 * Detect if the current file edit overlaps with another agent's claimed area.
 * Returns a warning string if overlap found, null otherwise.
 */
async function detectCrossSessionOverlap(
  input: HookInput,
  cwd: string,
  sprintNumber: number,
): Promise<string | null> {
  const relativePaths = resolveTouchedPaths(input)
    .map(filePath => normalizeTouchedPath(filePath, cwd))
    .filter((filePath): filePath is string => Boolean(filePath));
  if (relativePaths.length === 0) return null;

  try {
    const store = await resolveStore(cwd);
    const claims = await store.list(sprintNumber);
    const sessions = await store.getActiveSessions();
    store.close();

    // Find claims from OTHER sessions that overlap with this file's area
    const otherClaims = claims.filter(c =>
      c.session_id && c.session_id !== input.session_id,
    );

    for (const relativePath of relativePaths) {
      const fileArea = dirname(relativePath);
      for (const claim of otherClaims) {
        const overlaps = claimOverlapsPath(claim.scope, claim.target, relativePath, fileArea);

        if (overlaps) {
          const agent = sessions.find(s => s.session_id === claim.session_id);
          const agentDesc = agent?.agent_role ?? agent?.role ?? 'another agent';
          return `SLOPE multi-agent: ${relativePath} overlaps with ${agentDesc}'s claim on "${claim.target}". Coordinate to avoid conflicts.`;
        }
      }
    }
  } catch { /* store unavailable — skip overlap check */ }

  return null;
}

async function loadSprintClaims(cwd: string, sprintNumber: number): Promise<SprintClaim[]> {
  let store: Awaited<ReturnType<typeof resolveStore>> | null = null;
  try {
    store = await resolveStore(cwd);
    return await store.list(sprintNumber);
  } catch {
    return [];
  } finally {
    store?.close();
  }
}

function isWholeSprintClaim(target: string): boolean {
  return /^sprint:S\d+(?:\.\d+)?$/i.test(target);
}
