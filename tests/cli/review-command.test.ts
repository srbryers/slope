import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildScorecard } from '../../src/core/builder.js';
import { reviewCommand } from '../../src/cli/commands/review.js';

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
});
