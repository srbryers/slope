import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUIET_STDIO } from '../../core/process.js';
import { findCommands, positionalArgs } from './command-parse.js';
import type { HookInput, GuardResult } from '../../core/index.js';

/**
 * Version-check guard: fires PreToolUse on Bash.
 * Blocks `git push` to main/master when local package version matches
 * the published npm version (i.e. version hasn't been bumped).
 */
export async function versionCheckGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const command = (input.tool_input?.command as string) ?? '';

  // Only fire on an actual `git push` whose arguments name main/master.
  // Matching the raw text here blocked any command that merely mentioned
  // both strings — a commit message, an issue body, a heredoc (#683).
  const pushes = findCommands(command, ['git', 'push']);
  const targetsTrunk = pushes.some(cmd =>
    positionalArgs(cmd, 2).some(token => /(^|[:/])(main|master)$/.test(token.value)),
  );
  if (!targetsTrunk) return {};

  // Read local version from core package.json
  let localVersion: string;
  try {
    const pkgPath = join(cwd, 'packages', 'core', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    localVersion = pkg.version;
  } catch {
    // Can't read local package — skip check
    return {};
  }

  // Get published version from npm
  let publishedVersion: string;
  try {
    publishedVersion = execSync('npm view @slope-dev/slope version', {
      cwd,
      encoding: 'utf8',
      timeout: 10000,
      stdio: QUIET_STDIO,
    }).trim();
  } catch {
    // Package not published yet or npm unreachable — allow
    return {};
  }

  // If versions match, the developer hasn't bumped yet
  if (localVersion === publishedVersion) {
    return {
      decision: 'deny',
      blockReason: `Version not bumped — local @slope-dev/slope is ${localVersion}, same as npm. Run \`pnpm version:bump <version>\` before pushing to main.`,
    };
  }

  return {};
}
