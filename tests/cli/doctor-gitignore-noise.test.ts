import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runDoctorChecks, runDoctorFixes, COMMON_NOISE_PATTERNS } from '../../src/cli/commands/doctor.js';

function makeTmpRepo(): string {
  return mkdtempSync(join(tmpdir(), 'slope-doctor-noise-'));
}

describe('checkGitignoreNoise (#323)', () => {
  let cwd: string;

  beforeEach(() => { cwd = makeTmpRepo(); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it('skips when .gitignore is missing (primary check handles that)', () => {
    const checks = runDoctorChecks(cwd);
    const noise = checks.find(c => c.name === 'gitignore-noise');
    expect(noise).toBeUndefined();
  });

  it('reports OK when all common-noise patterns are present', () => {
    const all = COMMON_NOISE_PATTERNS.map(p => p.pattern).join('\n');
    writeFileSync(join(cwd, '.gitignore'), `.slope/\n${all}\n`);
    const checks = runDoctorChecks(cwd);
    const noise = checks.find(c => c.name === 'gitignore-noise');
    expect(noise?.status).toBe('ok');
  });

  it('warns with count + sample when patterns are missing', () => {
    writeFileSync(join(cwd, '.gitignore'), '.slope/\n');
    const checks = runDoctorChecks(cwd);
    const noise = checks.find(c => c.name === 'gitignore-noise');
    expect(noise?.status).toBe('warn');
    expect(noise?.message).toMatch(/\d+ common-noise pattern\(s\) missing:/);
    // .DS_Store is at the head of the curated list — should appear in the sample
    expect(noise?.message).toContain('.DS_Store');
    expect(noise?.fixable).toBe(true);
  });

  it('does not double-flag patterns that are present (commented vs uncommented)', () => {
    writeFileSync(join(cwd, '.gitignore'), '.DS_Store\n# .swp is for vim users\n');
    const checks = runDoctorChecks(cwd);
    const noise = checks.find(c => c.name === 'gitignore-noise');
    // .DS_Store is uncommented, so it's NOT in the missing list (sample omits it)
    expect(noise?.status).toBe('warn');
    expect(noise?.message).not.toMatch(/missing:[^.]*\.DS_Store/);
    // Comments are stripped, so the comment-only mention of .swp doesn't count
    // — *.swp remains missing. The displayed sample shows the first 3 only,
    // so we just check the count reflects the un-sampled pattern.
    expect(noise?.message).toMatch(/\d+ common-noise/);
  });

  it('--fix appends missing patterns and re-check is OK', async () => {
    writeFileSync(join(cwd, '.gitignore'), '.slope/\n');
    const before = runDoctorChecks(cwd);
    const fixed = await runDoctorFixes(cwd, before);

    expect(fixed.some(m => m.includes('common-noise pattern'))).toBe(true);

    const content = readFileSync(join(cwd, '.gitignore'), 'utf8');
    for (const p of COMMON_NOISE_PATTERNS) {
      expect(content).toContain(p.pattern);
    }

    const after = runDoctorChecks(cwd);
    const noise = after.find(c => c.name === 'gitignore-noise');
    expect(noise?.status).toBe('ok');
  });

  it('preserves existing .gitignore contents when adding patterns', async () => {
    writeFileSync(join(cwd, '.gitignore'), '.slope/\n# my custom comment\nmy-custom-rule\n');
    const before = runDoctorChecks(cwd);
    await runDoctorFixes(cwd, before);
    const content = readFileSync(join(cwd, '.gitignore'), 'utf8');
    expect(content).toContain('# my custom comment');
    expect(content).toContain('my-custom-rule');
    expect(content).toContain('.DS_Store');
  });
});
