import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { nextCommand } from '../../../src/cli/commands/next.js';
import { createSprintState, saveSprintState } from '../../../src/cli/sprint-state.js';

function makeRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'slope-next-'));
  mkdirSync(join(cwd, '.slope'), { recursive: true });
  mkdirSync(join(cwd, 'docs', 'backlog'), { recursive: true });
  mkdirSync(join(cwd, 'docs', 'retros'), { recursive: true });
  writeFileSync(join(cwd, '.slope', 'config.json'), JSON.stringify({
    roadmapPath: 'docs/backlog/roadmap.json',
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
  }));
  return cwd;
}

function writeScorecard(cwd: string, sprint: number): void {
  writeFileSync(join(cwd, 'docs', 'retros', `sprint-${sprint}.json`), JSON.stringify({
    sprint_number: sprint,
    theme: `Sprint ${sprint}`,
    par: 4,
    slope: 1,
    score: 4,
    score_label: 'par',
    shots: [],
    stats: { fairways_hit: 0, fairways_total: 0, greens_in_regulation: 0, greens_total: 0, putts: 0, penalties: 0, hazards_hit: 0, hazard_penalties: 0, miss_directions: { long: 0, short: 0, left: 0, right: 0 } },
    conditions: [],
    special_plays: [],
    bunker_locations: [],
    yardage_book_updates: [],
    course_management_notes: [],
  }));
}

function writeRoadmap(cwd: string): void {
  writeFileSync(join(cwd, 'docs', 'backlog', 'roadmap.json'), JSON.stringify({
    name: 'Test',
    phases: [{ name: 'P1', sprints: [43, 435, 44] }],
    sprints: [
      { id: 43, theme: 'Done', par: 4, slope: 1, type: 'feature', status: 'complete', tickets: [
        { key: 'S43-1', title: 'done', club: 'wedge', complexity: 'small' },
        { key: 'S43-2', title: 'done', club: 'wedge', complexity: 'small' },
        { key: 'S43-3', title: 'done', club: 'wedge', complexity: 'small' },
      ] },
      { id: 435, theme: 'Inserted work', par: 4, slope: 1, type: 'bug fix', status: 'planned', tickets: [
        { key: 'S43.5-1', title: 'inserted', club: 'wedge', complexity: 'small' },
        { key: 'S43.5-2', title: 'inserted', club: 'wedge', complexity: 'small' },
        { key: 'S43.5-3', title: 'inserted', club: 'wedge', complexity: 'small' },
      ] },
      { id: 44, theme: 'Later', par: 4, slope: 1, type: 'feature', status: 'planned', tickets: [
        { key: 'S44-1', title: 'later', club: 'wedge', complexity: 'small' },
        { key: 'S44-2', title: 'later', club: 'wedge', complexity: 'small' },
        { key: 'S44-3', title: 'later', club: 'wedge', complexity: 'small' },
      ] },
    ],
  }));
}

function writeSupersededRoadmap(cwd: string): void {
  writeFileSync(join(cwd, 'docs', 'backlog', 'roadmap.json'), JSON.stringify({
    name: 'Test',
    phases: [{ name: 'P1', sprints: [75.5, 96] }],
    sprints: [
      { id: 75.5, theme: 'Old inserted work', par: 4, slope: 1, type: 'bug fix', status: 'superseded', tickets: [
        { key: 'S75.5-1', title: 'old', club: 'wedge', complexity: 'small' },
        { key: 'S75.5-2', title: 'old', club: 'wedge', complexity: 'small' },
        { key: 'S75.5-3', title: 'old', club: 'wedge', complexity: 'small' },
      ] },
      { id: 96, theme: 'Current work', par: 4, slope: 1, type: 'feature', status: 'planned', tickets: [
        { key: 'S96-1', title: 'current', club: 'wedge', complexity: 'small' },
        { key: 'S96-2', title: 'current', club: 'wedge', complexity: 'small' },
        { key: 'S96-3', title: 'current', club: 'wedge', complexity: 'small' },
      ] },
    ],
  }));
}

