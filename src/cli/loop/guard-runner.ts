import { execSync, execFileSync } from 'node:child_process';
import type { BacklogTicket, LoopConfig } from './types.js';
import type { Logger } from './logger.js';

export interface GuardResult {
  passed: boolean;
  // diff_scope is forward-looking — currently warn-only, may become a hard guard
  failedGuard?: 'typecheck' | 'tests' | 'substantiveness' | 'diff_scope';
}

export interface DiffScopeResult {
  inScope: boolean;
  outOfScopeFiles: string[];
}

const SHA_PATTERN = /^[0-9a-f]{40}$/;

/**
 * Check if the diff since preSha is within the ticket's module scope.
 * A file is in scope if it matches a module path, is under a module directory,
 * or is a test file for an in-scope module.
 */
export function isDiffInScope(preSha: string, modules: string[], cwd: string): DiffScopeResult {
  if (modules.length === 0) return { inScope: true, outOfScopeFiles: [] };

  let changedFiles: string[];
  try {
    const output = execFileSync('git', ['diff', '--name-only', preSha, 'HEAD'], {
      cwd,
      encoding: 'utf8',
    });
    changedFiles = output.split('\n').map(f => f.trim()).filter(Boolean);
  } catch {
    // If diff fails, assume in scope (don't block on errors)
    return { inScope: true, outOfScopeFiles: [] };
  }

  if (changedFiles.length === 0) return { inScope: true, outOfScopeFiles: [] };

  const outOfScopeFiles: string[] = [];

  for (const file of changedFiles) {
    const fileInScope = modules.some(mod => {
      // Direct path match
      if (file === mod) return true;
      // File is under a module directory
      if (file.startsWith(mod.endsWith('/') ? mod : mod + '/')) return true;
      // Test file for an in-scope module: test path mirrors src path
      // e.g., "tests/cli/loop/planner.test.ts" is in scope for "src/cli/loop/planner.ts"
      if (file.includes('.test.')) {
        const srcEquiv = file
          .replace(/^tests\//, 'src/')
          .replace(/\.test\.(ts|js)$/, '.$1');
        if (srcEquiv === mod) return true;
        if (srcEquiv.startsWith(mod + '/')) return true;
        // Also check if the test is under a module directory in tests/
        const testDir = mod.replace(/^src\//, 'tests/');
        if (file.startsWith(testDir + '/') || file.startsWith(testDir)) return true;
      }
      return false;
    });

    if (!fileInScope) {
      outOfScopeFiles.push(file);
    }
  }

  // Threshold: more than half of files must be out of scope to flag (warn-only)
  const SCOPE_THRESHOLD = 0.5;
  const inScope = outOfScopeFiles.length / changedFiles.length <= SCOPE_THRESHOLD;
  return { inScope, outOfScopeFiles };
}

/**
 * Run post-ticket guards: typecheck + tests.
 * If either fails, auto-revert to preSha.
 *
 * @returns Guard result with pass/fail status
 */
export function runGuards(
  preSha: string,
  config: LoopConfig,
  cwd: string,
  log: Logger,
  ticket?: BacklogTicket,
): GuardResult {
  // Guard 0a: Diff scope — warn if changes are outside ticket modules
  if (ticket && ticket.modules.length > 0) {
    const scopeResult = isDiffInScope(preSha, ticket.modules, cwd);
    if (!scopeResult.inScope) {
      log.warn(`Diff scope warning: ${scopeResult.outOfScopeFiles.length} file(s) outside ticket modules: ${scopeResult.outOfScopeFiles.join(', ')}`);
      // Warn only — do NOT return failure
    }
  }

  // Guard 0b: Substantiveness — detect stub/whitespace-only changes
  if (!isSubstantive(preSha, cwd)) {
    log.warn('Changes are not substantive (comments/whitespace only) — reverting');
    revert(preSha, cwd);
    return { passed: false, failedGuard: 'substantiveness' };
  }

  // Guard 1: Typecheck
  try {
    execSync('pnpm typecheck', { cwd, stdio: 'pipe', timeout: 120_000 });
  } catch {
    const commitCount = countRevertable(preSha, cwd);
    log.error(`REVERT: typecheck failing — reverting ${commitCount} commit(s)`);
    revert(preSha, cwd);
    return { passed: false, failedGuard: 'typecheck' };
  }

  // Guard 2: Tests (configurable command)
  try {
    execSync(config.loopTestCmd, { cwd, stdio: 'pipe', timeout: 300_000 });
  } catch {
    const commitCount = countRevertable(preSha, cwd);
    log.error(`REVERT: tests failing — reverting ${commitCount} commit(s)`);
    revert(preSha, cwd);
    return { passed: false, failedGuard: 'tests' };
  }

  return { passed: true };
}

/** Revert to a given SHA (hard reset + clean) */
function revert(sha: string, cwd: string): void {
  if (!SHA_PATTERN.test(sha)) throw new Error(`Invalid SHA: ${sha}`);
  execFileSync('git', ['reset', '--hard', sha], { cwd, stdio: 'pipe' });
  try {
    execFileSync('git', ['clean', '-fd'], { cwd, stdio: 'pipe' });
  } catch { /* ok */ }
}

/**
 * Check if changes since preSha are substantive (not just comments/whitespace).
 * Uses `git diff --stat` to count insertions/deletions, then checks
 * if the non-comment/non-whitespace diff is meaningful.
 */
export function isSubstantive(preSha: string, cwd: string): boolean {
  try {
    // Get the actual code diff (ignore whitespace changes)
    const diff = execFileSync('git', ['diff', '-w', '--no-color', preSha, 'HEAD'], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });

    // Extract only added/removed lines (not diff headers)
    const changedLines = diff.split('\n').filter(line =>
      (line.startsWith('+') || line.startsWith('-')) &&
      !line.startsWith('+++') && !line.startsWith('---'),
    );

    // Filter out comment-only and empty lines
    const substantiveLines = changedLines.filter(line => {
      const content = line.slice(1).trim(); // Remove +/- prefix
      if (content === '') return false;
      // Skip pure comment lines
      if (content.startsWith('//') || content.startsWith('/*') || content.startsWith('*') || content.startsWith('#')) return false;
      // Skip JSDoc-only lines
      if (content.startsWith('/**') || content === '*/') return false;
      return true;
    });

    return substantiveLines.length >= 3;
  } catch {
    // If diff fails, assume substantive (don't block on errors)
    return true;
  }
}

/** Count commits that would be reverted */
function countRevertable(preSha: string, cwd: string): number {
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
    const count = execFileSync('git', ['rev-list', '--count', `${preSha}..${head}`], { cwd, encoding: 'utf8' }).trim();
    return parseInt(count, 10) || 0;
  } catch {
    return 0;
  }
}
