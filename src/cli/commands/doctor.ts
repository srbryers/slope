import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { detectPlatforms, type InitProvider } from './init.js';
import { detectActiveHarnessGuardShims } from '../harness-hook-status.js';
import { GUARD_DEFINITIONS } from '../../core/guard.js';
import { hasMetaphor } from '../../core/metaphor.js';
import { detectAdapter, SLOPE_BIN_PREAMBLE, writeOrUpdateManagedScript } from '../../core/harness.js';

// Side-effect imports: ensure adapters are registered for detectAdapter()
import '../../core/adapters/claude-code.js';
import '../../core/adapters/cursor.js';
import '../../core/adapters/windsurf.js';
import '../../core/adapters/codex.js';
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
  const stateCwd = resolveSlopeStateCwd(cwd);
  if (stateCwd !== cwd) {
    checks.push({
      name: 'worktree-state',
      status: 'ok',
      message: `Linked worktree using SLOPE state from ${stateCwd}`,
    });
  }

  // 1. Check .slope/config.json exists and is valid JSON
  checks.push(checkConfig(stateCwd, cwd));

  // 2. Check .gitignore contains .slope/
  checks.push(checkGitignore(cwd));

  // 2b. Check .gitignore covers common-noise patterns (#323)
  checks.push(...checkGitignoreNoise(cwd));

  // 3. Check SQLite store exists
  checks.push(checkStore(stateCwd, cwd));

  // 4. Check common-issues.json exists
  checks.push(checkCommonIssues(stateCwd, cwd));

  // 5. Check docs/retros/ directory exists
  checks.push(checkRetrosDir(cwd));

  // 6. Check docs/backlog/roadmap.json exists
  checks.push(checkRoadmap(cwd));

  // 7. Check CODEBASE.md exists and is not stale
  checks.push(checkCodebaseMap(cwd));

  // 8. Check version drift
  checks.push(checkVersion(stateCwd, cwd));

  // 9. Check config schema validity
  checks.push(...checkConfigSchema(stateCwd, cwd));

  // 10. Check guards are installed for detected platforms
  checks.push(...checkGuards(stateCwd, cwd));

  // 11. Check hook script staleness
  checks.push(...checkHookScripts(cwd));

  // 12. Check Codex hook config shape and runtime-path hazards
  checks.push(...checkCodexHooks(cwd));

  // 13. Check MCP config for detected platforms
  checks.push(...checkMcpConfig(cwd));

  // 14. Branch hygiene — stale merged + remote-tracking refs (#322)
  checks.push(...checkBranchHygiene(cwd));

  return checks;
}

function stateNote(stateCwd: string, cwd: string): string {
  return stateCwd === cwd ? '' : ` (from primary worktree ${stateCwd})`;
}

function resolveSlopeStateCwd(cwd: string): string {
  if (existsSync(join(cwd, '.slope', 'config.json'))) return cwd;
  for (const worktree of listGitWorktrees(cwd)) {
    if (resolve(worktree) === resolve(cwd)) continue;
    if (existsSync(join(worktree, '.slope', 'config.json'))) return worktree;
  }
  return cwd;
}