function writeSkippedPlannedRoadmap(cwd: string): void {
  writeFileSync(join(cwd, 'docs', 'backlog', 'roadmap.json'), JSON.stringify({
    name: 'Test',
    phases: [{ name: 'P1', sprints: [107, 108, 109, 110, 111] }],
    sprints: [
      { id: 107, theme: 'Done 107', par: 4, slope: 1, type: 'feature', status: 'complete', tickets: [
        { key: 'S107-1', title: 'done', club: 'wedge', complexity: 'small' },
        { key: 'S107-2', title: 'done', club: 'wedge', complexity: 'small' },
        { key: 'S107-3', title: 'done', club: 'wedge', complexity: 'small' },
      ] },
      { id: 108, theme: 'Done 108', par: 4, slope: 1, type: 'feature', status: 'complete', tickets: [
        { key: 'S108-1', title: 'done', club: 'wedge', complexity: 'small' },
        { key: 'S108-2', title: 'done', club: 'wedge', complexity: 'small' },
        { key: 'S108-3', title: 'done', club: 'wedge', complexity: 'small' },
      ] },
      { id: 109, theme: 'Skipped planned work', par: 4, slope: 1, type: 'feature', status: 'planned', tickets: [
        { key: 'S109-1', title: 'skipped', club: 'wedge', complexity: 'small' },
        { key: 'S109-2', title: 'skipped', club: 'wedge', complexity: 'small' },
        { key: 'S109-3', title: 'skipped', club: 'wedge', complexity: 'small' },
      ] },
      { id: 110, theme: 'Done 110', par: 4, slope: 1, type: 'feature', status: 'complete', tickets: [
        { key: 'S110-1', title: 'done', club: 'wedge', complexity: 'small' },
        { key: 'S110-2', title: 'done', club: 'wedge', complexity: 'small' },
        { key: 'S110-3', title: 'done', club: 'wedge', complexity: 'small' },
      ] },
      { id: 111, theme: 'Done 111', par: 4, slope: 1, type: 'feature', status: 'complete', tickets: [
        { key: 'S111-1', title: 'done', club: 'wedge', complexity: 'small' },
        { key: 'S111-2', title: 'done', club: 'wedge', complexity: 'small' },
        { key: 'S111-3', title: 'done', club: 'wedge', complexity: 'small' },
      ] },
    ],
  }));
}

function writeLinearRoadmap(cwd: string): void {
  writeFileSync(join(cwd, 'docs', 'backlog', 'roadmap.json'), JSON.stringify({
    name: 'Test',
    phases: [{ name: 'P1', sprints: [1, 30, 31] }],
    sprints: [
      { id: 1, theme: 'Historical', par: 4, slope: 1, type: 'feature', status: 'complete', tickets: [
        { key: 'S1-1', title: 'old', club: 'wedge', complexity: 'small' },
        { key: 'S1-2', title: 'old', club: 'wedge', complexity: 'small' },
        { key: 'S1-3', title: 'old', club: 'wedge', complexity: 'small' },
      ] },
      { id: 30, theme: 'Current work', par: 4, slope: 1, type: 'feature', status: 'planned', tickets: [
        { key: 'S30-1', title: 'current', club: 'wedge', complexity: 'small' },
        { key: 'S30-2', title: 'current', club: 'wedge', complexity: 'small' },
        { key: 'S30-3', title: 'current', club: 'wedge', complexity: 'small' },
      ] },
      { id: 31, theme: 'Next work', par: 4, slope: 1, type: 'feature', status: 'planned', depends_on: [30], tickets: [
        { key: 'S31-1', title: 'next', club: 'wedge', complexity: 'small' },
        { key: 'S31-2', title: 'next', club: 'wedge', complexity: 'small' },
        { key: 'S31-3', title: 'next', club: 'wedge', complexity: 'small' },
      ] },
    ],
  }));
}

