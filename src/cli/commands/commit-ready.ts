import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseRoadmap } from '../../core/index.js';
import { resolveActor } from '../actor.js';
import { loadConfig } from '../config.js';
import { loadSprintState, pendingGates } from '../sprint-state.js';
import { resolveStore } from '../store.js';
import { runStalenessCheck } from './map.js';

/**
 * `slope commit-ready` — pre-commit checklist for agents (#314).
 *
 * Inspects the working state across multiple subsystems and reports a
 * structured verdict: are we safe to commit, and if not, what remains.
 *
 *   slope commit-ready          Human-readable
 *   slope commit-ready --json   Machine-readable
 *
 * The command is non-blocking — it never fails the shell with a non-zero
 * exit by default; callers must check `ok` in the JSON output. Pass
 * --strict to exit non-zero when any check fails.
 */

export interface CommitReadyCheck {
  name: string;
  ok: boolean;
  severity: 'block' | 'warn' | 'info';
  reason?: string;
  suggestion?: string;
}

export interface CommitReadyResult {
  ok: boolean;
  blockers: number;
  warnings: number;
  checks: CommitReadyCheck[];
}

export async function commitReadyCommand(args: string[]): Promise<void> {
  const json = args.includes('--json');
  const strict = args.includes('--strict');
  const cwd = process.cwd();

  const result = await collectCommitReady(cwd);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }

  if (strict && !result.ok) {
    process.exit(1);
  }
}

export async function collectCommitReady(cwd: string): Promise<CommitReadyResult> {
  const checks: CommitReadyCheck[] = [];
  checks.push(checkBranch(cwd));
  checks.push(checkUncommittedChanges(cwd));
  const sprintCheck = checkSprintState(cwd);
  checks.push(sprintCheck);
  // Always run the claim check — even when sprint state is missing, the
  // user benefits from a clear "no sprint -> start first, then claim"
  // hint rather than a silent skip (#314 review finding).
  checks.push(await checkActiveClaim(cwd, extractSprintNumber(cwd)));
  checks.push(checkRoadmap(cwd));
  checks.push(checkCodebaseMap(cwd));
  checks.push(checkPendingGates(cwd));

  const blockers = checks.filter(c => !c.ok && c.severity === 'block').length;
  const warnings = checks.filter(c => !c.ok && c.severity === 'warn').length;

  return {
    ok: blockers === 0,
    blockers,
    warnings,
    checks,
  };
}

