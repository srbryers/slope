import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RoadmapDefinition } from '../../src/core/index.js';

let tmpDir: string;
let originalCwd: string;

// Capture console output
let consoleOutput: string[];
let consoleErrors: string[];

function makeRoadmapJson(overrides: Partial<RoadmapDefinition> = {}): RoadmapDefinition {
  return {
    name: 'Test Roadmap',
    phases: [{ name: 'Phase 1', sprints: [7, 8, 9] }],
    sprints: [
      {
        id: 7, theme: 'Foundation', par: 4, slope: 2, type: 'feature',
        tickets: [
          { key: 'S7-1', title: 'T1', club: 'short_iron', complexity: 'standard' },
          { key: 'S7-2', title: 'T2', club: 'wedge', complexity: 'small' },
          { key: 'S7-3', title: 'T3', club: 'short_iron', complexity: 'standard' },
        ],
      },
      {
        id: 8, theme: 'Platform', par: 4, slope: 2, type: 'feature',
        depends_on: [7],
        tickets: [
          { key: 'S8-1', title: 'T1', club: 'short_iron', complexity: 'standard' },
          { key: 'S8-2', title: 'T2', club: 'short_iron', complexity: 'standard' },
          { key: 'S8-3', title: 'T3', club: 'wedge', complexity: 'small' },
        ],
      },
      {
        id: 9, theme: 'Polish', par: 3, slope: 1, type: 'chore',
        depends_on: [8],
        tickets: [
          { key: 'S9-1', title: 'T1', club: 'wedge', complexity: 'small' },
          { key: 'S9-2', title: 'T2', club: 'putter', complexity: 'trivial' },
          { key: 'S9-3', title: 'T3', club: 'wedge', complexity: 'small' },
        ],
      },
    ],
    ...overrides,
  };
}

function writeRoadmap(dir: string, roadmap: RoadmapDefinition): string {
  const path = join(dir, 'docs', 'backlog', 'roadmap.json');
  mkdirSync(join(dir, 'docs', 'backlog'), { recursive: true });
  writeFileSync(path, JSON.stringify(roadmap, null, 2));
  return path;
}

function writeConfig(dir: string, config: Record<string, unknown> = {}): void {
  mkdirSync(join(dir, '.slope'), { recursive: true });
  writeFileSync(join(dir, '.slope', 'config.json'), JSON.stringify(config, null, 2));
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-roadmap-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);

  consoleOutput = [];
  consoleErrors = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    consoleOutput.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// We import the command after setting up mocks
// Use dynamic import to avoid process.exit issues
import { roadmapCommand } from '../../src/cli/commands/roadmap.js';

// Helper to prevent process.exit from actually exiting
function mockExit(): number[] {
  const codes: number[] = [];
  vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
    codes.push(typeof code === 'number' ? code : 0);
    throw new Error(`process.exit(${code})`);
  });
  return codes;
}

