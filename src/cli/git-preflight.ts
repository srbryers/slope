import { execFileSync } from 'node:child_process';

const NO_GIT_FLAGS = new Set(['--allow-no-git', '--no-git']);

export interface GitPreflightResult {
  insideGitWorkTree: boolean;
  degradedNoGitMode: boolean;
}

export function isNoGitModeRequested(args: string[]): boolean {
  return args.some(arg => {
    const [flag, value] = arg.split('=', 2);
    return NO_GIT_FLAGS.has(flag) && value !== 'false';
  });
}

export function isInsideGitWorkTree(cwd: string = process.cwd()): boolean {
  try {
    const out = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return String(out).trim() === 'true';
  } catch {
    return false;
  }
}

export function requireGitWorkTreeOrExplicitNoGit(
  commandName: string,
  args: string[],
  cwd: string = process.cwd(),
): GitPreflightResult {
  if (isInsideGitWorkTree(cwd)) {
    return { insideGitWorkTree: true, degradedNoGitMode: false };
  }
  if (isNoGitModeRequested(args)) {
    return { insideGitWorkTree: false, degradedNoGitMode: true };
  }

  throw new Error(
    `slope ${commandName} must run inside a git work tree. ` +
    'SLOPE uses git commits as shipped-state evidence for roadmap, sprint, and ticket completion. ' +
    'Run `git init -b main` before retrying, or rerun with `--allow-no-git` for degraded mode without commit-backed completion evidence.',
  );
}

export function formatNoGitModeWarning(commandName: string): string {
  return `Warning: slope ${commandName} running with --allow-no-git; commit-backed roadmap, sprint, and ticket evidence is disabled until this directory is a git work tree.`;
}