function git(cmd: string, cwd: string): string {
  try {
    return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

function checkBranch(cwd: string): CommitReadyCheck {
  const branch = git('rev-parse --abbrev-ref HEAD', cwd);
  if (!branch) {
    return { name: 'branch', ok: false, severity: 'block', reason: 'Not in a git repository' };
  }
  if (branch === 'main' || branch === 'master') {
    return {
      name: 'branch',
      ok: false,
      severity: 'block',
      reason: `On protected branch ${branch}`,
      suggestion: `git checkout -b feat/<description>`,
    };
  }
  return { name: 'branch', ok: true, severity: 'block', reason: `On ${branch}` };
}

function checkUncommittedChanges(cwd: string): CommitReadyCheck {
  const status = git('status --porcelain', cwd);
  if (!status) {
    return {
      name: 'uncommitted',
      ok: false,
      severity: 'warn',
      reason: 'Working tree is clean — nothing to commit',
    };
  }
  const lines = status.split('\n').filter(Boolean);
  return { name: 'uncommitted', ok: true, severity: 'info', reason: `${lines.length} file(s) staged or modified` };
}

function checkSprintState(cwd: string): CommitReadyCheck {
  const state = loadSprintState(cwd);
  if (!state) {
    return {
      name: 'sprint',
      ok: false,
      severity: 'warn',
      reason: 'No active sprint — sprint-state.json missing',
      suggestion: 'slope sprint start --number=N',
    };
  }
  return { name: 'sprint', ok: true, severity: 'info', reason: `S${state.sprint} (phase: ${state.phase})` };
}

function extractSprintNumber(cwd: string): number | null {
  const state = loadSprintState(cwd);
  return state?.sprint ?? null;
}

async function checkActiveClaim(cwd: string, sprintNumber: number | null): Promise<CommitReadyCheck> {
  if (sprintNumber == null) {
    return {
      name: 'claim',
      ok: false,
      severity: 'warn',
      reason: 'No sprint state — cannot verify claim',
    };
  }
  try {
    const store = await resolveStore(cwd);
    const actor = resolveActor(cwd);
    const player = actor.name;
    const claims = await store.list(sprintNumber);
    store.close();
    const own = claims.filter(c => c.player === player);
    if (own.length === 0) {
      return {
        name: 'claim',
        ok: false,
        severity: 'warn',
        reason: `No active claim for ${player} on S${sprintNumber}`,
        suggestion: 'slope claim --target=<ticket> --sprint=' + sprintNumber,
      };
    }
    return {
      name: 'claim',
      ok: true,
      severity: 'info',
      reason: `Claim(s): ${own.map(c => c.target).join(', ')}`,
    };
  } catch {
    return { name: 'claim', ok: true, severity: 'info', reason: 'Store unavailable — skipped' };
  }
}

function checkRoadmap(cwd: string): CommitReadyCheck {
  try {
    const config = loadConfig(cwd);
    const roadmapPath = join(cwd, config.roadmapPath);
    if (!existsSync(roadmapPath)) {
      return {
        name: 'roadmap',
        ok: false,
        severity: 'warn',
        reason: 'No roadmap file',
        suggestion: 'slope roadmap generate',
      };
    }
    const raw = JSON.parse(readFileSync(roadmapPath, 'utf8'));
    const parsed = parseRoadmap(raw);
    if (!parsed.validation.valid) {
      return {
        name: 'roadmap',
        ok: false,
        severity: 'warn',
        reason: `Roadmap has ${parsed.validation.errors.length} validation error(s)`,
        suggestion: 'slope roadmap validate',
      };
    }
    return { name: 'roadmap', ok: true, severity: 'info', reason: 'Valid' };
  } catch (err) {
    return {
      name: 'roadmap',
      ok: false,
      severity: 'warn',
      reason: `Could not parse roadmap: ${(err as Error).message}`,
    };
  }
}

function checkCodebaseMap(cwd: string): CommitReadyCheck {
  const mapPath = join(cwd, 'CODEBASE.md');
  if (!existsSync(mapPath)) {
    return {
      name: 'codebase-map',
      ok: false,
      severity: 'warn',
      reason: 'CODEBASE.md not found',
      suggestion: 'slope map',
    };
  }

  try {
    const config = loadConfig(cwd);
    const mapContent = readFileSync(mapPath, 'utf8');
    const results = runStalenessCheck(cwd, config, mapContent);
    const stale = results.filter(result => result.status === 'stale');
    if (stale.length > 0) {
      return {
        name: 'codebase-map',
        ok: false,
        severity: 'warn',
        reason: `CODEBASE.md is stale: ${stale.map(result => `${result.label}: ${result.message}`).join('; ')}`,
        suggestion: 'slope map',
      };
    }
    const warnings = results.filter(result => result.status === 'warn');
    return {
      name: 'codebase-map',
      ok: true,
      severity: 'info',
      reason: warnings.length > 0 ? `Present (map check current; ${warnings.length} warning(s))` : 'Present (map check current)',
    };
  } catch {
    return { name: 'codebase-map', ok: true, severity: 'info', reason: 'Present (staleness unknown)' };
  }

}

function checkPendingGates(cwd: string): CommitReadyCheck {
  const state = loadSprintState(cwd);
  if (!state) {
    return { name: 'gates', ok: true, severity: 'info', reason: 'No sprint state — skipped' };
  }
  const pending = pendingGates(state);
  if (pending.length === 0) {
    return { name: 'gates', ok: true, severity: 'info', reason: 'All sprint gates complete' };
  }
  return {
    name: 'gates',
    ok: false,
    severity: 'warn',
    reason: `${pending.length} pending gate(s): ${pending.join(', ')}`,
    suggestion: 'slope sprint gate <name>; required reviews need --reviewer/--evidence, --pr-review, or --waive-independent-review --reason',
  };
}

function printHuman(r: CommitReadyResult): void {
  const lines: string[] = [];
  lines.push('');
  lines.push(r.ok ? 'COMMIT-READY ✓' : 'NOT COMMIT-READY ✗');
  lines.push('═'.repeat(50));
  for (const c of r.checks) {
    const icon = c.ok ? '✓' : (c.severity === 'block' ? '✗' : '⚠');
    lines.push(`  ${icon} ${c.name.padEnd(15)} ${c.reason ?? ''}`);
    if (!c.ok && c.suggestion) {
      lines.push(`      → ${c.suggestion}`);
    }
  }
  lines.push('');
  if (r.blockers > 0) {
    lines.push(`${r.blockers} blocker(s); ${r.warnings} warning(s).`);
  } else if (r.warnings > 0) {
    lines.push(`No blockers; ${r.warnings} warning(s).`);
  } else {
    lines.push('All checks pass.');
  }
  lines.push('');
  console.log(lines.join('\n'));
}
