import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadInitiative, saveInitiative } from '../../src/core/initiative.js';

let tmpDir: string;
let originalCwd: string;

let consoleOutput: string[];
let consoleErrors: string[];

const SAMPLE_ROADMAP = {
  name: 'Test Initiative',
  description: 'Test',
  phases: [{ name: 'Phase 1', sprints: [1, 2] }],
  sprints: [
    {
      id: 1, theme: 'Sprint One', par: 4, slope: 2, type: 'feature',
      tickets: [
        { key: 'S1-1', title: 'Add store API endpoint', club: 'short_iron', complexity: 'standard' },
        { key: 'S1-2', title: 'CLI command handler', club: 'wedge', complexity: 'small' },
      ],
    },
    {
      id: 2, theme: 'Sprint Two', par: 4, slope: 2, type: 'feature',
      depends_on: [1],
      tickets: [
        { key: 'S2-1', title: 'Dashboard rendering', club: 'short_iron', complexity: 'standard' },
      ],
    },
  ],
};

function setupTmpDir(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-initiative-test-'));
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  mkdirSync(join(tmpDir, 'docs', 'backlog'), { recursive: true });
  writeFileSync(
    join(tmpDir, 'docs', 'backlog', 'roadmap.json'),
    JSON.stringify(SAMPLE_ROADMAP, null, 2),
  );
  // Minimal slope config
  writeFileSync(
    join(tmpDir, '.slope', 'config.json'),
    JSON.stringify({ retrosPath: 'docs/retros', roadmapPath: 'docs/backlog/roadmap.json' }),
  );
  originalCwd = process.cwd();
  process.chdir(tmpDir);
}

function cleanupTmpDir(): void {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
}

beforeEach(() => {
  setupTmpDir();
  consoleOutput = [];
  consoleErrors = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    consoleOutput.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(' '));
  });
  vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit called');
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanupTmpDir();
});

// Dynamic import to get fresh module per test
async function runInitiativeCommand(args: string[]): Promise<void> {
  const { initiativeCommand } = await import('../../src/cli/commands/initiative.js');
  return initiativeCommand(args);
}

describe('slope initiative create', () => {
  it('creates an initiative from roadmap', async () => {
    await runInitiativeCommand(['create', '--name=Test', '--roadmap=docs/backlog/roadmap.json']);
    const output = consoleOutput.join('\n');
    expect(output).toContain('Initiative created: Test');
    expect(output).toContain('Sprints: 2');

    const initiative = loadInitiative(tmpDir);
    expect(initiative).not.toBeNull();
    expect(initiative!.sprints).toHaveLength(2);
  });

  it('shows error for missing name', async () => {
    await expect(runInitiativeCommand(['create', '--roadmap=docs/backlog/roadmap.json']))
      .rejects.toThrow('process.exit');
    expect(consoleErrors.join('\n')).toContain('Usage');
  });

  it('shows error for missing roadmap', async () => {
    await expect(runInitiativeCommand(['create', '--name=Test']))
      .rejects.toThrow('process.exit');
  });

  it('shows error for invalid roadmap path', async () => {
    await expect(runInitiativeCommand(['create', '--name=Test', '--roadmap=nonexistent.json']))
      .rejects.toThrow('process.exit');
    expect(consoleErrors.join('\n')).toContain('Cannot read roadmap');
  });
});

describe('slope initiative status', () => {
  it('shows status table', async () => {
    await runInitiativeCommand(['create', '--name=Test', '--roadmap=docs/backlog/roadmap.json']);
    consoleOutput = [];
    await runInitiativeCommand(['status']);
    const output = consoleOutput.join('\n');
    expect(output).toContain('Test');
    expect(output).toContain('S1');
    expect(output).toContain('pending');
  });

  it('shows error when no initiative exists', async () => {
    await expect(runInitiativeCommand(['status'])).rejects.toThrow('process.exit');
    expect(consoleErrors.join('\n')).toContain('No initiative found');
  });
});

