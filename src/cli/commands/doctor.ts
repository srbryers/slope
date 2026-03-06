import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../config.js';
import { detectPlatforms, type InitProvider } from './init.js';
import { GUARD_DEFINITIONS } from '../../core/guard.js';

export interface DoctorCheck {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  message: string;
  fixable?: boolean;
}

/** Run all health checks on a SLOPE-configured repo. */
export function runDoctorChecks(cwd: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  // 1. Check .slope/config.json exists and is valid JSON
  checks.push(checkConfig(cwd));

  // 2. Check .gitignore contains .slope/
  checks.push(checkGitignore(cwd));

  // 3. Check SQLite store exists
  checks.push(checkStore(cwd));

  // 4. Check common-issues.json exists
  checks.push(checkCommonIssues(cwd));

  // 5. Check docs/retros/ directory exists
  checks.push(checkRetrosDir(cwd));

  // 6. Check docs/backlog/roadmap.json exists
  checks.push(checkRoadmap(cwd));

  // 7. Check CODEBASE.md exists and is not stale
  checks.push(checkCodebaseMap(cwd));

  // 8. Check guards are installed for detected platforms
  checks.push(...checkGuards(cwd));

  // 9. Check MCP config for detected platforms
  checks.push(...checkMcpConfig(cwd));

  return checks;
}

function checkConfig(cwd: string): DoctorCheck {
  const configPath = join(cwd, '.slope', 'config.json');
  if (!existsSync(configPath)) {
    return { name: 'config', status: 'fail', message: '.slope/config.json missing — run `slope init`', fixable: true };
  }
  try {
    const config = loadConfig(cwd);
    if (!config) {
      return { name: 'config', status: 'fail', message: '.slope/config.json exists but could not be loaded', fixable: true };
    }
    return { name: 'config', status: 'ok', message: '.slope/config.json valid' };
  } catch {
    return { name: 'config', status: 'fail', message: '.slope/config.json exists but is invalid JSON', fixable: true };
  }
}

function checkGitignore(cwd: string): DoctorCheck {
  const gitignorePath = join(cwd, '.gitignore');
  if (!existsSync(gitignorePath)) {
    return { name: 'gitignore', status: 'warn', message: '.gitignore missing — .slope/ state may be committed', fixable: true };
  }
  const content = readFileSync(gitignorePath, 'utf8');
  if (/^\/?\.slope\/?$/m.test(content)) {
    return { name: 'gitignore', status: 'ok', message: '.slope/ is in .gitignore' };
  }
  return { name: 'gitignore', status: 'warn', message: '.slope/ not in .gitignore — local state may be committed', fixable: true };
}

function checkStore(cwd: string): DoctorCheck {
  const dbPath = join(cwd, '.slope', 'slope.db');
  if (!existsSync(dbPath)) {
    return { name: 'store', status: 'warn', message: '.slope/slope.db missing — sessions and events will not be tracked', fixable: true };
  }
  return { name: 'store', status: 'ok', message: '.slope/slope.db exists' };
}

function checkCommonIssues(cwd: string): DoctorCheck {
  const path = join(cwd, '.slope', 'common-issues.json');
  if (!existsSync(path)) {
    return { name: 'common-issues', status: 'warn', message: '.slope/common-issues.json missing', fixable: true };
  }
  return { name: 'common-issues', status: 'ok', message: '.slope/common-issues.json exists' };
}

function checkRetrosDir(cwd: string): DoctorCheck {
  const path = join(cwd, 'docs', 'retros');
  if (!existsSync(path)) {
    return { name: 'retros-dir', status: 'warn', message: 'docs/retros/ missing — scorecards have nowhere to go', fixable: true };
  }
  return { name: 'retros-dir', status: 'ok', message: 'docs/retros/ exists' };
}

function checkRoadmap(cwd: string): DoctorCheck {
  const path = join(cwd, 'docs', 'backlog', 'roadmap.json');
  if (!existsSync(path)) {
    return { name: 'roadmap', status: 'warn', message: 'docs/backlog/roadmap.json missing', fixable: true };
  }
  try {
    JSON.parse(readFileSync(path, 'utf8'));
    return { name: 'roadmap', status: 'ok', message: 'docs/backlog/roadmap.json valid' };
  } catch {
    return { name: 'roadmap', status: 'fail', message: 'docs/backlog/roadmap.json is invalid JSON' };
  }
}

