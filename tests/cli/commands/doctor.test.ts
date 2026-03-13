import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runDoctorChecks, runDoctorFixes } from '../../../src/cli/commands/doctor.js';
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
