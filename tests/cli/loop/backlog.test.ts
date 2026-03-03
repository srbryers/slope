import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadBacklog,
  selectNextSprint,
  selectSprintById,
  releaseLock,
  validateTickets,
  needsEnrichment,
  getRemainingSprintIds,
} from '../../../src/cli/loop/backlog.js';
import { DEFAULT_LOOP_CONFIG } from '../../../src/cli/loop/types.js';
import type { LoopConfig, BacklogFile } from '../../../src/cli/loop/types.js';
import { createLogger } from '../../../src/cli/loop/logger.js';

let tmpDir: string;
let config: LoopConfig;
let log: ReturnType<typeof createLogger>;

const SAMPLE_BACKLOG: BacklogFile = {
  generated_at: '2026-01-01T00:00:00Z',
  sprints: [
    {
      id: 'S-LOCAL-001',
      title: 'Test Sprint 1',
      strategy: 'hardening',
      par: 4,
      slope: 2,
      type: 'bugfix',
      tickets: [
        {
          key: 'S-LOCAL-001-1',
          title: 'Fix thing',
          club: 'wedge',
          description: 'Fix the thing',
          acceptance_criteria: ['pnpm test passes'],
          modules: ['src/core/index.ts'],
          max_files: 1,
        },
      ],
    },
    {
      id: 'S-LOCAL-002',
      title: 'Test Sprint 2',
      strategy: 'testing',
      par: 4,
      slope: 1,
      type: 'feature',
      tickets: [
        {
          key: 'S-LOCAL-002-1',
          title: 'Add tests',
          club: 'short_iron',
          description: 'Add tests',
          acceptance_criteria: ['pnpm test passes'],
          modules: ['src/nonexistent.ts'],
          max_files: 1,
        },
      ],
    },
  ],
};

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-loop-backlog-'));
  mkdirSync(join(tmpDir, 'slope-loop'), { recursive: true });
  mkdirSync(join(tmpDir, 'slope-loop/results'), { recursive: true });
  // Create a dummy module file for ticket validation
  mkdirSync(join(tmpDir, 'src/core'), { recursive: true });
  writeFileSync(join(tmpDir, 'src/core/index.ts'), '// dummy');

  config = {
    ...DEFAULT_LOOP_CONFIG,
    backlogPath: 'slope-loop/backlog.json',
    resultsDir: 'slope-loop/results',
  };
  log = createLogger('test');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadBacklog', () => {
  it('loads and parses backlog.json', () => {
    writeFileSync(join(tmpDir, 'slope-loop/backlog.json'), JSON.stringify(SAMPLE_BACKLOG));
    const backlog = loadBacklog(tmpDir, config);
    expect(backlog.sprints).toHaveLength(2);
    expect(backlog.sprints[0].id).toBe('S-LOCAL-001');
  });

  it('throws if backlog.json does not exist', () => {
    expect(() => loadBacklog(tmpDir, config)).toThrow('Backlog not found');
  });
});

describe('selectNextSprint', () => {
  it('selects the first sprint without a result file', () => {
    writeFileSync(join(tmpDir, 'slope-loop/backlog.json'), JSON.stringify(SAMPLE_BACKLOG));
    const backlog = loadBacklog(tmpDir, config);
    const sprint = selectNextSprint(backlog, tmpDir, config);
    expect(sprint).not.toBeNull();
    expect(sprint!.id).toBe('S-LOCAL-001');
    // Lock directory should exist
    expect(existsSync(join(tmpDir, 'slope-loop/results/S-LOCAL-001.lock'))).toBe(true);
  });

  it('skips sprints that already have result files', () => {
    writeFileSync(join(tmpDir, 'slope-loop/backlog.json'), JSON.stringify(SAMPLE_BACKLOG));
    writeFileSync(join(tmpDir, 'slope-loop/results/S-LOCAL-001.json'), '{}');
    const backlog = loadBacklog(tmpDir, config);
    const sprint = selectNextSprint(backlog, tmpDir, config);
    expect(sprint!.id).toBe('S-LOCAL-002');
  });

  it('skips sprints that are already locked', () => {
    writeFileSync(join(tmpDir, 'slope-loop/backlog.json'), JSON.stringify(SAMPLE_BACKLOG));
    mkdirSync(join(tmpDir, 'slope-loop/results/S-LOCAL-001.lock'));
    const backlog = loadBacklog(tmpDir, config);
    const sprint = selectNextSprint(backlog, tmpDir, config);
    expect(sprint!.id).toBe('S-LOCAL-002');
  });

  it('returns null when all sprints are completed', () => {
    writeFileSync(join(tmpDir, 'slope-loop/backlog.json'), JSON.stringify(SAMPLE_BACKLOG));
    writeFileSync(join(tmpDir, 'slope-loop/results/S-LOCAL-001.json'), '{}');
    writeFileSync(join(tmpDir, 'slope-loop/results/S-LOCAL-002.json'), '{}');
    const backlog = loadBacklog(tmpDir, config);
    const sprint = selectNextSprint(backlog, tmpDir, config);
    expect(sprint).toBeNull();
  });
});

