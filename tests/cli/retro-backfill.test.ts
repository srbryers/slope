import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildBackfillScorecard } from '../../src/cli/commands/retro.js';

const REPO_ROOT = resolve(__dirname, '..', '..');
const SLOPE_BIN = resolve(REPO_ROOT, 'dist', 'cli', 'index.js');

function setupRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'slope-retro-'));
  mkdirSync(join(dir, '.slope'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'backlog'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'retros'), { recursive: true });
  writeFileSync(join(dir, '.slope', 'config.json'), JSON.stringify({
    roadmapPath: 'docs/backlog/roadmap.json',
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
  }));
  writeFileSync(join(dir, 'docs', 'backlog', 'roadmap.json'), JSON.stringify({
    name: 'Test',
    phases: [{ name: 'P1', sprints: [1, 2] }],
    sprints: [
      { id: 1, theme: 'First Sprint', par: 4, slope: 1, type: 'feature', tickets: [
        { key: 'S1-1', title: 'a', club: 'wedge', complexity: 'small' },
        { key: 'S1-2', title: 'b', club: 'wedge', complexity: 'small' },
        { key: 'S1-3', title: 'c', club: 'wedge', complexity: 'small' },
      ] },
      { id: 2, theme: 'Second Sprint', par: 5, slope: 2, type: 'feature', tickets: [
        { key: 'S2-1', title: 'a', club: 'wedge', complexity: 'small' },
        { key: 'S2-2', title: 'b', club: 'wedge', complexity: 'small' },
        { key: 'S2-3', title: 'c', club: 'wedge', complexity: 'small' },
      ] },
    ],
  }));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t', { cwd: dir });
  execSync('git config user.name t', { cwd: dir });
  execSync('git checkout -q -b main', { cwd: dir });
  execSync('git commit -q --allow-empty -m initial', { cwd: dir });
  return dir;
}

function commitWith(cwd: string, message: string) {
  execSync('git commit -q --allow-empty -m ' + JSON.stringify(message), { cwd });
}

describe('buildBackfillScorecard (#318)', () => {
  let cwd: string;

  beforeEach(() => { cwd = setupRepo(); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it('returns null when no commits reference the sprint', () => {
    const result = buildBackfillScorecard(cwd, 99, null);
    expect(result.scorecard).toBeNull();
    expect(result.reason).toContain('no commits found');
  });

  it('builds a scorecard from commit log with par from roadmap', () => {
    commitWith(cwd, 'feat(S1-1): hello world');
    commitWith(cwd, 'feat(S1-2): world hello');

    const roadmapRaw = JSON.parse(readFileSync(join(cwd, 'docs/backlog/roadmap.json'), 'utf8'));
    const result = buildBackfillScorecard(cwd, 1, roadmapRaw);

    expect(result.scorecard).not.toBeNull();
    const card = result.scorecard as Record<string, unknown>;
    expect(card.sprint_number).toBe('1');
    expect(card.par).toBe(4);
    expect(card.slope).toBe(1);
    expect(card.theme).toBe('First Sprint');
    expect((card.shots as unknown[]).length).toBe(2);
    expect(card._backfilled).toBe(true);
    expect(card._auto_generated).toBe(true);
  });

  it('extracts ticket keys from commit subjects when present', () => {
    commitWith(cwd, 'feat(S1-1): first');
    commitWith(cwd, 'feat(S1-2): second');

    const result = buildBackfillScorecard(cwd, 1, null);
    const shots = (result.scorecard as { shots: { ticket_key: string }[] }).shots;
    expect(shots[0].ticket_key).toBe('S1-1');
    expect(shots[1].ticket_key).toBe('S1-2');
  });

  it('falls back to S{N}-{i+1} when subject lacks ticket key', () => {
    commitWith(cwd, 'feat(S1): umbrella commit');
    const result = buildBackfillScorecard(cwd, 1, null);
    const shots = (result.scorecard as { shots: { ticket_key: string }[] }).shots;
    expect(shots[0].ticket_key).toBe('S1-1');
  });

  it('preserves S75.5 vs S75 distinction (does not double-count)', () => {
    commitWith(cwd, 'feat(S75.5): bug clearing');
    // S75.5 should NOT match a sprint=75 query
    const result = buildBackfillScorecard(cwd, 75, null);
    expect(result.scorecard).toBeNull();
  });
});

describe('slope retro backfill CLI (#318)', () => {
  let cwd: string;

  beforeEach(() => { cwd = setupRepo(); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it('writes sprint-N.json and reports counts on success', () => {
    commitWith(cwd, 'feat(S1-1): a');
    commitWith(cwd, 'feat(S1-2): b');

    const out = execSync(`node ${SLOPE_BIN} retro backfill --sprint=1`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    expect(out).toMatch(/S1: wrote .*sprint-1\.json \(2 shots/);
    expect(existsSync(join(cwd, 'docs', 'retros', 'sprint-1.json'))).toBe(true);
    const written = JSON.parse(readFileSync(join(cwd, 'docs', 'retros', 'sprint-1.json'), 'utf8'));
    expect(written._backfilled).toBe(true);
    expect(written.shots.length).toBe(2);
  });

  it('--dry-run does not write the file', () => {
    commitWith(cwd, 'feat(S1-1): a');
    const out = execSync(`node ${SLOPE_BIN} retro backfill --sprint=1 --dry-run`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    expect(out).toContain('[dry-run]');
    expect(existsSync(join(cwd, 'docs', 'retros', 'sprint-1.json'))).toBe(false);
  });

  it('--all-missing iterates shipped sprints without scorecards', () => {
    commitWith(cwd, 'feat(S1-1): a');
    commitWith(cwd, 'feat(S2-1): b');
    // Pre-populate S1 scorecard so only S2 should be backfilled
    writeFileSync(join(cwd, 'docs', 'retros', 'sprint-1.json'), '{}');

    const out = execSync(`node ${SLOPE_BIN} retro backfill --all-missing`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    expect(out).toContain('S2');
    expect(out).not.toMatch(/S1: wrote/);
    expect(existsSync(join(cwd, 'docs', 'retros', 'sprint-2.json'))).toBe(true);
  });

  it('skips when scorecard already exists', () => {
    commitWith(cwd, 'feat(S1-1): a');
    writeFileSync(join(cwd, 'docs', 'retros', 'sprint-1.json'), '{}');

    const out = execSync(`node ${SLOPE_BIN} retro backfill --sprint=1`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    expect(out).toContain('skipped (already exists)');
  });

  it('honors a custom scorecardPattern with multiple wildcards', () => {
    // Repoint config at a multi-wildcard pattern. The original
    // implementation used .replace('*', …) which only swapped the FIRST
    // wildcard, so target/skip detection silently looked at the wrong
    // path. Now uses .replaceAll — both wildcards must be substituted.
    writeFileSync(join(cwd, '.slope', 'config.json'), JSON.stringify({
      roadmapPath: 'docs/backlog/roadmap.json',
      scorecardDir: 'docs/retros',
      scorecardPattern: 'sprint-*-final-*.json',
    }));

    commitWith(cwd, 'feat(S1-1): a');
    // Pre-write a scorecard at the fully-substituted path so the CLI
    // should report "already exists". If only the first '*' were
    // replaced, it'd hunt for sprint-1-final-*.json (literal '*') and
    // miss this file → backfill instead of skip.
    writeFileSync(join(cwd, 'docs', 'retros', 'sprint-1-final-1.json'), '{}');

    const out = execSync(`node ${SLOPE_BIN} retro backfill --sprint=1`, {
      cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(out).toContain('skipped (already exists)');
  });
});