function checkCodebaseMap(cwd: string): DoctorCheck {
  const path = join(cwd, 'CODEBASE.md');
  if (!existsSync(path)) {
    return { name: 'codebase-map', status: 'warn', message: 'CODEBASE.md missing — run `slope map`', fixable: true };
  }
  // Check staleness by reading generated_at from frontmatter
  const content = readFileSync(path, 'utf8');
  const match = content.match(/generated_at:\s*"([^"]+)"/);
  if (match) {
    const generatedAt = new Date(match[1]);
    const ageMs = Date.now() - generatedAt.getTime();
    const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
    if (ageDays > 7) {
      return { name: 'codebase-map', status: 'warn', message: `CODEBASE.md is ${ageDays} days old — run \`slope map\` to refresh` };
    }
  }
  return { name: 'codebase-map', status: 'ok', message: 'CODEBASE.md exists and is recent' };
}

function checkGuards(cwd: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const hooksPath = join(cwd, '.slope', 'hooks.json');

  if (!existsSync(hooksPath)) {
    checks.push({
      name: 'guards',
      status: 'warn',
      message: 'No hooks installed — run `slope hook add --level=full` for full guard coverage',
      fixable: true,
    });
    return checks;
  }

  try {
    const hooksConfig = JSON.parse(readFileSync(hooksPath, 'utf8'));
    const installedCount = Object.keys(hooksConfig.installed ?? {}).length;
    const totalGuards = GUARD_DEFINITIONS.length;

    if (installedCount === 0) {
      checks.push({
        name: 'guards',
        status: 'warn',
        message: `No guards active (${totalGuards} available) — run \`slope hook add --level=full\``,
        fixable: true,
      });
    } else {
      checks.push({
        name: 'guards',
        status: 'ok',
        message: `${installedCount} hooks installed (${totalGuards} guards available)`,
      });
    }
  } catch {
    checks.push({
      name: 'guards',
      status: 'warn',
      message: '.slope/hooks.json is invalid — run `slope init` to reset',
      fixable: true,
    });
  }

  return checks;
}

function checkMcpConfig(cwd: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const platforms = detectPlatforms(cwd);

  const mcpPaths: Partial<Record<InitProvider, string>> = {
    'claude-code': '.mcp.json',
    cursor: '.cursor/mcp.json',
    windsurf: '.windsurf/mcp.json',
    opencode: 'opencode.json',
  };

  for (const platform of platforms) {
    const mcpRelPath = mcpPaths[platform];
    if (!mcpRelPath) continue; // cline, generic — no file-based MCP config

    const mcpPath = join(cwd, mcpRelPath);
    if (!existsSync(mcpPath)) {
      checks.push({
        name: `mcp-${platform}`,
        status: 'warn',
        message: `${platform} detected but ${mcpRelPath} missing — run \`slope init --${platform}\``,
        fixable: true,
      });
      continue;
    }

    try {
      const config = JSON.parse(readFileSync(mcpPath, 'utf8'));
      const servers = config.mcpServers ?? config.mcp ?? {};
      if (servers.slope) {
        checks.push({
          name: `mcp-${platform}`,
          status: 'ok',
          message: `${platform} MCP configured in ${mcpRelPath}`,
        });
      } else {
        checks.push({
          name: `mcp-${platform}`,
          status: 'warn',
          message: `${mcpRelPath} exists but no 'slope' server entry — run \`slope init --${platform}\``,
          fixable: true,
        });
      }
    } catch {
      checks.push({
        name: `mcp-${platform}`,
        status: 'warn',
        message: `${mcpRelPath} is invalid JSON`,
        fixable: true,
      });
    }
  }

  return checks;
}

