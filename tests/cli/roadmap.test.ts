import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
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

function gitInit(dir: string): void {
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'ignore' });
}

function gitCommit(dir: string, message: string): void {
  execFileSync('git', ['commit', '--allow-empty', '-m', message], { cwd: dir, stdio: 'ignore' });
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

  it('does not flag planned sprints from docs-only git references', async () => {
    writeRoadmap(tmpDir, makeRoadmapJson());
    gitInit(tmpDir);
    gitCommit(tmpDir, 'docs(platform): multi-tenant product architecture spike - S8 context (#287)');
    gitCommit(tmpDir, 'docs(roadmap): reslot registry-purchase to S8, mark S7 as the admin audit (#284)');
    const codes = mockExit();

    await expect(roadmapCommand(['validate'])).rejects.toThrow('process.exit(0)');
    expect(codes[0]).toBe(0);
    const output = consoleOutput.join('\n');
    expect(output).toContain('Roadmap is valid');
    expect(output).not.toContain('shipped commits');
  });

  it('still flags planned sprints from real ticket-key commits', async () => {
    writeRoadmap(tmpDir, makeRoadmapJson());
    gitInit(tmpDir);
    gitCommit(tmpDir, 'fix(S8-1): implement platform ticket');
    const codes = mockExit();

    await expect(roadmapCommand(['validate'])).rejects.toThrow('process.exit(1)');
    expect(codes[0]).toBe(1);
    const output = consoleOutput.join('\n');
    expect(output).toContain('[S8]');
    expect(output).toContain('shipped commits');
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

  it('uses id_key in architect-review diagnostics', () => {
    const roadmap = makeRoadmapJson({
      phases: [{
        name: 'Canonical IDs',
        sprints: [458.1],
        sprint_keys: ['458.10'],
      }],
      sprints: [{
        id: 458.1,
        id_key: '458.10',
        theme: 'Exact label',
        par: 3,
        slope: 1,
        type: 'repair',
        tickets: [
          { key: 'S458.10-1', title: 'T1', club: 'wedge', complexity: 'small' },
          { key: 'S458.10-2', title: 'T2', club: 'wedge', complexity: 'small' },
        ],
      }],
    });
    writeRoadmap(tmpDir, roadmap);

    roadmapCommand(['review']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('S458.10 has 2 tickets');
    expect(output).not.toContain('S458.1 has 2 tickets');
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

describe('slope roadmap focus', () => {
  it('renders bounded human context without broad roadmap analysis', async () => {
    writeRoadmap(tmpDir, makeRoadmapJson());
    writeConfig(tmpDir);

    await roadmapCommand(['focus', '--sprint=8']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('# Focused Roadmap Context — S8');
    expect(output).toContain('## Phase Contract');
    expect(output).toContain('## Active Sprint');
    expect(output).toContain('## Direct Dependencies');
    expect(output).toContain('S7: Foundation');
    expect(output).toContain('## Immediate Successors');
    expect(output).toContain('S9: Polish');
    expect(output).not.toContain('Critical Path');
    expect(output).not.toContain('Parallel Opportunities');
    expect(output).not.toContain('Roadmap Reality Checks');
  });

  it('emits deterministic machine-readable JSON with canonical evidence', async () => {
    writeRoadmap(tmpDir, makeRoadmapJson());
    writeConfig(tmpDir);

    await roadmapCommand(['focus', '--sprint=S8', '--json']);
    const first = consoleOutput.join('\n');
    const parsed = JSON.parse(first);

    expect(parsed.version).toBe(1);
    expect(parsed.roadmap).toEqual({ name: 'Test Roadmap' });
    expect(parsed.sprint.id).toBe('8');
    expect(parsed.phase.name).toBe('Phase 1');
    expect(parsed.dependencies.map((item: any) => item.sprint.id)).toEqual(['7']);
    expect(parsed.successors.map((item: any) => item.sprint.id)).toEqual(['9']);
    expect(parsed.evidence).toContainEqual(expect.objectContaining({
      kind: 'roadmap',
      ref: 'docs/backlog/roadmap.json',
    }));
    expect(first).not.toContain('generated_at');
    expect(consoleErrors).toEqual([]);
  });

  it('includes relevant dependency scorecard hazards and excludes unrelated history', async () => {
    writeRoadmap(tmpDir, makeRoadmapJson());
    writeConfig(tmpDir, { scorecardDir: 'docs/retros', scorecardPattern: 'sprint-*.json', minSprint: 1 });
    mkdirSync(join(tmpDir, 'docs', 'retros'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs', 'retros', 'sprint-7.json'), JSON.stringify({
      sprint_number: 7, par: 4, score: 4, slope: 2, type: 'feature', theme: 'Foundation',
      shots: [{
        ticket_key: 'S7-1', title: 'T1', club: 'wedge', result: 'green',
        hazards: [{ type: 'bunker', severity: 'moderate', description: 'Dependency hazard' }],
      }],
      bunker_locations: ['Dependency location'],
    }));
    writeFileSync(join(tmpDir, 'docs', 'retros', 'sprint-6.json'), JSON.stringify({
      sprint_number: 6, par: 3, score: 3, slope: 1, type: 'feature', theme: 'Unrelated',
      shots: [{
        ticket_key: 'S6-1', title: 'Old', club: 'wedge', result: 'green',
        hazards: [{ type: 'water', severity: 'major', description: 'UNRELATED_HISTORY_HAZARD' }],
      }],
    }));

    await roadmapCommand(['focus', '--sprint=8', '--json']);
    const parsed = JSON.parse(consoleOutput.join('\n'));

    expect(parsed.hazards.map((hazard: any) => hazard.description)).toContain('Dependency hazard');
    expect(parsed.hazards.map((hazard: any) => hazard.description)).toContain('Dependency location');
    expect(parsed.hazards.map((hazard: any) => hazard.description)).not.toContain('UNRELATED_HISTORY_HAZARD');
  });

  it.each([
    [],
    ['--sprint='],
    ['--sprint=0'],
    ['--sprint=-1'],
    ['--sprint=abc'],
    ['--sprint=114.'],
  ])('rejects missing or invalid explicit selectors: %j', async (...selector) => {
    writeRoadmap(tmpDir, makeRoadmapJson());
    writeConfig(tmpDir);
    const codes = mockExit();

    await expect(roadmapCommand(['focus', ...selector])).rejects.toThrow('process.exit(1)');

    expect(codes).toEqual([1]);
    expect(consoleErrors.join('\n')).toContain('slope roadmap focus --sprint=N');
    expect(consoleOutput).toEqual([]);
  });

  it('rejects a valid sprint ID that is absent from the roadmap', async () => {
    writeRoadmap(tmpDir, makeRoadmapJson());
    writeConfig(tmpDir);
    const codes = mockExit();

    await expect(roadmapCommand(['focus', '--sprint=99'])).rejects.toThrow('process.exit(1)');

    expect(codes).toEqual([1]);
    expect(consoleErrors.join('\n')).toContain('was not found in the roadmap');
  });

  it('selects decimal and canonical post-200 sprint IDs exactly', async () => {
    const roadmap = makeRoadmapJson({
      phases: [{ name: 'Mixed IDs', sprints: [146.1, 224, 225, 226] }],
      sprints: [
        { ...makeRoadmapJson().sprints[0], id: 146.1, theme: 'Decimal', tickets: [
          { key: 'S146.1-1', title: 'T1', club: 'wedge', complexity: 'small' },
        ] } as any,
        { ...makeRoadmapJson().sprints[0], id: 224, theme: 'Before', tickets: [
          { key: 'S224-1', title: 'T1', club: 'wedge', complexity: 'small' },
        ] } as any,
        { ...makeRoadmapJson().sprints[0], id: 225, theme: 'Canonical 225', tickets: [
          { key: 'S225-1', title: 'T1', club: 'wedge', complexity: 'small' },
        ] } as any,
        { ...makeRoadmapJson().sprints[0], id: 226, theme: 'After', tickets: [
          { key: 'S226-1', title: 'T1', club: 'wedge', complexity: 'small' },
        ] } as any,
      ],
    });
    writeRoadmap(tmpDir, roadmap);
    writeConfig(tmpDir);

    await roadmapCommand(['focus', '--sprint=S146.1', '--json']);
    expect(JSON.parse(consoleOutput.join('\n')).sprint.label).toBe('S146.1');
    consoleOutput.length = 0;
    await roadmapCommand(['focus', '--sprint=225', '--json']);
    expect(JSON.parse(consoleOutput.join('\n')).sprint.label).toBe('S225');
  });

  it('attributes focused scorecard evidence to S458.10 without aliasing S458.1', async () => {
    const canonicalSprint = (key: '458.1' | '458.10', theme: string) => ({
      id: 458.1,
      id_key: key,
      theme,
      par: 3 as const,
      slope: 1,
      type: 'repair',
      tickets: [1, 2, 3].map(number => ({
        key: `S${key}-${number}`,
        title: `T${number}`,
        club: 'wedge' as const,
        complexity: 'small' as const,
      })),
    });
    const roadmap = makeRoadmapJson({
      phases: [
        { name: 'First insert', sprints: [458.1], sprint_keys: ['458.1'] },
        { name: 'Tenth insert', sprints: [458.1], sprint_keys: ['458.10'] },
      ],
      sprints: [
        canonicalSprint('458.1', 'First'),
        canonicalSprint('458.10', 'Tenth'),
      ],
    });
    writeRoadmap(tmpDir, roadmap);
    writeConfig(tmpDir, { scorecardDir: 'docs/retros', scorecardPattern: 'sprint-*.json', minSprint: 1 });
    mkdirSync(join(tmpDir, 'docs', 'retros'), { recursive: true });
    for (const key of ['458.1', '458.10']) {
      writeFileSync(join(tmpDir, 'docs', 'retros', `sprint-${key}.json`), JSON.stringify({
        sprint_number: key,
        par: 3,
        score: 3,
        shots: [],
      }));
    }

    await roadmapCommand(['focus', '--sprint=458.10', '--json']);
    const parsed = JSON.parse(consoleOutput.join('\n'));
    const scorecardEvidence = parsed.evidence.filter((item: { kind: string }) =>
      item.kind === 'scorecard');

    expect(parsed.sprint).toMatchObject({ id: '458.10', label: 'S458.10' });
    expect(scorecardEvidence).toEqual([expect.objectContaining({
      sprint: '458.10',
      ref: 'docs/retros/sprint-458.10.json',
    })]);
  });

  it('matches encoded roadmap IDs to decimal scorecard completion and evidence', async () => {
    const roadmap = makeRoadmapJson({
      phases: [{ name: 'Encoded', sprints: [43, 435, 44] }],
      sprints: [
        { ...makeRoadmapJson().sprints[0], id: 43, theme: 'Before', tickets: [
          { key: 'S43-1', title: 'T1', club: 'wedge', complexity: 'small' },
        ] } as any,
        { ...makeRoadmapJson().sprints[0], id: 435, theme: 'Inserted', tickets: [
          { key: 'S43.5-1', title: 'T1', club: 'wedge', complexity: 'small' },
        ] } as any,
        { ...makeRoadmapJson().sprints[0], id: 44, theme: 'After', tickets: [
          { key: 'S44-1', title: 'T1', club: 'wedge', complexity: 'small' },
        ] } as any,
      ],
    });
    writeRoadmap(tmpDir, roadmap);
    writeConfig(tmpDir, { scorecardDir: 'docs/retros', scorecardPattern: 'sprint-*.json', minSprint: 1 });
    mkdirSync(join(tmpDir, 'docs', 'retros'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs', 'retros', 'sprint-43.5.json'), JSON.stringify({
      sprint_number: 43.5, par: 4, score: 4, slope: 2, type: 'feature', theme: 'Inserted', shots: [],
    }));
    writeFileSync(join(tmpDir, 'docs', 'retros', 'sprint-43.5-review.md'), '# Review\n');

    await roadmapCommand(['focus', '--sprint=435', '--json']);
    const parsed = JSON.parse(consoleOutput.join('\n'));

    expect(parsed.sprint).toMatchObject({ label: 'S43.5', status: 'complete', readiness: 'complete' });
    expect(parsed.evidence).toContainEqual(expect.objectContaining({
      kind: 'scorecard',
      sprint: '43.5',
      ref: 'docs/retros/sprint-43.5.json',
    }));
    expect(parsed.evidence).toContainEqual(expect.objectContaining({
      kind: 'review',
      sprint: '43.5',
      ref: 'docs/retros/sprint-43.5-review.md',
    }));
  });

  it('supports a custom single-file roadmap path without mutation', async () => {
    const path = join(tmpDir, 'planning', 'custom-roadmap.json');
    mkdirSync(join(tmpDir, 'planning'), { recursive: true });
    writeFileSync(path, JSON.stringify(makeRoadmapJson(), null, 2));
    writeConfig(tmpDir);
    const before = readFileSync(path, 'utf8');

    await roadmapCommand(['focus', '--sprint=8', `--path=${path}`, '--json']);

    expect(JSON.parse(consoleOutput.join('\n')).sprint.id).toBe('8');
    expect(readFileSync(path, 'utf8')).toBe(before);
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

  it('marks scorecard-backed sprints complete while preserving roadmap-owned tickets (#568, #597)', () => {
    const roadmap = makeRoadmapJson({
      sprints: makeRoadmapJson().sprints.map(sprint => sprint.id === 8
        ? {
          ...sprint,
          status: 'planned',
          tickets: [
            { ...sprint.tickets[0], github_issue: 568 } as RoadmapDefinition['sprints'][number]['tickets'][number],
            { ...sprint.tickets[1], depends_on: ['S8-1'], github_issue: 568 } as RoadmapDefinition['sprints'][number]['tickets'][number],
            { ...sprint.tickets[2], depends_on: ['S8-2'] },
          ],
        } as RoadmapDefinition['sprints'][number]
        : sprint),
    });
    writeRoadmap(tmpDir, roadmap);
    writeConfig(tmpDir, { scorecardDir: 'docs/retros', scorecardPattern: 'sprint-*.json', minSprint: 1 });
    writeScorecard(tmpDir, 8, {
      theme: 'Updated Platform',
      shots: [
        { ticket_key: 'S8-1', title: 'Synced T1', club: 'short_iron', result: 'green', hazards: [] },
        { ticket_key: 'S8-2', title: 'Synced T2', club: 'wedge', result: 'green', hazards: [] },
        { ticket_key: 'S8-3', title: 'Synced T3', club: 'putter', result: 'green', hazards: [] },
      ],
    });

    roadmapCommand(['sync']);

    const result = JSON.parse(readFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), 'utf8'));
    const s8 = result.sprints.find((s: { id: number }) => s.id === 8);
    expect(s8.status).toBe('complete');
    expect(s8.tickets[0].title).toBe('T1');
    expect(s8.tickets[0].github_issue).toBe(568);
    expect(s8.tickets[1].depends_on).toEqual(['S8-1']);
    expect(s8.tickets[1].github_issue).toBe(568);
    expect(s8.tickets[2].depends_on).toEqual(['S8-2']);
  });

  it('does not collapse existing roadmap tickets when a scorecard shot covers multiple ticket keys (#597)', () => {
    const roadmap = makeRoadmapJson({
      sprints: makeRoadmapJson().sprints.map(sprint => sprint.id === 8
        ? {
          ...sprint,
          tickets: [
            { key: 'S8-1', title: 'Roadmap task 1', club: 'short_iron', complexity: 'standard' },
            { key: 'S8-2', title: 'Roadmap task 2', club: 'wedge', complexity: 'small' },
            { key: 'S8-3', title: 'Roadmap task 3', club: 'putter', complexity: 'trivial' },
          ],
        } as RoadmapDefinition['sprints'][number]
        : sprint),
    });
    writeRoadmap(tmpDir, roadmap);
    writeConfig(tmpDir, { scorecardDir: 'docs/retros', scorecardPattern: 'sprint-*.json', minSprint: 1 });
    writeScorecard(tmpDir, 8, {
      shots: [
        { ticket_key: 'S8-1', title: 'S8-1 S8-2 S8-3: Did the whole sprint', club: 'short_iron', result: 'green', hazards: [] },
      ],
    });

    roadmapCommand(['sync']);

    const result = JSON.parse(readFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), 'utf8'));
    const s8 = result.sprints.find((s: { id: number }) => s.id === 8);
    expect(s8.tickets.map((ticket: { key: string }) => ticket.key)).toEqual(['S8-1', 'S8-2', 'S8-3']);
    expect(s8.tickets.map((ticket: { title: string }) => ticket.title)).toEqual([
      'Roadmap task 1',
      'Roadmap task 2',
      'Roadmap task 3',
    ]);
  });

  it('maps club to complexity correctly', () => {
    const roadmap = makeRoadmapJson();
    writeRoadmap(tmpDir, roadmap);
    writeConfig(tmpDir, { scorecardDir: 'docs/retros', scorecardPattern: 'sprint-*.json', minSprint: 1 });
    writeScorecard(tmpDir, 10, {
      theme: 'New Sprint',
      shots: [
        { ticket_key: 'S10-1', title: 'Driver', club: 'driver', result: 'green', hazards: [] },
        { ticket_key: 'S10-2', title: 'Long Iron', club: 'long_iron', result: 'green', hazards: [] },
        { ticket_key: 'S10-3', title: 'Putter', club: 'putter', result: 'green', hazards: [] },
      ],
    });

    roadmapCommand(['sync']);

    const result = JSON.parse(readFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), 'utf8'));
    const s10 = result.sprints.find((s: { id: number }) => s.id === 10);
    expect(s10.tickets[0].complexity).toBe('moderate'); // driver
    expect(s10.tickets[1].complexity).toBe('moderate'); // long_iron
    expect(s10.tickets[2].complexity).toBe('trivial');  // putter
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