describe('slope next', () => {
  const repos: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const repo of repos.splice(0)) rmSync(repo, { recursive: true, force: true });
  });

  it('prints help instead of running next when --help is passed', () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg = '') => logs.push(String(msg)));

    nextCommand(['--help']);

    const output = logs.join('\n');
    expect(output).toContain('slope next [--help]');
    expect(output).toContain('Selection order:');
    expect(output).not.toContain('Quick start:');
  });

  it('prefers a pending inserted roadmap sprint over scorecard+1 fallback', () => {
    const cwd = makeRepo();
    repos.push(cwd);
    writeScorecard(cwd, 99);
    writeRoadmap(cwd);
    const originalCwd = process.cwd();
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg = '') => logs.push(String(msg)));

    try {
      process.chdir(cwd);
      nextCommand();
    } finally {
      process.chdir(originalCwd);
    }

    const output = logs.join('\n');
    expect(output).toContain('Latest scorecard: S99');
    expect(output).toContain('Next sprint: S43.5');
    expect(output).toContain('roadmap state overrides scorecard fallback to S100');
    expect(output).toContain('slope briefing --sprint=435');
    expect(output).toMatch(/slope auto-card --sprint=435 --since="\d{4}-\d{2}-\d{2}"/);
    expect(output).not.toContain('date -d yesterday');
  });

  it('ignores superseded roadmap sprints when selecting the next sprint', () => {
    const cwd = makeRepo();
    repos.push(cwd);
    writeScorecard(cwd, 95);
    writeSupersededRoadmap(cwd);
    const originalCwd = process.cwd();
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg = '') => logs.push(String(msg)));

    try {
      process.chdir(cwd);
      nextCommand();
    } finally {
      process.chdir(originalCwd);
    }

    const output = logs.join('\n');
    expect(output).toContain('Latest scorecard: S95');
    expect(output).toContain('Next sprint: S96');
    expect(output).not.toContain('S75.5');
  });

  it('prefers the earliest skipped planned roadmap sprint over scorecard+1 fallback', () => {
    const cwd = makeRepo();
    repos.push(cwd);
    for (const sprint of [107, 108, 110, 111]) writeScorecard(cwd, sprint);
    writeSkippedPlannedRoadmap(cwd);
    const originalCwd = process.cwd();
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg = '') => logs.push(String(msg)));

    try {
      process.chdir(cwd);
      nextCommand();
    } finally {
      process.chdir(originalCwd);
    }

    const output = logs.join('\n');
    expect(output).toContain('Latest scorecard: S111');
    expect(output).toContain('Next sprint: S109');
    expect(output).toContain('selected from pending roadmap sprint: Skipped planned work');
    expect(output).toContain('roadmap state overrides scorecard fallback to S112');
    expect(output).toContain('slope briefing --sprint=109');
  });

  it('does not let fully gated scoring sprint-state reset next sprint output', () => {
    const cwd = makeRepo();
    repos.push(cwd);
    writeScorecard(cwd, 29);
    writeLinearRoadmap(cwd);
    const state = createSprintState(1, 'scoring');
    state.gates.tests = true;
    state.gates.code_review = true;
    state.gates.architect_review = true;
    state.gates.scorecard = true;
    state.gates.review_md = true;
    state.review_gates.code_review = {
      provenance: 'independent_review',
      evidence: ['agent:code-reviewer-output'],
      reviewer: 'code-reviewer',
    };
    state.review_gates.architect_review = {
      provenance: 'independent_review',
      evidence: ['agent:architect-reviewer-output'],
      reviewer: 'architect-reviewer',
    };
    saveSprintState(cwd, state);
    const originalCwd = process.cwd();
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg = '') => logs.push(String(msg)));

    try {
      process.chdir(cwd);
      nextCommand();
    } finally {
      process.chdir(originalCwd);
    }

    const output = logs.join('\n');
    expect(output).toContain('Latest scorecard: S29');
    expect(output).toContain('Next sprint: S30');
    expect(output).not.toContain('Next sprint: S1');
  });

  it('falls back to the next canonical sprint after a decimal inserted scorecard', () => {
    const cwd = makeRepo();
    repos.push(cwd);
    writeScorecard(cwd, 114.5);
    const originalCwd = process.cwd();
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg = '') => logs.push(String(msg)));

    try {
      process.chdir(cwd);
      nextCommand();
    } finally {
      process.chdir(originalCwd);
    }

    const output = logs.join('\n');
    expect(output).toContain('Latest scorecard: S114.5');
    expect(output).toContain('Next sprint: S115');
    expect(output).not.toContain('Next sprint: S115.5');
  });
});
