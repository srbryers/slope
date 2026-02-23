import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
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

  it('shows strategic context for current sprint', () => {
    writeRoadmap(tmpDir, makeRoadmapJson());
    writeConfig(tmpDir, { currentSprint: 8 });

    roadmapCommand(['status']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('Current Context');
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
});

describe('slope roadmap (no subcommand)', () => {
  it('shows help text', () => {
    roadmapCommand([]);

    const output = consoleOutput.join('\n');
    expect(output).toContain('slope roadmap');
    expect(output).toContain('validate');
    expect(output).toContain('review');
    expect(output).toContain('status');
    expect(output).toContain('show');
  });
});
