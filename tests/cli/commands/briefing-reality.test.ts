import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RoadmapDefinition } from '../../../src/core/index.js';
import { briefingCommand } from '../../../src/cli/commands/briefing.js';

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-briefing-reality-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({
    currentSprint: 7,
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
    commonIssuesPath: '.slope/common-issues.json',
    roadmapPath: 'docs/backlog/roadmap.json',
    minSprint: 1,
  }, null, 2));
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeRoadmap(): void {
  const roadmap: RoadmapDefinition = {
    name: 'Briefing Reality Roadmap',
    phases: [{ name: 'Phase 1', sprints: [7] }],
    sprints: [{
      id: 7,
      theme: 'Already Landed',
      par: 4,
      slope: 2,
      type: 'feature',
      status: 'planned',
      tickets: [
        { key: 'S7-1', title: 'Ticket 1', club: 'short_iron', complexity: 'standard' },
        { key: 'S7-2', title: 'Ticket 2', club: 'wedge', complexity: 'small' },
        { key: 'S7-3', title: 'Ticket 3', club: 'putter', complexity: 'trivial' },
      ],
    }],
  };
  mkdirSync(join(tmpDir, 'docs', 'backlog'), { recursive: true });
  writeFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), JSON.stringify(roadmap, null, 2));
}

function writeScorecard(): void {
  mkdirSync(join(tmpDir, 'docs', 'retros'), { recursive: true });
  writeFileSync(join(tmpDir, 'docs', 'retros', 'sprint-7.json'), JSON.stringify({
    sprint_number: 7,
    theme: 'Already Landed',
    par: 4,
    slope: 2,
    score: 4,
    score_label: 'par',
    type: 'feature',
    shots: [],
    conditions: [],
    special_plays: [],
    stats: { fairways_hit: 0, fairways_total: 0, greens_in_regulation: 0, greens_total: 0, putts: 0, penalties: 0, hazards_hit: 0, hazard_penalties: 0, miss_directions: {} },
    date: '2025-01-01',
    yardage_book_updates: [],
    bunker_locations: [],
    course_management_notes: [],
  }));
}

describe('slope briefing reality checks', () => {
  it('includes roadmap drift warnings from existing scorecards', async () => {
    writeRoadmap();
    writeScorecard();
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    await briefingCommand(['--sprint=7']);

    const output = logs.join('\n');
    expect(output).toContain('ROADMAP REALITY CHECKS');
    expect(output).toContain('S7 has a scorecard');
    expect(output).toContain('expected "complete"');
  });
});
