import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { chmodSync, mkdirSync, writeFileSync, rmSync, readFileSync, utimesSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { doctorCommand, runDoctorChecks, runDoctorFixes } from '../../../src/cli/commands/doctor.js';
import { SLOPE_BIN_PREAMBLE } from '../../../src/core/harness.js';

// Ensure metaphors are registered
import '../../../src/core/metaphors/golf.js';
import '../../../src/core/metaphors/gaming.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `slope-doctor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Set up a minimal valid .slope directory */
function setupSlopeDir(cwd: string, overrides?: { config?: Record<string, unknown> }): void {
  const slopeDir = join(cwd, '.slope');
  mkdirSync(slopeDir, { recursive: true });

  const config = {
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
    metaphor: 'golf',
    slopeVersion: '1.25.5',
    ...overrides?.config,
  };
  writeFileSync(join(slopeDir, 'config.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(slopeDir, 'common-issues.json'), JSON.stringify({ recurring_patterns: [] }));
  writeFileSync(join(slopeDir, 'hooks.json'), JSON.stringify({ installed: {} }));

  // Create required dirs
  mkdirSync(join(cwd, 'docs', 'retros'), { recursive: true });
  mkdirSync(join(cwd, 'docs', 'backlog'), { recursive: true });
  writeFileSync(join(cwd, 'docs', 'backlog', 'roadmap.json'), JSON.stringify({ sprints: [] }));
  writeFileSync(join(cwd, '.gitignore'), '.slope/\n');
}

describe('doctor checks', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  describe('doctor --fix --dry-run', () => {
    it('previews fixable checks without writing changes', async () => {
      setupSlopeDir(cwd);
      const gitignorePath = join(cwd, '.gitignore');
      const before = readFileSync(gitignorePath, 'utf8');
      const logs: string[] = [];
      const logSpy = vi.spyOn(console, 'log').mockImplementation((message = '') => {
        logs.push(String(message));
      });
      const originalCwd = process.cwd();

      try {
        process.chdir(cwd);
        await doctorCommand(['--fix', '--dry-run']);
      } finally {
        process.chdir(originalCwd);
        logSpy.mockRestore();
      }

      expect(readFileSync(gitignorePath, 'utf8')).toBe(before);
      expect(logs.join('\n')).toContain('[dry-run] Fixes that would be applied');
      expect(logs.join('\n')).toContain('gitignore-noise');
      expect(logs.join('\n')).not.toContain('Applying fixes');
    });
  });

  describe('linked worktree state discovery', () => {
    it('uses primary worktree .slope state when a linked worktree lacks local ignored state', () => {
      setupSlopeDir(cwd);
      writeFileSync(join(cwd, '.slope', 'slope.db'), '');
      writeFileSync(join(cwd, 'README.md'), '# test repo\n');
      execSync('git init', { cwd, stdio: 'ignore' });
      execSync('git config user.email test@example.com', { cwd, stdio: 'ignore' });
      execSync('git config user.name "Test User"', { cwd, stdio: 'ignore' });
      execSync('git add .gitignore README.md docs/backlog/roadmap.json', { cwd, stdio: 'ignore' });
      execSync('git commit -m init', { cwd, stdio: 'ignore' });

      const linked = join(tmpdir(), `slope-doctor-linked-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      execSync(`git worktree add -b linked-state-test "${linked}"`, { cwd, stdio: 'ignore' });
      try {
        const checks = runDoctorChecks(linked);

        expect(checks.find(c => c.name === 'worktree-state')?.message).toContain(cwd);
        expect(checks.find(c => c.name === 'config')).toMatchObject({ status: 'ok' });
        expect(checks.find(c => c.name === 'store')).toMatchObject({ status: 'ok' });
        expect(checks.find(c => c.name === 'common-issues')).toMatchObject({ status: 'ok' });
        expect(checks.find(c => c.name === 'version')?.message).not.toContain('missing');
        expect(checks.find(c => c.name === 'guards')?.message).not.toContain('No hooks installed');
      } finally {
        execSync(`git worktree remove --force "${linked}"`, { cwd, stdio: 'ignore' });
      }
    });

    it('honors configured shared store paths from a linked worktree config', () => {
      setupSlopeDir(cwd);
      writeFileSync(join(cwd, '.slope', 'slope.db'), '');
      writeFileSync(join(cwd, 'README.md'), '# test repo\n');
      execSync('git init', { cwd, stdio: 'ignore' });
      execSync('git config user.email test@example.com', { cwd, stdio: 'ignore' });
      execSync('git config user.name "Test User"', { cwd, stdio: 'ignore' });
      execSync('git add .gitignore README.md docs/backlog/roadmap.json', { cwd, stdio: 'ignore' });
      execSync('git commit -m init', { cwd, stdio: 'ignore' });

      const linked = join(tmpdir(), `slope-doctor-linked-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      execSync(`git worktree add -b linked-config-test "${linked}"`, { cwd, stdio: 'ignore' });
      try {
        mkdirSync(join(linked, '.slope'), { recursive: true });
        writeFileSync(join(linked, '.slope', 'config.json'), JSON.stringify({
          scorecardDir: 'docs/retros',
          scorecardPattern: 'sprint-*.json',
          store_path: relative(linked, join(cwd, '.slope', 'slope.db')),
          commonIssuesPath: relative(linked, join(cwd, '.slope', 'common-issues.json')),
          metaphor: 'golf',
          slopeVersion: '1.25.5',
        }, null, 2));

        const checks = runDoctorChecks(linked);

        expect(checks.find(c => c.name === 'store')).toMatchObject({ status: 'ok' });
        expect(checks.find(c => c.name === 'common-issues')).toMatchObject({ status: 'ok' });
        expect(checks.find(c => c.name === 'store')?.message).not.toContain('.slope/slope.db missing');
        expect(checks.find(c => c.name === 'common-issues')?.message).not.toContain('.slope/common-issues.json missing');
      } finally {
        execSync(`git worktree remove --force "${linked}"`, { cwd, stdio: 'ignore' });
      }
    });
  });

  // --- S65-1: version drift ---

  describe('version drift (S65-1)', () => {
    it('detects version mismatch', () => {
      setupSlopeDir(cwd, { config: { slopeVersion: '0.0.1' } });
      const checks = runDoctorChecks(cwd);
      const versionCheck = checks.find(c => c.name === 'version');
      expect(versionCheck).toBeDefined();
      expect(versionCheck!.status).toBe('warn');
      expect(versionCheck!.message).toContain('differs from package');
      expect(versionCheck!.fixable).toBe(true);
    });

    it('detects missing slopeVersion', () => {
      setupSlopeDir(cwd);
      // Remove slopeVersion from config
      const configPath = join(cwd, '.slope', 'config.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      delete config.slopeVersion;
      writeFileSync(configPath, JSON.stringify(config));

      const checks = runDoctorChecks(cwd);
      const versionCheck = checks.find(c => c.name === 'version');
      expect(versionCheck!.status).toBe('warn');
      expect(versionCheck!.message).toContain('missing');
      expect(versionCheck!.fixable).toBe(true);
    });

    it('passes when version matches', () => {
      // Read the actual package version to ensure match
      const pkgVersion = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf8')).version;
      setupSlopeDir(cwd, { config: { slopeVersion: pkgVersion } });
      const checks = runDoctorChecks(cwd);
      const versionCheck = checks.find(c => c.name === 'version');
      expect(versionCheck!.status).toBe('ok');
    });

    it('fixes version mismatch', async () => {
      setupSlopeDir(cwd, { config: { slopeVersion: '0.0.1' } });
      const checks = runDoctorChecks(cwd);
      const fixed = await runDoctorFixes(cwd, checks);
      expect(fixed.some(f => f.includes('Updated config.slopeVersion'))).toBe(true);

      // Verify the fix
      const config = JSON.parse(readFileSync(join(cwd, '.slope', 'config.json'), 'utf8'));
      const pkgVersion = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf8')).version;
      expect(config.slopeVersion).toBe(pkgVersion);
    });
  });

  // --- S65-2: hook script staleness ---

  describe('hook script staleness (S65-2)', () => {
    it('detects stale guard dispatcher', () => {
      setupSlopeDir(cwd);
      // Create a .claude dir to trigger claude-code adapter detection
      const hooksDir = join(cwd, '.claude', 'hooks');
      mkdirSync(hooksDir, { recursive: true });

      // Write a guard dispatcher with outdated managed section
      const staleScript = [
        '#!/usr/bin/env bash',
        '# SLOPE guard dispatcher',
        '',
        '# === SLOPE MANAGED (do not edit above this line) ===',
        '# OLD CONTENT THAT IS STALE',
        'slope guard "$@"',
        '# === SLOPE END ===',
        '',
      ].join('\n');
      writeFileSync(join(hooksDir, 'slope-guard.sh'), staleScript, { mode: 0o755 });

      const checks = runDoctorChecks(cwd);
      const hookCheck = checks.find(c => c.name === 'hook-scripts' && c.status === 'warn');
      expect(hookCheck).toBeDefined();
      expect(hookCheck!.message).toContain('slope-guard.sh managed section is outdated');
      expect(hookCheck!.fixable).toBe(true);
    });

    it('passes when hook scripts are current', () => {
      setupSlopeDir(cwd);
      const hooksDir = join(cwd, '.claude', 'hooks');
      mkdirSync(hooksDir, { recursive: true });

      const currentScript = [
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
      writeFileSync(join(hooksDir, 'slope-guard.sh'), currentScript, { mode: 0o755 });

      const checks = runDoctorChecks(cwd);
      const hookCheck = checks.find(c => c.name === 'hook-scripts');
      expect(hookCheck).toBeDefined();
      expect(hookCheck!.status).toBe('ok');
    });

    it('detects Codex hooks.json missing top-level hooks object', () => {
      setupSlopeDir(cwd);
      mkdirSync(join(cwd, '.codex'), { recursive: true });
      writeFileSync(join(cwd, '.codex', 'hooks.json'), JSON.stringify({ PreToolUse: [] }));

      const checks = runDoctorChecks(cwd);
      const codexCheck = checks.find(c => c.name === 'codex-hooks' && c.message.includes('missing top-level "hooks"'));
      expect(codexCheck).toBeDefined();
      expect(codexCheck!.status).toBe('warn');
      expect(codexCheck!.fixable).toBe(true);
    });

    it('warns when SLOPE Codex hooks are installed at both project and user level', () => {
      setupSlopeDir(cwd);
      const previousCodexHome = process.env.SLOPE_CODEX_HOME;
      const codexHome = join(cwd, '.test-codex-home');

      try {
        process.env.SLOPE_CODEX_HOME = codexHome;
        mkdirSync(join(cwd, '.codex'), { recursive: true });
        mkdirSync(codexHome, { recursive: true });
        const hooksConfig = {
          hooks: {
            PreToolUse: [{
              matcher: 'Bash',
              hooks: [{ type: 'command', command: '"./.codex/hooks/slope-guard.sh" branch-before-commit' }],
            }],
          },
        };
        writeFileSync(join(cwd, '.codex', 'hooks.json'), JSON.stringify(hooksConfig));
        writeFileSync(join(codexHome, 'hooks.json'), JSON.stringify(hooksConfig));

        const checks = runDoctorChecks(cwd);
        const duplicateCheck = checks.find(c =>
          c.name === 'codex-hooks' &&
          c.status === 'warn' &&
          c.message.includes('keep one active Codex runtime path'),
        );

        expect(duplicateCheck).toBeDefined();
        expect(duplicateCheck!.message).toContain(join(cwd, '.codex', 'hooks.json'));
        expect(duplicateCheck!.message).toContain(join(codexHome, 'hooks.json'));
      } finally {
        if (previousCodexHome === undefined) {
          delete process.env.SLOPE_CODEX_HOME;
        } else {
          process.env.SLOPE_CODEX_HOME = previousCodexHome;
        }
      }
    });

    it('fixes Codex hooks.json root event shape', async () => {
      setupSlopeDir(cwd);
      mkdirSync(join(cwd, '.codex'), { recursive: true });
      const configPath = join(cwd, '.codex', 'hooks.json');
      writeFileSync(configPath, JSON.stringify({
        PreToolUse: [{ matcher: 'Bash', hooks: [] }],
        custom: true,
      }));

      const checks = runDoctorChecks(cwd);
      const fixed = await runDoctorFixes(cwd, checks);
      expect(fixed).toContain('Repaired Codex project hooks.json top-level hooks shape');

      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      expect(config.custom).toBe(true);
      expect(config.hooks.PreToolUse).toHaveLength(1);
      expect(config.PreToolUse).toBeUndefined();
    });

    it('warns when Codex hooks will resolve a stale project-local slope package', () => {
      setupSlopeDir(cwd);
      mkdirSync(join(cwd, '.codex'), { recursive: true });
      writeFileSync(join(cwd, '.codex', 'hooks.json'), JSON.stringify({
        hooks: {
          PreToolUse: [{
            matcher: 'apply_patch',
            hooks: [{ type: 'command', command: '"./.codex/hooks/slope-guard.sh" claim-required' }],
          }],
        },
      }));
      mkdirSync(join(cwd, 'node_modules', '@slope-dev', 'slope'), { recursive: true });
      writeFileSync(join(cwd, 'node_modules', '@slope-dev', 'slope', 'package.json'), JSON.stringify({
        name: '@slope-dev/slope',
        version: '0.0.1',
      }));

      const checks = runDoctorChecks(cwd);
      const runtimeCheck = checks.find(c =>
        c.name === 'codex-runtime' &&
        c.status === 'warn' &&
        c.message.includes('project-local @slope-dev/slope 0.0.1'),
      );

      expect(runtimeCheck).toBeDefined();
      expect(runtimeCheck!.message).toContain('before global/current');
    });

    it('warns when Codex hooks in the SLOPE dev repo would use stale dist output', () => {
      setupSlopeDir(cwd);
      mkdirSync(join(cwd, '.codex'), { recursive: true });
      writeFileSync(join(cwd, '.codex', 'hooks.json'), JSON.stringify({
        hooks: {
          PreToolUse: [{
            matcher: 'apply_patch',
            hooks: [{ type: 'command', command: '"./.codex/hooks/slope-guard.sh" claim-required' }],
          }],
        },
      }));
      writeFileSync(join(cwd, 'package.json'), JSON.stringify({
        name: '@slope-dev/slope',
        version: '9.9.9',
      }));
      mkdirSync(join(cwd, 'src', 'cli', 'guards'), { recursive: true });
      mkdirSync(join(cwd, 'dist', 'cli'), { recursive: true });
      const distPath = join(cwd, 'dist', 'cli', 'index.js');
      const sourcePath = join(cwd, 'src', 'cli', 'guards', 'claim-required.ts');
      writeFileSync(distPath, '// old build\n');
      writeFileSync(sourcePath, '// new source\n');
      const oldDate = new Date('2024-01-01T00:00:00Z');
      const newDate = new Date('2026-01-01T00:00:00Z');
      utimesSync(distPath, oldDate, oldDate);
      utimesSync(sourcePath, newDate, newDate);

      const checks = runDoctorChecks(cwd);
      const runtimeCheck = checks.find(c =>
        c.name === 'codex-runtime' &&
        c.status === 'warn' &&
        c.message.includes('src/ is newer'),
      );

      expect(runtimeCheck).toBeDefined();
      expect(runtimeCheck!.message).toContain('pnpm build');
    });

    it('detects non-executable Codex hook scripts', () => {
      setupSlopeDir(cwd);
      const hooksDir = join(cwd, '.codex', 'hooks');
      mkdirSync(hooksDir, { recursive: true });
      const scriptPath = join(hooksDir, 'slope-guard.sh');
      writeFileSync(scriptPath, '#!/usr/bin/env bash\nexit 0\n');
      chmodSync(scriptPath, 0o644);

      const checks = runDoctorChecks(cwd);
      const codexCheck = checks.find(c => c.name === 'codex-hooks' && c.message.includes('not executable'));
      expect(codexCheck).toBeDefined();
      expect(codexCheck!.status).toBe('warn');
    });
  });

  // --- S65-4: config schema validation ---

  describe('config schema validation (S65-4)', () => {
    it('detects invalid metaphor type', () => {
      setupSlopeDir(cwd, { config: { metaphor: 123 as unknown as string } });
      const checks = runDoctorChecks(cwd);
      const schemaCheck = checks.find(c => c.name === 'config-schema' && c.status === 'warn');
      expect(schemaCheck).toBeDefined();
      expect(schemaCheck!.message).toContain('metaphor should be a string');
      expect(schemaCheck!.fixable).toBe(true);
    });

    it('detects unregistered metaphor', () => {
      setupSlopeDir(cwd, { config: { metaphor: 'nonexistent-metaphor' } });
      const checks = runDoctorChecks(cwd);
      const schemaCheck = checks.find(c => c.name === 'config-schema' && c.status === 'warn');
      expect(schemaCheck).toBeDefined();
      expect(schemaCheck!.message).toContain('not a registered metaphor');
      expect(schemaCheck!.fixable).toBe(true);
    });

    it('detects invalid scorecardDir type', () => {
      setupSlopeDir(cwd, { config: { scorecardDir: 42 as unknown as string } });
      const checks = runDoctorChecks(cwd);
      const schemaCheck = checks.find(c => c.name === 'config-schema' && c.status === 'warn');
      expect(schemaCheck).toBeDefined();
      expect(schemaCheck!.message).toContain('scorecardDir should be a string');
    });

    it('passes with valid schema', () => {
      setupSlopeDir(cwd);
      const checks = runDoctorChecks(cwd);
      const schemaChecks = checks.filter(c => c.name === 'config-schema');
      expect(schemaChecks).toHaveLength(1);
      expect(schemaChecks[0].status).toBe('ok');
    });

    it('fixes invalid metaphor to golf default', async () => {
      setupSlopeDir(cwd, { config: { metaphor: 'nonexistent' } });
      const checks = runDoctorChecks(cwd);
      const fixed = await runDoctorFixes(cwd, checks);
      expect(fixed.some(f => f.includes('Fixed config schema issues'))).toBe(true);

      const config = JSON.parse(readFileSync(join(cwd, '.slope', 'config.json'), 'utf8'));
      expect(config.metaphor).toBe('golf');
    });
  });
});