describe('slope roadmap validate', () => {
  it('validates a correct roadmap', async () => {
    writeRoadmap(tmpDir, makeRoadmapJson());
    const codes = mockExit();

    await expect(roadmapCommand(['validate'])).rejects.toThrow('process.exit(0)');
    expect(codes[0]).toBe(0);
    const output = consoleOutput.join('\n');
    expect(output).toContain('Roadmap is valid');
    expect(output).toContain('Sprints: 3');
    expect(output).toContain('Tickets: 9');
  });

  it('reports errors for invalid roadmap', async () => {
    const roadmap = makeRoadmapJson({
      sprints: [{
        id: 7, theme: 'Bad', par: 4, slope: 2, type: 'feature',
        tickets: [
          { key: 'S8-1', title: 'Wrong', club: 'wedge', complexity: 'small' },
          { key: 'S7-2', title: 'T2', club: 'wedge', complexity: 'small' },
          { key: 'S7-3', title: 'T3', club: 'wedge', complexity: 'small' },
        ],
      }],
      phases: [{ name: 'P1', sprints: [7] }],
    });
    writeRoadmap(tmpDir, roadmap);
    const codes = mockExit();

    await expect(roadmapCommand(['validate'])).rejects.toThrow('process.exit(1)');
    expect(codes[0]).toBe(1);
    const output = consoleOutput.join('\n');
    expect(output).toContain('error');
    expect(output).toContain('S8-1');
  });

  it('validates roadmap tickets that use id instead of key', async () => {
    const roadmap = makeRoadmapJson({
      sprints: [{
        id: 7, theme: 'Id Only', par: 4, slope: 2, type: 'feature',
        tickets: [
          { id: 'S7-1', title: 'T1', club: 'short_iron', complexity: 'standard' },
          { id: 'S7-2', title: 'T2', club: 'wedge', complexity: 'small', depends_on: ['S7-1'] },
          { id: 'S7-3', title: 'T3', club: 'short_iron', complexity: 'standard' },
        ],
      } as unknown as RoadmapDefinition['sprints'][number]],
      phases: [{ name: 'P1', sprints: [7] }],
    });
    writeRoadmap(tmpDir, roadmap);
    const codes = mockExit();

    await expect(roadmapCommand(['validate'])).rejects.toThrow('process.exit(0)');
    expect(codes[0]).toBe(0);
    expect(consoleOutput.join('\n')).toContain('Roadmap is valid');
  });

  it('reports missing roadmap ticket identifiers without throwing TypeError', async () => {
    const roadmap = makeRoadmapJson({
      sprints: [{
        id: 7, theme: 'Missing Identifier', par: 4, slope: 2, type: 'feature',
        tickets: [
          { title: 'T1', club: 'short_iron', complexity: 'standard' },
          { key: 'S7-2', title: 'T2', club: 'wedge', complexity: 'small' },
          { key: 'S7-3', title: 'T3', club: 'short_iron', complexity: 'standard' },
        ],
      } as unknown as RoadmapDefinition['sprints'][number]],
      phases: [{ name: 'P1', sprints: [7] }],
    });
    writeRoadmap(tmpDir, roadmap);
    const codes = mockExit();

    await expect(roadmapCommand(['validate'])).rejects.toThrow('process.exit(1)');
    expect(codes[0]).toBe(1);
    const output = consoleOutput.join('\n');
    expect(output).toContain('missing key/id');
    expect(output).not.toContain('startsWith');
  });

  it('validates a sprint with no tickets array without throwing TypeError', async () => {
    const roadmap = makeRoadmapJson({
      sprints: [{
        id: 7,
        theme: 'Ticketless',
        par: 4,
        slope: 2,
        type: 'feature',
      } as unknown as RoadmapDefinition['sprints'][number]],
      phases: [{ name: 'P1', sprints: [7] }],
    });
    writeRoadmap(tmpDir, roadmap);
    const codes = mockExit();

    await expect(roadmapCommand(['validate'])).rejects.toThrow('process.exit(0)');
    expect(codes[0]).toBe(0);
    const output = consoleOutput.join('\n');
    expect(output).toContain('0 tickets');
    expect(output).not.toContain('Cannot read properties of undefined');
  });

  it('shows warnings for low ticket count', async () => {
    const roadmap = makeRoadmapJson({
      sprints: [{
        id: 7, theme: 'Thin', par: 3, slope: 1, type: 'feature',
        tickets: [
          { key: 'S7-1', title: 'T1', club: 'wedge', complexity: 'small' },
          { key: 'S7-2', title: 'T2', club: 'wedge', complexity: 'small' },
        ],
      }],
      phases: [{ name: 'P1', sprints: [7] }],
    });
    writeRoadmap(tmpDir, roadmap);
    const codes = mockExit();

    await expect(roadmapCommand(['validate'])).rejects.toThrow('process.exit(0)');
    const output = consoleOutput.join('\n');
    expect(output).toContain('Warnings');
    expect(output).toContain('2 tickets');
  });

  it('exits 1 when no roadmap file exists', async () => {
    const codes = mockExit();
    await expect(roadmapCommand(['validate'])).rejects.toThrow('process.exit(1)');
    expect(codes[0]).toBe(1);
    expect(consoleErrors.join('\n')).toContain('No roadmap file');
  });

  it('accepts --path flag', async () => {
    const customPath = join(tmpDir, 'custom-roadmap.json');
    writeFileSync(customPath, JSON.stringify(makeRoadmapJson()));
    const codes = mockExit();

    await expect(roadmapCommand(['validate', `--path=${customPath}`])).rejects.toThrow('process.exit(0)');
    expect(codes[0]).toBe(0);
  });
});

