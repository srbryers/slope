import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { convertPlannedSprints } from '../../../slope-loop/analyze-scorecards.js';
import type { PlannedSprint } from '../../../src/cli/loop/types.js';

let tmpDir: string;

const VALID_PLANNED: PlannedSprint[] = [
  {
    id: 'P10-1',
    theme: 'Context budget per ticket',
    par: 3,
    slope: 2,
    type: 'feature',
    tickets: [
      {
        key: 'P10-1-1',
        title: 'Add token budget instruction',
        club: 'short_iron',
        description: 'Inject a context budget instruction into the Aider prompt.',
        acceptance_criteria: ['pnpm test passes', 'pnpm typecheck passes'],
        modules: ['src/executor.ts'],
        max_files: 1,
      },
    ],
  },
  {
    id: 'P10-2',
    theme: 'Analysis paralysis timeout',
    par: 3,
    slope: 2,
    type: 'feature',
    tickets: [
      {
        key: 'P10-2-1',
        title: 'Add early-kill timeout',
        club: 'short_iron',
        description: 'Kill Aider if no file changes within 50% of timeout.',
        acceptance_criteria: ['pnpm test passes'],
        modules: ['src/executor.ts'],
        max_files: 1,
      },
    ],
  },
  {
    id: 'P10-3',
    theme: 'Pass planner files as --file flags',
    par: 4,
    slope: 2,
    type: 'feature',
    tickets: [
      {
        key: 'P10-3-1',
        title: 'Thread planner file list',
        club: 'short_iron',
        description: 'Pass ExecutionPlan.files as Aider --file flags.',
        acceptance_criteria: ['pnpm test passes'],
        modules: ['src/executor.ts', 'src/planner.ts'],
        max_files: 2,
      },
    ],
  },
  {
    id: 'P10-4',
    theme: 'Fourth planned sprint',
    par: 4,
    slope: 2,
    type: 'feature',
    tickets: [
      {
        key: 'P10-4-1',
        title: 'Fourth ticket',
        club: 'wedge',
        description: 'Fourth planned sprint ticket.',
        acceptance_criteria: ['pnpm test passes'],
        modules: ['src/executor.ts'],
        max_files: 1,
      },
    ],
  },
];

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-analyze-'));
  mkdirSync(join(tmpDir, 'slope-loop/results'), { recursive: true });
  // Create module files that tickets reference
  mkdirSync(join(tmpDir, 'src'), { recursive: true });
  writeFileSync(join(tmpDir, 'src/executor.ts'), '// dummy');
  writeFileSync(join(tmpDir, 'src/planner.ts'), '// dummy');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('convertPlannedSprints', () => {
  it('converts planned sprints to BacklogSprint format with S-LOCAL-NNN IDs', () => {
    const { sprints } = convertPlannedSprints(VALID_PLANNED.slice(0, 1), 59, tmpDir);

    expect(sprints).toHaveLength(1);
    expect(sprints[0].id).toBe('S-LOCAL-059');
    expect(sprints[0].title).toBe('Context budget per ticket');
    expect(sprints[0].strategy).toBe('roadmap');
    expect(sprints[0].par).toBe(3);
    expect(sprints[0].slope).toBe(2);
    expect(sprints[0].type).toBe('feature');
  });

  it('remaps ticket keys to {sprintId}-{N} format', () => {
    const { sprints } = convertPlannedSprints(VALID_PLANNED.slice(0, 1), 59, tmpDir);

    expect(sprints[0].tickets).toHaveLength(1);
    expect(sprints[0].tickets[0].key).toBe('S-LOCAL-059-1');
    expect(sprints[0].tickets[0].title).toBe('Add token budget instruction');
    expect(sprints[0].tickets[0].club).toBe('short_iron');
  });

  it('caps at 3 sprints per cycle', () => {
    const { sprints } = convertPlannedSprints(VALID_PLANNED, 59, tmpDir);

    expect(sprints).toHaveLength(3);
    expect(sprints[0].id).toBe('S-LOCAL-059');
    expect(sprints[1].id).toBe('S-LOCAL-060');
    expect(sprints[2].id).toBe('S-LOCAL-061');
  });

  it('advances counter correctly', () => {
    const { counter } = convertPlannedSprints(VALID_PLANNED, 59, tmpDir);

    // 3 sprints consumed (capped), counter advanced for each
    expect(counter).toBe(62);
  });

  it('skips already-completed sprints (result file exists)', () => {
    // Mark S-LOCAL-059 as completed
    writeFileSync(join(tmpDir, 'slope-loop/results/S-LOCAL-059.json'), '{}');

    const { sprints, counter } = convertPlannedSprints(VALID_PLANNED, 59, tmpDir);

    // First planned sprint skipped (counter 59 → result file exists)
    // Next 3 uncompleted sprints fill the cap
    expect(sprints).toHaveLength(3);
    expect(sprints[0].id).toBe('S-LOCAL-060');
    expect(sprints[1].id).toBe('S-LOCAL-061');
    expect(sprints[2].id).toBe('S-LOCAL-062');
    expect(counter).toBe(63);
  });

  it('filters module paths by existence on disk', () => {
    const planned: PlannedSprint[] = [{
      id: 'P1',
      theme: 'Test modules',
      par: 3,
      slope: 1,
      type: 'feature',
      tickets: [{
        key: 'P1-1',
        title: 'Test',
        club: 'wedge',
        description: 'Test',
        acceptance_criteria: ['pass'],
        modules: ['src/executor.ts', 'src/nonexistent.ts'],
        max_files: 2,
      }],
    }];

    const { sprints } = convertPlannedSprints(planned, 1, tmpDir);

    // src/nonexistent.ts doesn't exist, should be filtered out
    expect(sprints[0].tickets[0].modules).toEqual(['src/executor.ts']);
  });

  it('skips tickets with empty acceptance_criteria', () => {
    const planned: PlannedSprint[] = [{
      id: 'P1',
      theme: 'Mixed tickets',
      par: 3,
      slope: 1,
      type: 'feature',
      tickets: [
        {
          key: 'P1-1',
          title: 'No criteria',
          club: 'wedge',
          description: 'Missing criteria',
          acceptance_criteria: [],
          modules: ['src/executor.ts'],
          max_files: 1,
        },
        {
          key: 'P1-2',
          title: 'Has criteria',
          club: 'wedge',
          description: 'Good ticket',
          acceptance_criteria: ['pnpm test passes'],
          modules: ['src/executor.ts'],
          max_files: 1,
        },
      ],
    }];

    const { sprints } = convertPlannedSprints(planned, 1, tmpDir);

    expect(sprints[0].tickets).toHaveLength(1);
    expect(sprints[0].tickets[0].title).toBe('Has criteria');
    // Key should be -1 since it's the first valid ticket after filtering
    expect(sprints[0].tickets[0].key).toBe('S-LOCAL-001-1');
  });

  it('skips malformed sprints (missing tickets array)', () => {
    const malformed = [
      { id: 'P1', theme: 'No tickets', par: 3, slope: 1, type: 'feature' } as unknown as PlannedSprint,
      VALID_PLANNED[0],
    ];

    const { sprints } = convertPlannedSprints(malformed, 1, tmpDir);

    expect(sprints).toHaveLength(1);
    expect(sprints[0].title).toBe('Context budget per ticket');
  });

  it('skips malformed sprints (empty tickets array)', () => {
    const planned: PlannedSprint[] = [
      { id: 'P1', theme: 'Empty', par: 3, slope: 1, type: 'feature', tickets: [] },
      VALID_PLANNED[0],
    ];

    const { sprints } = convertPlannedSprints(planned, 1, tmpDir);

    expect(sprints).toHaveLength(1);
    expect(sprints[0].title).toBe('Context budget per ticket');
  });

  it('returns 0 sprints for empty planned array', () => {
    const { sprints, counter } = convertPlannedSprints([], 59, tmpDir);

    expect(sprints).toHaveLength(0);
    expect(counter).toBe(59);
  });

  it('returns 0 sprints when all planned sprints are completed', () => {
    // Mark all 4 counter positions as completed
    for (let i = 59; i <= 62; i++) {
      writeFileSync(
        join(tmpDir, `slope-loop/results/S-LOCAL-${String(i).padStart(3, '0')}.json`),
        '{}',
      );
    }

    const { sprints } = convertPlannedSprints(VALID_PLANNED, 59, tmpDir);

    expect(sprints).toHaveLength(0);
  });

  it('handles mixed strategies — valid sprints interspersed with malformed', () => {
    const mixed: PlannedSprint[] = [
      { id: 'P1', theme: 'Bad', par: 3, slope: 1, type: 'feature', tickets: [] },
      VALID_PLANNED[0],
      { id: 'P3', theme: 'Also bad', par: 3, slope: 1, type: 'chore' } as unknown as PlannedSprint,
      VALID_PLANNED[1],
    ];

    const { sprints } = convertPlannedSprints(mixed, 1, tmpDir);

    expect(sprints).toHaveLength(2);
    expect(sprints[0].title).toBe('Context budget per ticket');
    expect(sprints[1].title).toBe('Analysis paralysis timeout');
  });

  it('missing results directory does not crash', () => {
    // Use a path with no results dir
    const noResultsDir = mkdtempSync(join(tmpdir(), 'slope-no-results-'));
    mkdirSync(join(noResultsDir, 'src'), { recursive: true });
    writeFileSync(join(noResultsDir, 'src/executor.ts'), '// dummy');

    const { sprints } = convertPlannedSprints(VALID_PLANNED.slice(0, 1), 1, noResultsDir);

    expect(sprints).toHaveLength(1);
    rmSync(noResultsDir, { recursive: true, force: true });
  });
});