function listGitWorktrees(cwd: string): string[] {
  try {
    const raw = execSync('git worktree list --porcelain', {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return raw
      .split('\n')
      .filter(line => line.startsWith('worktree '))
      .map(line => line.slice('worktree '.length).trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function checkConfig(cwd: string, originalCwd = cwd): DoctorCheck {
  const configPath = join(cwd, '.slope', 'config.json');
  if (!existsSync(configPath)) {
    return { name: 'config', status: 'fail', message: '.slope/config.json missing — run `slope init`', fixable: true };
  }
  try {
    JSON.parse(readFileSync(configPath, 'utf8'));
    return { name: 'config', status: 'ok', message: `.slope/config.json valid${stateNote(cwd, originalCwd)}` };
  } catch {
    // Corrupt config — not auto-fixable (would lose custom settings)
    return { name: 'config', status: 'fail', message: '.slope/config.json is invalid JSON — fix manually or delete and run `slope init`' };
  }
}

function readSlopeConfig(cwd: string): Record<string, unknown> | null {
  const configPath = join(cwd, '.slope', 'config.json');
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function configuredPath(cwd: string, key: string, fallback: string): { configured: string; path: string } {
  const config = readSlopeConfig(cwd);
  const raw = config?.[key];
  const configured = typeof raw === 'string' && raw.trim()
    ? raw
    : fallback;
  return { configured, path: resolve(cwd, configured) };
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

/** Curated list of common-noise patterns that should typically be gitignored.
 *  Used by checkGitignoreNoise (#323) so projects don't accidentally commit
 *  macOS metadata, editor temps, OS junk, or agent caches. */
export const COMMON_NOISE_PATTERNS: ReadonlyArray<{ pattern: string; reason: string }> = [
  { pattern: '.DS_Store', reason: 'macOS Finder metadata' },
  { pattern: '._*', reason: 'macOS resource forks' },
  { pattern: 'Thumbs.db', reason: 'Windows thumbnail cache' },
  { pattern: 'desktop.ini', reason: 'Windows folder metadata' },
  { pattern: '*.swp', reason: 'Vim swap files' },
  { pattern: '*.swo', reason: 'Vim swap files' },
  { pattern: '*~', reason: 'Editor backup files (Emacs/etc.)' },
  { pattern: '.idea/', reason: 'JetBrains IDE settings' },
  { pattern: 'node_modules/', reason: 'Node dependencies' },
];

/** Check whether the project's .gitignore covers common-noise patterns.
 *  Reports a warning per missing pattern so users can fix multiple in one
 *  pass via slope doctor --fix. Returns [] if no .gitignore exists (the
 *  primary checkGitignore handles that). */
function checkGitignoreNoise(cwd: string): DoctorCheck[] {
  const gitignorePath = join(cwd, '.gitignore');
  if (!existsSync(gitignorePath)) return [];

  // Strip inline comments and trim — matches the format we write in the
  // --fix path so re-checks after a fix find the pattern as "present".
  const lines = readFileSync(gitignorePath, 'utf8')
    .split('\n')
    .map(l => l.replace(/\s+#.*$/, '').trim())
    .filter(l => l && !l.startsWith('#'));
  const present = new Set(lines);

  const missing = COMMON_NOISE_PATTERNS.filter(p => !present.has(p.pattern));
  if (missing.length === 0) {
    return [{ name: 'gitignore-noise', status: 'ok', message: 'Common-noise patterns covered' }];
  }
  return [{
    name: 'gitignore-noise',
    status: 'warn',
    message: `${missing.length} common-noise pattern(s) missing: ${missing.slice(0, 3).map(m => m.pattern).join(', ')}${missing.length > 3 ? ', ...' : ''} — run \`slope doctor --fix\` to add`,
    fixable: true,
  }];
}

function checkStore(cwd: string, originalCwd = cwd): DoctorCheck {
  const { configured, path: dbPath } = configuredPath(cwd, 'store_path', '.slope/slope.db');
  if (!existsSync(dbPath)) {
    return { name: 'store', status: 'warn', message: `${configured} missing — sessions and events will not be tracked`, fixable: true };
  }
  return { name: 'store', status: 'ok', message: `${configured} exists${stateNote(cwd, originalCwd)}` };
}

function checkCommonIssues(cwd: string, originalCwd = cwd): DoctorCheck {
  const { configured, path } = configuredPath(cwd, 'commonIssuesPath', '.slope/common-issues.json');
  if (!existsSync(path)) {
    return { name: 'common-issues', status: 'warn', message: `${configured} missing`, fixable: true };
  }
  return { name: 'common-issues', status: 'ok', message: `${configured} exists${stateNote(cwd, originalCwd)}` };
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

function checkVersion(cwd: string, originalCwd = cwd): DoctorCheck {
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
    return { name: 'version', status: 'ok', message: `config.slopeVersion matches package (${pkgVersion})${stateNote(cwd, originalCwd)}` };
  } catch {
    return { name: 'version', status: 'warn', message: 'Cannot check version — .slope/config.json unreadable', fixable: false };
  }
}

function checkConfigSchema(cwd: string, originalCwd = cwd): DoctorCheck[] {
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
    checks.push({ name: 'config-schema', status: 'ok', message: `Config schema valid${stateNote(cwd, originalCwd)}` });
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
    codex: join(cwd, '.codex', 'hooks'),
    ob1: join(cwd, '.ob1', 'hooks'),
  };
  const hooksDir = hooksDirMap[adapter.id];
  if (!hooksDir) return checks;

  if (adapter.id === 'codex') {
    return checkCodexHookScripts(hooksDir);
  }

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

function checkCodexHookScripts(hooksDir: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  for (const name of ['slope-guard.sh', 'slope-session-start.sh', 'slope-session-end.sh']) {
    const filePath = join(hooksDir, name);
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, 'utf8');
    if (!content.startsWith('#!')) {
      checks.push({
        name: 'codex-hooks',
        status: 'warn',
        message: `${name} is missing a shebang — reinstall Codex hooks`,
        fixable: false,
      });
    }
    if ((statSync(filePath).mode & 0o111) === 0) {
      checks.push({
        name: 'codex-hooks',
        status: 'warn',
        message: `${name} is not executable — run \`chmod +x ${filePath}\``,
        fixable: false,
      });
    }
  }

  if (checks.length === 0 && existsSync(join(hooksDir, 'slope-guard.sh'))) {
    checks.push({ name: 'codex-hooks', status: 'ok', message: 'Codex hook scripts have shebangs and executable bits' });
  }
  return checks;
}

function checkCodexHooks(cwd: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const projectHooksPath = join(cwd, '.codex', 'hooks.json');
  const userHooksPath = join(resolveCodexHome(), 'hooks.json');
  const hasProjectSlopeHooks = existsSync(projectHooksPath) && fileHasSlopeHooks(projectHooksPath);
  const hasUserSlopeHooks = existsSync(userHooksPath) && fileHasSlopeHooks(userHooksPath);

  if (existsSync(projectHooksPath)) {
    checks.push(...checkCodexHooksFile(projectHooksPath, 'project'));
  }
  if (hasProjectSlopeHooks || hasUserSlopeHooks || existsSync(join(cwd, '.codex'))) {
    checks.push(...checkCodexRuntimeResolution(cwd));
  }
  if (hasProjectSlopeHooks && hasUserSlopeHooks) {
    checks.push({
      name: 'codex-hooks',
      status: 'warn',
      message: `SLOPE hooks found in both ${projectHooksPath} and ${userHooksPath} — keep one active Codex runtime path to avoid duplicate firing`,
      fixable: false,
    });
  }

  return checks;
}

function resolveCodexHome(): string {
  const override = process.env.SLOPE_CODEX_HOME ?? process.env.CODEX_HOME;
  return override && override.trim().length > 0 ? resolve(override.trim()) : join(homedir(), '.codex');
}

function checkCodexRuntimeResolution(cwd: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [{
    name: 'codex-runtime',
    status: 'ok',
    message: 'Codex dispatcher resolution: project node_modules/.bin/slope → SLOPE dev dist/cli/index.js → global slope',
  }];

  const currentVersion = getPackageVersion();
  const localPackagePath = join(cwd, 'node_modules', '@slope-dev', 'slope', 'package.json');
  if (existsSync(localPackagePath)) {
    try {
      const localPkg = JSON.parse(readFileSync(localPackagePath, 'utf8'));
      const localVersion = typeof localPkg.version === 'string' ? localPkg.version : null;
      if (localVersion && compareSemver(localVersion, currentVersion) < 0) {
        checks.push({
          name: 'codex-runtime',
          status: 'warn',
          message: `Codex hooks will prefer project-local @slope-dev/slope ${localVersion} before global/current ${currentVersion} — update the project dependency or remove the stale local install`,
          fixable: false,
        });
      }
    } catch {
      checks.push({
        name: 'codex-runtime',
        status: 'warn',
        message: 'Codex hooks will prefer project-local node_modules/.bin/slope, but node_modules/@slope-dev/slope/package.json is unreadable',
        fixable: false,
      });
    }
  }

  const packagePath = join(cwd, 'package.json');
  const distCliPath = join(cwd, 'dist', 'cli', 'index.js');
  if (existsSync(packagePath)) {
    try {
      const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
      if (pkg.name === '@slope-dev/slope') {
        if (!existsSync(distCliPath)) {
          checks.push({
            name: 'codex-runtime',
            status: 'warn',
            message: 'Codex hooks in the SLOPE dev repo prefer dist/cli/index.js, but it is missing — run `pnpm build`',
            fixable: false,
          });
        } else {
          const newestSourceMtime = newestMtime(join(cwd, 'src'));
          const distMtime = statSync(distCliPath).mtimeMs;
          if (newestSourceMtime > distMtime) {
            checks.push({
              name: 'codex-runtime',
              status: 'warn',
              message: 'Codex hooks in the SLOPE dev repo prefer dist/cli/index.js, but src/ is newer — run `pnpm build` before relying on hooks',
              fixable: false,
            });
          }
        }
      }
    } catch { /* package.json diagnostics are handled elsewhere */ }
  }

  return checks;
}

function compareSemver(a: string, b: string): number {
  const aParts = a.split('.').map(part => Number.parseInt(part, 10) || 0);
  const bParts = b.split('.').map(part => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const delta = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function newestMtime(path: string): number {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;

  let newest = stat.mtimeMs;
  for (const entry of readdirSync(path)) {
    const childPath = join(path, entry);
    const childStat = statSync(childPath);
    if (childStat.isDirectory()) {
      newest = Math.max(newest, newestMtime(childPath));
    } else {
      newest = Math.max(newest, childStat.mtimeMs);
    }
  }
  return newest;
}

function checkCodexHooksFile(filePath: string, label: string): DoctorCheck[] {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    if (!parsed.hooks || typeof parsed.hooks !== 'object' || Array.isArray(parsed.hooks)) {
      return [{
        name: 'codex-hooks',
        status: 'warn',
        message: `Codex ${label} hooks config is missing top-level "hooks" object — reinstall with \`slope hook add --harness=codex --level=full\``,
        fixable: label === 'project',
      }];
    }
  } catch {
    return [{
      name: 'codex-hooks',
      status: 'warn',
      message: `Codex ${label} hooks config is invalid JSON`,
      fixable: false,
    }];
  }
  return [];
}

function fileHasSlopeHooks(filePath: string): boolean {
  try {
    return readFileSync(filePath, 'utf8').includes('slope-guard.sh');
  } catch {
    return false;
  }
}

function repairCodexProjectHooksConfig(cwd: string): boolean {
  const configPath = join(cwd, '.codex', 'hooks.json');
  if (!existsSync(configPath)) return false;
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    if (parsed.hooks && typeof parsed.hooks === 'object' && !Array.isArray(parsed.hooks)) return false;

    const eventNames = ['PreToolUse', 'PostToolUse', 'Stop', 'SessionStart'];
    const hooks: Record<string, unknown> = {};
    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (eventNames.includes(key)) {
        hooks[key] = value;
      } else {
        rest[key] = value;
      }
    }
    if (Object.keys(hooks).length === 0) return false;
    writeFileSync(configPath, JSON.stringify({ ...rest, hooks }, null, 2) + '\n');
    return true;
  } catch {
    return false;
  }
}

function checkGuards(cwd: string, originalCwd = cwd): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const hooksPath = join(cwd, '.slope', 'hooks.json');
  const activeShims = detectActiveHarnessGuardShims(cwd);
  const shimSummary = activeShims
    .map(shim => `${shim.provider} ${shim.scope} shim (${shim.guardCount} guard command${shim.guardCount === 1 ? '' : 's'} in ${shim.configPath})`)
    .join('; ');

  if (!existsSync(hooksPath)) {
    if (activeShims.length > 0) {
      checks.push({
        name: 'guards',
        status: 'ok',
        message: `No internal hook registry found, but active harness guard shim detected: ${shimSummary}`,
      });
      return checks;
    }
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
    // Count only guard-prefixed entries — session-start/session-end and
    // other non-guard hooks live in the same registry but shouldn't
    // contribute to the "guards installed" tally (#307).
    const installed = hooksConfig.installed ?? {};
    const installedGuards = Object.keys(installed).filter(k => k.startsWith('guard-'));
    const installedCount = installedGuards.length;
    const totalGuards = GUARD_DEFINITIONS.length;

    if (installedCount === 0) {
      if (activeShims.length > 0) {
        checks.push({
          name: 'guards',
          status: 'ok',
          message: `Internal hook registry has no guard entries, but active harness guard shim detected: ${shimSummary}`,
        });
        return checks;
      }
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
        message: `${installedCount} of ${totalGuards} guard hooks installed${stateNote(cwd, originalCwd)} — run \`slope hook add --level=full\` to install the rest`,
      });
    } else {
      checks.push({
        name: 'guards',
        status: 'ok',
        message: `${installedCount} of ${totalGuards} guard hooks installed${stateNote(cwd, originalCwd)}`,
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
      case 'gitignore-noise': {
        // Append any missing common-noise patterns under a single section
        // header so reviewers can see why they appeared in one diff.
        const gitignorePath = join(cwd, '.gitignore');
        const content = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
        const lines = content.split('\n').map(l => l.trim());
        const present = new Set(lines.filter(l => l && !l.startsWith('#')));
        const missing = COMMON_NOISE_PATTERNS.filter(p => !present.has(p.pattern));
        if (missing.length > 0) {
          const block = '\n# Common-noise patterns (added by slope doctor --fix)\n' +
            missing.map(p => `${p.pattern}    # ${p.reason}`).join('\n') + '\n';
          writeFileSync(gitignorePath, content + block);
          fixed.push(`Added ${missing.length} common-noise pattern(s) to .gitignore`);
        }
        break;
      }
      case 'store': {
        try {
          const { createStore } = await import('../../store/index.js');
          const { configured: storePath } = configuredPath(cwd, 'store_path', '.slope/slope.db');
          const store = createStore({ storePath, cwd });
          store.close();
          fixed.push(`Created ${storePath}`);
        } catch (err) {
          console.error(`  Could not create store: ${(err as Error).message}`);
        }
        break;
      }
      case 'common-issues': {
        const { configured, path } = configuredPath(cwd, 'commonIssuesPath', '.slope/common-issues.json');
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify({ recurring_patterns: [] }, null, 2) + '\n');
        fixed.push(`Created ${configured}`);
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
      case 'codex-hooks': {
        if (repairCodexProjectHooksConfig(cwd)) {
          fixed.push('Repaired Codex project hooks.json top-level hooks shape');
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

// ── Branch hygiene (GH #322) ───────────────────────────

function git(cmd: string, cwd: string): string {
  try {
    return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }).trim();
  } catch {
    return '';
  }
}

/** Detect a reasonable "main" branch — main first, fall back to master.
 *  Verifies the candidate exists locally before returning it; on detached
 *  HEAD or a repo without main/master, returns null. */
function detectMainBranch(cwd: string): string | null {
  // Try to read remote HEAD pointer (e.g., refs/remotes/origin/HEAD -> origin/main)
  const remoteHead = git('symbolic-ref --short refs/remotes/origin/HEAD', cwd);
  if (remoteHead) {
    const parts = remoteHead.split('/');
    const candidate = parts[parts.length - 1];
    // Verify the local branch actually exists — symbolic-ref can succeed
    // even when the local branch is missing (e.g., detached HEAD).
    if (candidate && git(`rev-parse --verify ${candidate}`, cwd)) return candidate;
  }
  // Fallback: pick whichever exists locally
  for (const candidate of ['main', 'master']) {
    if (git(`rev-parse --verify ${candidate}`, cwd)) return candidate;
  }
  return null;
}

/** Branch hygiene checks — emits one or more DoctorCheck entries. */
export function checkBranchHygiene(cwd: string): DoctorCheck[] {
  const isGit = git('rev-parse --is-inside-work-tree', cwd);
  if (isGit !== 'true') return [];

  const main = detectMainBranch(cwd);
  if (!main) return [];

  const checks: DoctorCheck[] = [];

  // 1. Branches already merged into main (excluding the current branch and main itself)
  const mergedRaw = git(`branch --merged ${main}`, cwd);
  const merged = mergedRaw
    .split('\n')
    .map(l => l.replace(/^[*+]\s*/, '').trim())
    .filter(b => b && b !== main && !b.startsWith('('));

  if (merged.length >= 5) {
    checks.push({
      name: 'branch-hygiene-merged',
      status: 'warn',
      message: `${merged.length} merged-to-${main} branch(es) still local — clean up with \`git branch -d ${merged.slice(0, 3).join(' ')}${merged.length > 3 ? ' ...' : ''}\``,
    });
  } else if (merged.length > 0) {
    checks.push({
      name: 'branch-hygiene-merged',
      status: 'ok',
      message: `${merged.length} merged-to-${main} branch(es) (under threshold)`,
    });
  } else {
    checks.push({
      name: 'branch-hygiene-merged',
      status: 'ok',
      message: `No merged-to-${main} cleanup needed`,
    });
  }

  // 2. Stale remote-tracking refs — branches that no longer exist on origin
  const pruneRaw = git('remote prune origin --dry-run', cwd);
  const stalePrune = pruneRaw
    .split('\n')
    .filter(l => l.includes('would prune') || l.includes('[would prune]'));

  if (stalePrune.length >= 5) {
    checks.push({
      name: 'branch-hygiene-stale-remotes',
      status: 'warn',
      message: `${stalePrune.length} stale remote-tracking ref(s) — clean up with \`git remote prune origin\``,
    });
  } else if (stalePrune.length > 0) {
    checks.push({
      name: 'branch-hygiene-stale-remotes',
      status: 'ok',
      message: `${stalePrune.length} stale remote-tracking ref(s) (under threshold)`,
    });
  } else {
    checks.push({
      name: 'branch-hygiene-stale-remotes',
      status: 'ok',
      message: 'No stale remote-tracking refs',
    });
  }

  return checks;
}

export async function doctorCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  let checks = runDoctorChecks(cwd);
  const shouldFix = args.includes('--fix');
  const dryRun = args.includes('--dry-run');

  formatResults(checks);

  if (shouldFix) {
    const fixable = checks.filter(c => (c.status === 'fail' || c.status === 'warn') && c.fixable);
    if (fixable.length === 0) {
      console.log('\n  Nothing to fix — all checks passed.');
      return;
    }

    if (dryRun) {
      console.log('\n  [dry-run] Fixes that would be applied:\n');
      for (const check of fixable) {
        console.log(`  [dry-run] ${check.name}: ${check.message}`);
      }
      console.log('\n  Re-run without --dry-run to apply fixes.');
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