describe('slope roadmap review', () => {
  it('produces architect review output', () => {
    writeRoadmap(tmpDir, makeRoadmapJson());
    const codes = mockExit();

    roadmapCommand(['review']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('Architect Review');
    expect(output).toContain('Structural Validation');
    expect(output).toContain('Scope Balance');
    expect(output).toContain('Critical Path');
    expect(output).toContain('Parallelism');
    expect(output).toContain('Verdict');
  });

  it('shows critical path', () => {
    writeRoadmap(tmpDir, makeRoadmapJson());
    roadmapCommand(['review']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('S7');
    expect(output).toContain('S8');
    expect(output).toContain('S9');
  });

  it('shows scope balance stats', () => {
    writeRoadmap(tmpDir, makeRoadmapJson());
    roadmapCommand(['review']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('Tickets per sprint');
    expect(output).toContain('Par per sprint');
    expect(output).toContain('Club distribution');
  });

  it('reports parallel opportunities with branching roadmap', () => {
    const roadmap = makeRoadmapJson({
      sprints: [
        {
          id: 7, theme: 'A', par: 4, slope: 2, type: 'feature',
          tickets: [
            { key: 'S7-1', title: 'T1', club: 'short_iron', complexity: 'standard' },
            { key: 'S7-2', title: 'T2', club: 'short_iron', complexity: 'standard' },
            { key: 'S7-3', title: 'T3', club: 'short_iron', complexity: 'standard' },
          ],
        },
        {
          id: 8, theme: 'B', par: 4, slope: 2, type: 'feature',
          tickets: [
            { key: 'S8-1', title: 'T1', club: 'short_iron', complexity: 'standard' },
            { key: 'S8-2', title: 'T2', club: 'short_iron', complexity: 'standard' },
            { key: 'S8-3', title: 'T3', club: 'short_iron', complexity: 'standard' },
          ],
        },
        {
          id: 9, theme: 'C', par: 4, slope: 2, type: 'feature',
          depends_on: [7],
          tickets: [
            { key: 'S9-1', title: 'T1', club: 'short_iron', complexity: 'standard' },
            { key: 'S9-2', title: 'T2', club: 'short_iron', complexity: 'standard' },
            { key: 'S9-3', title: 'T3', club: 'short_iron', complexity: 'standard' },
          ],
        },
      ],
      phases: [{ name: 'P1', sprints: [7, 8, 9] }],
    });
    writeRoadmap(tmpDir, roadmap);
    roadmapCommand(['review']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('S7, S8');
  });
});

describe('slope roadmap status', () => {
  it('shows status with no scorecards', () => {
    writeRoadmap(tmpDir, makeRoadmapJson());
    writeConfig(tmpDir, { currentSprint: 7 });
    const codes = mockExit();

    roadmapCommand(['status']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('Roadmap Status');
    expect(output).toContain('S7');
    expect(output).toContain('active');
    expect(output).toContain('S8');
    expect(output).toContain('blocked');
  });

  it('keeps default status bounded and hides completed history', () => {
    const ticket = (prefix: string, n: number) => ({
      key: `${prefix}-${n}`,
      title: `T${n}`,
      club: 'short_iron' as const,
      complexity: 'standard' as const,
    });
    const sprint = (id: number, status?: string): RoadmapDefinition['sprints'][number] => ({
      id,
      theme: `Sprint ${id}`,
      par: 4,
      slope: 2,
      type: 'feature',
      ...(status ? { status } : {}),
      ...(id > 1 ? { depends_on: [id - 1] } : {}),
      tickets: [ticket(`S${id}`, 1), ticket(`S${id}`, 2), ticket(`S${id}`, 3)],
    });
    const roadmap = makeRoadmapJson({
      phases: [
        { name: 'Old Completed Phase', sprints: [1, 2, 3, 4] },
        { name: 'Current Phase', sprints: [5, 6, 7, 8, 9] },
      ],
      sprints: [
        sprint(1, 'complete'),
        sprint(2, 'complete'),
        sprint(3, 'complete'),
        sprint(4, 'complete'),
        sprint(5, 'planned'),
        sprint(6, 'planned'),
        sprint(7, 'planned'),
        sprint(8, 'planned'),
        sprint(9, 'planned'),
      ],
    });
    writeRoadmap(tmpDir, roadmap);
    writeConfig(tmpDir);

    roadmapCommand(['status']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('Current: S5 Sprint 5');
    expect(output).toContain('Current Phase');
    expect(output).not.toContain('Old Completed Phase');
    expect(output).toContain('S6 Sprint 6');
    expect(output).toContain('S7 Sprint 7');
    expect(output).toContain('S8 Sprint 8');
    expect(output).not.toContain('S9 Sprint 9');
    expect(output).toContain('slope roadmap status --full');
  });

  it('recommends next ready work when an explicit completed sprint is shown', () => {
    const roadmap = makeRoadmapJson({
      sprints: [
        { ...makeRoadmapJson().sprints[0], status: 'complete' } as RoadmapDefinition['sprints'][number],
        { ...makeRoadmapJson().sprints[1], status: 'planned' } as RoadmapDefinition['sprints'][number],
        { ...makeRoadmapJson().sprints[2], status: 'planned' } as RoadmapDefinition['sprints'][number],
      ],
    });
    writeRoadmap(tmpDir, roadmap);
    writeConfig(tmpDir);

    roadmapCommand(['status', '--sprint=7']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('Current: S7 Foundation');
    expect(output).toContain('S7 Foundation - \u2713 completed');
    expect(output).toContain('Start S8: Platform');
    expect(output).not.toContain('Work S7-1');
  });

  it('marks completed sprints from scorecards', () => {
    writeRoadmap(tmpDir, makeRoadmapJson());
    writeConfig(tmpDir, { currentSprint: 8, scorecardDir: 'docs/retros', scorecardPattern: 'sprint-*.json', minSprint: 1 });

    // Create a scorecard for sprint 7
    mkdirSync(join(tmpDir, 'docs', 'retros'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs', 'retros', 'sprint-7.json'), JSON.stringify({
      sprint_number: 7, par: 4, score: 4, slope: 2, type: 'feature',
      theme: 'Foundation', shots: [],
    }));

    roadmapCommand(['status']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('S7');
    expect(output).toContain('completed');
    expect(output).toContain('S8');
    expect(output).toContain('active');
  });

  it('selects an active inserted sprint before a later planned sprint (#525)', () => {
    const roadmap = makeRoadmapJson({
      phases: [{ name: 'Phase 1', sprints: [146, 146.1, 147] }],
      sprints: [
        {
          id: 146, theme: 'Done', par: 4, slope: 2, type: 'fix', status: 'complete',
          tickets: [
            { key: 'S146-1', title: 'T1', club: 'wedge', complexity: 'small' },
            { key: 'S146-2', title: 'T2', club: 'wedge', complexity: 'small' },
            { key: 'S146-3', title: 'T3', club: 'wedge', complexity: 'small' },
          ],
        } as RoadmapDefinition['sprints'][number],
        {
          id: 146.1, theme: 'Inserted Release', par: 4, slope: 2, type: 'release', status: 'active',
          depends_on: [146],
          tickets: [
            { key: 'S146.1-1', title: 'T1', club: 'short_iron', complexity: 'standard' },
            { key: 'S146.1-2', title: 'T2', club: 'short_iron', complexity: 'standard' },
            { key: 'S146.1-3', title: 'T3', club: 'wedge', complexity: 'small' },
          ],
        } as RoadmapDefinition['sprints'][number],
        {
          id: 147, theme: 'Later', par: 4, slope: 2, type: 'feature', status: 'planned',
          depends_on: [146.1],
          tickets: [
            { key: 'S147-1', title: 'T1', club: 'short_iron', complexity: 'standard' },
            { key: 'S147-2', title: 'T2', club: 'short_iron', complexity: 'standard' },
            { key: 'S147-3', title: 'T3', club: 'wedge', complexity: 'small' },
          ],
        } as RoadmapDefinition['sprints'][number],
      ],
    });
    writeRoadmap(tmpDir, roadmap);
    writeConfig(tmpDir, { scorecardDir: 'docs/retros', scorecardPattern: 'sprint-*.json', minSprint: 1 });
    mkdirSync(join(tmpDir, 'docs', 'retros'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs', 'retros', 'sprint-146.json'), JSON.stringify({
      sprint_number: 146, par: 4, score: 4, slope: 2, type: 'fix',
      theme: 'Done', shots: [],
    }));

    roadmapCommand(['status']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('Current: S146.1 Inserted Release');
    expect(output).toContain('S146.1 Inserted Release');
    expect(output).toContain('\u25B6 active');
    expect(output).toContain('S147 Later');
    expect(output).toContain('blocked by S146.1');
    expect(output).toContain('For the full roadmap history');
  });

  it('treats superseded sprints as terminal progress', () => {
    const roadmap = makeRoadmapJson({
      phases: [{ name: 'Phase 1', sprints: [7, 8, 9] }],
      sprints: [
        { ...makeRoadmapJson().sprints[0], status: 'complete' } as any,
        { ...makeRoadmapJson().sprints[1], status: 'superseded' } as any,
        { ...makeRoadmapJson().sprints[2], depends_on: [8] },
      ],
    });
    writeRoadmap(tmpDir, roadmap);
    writeConfig(tmpDir, { currentSprint: 9 });

    roadmapCommand(['status', '--full']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('Phase 1 (2/3)');
    expect(output).toContain('S8');
    expect(output).toContain('\u21B7 superseded');
    expect(output).toContain('S9');
    expect(output).toContain('\u25B6 active');
    expect(output).not.toContain('blocked by S8');
  });

  it('shows strategic context for current sprint', () => {
    writeRoadmap(tmpDir, makeRoadmapJson());
    writeConfig(tmpDir, { currentSprint: 8 });

    roadmapCommand(['status']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('Current:');
    expect(output).toContain('Active sprint');
    expect(output).toContain('Phase 1');
  });

  it('respects --sprint override', () => {
    writeRoadmap(tmpDir, makeRoadmapJson());
    writeConfig(tmpDir);

    roadmapCommand(['status', '--sprint=9']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('S9');
    expect(output).toContain('active');
  });
});

describe('slope roadmap show', () => {
  it('renders roadmap summary markdown', () => {
    writeRoadmap(tmpDir, makeRoadmapJson());

    roadmapCommand(['show']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('# Test Roadmap');
    expect(output).toContain('Phase 1');
    expect(output).toContain('Critical Path');
    expect(output).toContain('S7');
  });

  it('includes summary table', () => {
    writeRoadmap(tmpDir, makeRoadmapJson());

    roadmapCommand(['show']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('| 3 | 9 | 11 |');
  });

  it('surfaces roadmap reality drift from scorecards', () => {
    writeRoadmap(tmpDir, makeRoadmapJson());
    writeConfig(tmpDir, { scorecardDir: 'docs/retros', scorecardPattern: 'sprint-*.json', minSprint: 1 });
    writeScorecard(tmpDir, 7);

    roadmapCommand(['show']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('ROADMAP REALITY CHECKS');
    expect(output).toContain('S7 has a scorecard');
    expect(output).toContain('expected "complete"');
  });
});

function writeScorecard(dir: string, sprint: number, overrides: Record<string, unknown> = {}): void {
  mkdirSync(join(dir, 'docs', 'retros'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'retros', `sprint-${sprint}.json`), JSON.stringify({
    sprint_number: sprint,
    theme: `Sprint ${sprint}`,
    par: 4,
    slope: 2,
    score: 4,
    score_label: 'par',
    type: 'feature',
    shots: [
      { ticket_key: `S${sprint}-1`, title: 'Ticket 1', club: 'short_iron', result: 'green', hazards: [] },
      { ticket_key: `S${sprint}-2`, title: 'Ticket 2', club: 'wedge', result: 'in_the_hole', hazards: [] },
      { ticket_key: `S${sprint}-3`, title: 'Ticket 3', club: 'putter', result: 'fairway', hazards: [] },
    ],
    conditions: [],
    special_plays: [],
    stats: { fairways_hit: 3, fairways_total: 3, greens_in_regulation: 3, greens_total: 3, putts: 0, penalties: 0, hazards_hit: 0, hazard_penalties: 0, miss_directions: {} },
    date: '2025-01-01',
    yardage_book_updates: [],
    bunker_locations: [],
    course_management_notes: [],
    ...overrides,
  }));
}

describe('slope roadmap sync', () => {
  it('updates existing sprints from scorecards', () => {
    const roadmap = makeRoadmapJson();
    writeRoadmap(tmpDir, roadmap);
    writeConfig(tmpDir, { scorecardDir: 'docs/retros', scorecardPattern: 'sprint-*.json', minSprint: 1 });
    writeScorecard(tmpDir, 7, { theme: 'Updated Foundation', slope: 3 });

    roadmapCommand(['sync']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('Updated: 1');
    expect(output).toContain('Added: 0');

    // Verify the file was written with updated theme
    const result = JSON.parse(readFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), 'utf8'));
    const s7 = result.sprints.find((s: { id: number }) => s.id === 7);
    expect(s7.theme).toBe('Updated Foundation');
    expect(s7.slope).toBe(3);
  });

  it('adds new sprints from scorecards', () => {
    const roadmap = makeRoadmapJson();
    writeRoadmap(tmpDir, roadmap);
    writeConfig(tmpDir, { scorecardDir: 'docs/retros', scorecardPattern: 'sprint-*.json', minSprint: 1 });
    writeScorecard(tmpDir, 10, { theme: 'New Sprint' });

    roadmapCommand(['sync']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('Added: 1');
    expect(output).toContain('Total sprints: 4');

    const result = JSON.parse(readFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), 'utf8'));
    const s10 = result.sprints.find((s: { id: number }) => s.id === 10);
    expect(s10).toBeDefined();
    expect(s10.theme).toBe('New Sprint');
    expect(s10.tickets).toHaveLength(3);
  });

  it('preserves depends_on when updating', () => {
    const roadmap = makeRoadmapJson();
    writeRoadmap(tmpDir, roadmap);
    writeConfig(tmpDir, { scorecardDir: 'docs/retros', scorecardPattern: 'sprint-*.json', minSprint: 1 });
    writeScorecard(tmpDir, 8, { theme: 'Updated Platform' });

    roadmapCommand(['sync']);

    const result = JSON.parse(readFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), 'utf8'));
    const s8 = result.sprints.find((s: { id: number }) => s.id === 8);
    expect(s8.theme).toBe('Updated Platform');
    expect(s8.depends_on).toEqual([7]);
  });

  it('maps club to complexity correctly', () => {
    const roadmap = makeRoadmapJson();
    writeRoadmap(tmpDir, roadmap);
    writeConfig(tmpDir, { scorecardDir: 'docs/retros', scorecardPattern: 'sprint-*.json', minSprint: 1 });
    writeScorecard(tmpDir, 7, {
      shots: [
        { ticket_key: 'S7-1', title: 'Driver', club: 'driver', result: 'green', hazards: [] },
        { ticket_key: 'S7-2', title: 'Long Iron', club: 'long_iron', result: 'green', hazards: [] },
        { ticket_key: 'S7-3', title: 'Putter', club: 'putter', result: 'green', hazards: [] },
      ],
    });

    roadmapCommand(['sync']);

    const result = JSON.parse(readFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), 'utf8'));
    const s7 = result.sprints.find((s: { id: number }) => s.id === 7);
    expect(s7.tickets[0].complexity).toBe('moderate'); // driver
    expect(s7.tickets[1].complexity).toBe('moderate'); // long_iron
    expect(s7.tickets[2].complexity).toBe('trivial');  // putter
  });

  it('dry-run shows changes without writing', () => {
    const roadmap = makeRoadmapJson();
    writeRoadmap(tmpDir, roadmap);
    writeConfig(tmpDir, { scorecardDir: 'docs/retros', scorecardPattern: 'sprint-*.json', minSprint: 1 });
    writeScorecard(tmpDir, 7, { theme: 'Should Not Persist' });

    roadmapCommand(['sync', '--dry-run']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('--dry-run');
    expect(output).toContain('Updated: 1');

    // Verify file was NOT written
    const result = JSON.parse(readFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), 'utf8'));
    const s7 = result.sprints.find((s: { id: number }) => s.id === 7);
    expect(s7.theme).toBe('Foundation'); // unchanged
  });

  it('reports no scorecards when retros dir is empty', () => {
    writeRoadmap(tmpDir, makeRoadmapJson());
    writeConfig(tmpDir, { scorecardDir: 'docs/retros', scorecardPattern: 'sprint-*.json', minSprint: 1 });

    roadmapCommand(['sync']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('No scorecards found');
  });

  it('sorts sprints by id after adding', () => {
    const roadmap = makeRoadmapJson();
    writeRoadmap(tmpDir, roadmap);
    writeConfig(tmpDir, { scorecardDir: 'docs/retros', scorecardPattern: 'sprint-*.json', minSprint: 1 });
    writeScorecard(tmpDir, 5, { theme: 'Earlier Sprint' });
    writeScorecard(tmpDir, 10, { theme: 'Later Sprint' });

    roadmapCommand(['sync']);

    const result = JSON.parse(readFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), 'utf8'));
    const ids = result.sprints.map((s: { id: number }) => s.id);
    expect(ids).toEqual([5, 7, 8, 9, 10]);
  });
});

describe('slope roadmap (no subcommand)', () => {
  it('shows help text', () => {
    roadmapCommand([]);

    const output = consoleOutput.join('\n');
    expect(output).toContain('slope roadmap');
    expect(output).toContain('slope roadmap interview');
    expect(output).toContain('Interview delegates to `slope interview`');
    expect(output).toContain('slope vision create/update');
    expect(output).toContain('slope roadmap generate');
    expect(output).toContain('validate');
    expect(output).toContain('review');
    expect(output).toContain('status');
    expect(output).toContain('show');
    expect(output).toContain('sync');
  });
});