describe('slope initiative next', () => {
  it('shows next sprint info', async () => {
    await runInitiativeCommand(['create', '--name=Test', '--roadmap=docs/backlog/roadmap.json']);
    consoleOutput = [];
    await runInitiativeCommand(['next']);
    const output = consoleOutput.join('\n');
    expect(output).toContain('Sprint 1');
    expect(output).toContain('pending');
  });

  it('shows all complete when done', async () => {
    await runInitiativeCommand(['create', '--name=Test', '--roadmap=docs/backlog/roadmap.json']);
    // Mark all sprints complete
    const initiative = loadInitiative(tmpDir)!;
    for (const s of initiative.sprints) s.phase = 'complete';
    saveInitiative(tmpDir, initiative);

    consoleOutput = [];
    await runInitiativeCommand(['next']);
    expect(consoleOutput.join('\n')).toContain('All sprints complete');
  });
});

describe('slope initiative advance', () => {
  it('advances sprint phase', async () => {
    await runInitiativeCommand(['create', '--name=Test', '--roadmap=docs/backlog/roadmap.json']);
    consoleOutput = [];
    await runInitiativeCommand(['advance', '--sprint=1']);
    const output = consoleOutput.join('\n');
    expect(output).toContain('pending');
    expect(output).toContain('planning');
  });

  it('shows error for missing sprint flag', async () => {
    await expect(runInitiativeCommand(['advance'])).rejects.toThrow('process.exit');
    expect(consoleErrors.join('\n')).toContain('Usage');
  });

  it('shows error when advancement blocked', async () => {
    await runInitiativeCommand(['create', '--name=Test', '--roadmap=docs/backlog/roadmap.json']);
    await runInitiativeCommand(['advance', '--sprint=1']); // pending → planning
    await runInitiativeCommand(['advance', '--sprint=1']); // planning → plan_review

    // Try to advance past plan_review without completing reviews
    await expect(runInitiativeCommand(['advance', '--sprint=1'])).rejects.toThrow('process.exit');
    expect(consoleErrors.join('\n')).toContain('not complete');
  });
});

describe('slope initiative review', () => {
  it('records a review', async () => {
    await runInitiativeCommand(['create', '--name=Test', '--roadmap=docs/backlog/roadmap.json']);
    await runInitiativeCommand(['advance', '--sprint=1']); // pending → planning
    await runInitiativeCommand(['advance', '--sprint=1']); // planning → plan_review

    consoleOutput = [];
    await runInitiativeCommand(['review', '--sprint=1', '--gate=plan', '--reviewer=architect', '--findings=2']);
    expect(consoleOutput.join('\n')).toContain('Recorded plan review: architect');

    const initiative = loadInitiative(tmpDir)!;
    const sprint = initiative.sprints.find(s => s.sprint_number === 1)!;
    const arch = sprint.plan_reviews.find(r => r.reviewer === 'architect')!;
    expect(arch.completed).toBe(true);
    expect(arch.findings_count).toBe(2);
  });

  it('shows error for missing flags', async () => {
    await expect(runInitiativeCommand(['review', '--sprint=1'])).rejects.toThrow('process.exit');
    expect(consoleErrors.join('\n')).toContain('Usage');
  });

  it('shows error for invalid gate', async () => {
    await expect(runInitiativeCommand(['review', '--sprint=1', '--gate=invalid', '--reviewer=architect']))
      .rejects.toThrow('process.exit');
    expect(consoleErrors.join('\n')).toContain('Invalid gate');
  });
});

describe('slope initiative (no subcommand)', () => {
  it('shows usage text', async () => {
    await runInitiativeCommand([]);
    const output = consoleOutput.join('\n');
    expect(output).toContain('slope initiative');
    expect(output).toContain('create');
    expect(output).toContain('status');
    expect(output).toContain('advance');
  });
});
