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

  it('de-stales replanned dependency hazards through the full CLI path', async () => {
    const roadmap: RoadmapDefinition = {
      name: 'Replanned Briefing Roadmap',
      phases: [
        { name: 'Phase 47 — Review Gate', sprints: [447], status: 'complete' },
        { name: 'Phase 48 — Roadmap Federation', sprints: [448, 449], status: 'planned' },
      ],
      sprints: [
        {
          id: 447, theme: 'AI review gate', par: 3, slope: 2, type: 'review', status: 'complete',
          tickets: [{ key: 'S447-1', title: 'Durable review evidence', club: 'wedge', complexity: 'small' }],
        },
        {
          id: 448,
          theme: 'SLOPE roadmap federation and focused agent context',
          par: 4,
          slope: 3,
          type: 'planning architecture',
          status: 'planned',
          depends_on: [447],
          tickets: [{ key: 'S448-1', title: 'Roadmap federation', club: 'long_iron', complexity: 'moderate' }],
        },
        {
          id: 449,
          theme: 'Flora Studio semantic gate kernel',
          par: 4,
          slope: 2,
          type: 'feature',
          status: 'planned',
          depends_on: [448],
          tickets: [{ key: 'S449-1', title: 'Semantic kernel', club: 'short_iron', complexity: 'standard' }],
        },
      ],
    };
    mkdirSync(join(tmpDir, 'docs', 'backlog'), { recursive: true });
    mkdirSync(join(tmpDir, 'docs', 'retros'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), JSON.stringify(roadmap, null, 2));
    writeFileSync(join(tmpDir, 'docs', 'retros', 'sprint-447.json'), JSON.stringify({
      sprint_number: 447,
      theme: 'AI review gate',
      par: 3,
      slope: 2,
      score: 3,
      score_label: 'par',
      type: 'review',
      shots: [{
        ticket_key: 'S447-1',
        title: 'Durable review evidence',
        club: 'wedge',
        result: 'green',
        hazards: [{
          type: 'bunker',
          description: 'Preserve the durable review decision. S448 routes to UE hardening before gumbo.',
        }],
      }],
      conditions: [],
      special_plays: [],
      stats: { fairways_hit: 1, fairways_total: 1, greens_in_regulation: 1, greens_total: 1, putts: 0, penalties: 0, hazards_hit: 1, hazard_penalties: 0, miss_directions: {} },
      date: '2026-07-01',
      yardage_book_updates: [],
      bunker_locations: ['Do not start S448 gumbo as if the S447 UE gate shape passed.'],
      course_management_notes: [],
    }, null, 2));
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    await briefingCommand(['--sprint=448']);

    const output = logs.join('\n');
    expect(output).toContain('S448: SLOPE roadmap federation and focused agent context');
    expect(output).toContain('Next: S449: Flora Studio semantic gate kernel');
    expect(output).toContain('direct dependency history for S448');
    expect(output).toContain('Preserve the durable review decision.');
    expect(output).not.toContain('gumbo');
    expect(output).not.toContain('UE hardening');
    expect(output).toContain('Suppressed 2 superseded route directives');
  });

  it('surfaces open codification candidates from review findings', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope', 'review-findings.json'), JSON.stringify({
      sprints: {
        3: [
          {
            id: '12345678-1234-1234-1234-123456789abc',
            review_type: 'workaround',
            ticket_key: 'workaround',
            severity: 'major',
            description: 'Local gallery server was pinned to sprint path',
            resolved: false,
            recurs: true,
            cost: 's',
            codification_status: 'open',
          },
          {
            id: '87654321-1234-1234-1234-123456789abc',
            review_type: 'workaround',
            ticket_key: 'workaround',
            severity: 'minor',
            description: 'Already codified workaround',
            resolved: true,
            recurs: true,
            cost: 'm',
            codification_status: 'paid_down',
          },
        ],
      },
    }, null, 2));

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    await briefingCommand(['--sprint=7']);

    const output = logs.join('\n');
    expect(output).toContain('CODIFICATION CANDIDATES: 1 open (1 structural)');
    expect(output).toContain('12345678 S3 [MAJOR cost=s]');
    expect(output).toContain('[codify now]');
    expect(output).not.toContain('Already codified workaround');
  });

  it('includes codification candidate counts in compact briefing', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope', 'review-findings.json'), JSON.stringify({
      sprints: {
        3: [
          {
            id: '12345678-1234-1234-1234-123456789abc',
            review_type: 'workaround',
            ticket_key: 'workaround',
            severity: 'major',
            description: 'Local gallery server was pinned to sprint path',
            resolved: false,
            recurs: true,
            cost: 's',
            codification_status: 'open',
          },
        ],
      },
    }, null, 2));

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    await briefingCommand(['--sprint=7', '--compact']);

    const output = logs.join('\n');
    expect(output).toContain('Codification candidates: 1 open');
  });
});
