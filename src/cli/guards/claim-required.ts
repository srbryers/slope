import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { HookInput, GuardResult } from '../../core/index.js';
import { loadSprintState } from '../sprint-state.js';
import { loadSessionState, updateSessionState } from '../session-state.js';
import { resolveStore } from '../store.js';

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

/**
 * Claim-required guard: fires PreToolUse on Edit|Write.
 * Warns (not blocks) when editing code without an active sprint claim.
 * Also detects cross-session claim overlaps for multi-agent coordination.
 * Uses session dedup — warns once per session only.
 */
export async function claimRequiredGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const sessionId = input.session_id;
  if (!sessionId) return {};

  // Check if there's an active sprint with claims
  const sprintState = loadSprintState(cwd);
  if (sprintState && sprintState.phase === 'implementing') {
    // Session dedup for the advisory missing-claim warning only.
    const sessionState = loadSessionState(cwd);
    if (sessionState.claim_warned_session_id === sessionId) return {};

    // Active sprint in implementing phase — check for claims
    try {
      const claimsPath = join(cwd, '.slope', 'claims.json');
      if (existsSync(claimsPath)) {
        const claims = JSON.parse(readFileSync(claimsPath, 'utf8'));
        if (Array.isArray(claims) && claims.length > 0) {
          // Has claims — check for cross-session overlaps
          const overlapWarning = await detectCrossSessionOverlap(input, cwd, sprintState.sprint);
          if (overlapWarning) return { context: overlapWarning };
          return {}; // No overlaps
        }
      }
    } catch { /* claims unavailable */ }
  } else if (!sprintState) {
    const filePath = input.tool_input?.file_path as string | undefined;
    const relativePath = normalizeHookPath(filePath, cwd);
    if (!relativePath || !isImplementationWritePath(relativePath)) return {};

    return {
      decision: 'ask',
      context: [
        `SLOPE claim-required: ${relativePath} looks like an implementation edit, but there is no active sprint state.`,
        'Start or resume a sprint and claim the work before editing, or get explicit user approval to continue as adhoc work.',
        'Suggested commands: `slope sprint start --number=<N> --phase=implementing` then `slope claim --target=<path> --ticket=<ticket>`.',
      ].join('\n'),
    };
  } else {
    // Sprint exists but not in implementing phase — passthrough
    return {};
  }

  // Mark as warned
  updateSessionState(cwd, 'claim_warned_session_id', sessionId);

  return {
    context: 'SLOPE: No active sprint claim. Consider running `slope claim` to track this work.',
  };
}

function normalizeHookPath(filePath: string | undefined, cwd: string): string | null {
  if (!filePath) return null;
  const normalizedCwd = cwd.replace(/\\/g, '/').replace(/\/$/, '');
  const normalizedPath = filePath.replace(/\\/g, '/');
  const relativePath = normalizedPath.startsWith(`${normalizedCwd}/`)
    ? normalizedPath.slice(normalizedCwd.length + 1)
    : normalizedPath;
  return relativePath.replace(/^\.\//, '');
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
  const filePath = input.tool_input?.file_path as string | undefined;
  if (!filePath) return null;

  const relativePath = filePath.startsWith(cwd)
    ? filePath.slice(cwd.length + 1)
    : filePath;
  const fileArea = dirname(relativePath);

  try {
    const store = await resolveStore(cwd);
    const claims = await store.list(sprintNumber);
    const sessions = await store.getActiveSessions();
    store.close();

    // Find claims from OTHER sessions that overlap with this file's area
    const otherClaims = claims.filter(c =>
      c.session_id && c.session_id !== input.session_id,
    );

    for (const claim of otherClaims) {
      const overlaps = claimOverlapsPath(claim.scope, claim.target, relativePath, fileArea);

      if (overlaps) {
        const agent = sessions.find(s => s.session_id === claim.session_id);
        const agentDesc = agent?.agent_role ?? agent?.role ?? 'another agent';
        return `SLOPE multi-agent: ${relativePath} overlaps with ${agentDesc}'s claim on "${claim.target}". Coordinate to avoid conflicts.`;
      }
    }
  } catch { /* store unavailable — skip overlap check */ }

  return null;
}