describe('selectSprintById', () => {
  it('finds sprint by ID', () => {
    const sprint = selectSprintById(SAMPLE_BACKLOG, 'S-LOCAL-002');
    expect(sprint).not.toBeNull();
    expect(sprint!.title).toBe('Test Sprint 2');
  });

  it('returns null for unknown ID', () => {
    const sprint = selectSprintById(SAMPLE_BACKLOG, 'NONEXISTENT');
    expect(sprint).toBeNull();
  });
});

describe('releaseLock', () => {
  it('removes the lock directory', () => {
    const lockDir = join(tmpDir, 'slope-loop/results/S-LOCAL-001.lock');
    mkdirSync(lockDir);
    expect(existsSync(lockDir)).toBe(true);
    releaseLock(tmpDir, config, 'S-LOCAL-001');
    expect(existsSync(lockDir)).toBe(false);
  });

  it('does not throw if lock does not exist', () => {
    expect(() => releaseLock(tmpDir, config, 'NONEXISTENT')).not.toThrow();
  });
});

describe('validateTickets', () => {
  it('accepts tickets with existing module files', () => {
    const valid = validateTickets(SAMPLE_BACKLOG.sprints[0].tickets, tmpDir, log);
    expect(valid).toHaveLength(1);
    expect(valid[0].key).toBe('S-LOCAL-001-1');
  });

  it('rejects tickets with nonexistent module files', () => {
    const valid = validateTickets(SAMPLE_BACKLOG.sprints[1].tickets, tmpDir, log);
    expect(valid).toHaveLength(0);
  });

  it('rejects tickets with empty modules array', () => {
    const tickets = [{ ...SAMPLE_BACKLOG.sprints[0].tickets[0], modules: [] }];
    const valid = validateTickets(tickets, tmpDir, log);
    expect(valid).toHaveLength(0);
  });
});

describe('needsEnrichment', () => {
  it('returns true when no enrichment metadata', () => {
    expect(needsEnrichment(SAMPLE_BACKLOG)).toBe(true);
  });

  it('returns true when version < 1', () => {
    expect(needsEnrichment({ ...SAMPLE_BACKLOG, _enrichMeta: { version: 0 } })).toBe(true);
  });

  it('returns false when version >= 1', () => {
    expect(needsEnrichment({ ...SAMPLE_BACKLOG, _enrichMeta: { version: 1 } })).toBe(false);
  });
});

describe('getRemainingSprintIds', () => {
  it('returns all sprint IDs when none have results', () => {
    const remaining = getRemainingSprintIds(SAMPLE_BACKLOG, tmpDir, config);
    expect(remaining).toEqual(['S-LOCAL-001', 'S-LOCAL-002']);
  });

  it('excludes sprints with result files', () => {
    writeFileSync(join(tmpDir, 'slope-loop/results/S-LOCAL-001.json'), '{}');
    const remaining = getRemainingSprintIds(SAMPLE_BACKLOG, tmpDir, config);
    expect(remaining).toEqual(['S-LOCAL-002']);
  });

  it('returns empty array when all complete', () => {
    writeFileSync(join(tmpDir, 'slope-loop/results/S-LOCAL-001.json'), '{}');
    writeFileSync(join(tmpDir, 'slope-loop/results/S-LOCAL-002.json'), '{}');
    const remaining = getRemainingSprintIds(SAMPLE_BACKLOG, tmpDir, config);
    expect(remaining).toEqual([]);
  });
});
