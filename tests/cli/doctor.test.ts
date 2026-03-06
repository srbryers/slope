import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runDoctorChecks, runDoctorFixes } from '../../src/cli/commands/doctor.js';

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-doctor-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('runDoctorChecks', () => {
  it('reports all failures on empty directory', () => {
    const checks = runDoctorChecks(tmpDir);

    const configCheck = checks.find(c => c.name === 'config');
    expect(configCheck?.status).toBe('fail');

    const gitignoreCheck = checks.find(c => c.name === 'gitignore');
    expect(gitignoreCheck?.status).toBe('warn');

    const storeCheck = checks.find(c => c.name === 'store');
    expect(storeCheck?.status).toBe('warn');

    const retrosCheck = checks.find(c => c.name === 'retros-dir');
    expect(retrosCheck?.status).toBe('warn');
  });

  it('reports OK for valid setup', () => {
    // Create minimal valid setup
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({
      retrosPath: 'docs/retros',
      commonIssuesPath: '.slope/common-issues.json',
    }));
    writeFileSync(join(tmpDir, '.slope', 'common-issues.json'), JSON.stringify({ recurring_patterns: [] }));
    writeFileSync(join(tmpDir, '.slope', 'hooks.json'), JSON.stringify({ installed: { test: {} } }));
    writeFileSync(join(tmpDir, '.gitignore'), '.slope/\n');
    // Create a minimal SQLite DB (just touch the file)
    writeFileSync(join(tmpDir, '.slope', 'slope.db'), '');
    mkdirSync(join(tmpDir, 'docs', 'retros'), { recursive: true });
    mkdirSync(join(tmpDir, 'docs', 'backlog'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), JSON.stringify({ name: 'test', phases: [], sprints: [] }));
    writeFileSync(join(tmpDir, 'CODEBASE.md'), `---\ngenerated_at: "${new Date().toISOString()}"\n---\n# Map`);

    const checks = runDoctorChecks(tmpDir);
    const configCheck = checks.find(c => c.name === 'config');
    expect(configCheck?.status).toBe('ok');

    const gitignoreCheck = checks.find(c => c.name === 'gitignore');
    expect(gitignoreCheck?.status).toBe('ok');

    const storeCheck = checks.find(c => c.name === 'store');
    expect(storeCheck?.status).toBe('ok');
  });

  it('detects missing .slope/ in .gitignore', () => {
    writeFileSync(join(tmpDir, '.gitignore'), 'node_modules/\n');

    const checks = runDoctorChecks(tmpDir);
    const gitignoreCheck = checks.find(c => c.name === 'gitignore');
    expect(gitignoreCheck?.status).toBe('warn');
    expect(gitignoreCheck?.fixable).toBe(true);
  });

  it('detects stale CODEBASE.md', () => {
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(join(tmpDir, 'CODEBASE.md'), `---\ngenerated_at: "${oldDate}"\n---\n# Map`);

    const checks = runDoctorChecks(tmpDir);
    const mapCheck = checks.find(c => c.name === 'codebase-map');
    expect(mapCheck?.status).toBe('warn');
    expect(mapCheck?.message).toContain('days old');
  });

  it('detects invalid roadmap JSON', () => {
    mkdirSync(join(tmpDir, 'docs', 'backlog'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), 'not json{');

    const checks = runDoctorChecks(tmpDir);
    const roadmapCheck = checks.find(c => c.name === 'roadmap');
    expect(roadmapCheck?.status).toBe('fail');
  });

  it('detects invalid config JSON as non-fixable failure', () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope', 'config.json'), '{ invalid json }');

    const checks = runDoctorChecks(tmpDir);
    const configCheck = checks.find(c => c.name === 'config');
    expect(configCheck?.status).toBe('fail');
    expect(configCheck?.fixable).toBeUndefined();
    expect(configCheck?.message).toContain('invalid JSON');
  });

  it('detects no guards installed', () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope', 'hooks.json'), JSON.stringify({ installed: {} }));

    const checks = runDoctorChecks(tmpDir);
    const guardCheck = checks.find(c => c.name === 'guards');
    expect(guardCheck?.status).toBe('warn');
    expect(guardCheck?.message).toContain('No guards active');
  });
});

describe('runDoctorFixes', () => {
  it('fixes missing .gitignore entry', async () => {
    writeFileSync(join(tmpDir, '.gitignore'), 'node_modules/\n');

    const checks = runDoctorChecks(tmpDir);
    const fixed = await runDoctorFixes(tmpDir, checks);

    expect(fixed).toContain('Added .slope/ to .gitignore');

    // Re-check
    const recheck = runDoctorChecks(tmpDir);
    const gitignoreCheck = recheck.find(c => c.name === 'gitignore');
    expect(gitignoreCheck?.status).toBe('ok');
  });

  it('fixes missing retros directory', async () => {
    const checks = [{ name: 'retros-dir', status: 'warn' as const, message: 'missing', fixable: true }];
    const fixed = await runDoctorFixes(tmpDir, checks);
    expect(fixed).toContain('Created docs/retros/');
  });

  it('fixes missing common-issues.json', async () => {
    const checks = [{ name: 'common-issues', status: 'warn' as const, message: 'missing', fixable: true }];
    const fixed = await runDoctorFixes(tmpDir, checks);
    expect(fixed).toContain('Created .slope/common-issues.json');
  });

  it('returns no fixes when all checks pass', async () => {
    const checks = [{ name: 'config', status: 'ok' as const, message: 'ok' }];
    const fixed = await runDoctorFixes(tmpDir, checks);
    expect(fixed).toHaveLength(0);
  });
});
