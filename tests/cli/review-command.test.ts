import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildScorecard } from '../../src/core/builder.js';
import { reviewCommand } from '../../src/cli/commands/review.js';
import { createSprintState, loadSprintState, saveSprintState } from '../../src/cli/sprint-state.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-review-command-'));
  vi.spyOn(process, 'cwd').mockImplementation(() => tmpDir);
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  mkdirSync(join(tmpDir, 'docs', 'retros'), { recursive: true });
  writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
    minSprint: 1,
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

describe('reviewCommand', () => {
  it('writes the canonical sprint review markdown by default', () => {
    const card = buildScorecard({
      sprint_number: 132,
      theme: 'Review materialization',
      par: 3,
      slope: 1,
      date: '2026-06-03',
      shots: [{
        ticket_key: 'S132-1',
        title: 'Generate review',
        club: 'wedge',
        result: 'in_the_hole',
        hazards: [],
      }],
    });
    const scorecardPath = join(tmpDir, 'docs', 'retros', 'sprint-132.json');
    writeFileSync(scorecardPath, JSON.stringify(card, null, 2));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    reviewCommand(scorecardPath);
    logSpy.mockRestore();

    const reviewPath = join(tmpDir, 'docs', 'retros', 'sprint-132-review.md');
    expect(existsSync(reviewPath)).toBe(true);
    expect(readFileSync(reviewPath, 'utf8')).toContain('## Sprint 132 Review: Review materialization');
  });

  it('refuses to guess a scorecard when multiple sprint artifacts exist', () => {
    for (const sprint of [109, 122]) {
      const card = buildScorecard({
        sprint_number: sprint,
        theme: `Sprint ${sprint}`,
        par: 3,
        slope: 1,
        date: '2026-07-10',
        shots: [{ ticket_key: `S${sprint}-1`, title: 'Review', club: 'wedge', result: 'green', hazards: [] }],
      });
      writeFileSync(join(tmpDir, 'docs', 'retros', `sprint-${sprint}.json`), JSON.stringify(card));
    }
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args.join(' ')); });
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as never);

    expect(() => reviewCommand()).toThrow('process.exit(1)');

    expect(errors.join('\n')).toContain('Multiple scorecards found; refusing to guess');
    expect(errors.join('\n')).toContain('slope review docs');
    expect(existsSync(join(tmpDir, 'docs', 'retros', 'sprint-122-review.md'))).toBe(false);
  });

  it('scopes explicit scorecard output and gate mutation to the selected sprint', () => {
    for (const sprint of [109, 122]) {
      const card = buildScorecard({
        sprint_number: sprint,
        theme: `Sprint ${sprint}`,
        par: 3,
        slope: 1,
        date: '2026-07-10',
        shots: [{ ticket_key: `S${sprint}-1`, title: 'Review', club: 'wedge', result: 'green', hazards: [] }],
      });
      writeFileSync(join(tmpDir, 'docs', 'retros', `sprint-${sprint}.json`), JSON.stringify(card));
    }
    const latestReviewPath = join(tmpDir, 'docs', 'retros', 'sprint-122-review.md');
    writeFileSync(latestReviewPath, 'existing latest review\n');
    saveSprintState(tmpDir, createSprintState(122, 'scoring'));
    const logs: string[] = [];
    const errors: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });
    vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args.join(' ')); });

    reviewCommand(join(tmpDir, 'docs', 'retros', 'sprint-109.json'));

    expect(readFileSync(join(tmpDir, 'docs', 'retros', 'sprint-109-review.md'), 'utf8'))
      .toContain('## Sprint 109 Review: Sprint 109');
    expect(readFileSync(latestReviewPath, 'utf8')).toBe('existing latest review\n');
    expect(loadSprintState(tmpDir)?.gates.review_md).toBe(false);
    expect(logs.join('\n')).not.toContain('Review written:');
    expect(errors.join('\n')).toContain('Review written: docs');
    expect(errors.join('\n')).toContain('sprint-109-review.md');
  });

  it('selects one scorecard by --sprint semantics when multiple exist', () => {
    for (const sprint of [109, 122]) {
      const card = buildScorecard({
        sprint_number: sprint,
        theme: `Sprint ${sprint}`,
        par: 3,
        slope: 1,
        date: '2026-07-10',
        shots: [{ ticket_key: `S${sprint}-1`, title: 'Review', club: 'wedge', result: 'green', hazards: [] }],
      });
      writeFileSync(join(tmpDir, 'docs', 'retros', `sprint-${sprint}.json`), JSON.stringify(card));
    }
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    reviewCommand(undefined, undefined, undefined, undefined, 'S109');

    expect(existsSync(join(tmpDir, 'docs', 'retros', 'sprint-109-review.md'))).toBe(true);
    expect(existsSync(join(tmpDir, 'docs', 'retros', 'sprint-122-review.md'))).toBe(false);
  });
});
