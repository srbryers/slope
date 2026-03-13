import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectPlatforms, type InitProvider } from './init.js';
import { GUARD_DEFINITIONS } from '../../core/guard.js';
import { hasMetaphor } from '../../core/metaphor.js';
import { detectAdapter, SLOPE_BIN_PREAMBLE, writeOrUpdateManagedScript } from '../../core/harness.js';

// Side-effect imports: ensure adapters are registered for detectAdapter()
import '../../core/adapters/claude-code.js';
import '../../core/adapters/cursor.js';
import '../../core/adapters/windsurf.js';
import '../../core/adapters/generic.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

  // 8. Check version drift
  checks.push(checkVersion(cwd));

  // 9. Check config schema validity
  checks.push(...checkConfigSchema(cwd));

  // 10. Check guards are installed for detected platforms
  checks.push(...checkGuards(cwd));

  // 11. Check hook script staleness
  checks.push(...checkHookScripts(cwd));

  // 12. Check MCP config for detected platforms
  checks.push(...checkMcpConfig(cwd));

  return checks;
}

function checkConfig(cwd: string): DoctorCheck {
  const configPath = join(cwd, '.slope', 'config.json');
  if (!existsSync(configPath)) {
    return { name: 'config', status: 'fail', message: '.slope/config.json missing — run `slope init`', fixable: true };
  }
  try {
    JSON.parse(readFileSync(configPath, 'utf8'));
    return { name: 'config', status: 'ok', message: '.slope/config.json valid' };
  } catch {
    // Corrupt config — not auto-fixable (would lose custom settings)
    return { name: 'config', status: 'fail', message: '.slope/config.json is invalid JSON — fix manually or delete and run `slope init`' };
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

/** Read the current SLOPE package version from package.json */
function getPackageVersion(): string {
  const pkgPath = join(__dirname, '..', '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  return pkg.version;
}

function checkVersion(cwd: string): DoctorCheck {
  const configPath = join(cwd, '.slope', 'config.json');
  if (!existsSync(configPath)) {
    return { name: 'version', status: 'warn', message: 'Cannot check version — .slope/config.json missing', fixable: false };
  }
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const pkgVersion = getPackageVersion();
    if (!config.slopeVersion) {
      return { name: 'version', status: 'warn', message: `config.slopeVersion missing — should be ${pkgVersion}`, fixable: true };
    }
    if (config.slopeVersion !== pkgVersion) {
      return { name: 'version', status: 'warn', message: `config.slopeVersion (${config.slopeVersion}) differs from package (${pkgVersion}) — run \`slope doctor --fix\``, fixable: true };
    }
    return { name: 'version', status: 'ok', message: `config.slopeVersion matches package (${pkgVersion})` };
  } catch {
    return { name: 'version', status: 'warn', message: 'Cannot check version — .slope/config.json unreadable', fixable: false };
  }
}

function checkConfigSchema(cwd: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const configPath = join(cwd, '.slope', 'config.json');
  if (!existsSync(configPath)) return checks;

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return checks; // JSON parse failure is already caught by checkConfig
  }

  // Required string fields
  if (config.scorecardDir !== undefined && typeof config.scorecardDir !== 'string') {
    checks.push({ name: 'config-schema', status: 'warn', message: 'config.scorecardDir should be a string', fixable: false });
  }
  if (config.scorecardPattern !== undefined && typeof config.scorecardPattern !== 'string') {
    checks.push({ name: 'config-schema', status: 'warn', message: 'config.scorecardPattern should be a string', fixable: false });
  }

  // Metaphor validation
  if (config.metaphor !== undefined) {
    if (typeof config.metaphor !== 'string') {
      checks.push({ name: 'config-schema', status: 'warn', message: 'config.metaphor should be a string — will reset to "golf"', fixable: true });
    } else if (!hasMetaphor(config.metaphor as string)) {
      checks.push({ name: 'config-schema', status: 'warn', message: `config.metaphor "${config.metaphor}" is not a registered metaphor — will reset to "golf"`, fixable: true });
    }
  }

  // slopeVersion type check
  if (config.slopeVersion !== undefined && typeof config.slopeVersion !== 'string') {
    checks.push({ name: 'config-schema', status: 'warn', message: 'config.slopeVersion should be a string', fixable: false });
  }

  // Optional detectedStack type checks
  if (config.detectedStack !== undefined && typeof config.detectedStack === 'object' && config.detectedStack !== null) {
    const stack = config.detectedStack as Record<string, unknown>;
    if (stack.language !== undefined && typeof stack.language !== 'string') {
      checks.push({ name: 'config-schema', status: 'warn', message: 'config.detectedStack.language should be a string', fixable: false });
    }
    if (stack.packageManager !== undefined && typeof stack.packageManager !== 'string') {
      checks.push({ name: 'config-schema', status: 'warn', message: 'config.detectedStack.packageManager should be a string', fixable: false });
    }
  }

  if (checks.length === 0) {
    checks.push({ name: 'config-schema', status: 'ok', message: 'Config schema valid' });
  }

  return checks;
}

/** Generate the expected guard dispatcher script content */
function generateGuardDispatcherScript(): string {
  return [
    '#!/usr/bin/env bash',
    '# SLOPE guard dispatcher — routes hook events to slope guard handlers',
    '# Auto-generated by slope hook add --level=full',
    '',
    '# === SLOPE MANAGED (do not edit above this line) ===',
    ...SLOPE_BIN_PREAMBLE,
    '',
    'slope guard "$@"',
    '# === SLOPE END ===',
    '',
  ].join('\n');
}

/** Generate the expected session hook script content */
function generateSessionHookScript(name: string, commands: string[]): string {
  return [
    '#!/usr/bin/env bash',
    `# SLOPE hook: ${name}`,
    '',
    '# === SLOPE MANAGED (do not edit above this line) ===',
    ...SLOPE_BIN_PREAMBLE,
    '',
    ...commands,
    '# === SLOPE END ===',
    '',
    '# Add your custom commands below:',
    '',
  ].join('\n');
}

const MANAGED_START = '# === SLOPE MANAGED (do not edit above this line) ===';
const MANAGED_END = '# === SLOPE END ===';

function checkHookScripts(cwd: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const adapter = detectAdapter(cwd);
  if (!adapter) return checks;

  // Determine the hooks directory for this adapter
  const hooksDirMap: Record<string, string> = {
    'claude-code': join(cwd, '.claude', 'hooks'),
    cursor: join(cwd, '.cursor', 'hooks'),
    windsurf: join(cwd, '.windsurf', 'hooks'),
    cline: join(cwd, '.clinerules', 'hooks'),
    ob1: join(cwd, '.ob1', 'hooks'),
  };
  const hooksDir = hooksDirMap[adapter.id];
  if (!hooksDir) return checks;

  // Check guard dispatcher
  const dispatcherPath = join(hooksDir, 'slope-guard.sh');
  if (existsSync(dispatcherPath)) {
    const existing = readFileSync(dispatcherPath, 'utf8');
    if (existing.includes(MANAGED_START) && existing.includes(MANAGED_END)) {
      const expected = generateGuardDispatcherScript();
      const existingManaged = existing.slice(
        existing.indexOf(MANAGED_START) + MANAGED_START.length,
        existing.indexOf(MANAGED_END),
      );
      const expectedManaged = expected.slice(
        expected.indexOf(MANAGED_START) + MANAGED_START.length,
        expected.indexOf(MANAGED_END),
      );
      if (existingManaged !== expectedManaged) {
        checks.push({
          name: 'hook-scripts',
          status: 'warn',
          message: 'slope-guard.sh managed section is outdated — run `slope doctor --fix` to update',
          fixable: true,
        });
      }
    }
  }

  // Check session hooks
  const sessionHooks: Record<string, string[]> = {
    'session-start': ['slope session start --ide="$SLOPE_IDE" --role=primary', 'slope briefing --compact'],
    'session-end': ['slope session end --session-id="$SLOPE_SESSION_ID"'],
  };

  for (const [name, commands] of Object.entries(sessionHooks)) {
    const filePath = join(hooksDir, `slope-${name}.sh`);
    if (!existsSync(filePath)) continue;

    const existing = readFileSync(filePath, 'utf8');
    if (existing.includes(MANAGED_START) && existing.includes(MANAGED_END)) {
      const expected = generateSessionHookScript(name, commands);
      const existingManaged = existing.slice(
        existing.indexOf(MANAGED_START) + MANAGED_START.length,
        existing.indexOf(MANAGED_END),
      );
      const expectedManaged = expected.slice(
        expected.indexOf(MANAGED_START) + MANAGED_START.length,
        expected.indexOf(MANAGED_END),
      );
      if (existingManaged !== expectedManaged) {
        checks.push({
          name: 'hook-scripts',
          status: 'warn',
          message: `slope-${name}.sh managed section is outdated — run \`slope doctor --fix\` to update`,
          fixable: true,
        });
      }
    }
  }

  if (checks.length === 0 && existsSync(dispatcherPath)) {
    checks.push({ name: 'hook-scripts', status: 'ok', message: 'Hook scripts are up to date' });
  }

  return checks;
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
    } else if (installedCount < totalGuards) {
      checks.push({
        name: 'guards',
        status: 'ok',
        message: `${installedCount} hooks installed (${totalGuards} guards available) — run \`slope guard recommend\` to see suggestions`,
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
    ob1: '.ob1/mcp.json',
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
        const { createConfig } = await import('../config.js');
        createConfig(cwd);
        fixed.push('Created .slope/config.json');
        break;
      }
      case 'gitignore': {
        const gitignorePath = join(cwd, '.gitignore');
        let content = '';
        if (existsSync(gitignorePath)) {
          content = readFileSync(gitignorePath, 'utf8');
        }
        if (!/^\/?\.slope\/?$/m.test(content)) {
          writeFileSync(gitignorePath, content + '\n# SLOPE local state (sessions, handoffs, sprint-state, DB)\n.slope/\n');
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
        mkdirSync(join(cwd, '.slope'), { recursive: true });
        writeFileSync(join(cwd, '.slope', 'common-issues.json'), JSON.stringify({ recurring_patterns: [] }, null, 2) + '\n');
        fixed.push('Created .slope/common-issues.json');
        break;
      }
      case 'retros-dir': {
        mkdirSync(join(cwd, 'docs', 'retros'), { recursive: true });
        fixed.push('Created docs/retros/');
        break;
      }
      case 'roadmap': {
        mkdirSync(join(cwd, 'docs', 'backlog'), { recursive: true });
        const { STARTER_ROADMAP } = await import('./init.js');
        writeFileSync(join(cwd, 'docs', 'backlog', 'roadmap.json'), JSON.stringify(STARTER_ROADMAP, null, 2) + '\n');
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
      case 'version': {
        const configPath = join(cwd, '.slope', 'config.json');
        if (existsSync(configPath)) {
          const config = JSON.parse(readFileSync(configPath, 'utf8'));
          config.slopeVersion = getPackageVersion();
          writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
          fixed.push(`Updated config.slopeVersion to ${config.slopeVersion}`);
        }
        break;
      }
      case 'config-schema': {
        const schemaConfigPath = join(cwd, '.slope', 'config.json');
        if (existsSync(schemaConfigPath)) {
          const config = JSON.parse(readFileSync(schemaConfigPath, 'utf8'));
          let changed = false;
          // Fix invalid metaphor
          if (typeof config.metaphor !== 'string' || !hasMetaphor(config.metaphor)) {
            config.metaphor = 'golf';
            changed = true;
          }
          // Fix missing slopeVersion
          if (!config.slopeVersion) {
            config.slopeVersion = getPackageVersion();
            changed = true;
          }
          if (changed) {
            writeFileSync(schemaConfigPath, JSON.stringify(config, null, 2) + '\n');
            fixed.push('Fixed config schema issues (metaphor/slopeVersion)');
          }
        }
        break;
      }
      case 'hook-scripts': {
        const adapter = detectAdapter(cwd);
        if (!adapter) break;
        const hooksDirMap: Record<string, string> = {
          'claude-code': join(cwd, '.claude', 'hooks'),
          cursor: join(cwd, '.cursor', 'hooks'),
          windsurf: join(cwd, '.windsurf', 'hooks'),
          cline: join(cwd, '.clinerules', 'hooks'),
          ob1: join(cwd, '.ob1', 'hooks'),
        };
        const hooksDir = hooksDirMap[adapter.id];
        if (!hooksDir) break;

        // Update guard dispatcher
        const dispatcherPath = join(hooksDir, 'slope-guard.sh');
        if (existsSync(dispatcherPath)) {
          const result = writeOrUpdateManagedScript(dispatcherPath, generateGuardDispatcherScript());
          if (result === 'updated') fixed.push('Updated slope-guard.sh managed section');
        }

        // Update session hooks
        const sessionHooks: Record<string, string[]> = {
          'session-start': ['slope session start --ide="$SLOPE_IDE" --role=primary', 'slope briefing --compact'],
          'session-end': ['slope session end --session-id="$SLOPE_SESSION_ID"'],
        };
        for (const [name, commands] of Object.entries(sessionHooks)) {
          const filePath = join(hooksDir, `slope-${name}.sh`);
          if (existsSync(filePath)) {
            const result = writeOrUpdateManagedScript(filePath, generateSessionHookScript(name, commands));
            if (result === 'updated') fixed.push(`Updated slope-${name}.sh managed section`);
          }
        }
        break;
      }
      case 'guards': {
        fixed.push('Run `slope hook add --level=full` to install guards');
        break;
      }
      default: {
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
  let checks = runDoctorChecks(cwd);
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
    checks = runDoctorChecks(cwd);
    formatResults(checks);
  }

  // Exit with non-zero if any failures remain
  if (checks.some(c => c.status === 'fail')) {
    process.exit(1);
  }
}