/** Apply auto-fixes for fixable issues. */
export async function runDoctorFixes(cwd: string, checks: DoctorCheck[]): Promise<string[]> {
  const fixed: string[] = [];
  const fixableFailures = checks.filter(c => (c.status === 'fail' || c.status === 'warn') && c.fixable);

  for (const check of fixableFailures) {
    switch (check.name) {
      case 'config': {
        // Re-run init to recreate config
        const { createConfig } = await import('../config.js');
        createConfig(cwd);
        fixed.push('Created .slope/config.json');
        break;
      }
      case 'gitignore': {
        const { existsSync: ex, readFileSync: rf, writeFileSync: wf } = await import('node:fs');
        const gitignorePath = join(cwd, '.gitignore');
        let content = '';
        if (ex(gitignorePath)) {
          content = rf(gitignorePath, 'utf8');
        }
        if (!/^\/?\.slope\/?$/m.test(content)) {
          wf(gitignorePath, content + '\n# SLOPE local state (sessions, handoffs, sprint-state, DB)\n.slope/\n');
          fixed.push('Added .slope/ to .gitignore');
        }
        break;
      }
      case 'store': {
        try {
          const { createStore } = await import('../../store/index.js');
          const store = createStore({ storePath: '.slope/slope.db', cwd });
          store.close();
          fixed.push('Created .slope/slope.db');
        } catch (err) {
          console.error(`  Could not create store: ${(err as Error).message}`);
        }
        break;
      }
      case 'common-issues': {
        const { writeFileSync: wf, mkdirSync: mk } = await import('node:fs');
        mk(join(cwd, '.slope'), { recursive: true });
        wf(join(cwd, '.slope', 'common-issues.json'), JSON.stringify({ recurring_patterns: [] }, null, 2) + '\n');
        fixed.push('Created .slope/common-issues.json');
        break;
      }
      case 'retros-dir': {
        const { mkdirSync: mk } = await import('node:fs');
        mk(join(cwd, 'docs', 'retros'), { recursive: true });
        fixed.push('Created docs/retros/');
        break;
      }
      case 'roadmap': {
        const { writeFileSync: wf, mkdirSync: mk } = await import('node:fs');
        mk(join(cwd, 'docs', 'backlog'), { recursive: true });
        const starter = {
          name: 'Project Roadmap',
          description: 'Replace this with your project roadmap.',
          phases: [{ name: 'Phase 1', sprints: [1] }],
          sprints: [{
            id: 1, theme: 'Getting Started', par: 3, slope: 0, type: 'feature',
            tickets: [{ key: 'S1-1', title: 'Set up project', club: 'short_iron', complexity: 'standard' }],
          }],
        };
        wf(join(cwd, 'docs', 'backlog', 'roadmap.json'), JSON.stringify(starter, null, 2) + '\n');
        fixed.push('Created docs/backlog/roadmap.json');
        break;
      }
      case 'codebase-map': {
        try {
          const { mapCommand } = await import('./map.js');
          await mapCommand([]);
          fixed.push('Generated CODEBASE.md');
        } catch {
          // map command may fail in some contexts — non-fatal
        }
        break;
      }
      case 'guards': {
        fixed.push('Run `slope hook add --level=full` to install guards');
        break;
      }
      default: {
        // MCP config fixes — re-run init for the platform
        if (check.name.startsWith('mcp-')) {
          const platform = check.name.slice(4);
          fixed.push(`Run \`slope init --${platform}\` to configure MCP`);
        }
        break;
      }
    }
  }

  return fixed;
}

/** Format doctor results for console output. */
function formatResults(checks: DoctorCheck[]): void {
  const symbols = { ok: '[OK]', warn: '[!!]', fail: '[FAIL]' };

  console.log('\nSLOPE Doctor — Repo Health Check\n');

  for (const check of checks) {
    const sym = symbols[check.status];
    console.log(`  ${sym} ${check.message}`);
  }

  const fails = checks.filter(c => c.status === 'fail').length;
  const warns = checks.filter(c => c.status === 'warn').length;
  const oks = checks.filter(c => c.status === 'ok').length;

  console.log('');
  console.log(`  ${oks} passed, ${warns} warnings, ${fails} failures`);

  const fixable = checks.filter(c => (c.status === 'fail' || c.status === 'warn') && c.fixable);
  if (fixable.length > 0) {
    console.log(`  ${fixable.length} issue${fixable.length > 1 ? 's' : ''} auto-fixable — run \`slope doctor --fix\``);
  }
}

export async function doctorCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const checks = runDoctorChecks(cwd);
  const shouldFix = args.includes('--fix');

  formatResults(checks);

  if (shouldFix) {
    const fixable = checks.filter(c => (c.status === 'fail' || c.status === 'warn') && c.fixable);
    if (fixable.length === 0) {
      console.log('\n  Nothing to fix — all checks passed.');
      return;
    }

    console.log('\nApplying fixes...\n');
    const fixed = await runDoctorFixes(cwd, checks);
    for (const msg of fixed) {
      console.log(`  [FIXED] ${msg}`);
    }
    console.log('');

    // Re-run checks to show updated status
    const recheck = runDoctorChecks(cwd);
    formatResults(recheck);
  }

  // Exit with non-zero if any failures
  const hasFails = checks.some(c => c.status === 'fail');
  if (hasFails && !shouldFix) {
    process.exit(1);
  }
}
