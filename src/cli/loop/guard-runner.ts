import { execSync, execFileSync } from 'node:child_process';
import type { LoopConfig } from './types.js';
import type { Logger } from './logger.js';

export interface GuardResult {
  passed: boolean;
  failedGuard?: 'typecheck' | 'tests';
}

const SHA_PATTERN = /^[0-9a-f]{40}$/;

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
): GuardResult {
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
