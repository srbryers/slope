import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { parseChangelog } from '../../src/cli/commands/docs.js';

// ── Fixture helpers ────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'slope-docs-'));
}

function gitInit(cwd: string): void {
  execSync('git init', { cwd, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd, stdio: 'pipe' });
  execSync('git config user.name "Test User"', { cwd, stdio: 'pipe' });
}

function gitCommit(cwd: string, message: string): void {
  writeFileSync(join(cwd, `file-${Date.now()}-${Math.random()}.txt`), message);
  execSync('git add -A', { cwd, stdio: 'pipe' });
  execSync(`git commit -m "${message}"`, { cwd, stdio: 'pipe' });
}

function gitTag(cwd: string, tag: string): void {
  execSync(`git tag ${tag}`, { cwd, stdio: 'pipe' });
}

// ── Tests ──────────────────────────────────────────────────────

describe('parseChangelog', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('handles non-git directory', () => {
    const result = parseChangelog(tmpDir);
    expect(result.status).toBe('unavailable');
    expect(result.entries).toHaveLength(0);
    expect(result.reason).toBeTruthy();
  });

  it('handles empty repo (no commits)', () => {
    gitInit(tmpDir);
    const result = parseChangelog(tmpDir);
    // No commits means no entries but still a valid result
    expect(['success', 'partial', 'unavailable']).toContain(result.status);
    expect(result.entries).toHaveLength(0);
  });

  it('parses conventional commits — feat with scope', () => {
    gitInit(tmpDir);
    gitCommit(tmpDir, 'feat(core): add feature');

    const result = parseChangelog(tmpDir);
    expect(result.status).toBe('success');
    expect(result.entries.length).toBeGreaterThanOrEqual(1);

    const unreleased = result.entries[0];
    expect(unreleased.version).toBe('Unreleased');
    expect(unreleased.changes.length).toBe(1);
    expect(unreleased.changes[0].type).toBe('feat');
    expect(unreleased.changes[0].scope).toBe('core');
    expect(unreleased.changes[0].description).toBe('add feature');
  });

  it('parses conventional commits — unscoped fix', () => {
    gitInit(tmpDir);
    gitCommit(tmpDir, 'fix: repair thing');

    const result = parseChangelog(tmpDir);
    expect(result.status).toBe('success');
    const changes = result.entries[0].changes;
    expect(changes[0].type).toBe('fix');
    expect(changes[0].scope).toBeUndefined();
    expect(changes[0].description).toBe('repair thing');
  });

  it('parses SLOPE ticket format', () => {
    gitInit(tmpDir);
    gitCommit(tmpDir, 'S48-1: Harden modules');

    const result = parseChangelog(tmpDir);
    expect(result.status).toBe('success');
    const changes = result.entries[0].changes;
    expect(changes[0].type).toBe('other');
    expect(changes[0].description).toContain('S48-1');
  });

  it('parses breaking changes', () => {
    gitInit(tmpDir);
    gitCommit(tmpDir, 'feat!: remove old API');

    const result = parseChangelog(tmpDir);
    expect(result.status).toBe('success');
    const changes = result.entries[0].changes;
    expect(changes[0].type).toBe('feat');
    expect(changes[0].breaking).toBe(true);
  });

  it('parses freeform commits as other', () => {
    gitInit(tmpDir);
    gitCommit(tmpDir, 'random commit message');

    const result = parseChangelog(tmpDir);
    expect(result.status).toBe('success');
    const changes = result.entries[0].changes;
    expect(changes[0].type).toBe('other');
  });

  it('handles repo with no tags — version is Unreleased', () => {
    gitInit(tmpDir);
    gitCommit(tmpDir, 'feat: first');
    gitCommit(tmpDir, 'fix: second');

    const result = parseChangelog(tmpDir);
    expect(result.status).toBe('success');
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].version).toBe('Unreleased');
    expect(result.entries[0].changes.length).toBe(2);
  });

  it('groups by version tags when tags exist', () => {
    gitInit(tmpDir);
    gitCommit(tmpDir, 'feat: initial');
    gitTag(tmpDir, 'v1.0.0');
    gitCommit(tmpDir, 'feat: after tag');

    const result = parseChangelog(tmpDir);
    expect(result.status).toBe('success');
    // Should have Unreleased (commits after v1.0.0) and v1.0.0
    const versions = result.entries.map(e => e.version);
    expect(versions).toContain('Unreleased');
    expect(versions).toContain('v1.0.0');
  });

  it('includes commit hashes', () => {
    gitInit(tmpDir);
    gitCommit(tmpDir, 'feat: with hash');

    const result = parseChangelog(tmpDir);
    const change = result.entries[0].changes[0];
    expect(change.hash).toBeTruthy();
    expect(change.hash).toMatch(/^[a-f0-9]{40}$/);
  });

  it('respects --since parameter', () => {
    gitInit(tmpDir);
    gitCommit(tmpDir, 'feat: old');
    gitTag(tmpDir, 'v1.0.0');
    gitCommit(tmpDir, 'feat: mid');
    gitTag(tmpDir, 'v2.0.0');
    gitCommit(tmpDir, 'feat: new');

    // Since v1.0.0 should include v2.0.0 tag entries + unreleased
    const result = parseChangelog(tmpDir, 'v1.0.0');
    expect(result.status).toBe('success');
    const versions = result.entries.map(e => e.version);
    expect(versions).toContain('Unreleased');
  });
});
