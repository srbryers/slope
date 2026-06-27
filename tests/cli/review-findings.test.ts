import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadFindings } from '../../src/cli/commands/review-state.js';
import type { FindingsFile } from '../../src/cli/commands/review-state.js';
import { createSprintState, saveSprintState } from '../../src/cli/sprint-state.js';

let tmpDir: string;
let origCwd: typeof process.cwd;
let origExit: typeof process.exit;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-review-findings-'));
  origCwd = process.cwd;
  process.cwd = () => tmpDir;
  origExit = process.exit;
  process.exit = ((code: number) => { throw new Error(`process.exit(${code})`); }) as never;
});

afterEach(() => {
  process.cwd = origCwd;
  process.exit = origExit;
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
});

async function runCommand(args: string[]) {
  const { reviewStateCommand } = await import('../../src/cli/commands/review-state.js');
  return reviewStateCommand(args);
}

function writeRoadmap(sprints: Array<{ id: number; slope: number; tickets: string[] }>): void {
  const dir = join(tmpDir, 'docs', 'backlog');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'roadmap.json'), JSON.stringify({
    name: 'Test Roadmap',
    phases: [],
    sprints: sprints.map(sprint => ({
      id: sprint.id,
      theme: `Sprint ${sprint.id}`,
      par: 4,
      slope: sprint.slope,
      type: 'bug fix',
      status: 'planned',
      tickets: sprint.tickets.map((title, index) => ({
        key: `S${sprint.id}-${index + 1}`,
        title,
        club: 'wedge',
        complexity: 'small',
      })),
    })),
  }, null, 2));
}

// --- loadFindings ---

describe('loadFindings', () => {
  it('returns null when no findings file', () => {
    expect(loadFindings(tmpDir)).toBeNull();
  });

  it('loads valid findings', () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    const data: FindingsFile = {
      sprints: {
        33: [{
          review_type: 'architect',
          ticket_key: 'S33-1',
          severity: 'moderate',
          description: 'Test finding',
          resolved: true,
        }],
      },
    };
    writeFileSync(join(tmpDir, '.slope/review-findings.json'), JSON.stringify(data));
    const loaded = loadFindings(tmpDir);
    expect(loaded).toEqual(data);
  });

  it('migrates legacy single-sprint format', () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    const legacy = {
      sprint_number: 33,
      findings: [{
        review_type: 'architect',
        ticket_key: 'S33-1',
        severity: 'moderate',
        description: 'Legacy finding',
        resolved: true,
      }],
    };
    writeFileSync(join(tmpDir, '.slope/review-findings.json'), JSON.stringify(legacy));
    const loaded = loadFindings(tmpDir);
    expect(loaded).toEqual({ sprints: { 33: legacy.findings } });
  });

  it('returns null for malformed JSON', () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/review-findings.json'), 'bad json');
    expect(loadFindings(tmpDir)).toBeNull();
  });
});

// --- recommend ---

describe('review recommend', () => {
  it('outputs recommendations from plan file', async () => {
    const plansDir = join(tmpDir, '.claude', 'plans');
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(plansDir, 'sprint-34.md'), [
      '# Sprint 34 — The Scoring Committee',
      '**Slope:** 2',
      '### S34-1: Types',
      '`src/core/review.ts`',
      '### S34-2: CLI',
      '`src/cli/commands/review-state.ts`',
      '### S34-3: Amend',
      '`src/core/review.ts`',
      '### S34-4: Guard',
      '`src/cli/guards/next-action.ts`',
    ].join('\n'));

    const spy = vi.spyOn(console, 'log');
    await runCommand(['recommend']);
    const logged = spy.mock.calls.map(c => c[0]).join('\n');
    spy.mockRestore();

    expect(logged).toContain('architect');
    expect(logged).toContain('required');
    expect(logged).toContain('code');
    expect(logged).toContain('optional');
    expect(logged).toContain('Purpose-built reviewer agents');
    expect(logged).toContain('Gate evidence must include: agent id/name, lane, verdict');
    expect(logged).toContain('slope sprint gate architect_review --reviewer=');
  });

  it('counts tickets from slope sprint plan table output', async () => {
    const plansDir = join(tmpDir, '.claude', 'plans');
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(plansDir, 'sprint-97.md'), [
      '# Sprint 97 Plan — Review Recommendation Repair',
      '',
      '**Par:** 3  |  **Slope:** 2  |  **Type:** bug fix',
      '',
      '## Tickets',
      '',
      '| Key | Title | Club | Complexity | Depends on |',
      '|---|---|---|---|---|',
      '| S97-1 | Teach plan-analysis ticket counting to read tables | wedge | small | — |',
      '| S97-2 | Add review recommend regression coverage | wedge | small | S97-1 |',
      '| S97-3 | Verify review-tier guard recommendation | wedge | small | S97-1 |',
      '| S97-4 | Update scorecard and release notes | wedge | small | S97-2 |',
    ].join('\n'));

    const spy = vi.spyOn(console, 'log');
    await runCommand(['recommend']);
    const logged = spy.mock.calls.map(c => c[0]).join('\n');
    spy.mockRestore();

    expect(logged).toContain('Recommended reviews for Sprint 97 (4 tickets, slope 2)');
    expect(logged).toContain('architect');
    expect(logged).toContain('required');
  });

  it('prefers active sprint-state over a stale plan file', async () => {
    writeRoadmap([
      { id: 74, slope: 3, tickets: ['Current source of truth', 'Guard repair', 'Regression coverage'] },
    ]);
    saveSprintState(tmpDir, createSprintState(74, 'implementing'));

    const plansDir = join(tmpDir, '.claude', 'plans');
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(plansDir, 'stale-sprint-29.md'), [
      '# Sprint 29 — Stale Global-ish Plan',
      '**Slope:** 1',
      '### S29-1: Old UI',
      '`src/ui/old.ts`',
    ].join('\n'));

    const spy = vi.spyOn(console, 'log');
    await runCommand(['recommend']);
    const logged = spy.mock.calls.map(c => c[0]).join('\n');
    spy.mockRestore();

    expect(logged).toContain('Recommended reviews for Sprint 74 (3 tickets, slope 3)');
    expect(logged).not.toContain('Sprint 29');
  });

  it('honors explicit --sprint over a stale plan file', async () => {
    writeRoadmap([
      { id: 88, slope: 2, tickets: ['Explicit review target', 'Second ticket'] },
    ]);

    const plansDir = join(tmpDir, '.claude', 'plans');
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(plansDir, 'stale-sprint-29.md'), [
      '# Sprint 29 — Stale Plan',
      '**Slope:** 5',
      '### S29-1: Old work',
    ].join('\n'));

    const spy = vi.spyOn(console, 'log');
    await runCommand(['recommend', '--sprint=88']);
    const logged = spy.mock.calls.map(c => c[0]).join('\n');
    spy.mockRestore();

    expect(logged).toContain('Recommended reviews for Sprint 88 (2 tickets, slope 2)');
    expect(logged).not.toContain('Sprint 29');
  });

  it('outputs no recommendations when no plan', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/config.json'), JSON.stringify({ scorecardDir: 'docs/retros' }));

    const spy = vi.spyOn(console, 'log');
    await runCommand(['recommend']);
    const logged = spy.mock.calls.map(c => c[0]).join('\n');
    spy.mockRestore();

    // With 0 tickets and slope 0, only code review (optional) is recommended
    expect(logged).toContain('code');
  });
});

// --- findings add ---

describe('review findings add', () => {
  it('creates findings file with first finding', async () => {
    // Create .slope/config.json so loadConfig works for sprint detection
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/config.json'), JSON.stringify({ scorecardDir: 'docs/retros' }));

    await runCommand([
      'findings', 'add',
      '--type=architect',
      '--ticket=S33-1',
      '--severity=moderate',
      '--description=Malformed JSONL crash',
      '--sprint=33',
    ]);

    const data = loadFindings(tmpDir);
    expect(data).not.toBeNull();
    expect(data!.sprints[33]).toHaveLength(1);
    expect(data!.sprints[33][0].review_type).toBe('architect');
    expect(data!.sprints[33][0].ticket_key).toBe('S33-1');
    expect(data!.sprints[33][0].severity).toBe('moderate');
    expect(data!.sprints[33][0].description).toBe('Malformed JSONL crash');
    expect(data!.sprints[33][0].resolved).toBe(false);
  });

  it('appends to existing findings', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    const existing: FindingsFile = {
      sprints: {
        33: [{
          review_type: 'architect',
          ticket_key: 'S33-1',
          severity: 'moderate',
          description: 'First finding',
          resolved: true,
        }],
      },
    };
    writeFileSync(join(tmpDir, '.slope/review-findings.json'), JSON.stringify(existing));

    await runCommand([
      'findings', 'add',
      '--type=code',
      '--ticket=S33-2',
      '--severity=minor',
      '--description=Sort instability',
      '--sprint=33',
    ]);

    const data = loadFindings(tmpDir);
    expect(data!.sprints[33]).toHaveLength(2);
    expect(data!.sprints[33][1].review_type).toBe('code');
  });

  it('defaults severity to moderate', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });

    await runCommand([
      'findings', 'add',
      '--type=architect',
      '--ticket=S33-1',
      '--description=Test',
      '--sprint=33',
    ]);

    const data = loadFindings(tmpDir);
    expect(data!.sprints[33][0].severity).toBe('moderate');
  });

  it('sets resolved when --resolved flag is present', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });

    await runCommand([
      'findings', 'add',
      '--type=architect',
      '--ticket=S33-1',
      '--description=Test',
      '--sprint=33',
      '--resolved',
    ]);

    const data = loadFindings(tmpDir);
    expect(data!.sprints[33][0].resolved).toBe(true);
  });

  it('records recurring workaround findings as open codification candidates', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });

    await runCommand([
      'findings', 'add',
      '--type=workaround',
      '--severity=major',
      '--description=Gallery server was pinned to sprint-specific path',
      '--sprint=221',
      '--recurs',
      '--cost=s',
    ]);

    const data = loadFindings(tmpDir);
    const finding = data!.sprints[221][0];
    expect(finding.id).toMatch(/[0-9a-f-]{36}/);
    expect(finding.review_type).toBe('workaround');
    expect(finding.ticket_key).toBe('workaround');
    expect(finding.recurs).toBe(true);
    expect(finding.cost).toBe('s');
    expect(finding.codification_status).toBe('open');
    expect(finding.resolved).toBe(false);
  });

  it('rejects workaround findings without recurrence metadata', async () => {
    await expect(runCommand([
      'findings', 'add',
      '--type=workaround',
      '--description=One-off manual detour',
      '--sprint=221',
    ])).rejects.toThrow('process.exit(1)');
  });

  it('requires cost for recurring codification candidates', async () => {
    await expect(runCommand([
      'findings', 'add',
      '--type=workaround',
      '--description=Recurring manual detour',
      '--sprint=221',
      '--recurs',
    ])).rejects.toThrow('process.exit(1)');
  });

  it('allows adding findings for a different sprint (multi-sprint)', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    const existing: FindingsFile = {
      sprints: {
        33: [{
          review_type: 'architect',
          ticket_key: 'S33-1',
          severity: 'moderate',
          description: 'Existing finding',
          resolved: true,
        }],
      },
    };
    writeFileSync(join(tmpDir, '.slope/review-findings.json'), JSON.stringify(existing));

    await runCommand([
      'findings', 'add',
      '--type=code',
      '--ticket=S34-1',
      '--description=New finding',
      '--sprint=34',
    ]);

    // Verify both sprints are preserved
    const data = loadFindings(tmpDir);
    expect(data!.sprints[33]).toHaveLength(1);
    expect(data!.sprints[34]).toHaveLength(1);
    expect(data!.sprints[34][0].ticket_key).toBe('S34-1');
  });

  it('errors with missing required args', async () => {
    await expect(runCommand(['findings', 'add', '--type=architect']))
      .rejects.toThrow('process.exit(1)');
  });

  it('errors with invalid review type', async () => {
    await expect(runCommand([
      'findings', 'add',
      '--type=invalid',
      '--ticket=S1-1',
      '--description=test',
    ])).rejects.toThrow('process.exit(1)');
  });

  it('errors with invalid severity', async () => {
    await expect(runCommand([
      'findings', 'add',
      '--type=architect',
      '--ticket=S1-1',
      '--severity=extreme',
      '--description=test',
    ])).rejects.toThrow('process.exit(1)');
  });
});

// --- findings list ---

describe('review findings list', () => {
  it('shows message when no findings', async () => {
    const spy = vi.spyOn(console, 'log');
    await runCommand(['findings', 'list']);
    const logged = spy.mock.calls.map(c => c[0]).join('\n');
    spy.mockRestore();

    expect(logged).toContain('No review findings recorded');
  });

  it('lists findings for current sprint', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    const data: FindingsFile = {
      sprints: {
        33: [
          { review_type: 'architect', ticket_key: 'S33-1', severity: 'moderate', description: 'Malformed JSONL crash', resolved: true },
          { review_type: 'ml-engineer', ticket_key: 'S33-3', severity: 'moderate', description: 'Stats underutilizes schema', resolved: true },
        ],
      },
    };
    writeFileSync(join(tmpDir, '.slope/review-findings.json'), JSON.stringify(data));

    const spy = vi.spyOn(console, 'log');
    await runCommand(['findings', 'list']);
    const logged = spy.mock.calls.map(c => c[0]).join('\n');
    spy.mockRestore();

    expect(logged).toContain('Sprint 33');
    expect(logged).toContain('2');
    expect(logged).toContain('S33-1');
    expect(logged).toContain('architect');
    expect(logged).toContain('Malformed JSONL crash');
    expect(logged).toContain('S33-3');
    expect(logged).toContain('ml-engineer');
  });

  it('filters by sprint number', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    const data: FindingsFile = {
      sprints: {
        33: [
          { review_type: 'architect', ticket_key: 'S33-1', severity: 'moderate', description: 'test', resolved: true },
        ],
      },
    };
    writeFileSync(join(tmpDir, '.slope/review-findings.json'), JSON.stringify(data));

    const spy = vi.spyOn(console, 'log');
    await runCommand(['findings', 'list', '--sprint=99']);
    const logged = spy.mock.calls.map(c => c[0]).join('\n');
    spy.mockRestore();

    expect(logged).toContain('No findings for Sprint 99');
  });

  it('shows codification metadata for recurring workaround findings', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    const data: FindingsFile = {
      sprints: {
        221: [
          {
            id: '12345678-1234-1234-1234-123456789abc',
            review_type: 'workaround',
            ticket_key: 'workaround',
            severity: 'major',
            description: 'Gallery server path was sprint-pinned',
            resolved: false,
            recurs: true,
            cost: 's',
            codification_status: 'open',
          },
        ],
      },
    };
    writeFileSync(join(tmpDir, '.slope/review-findings.json'), JSON.stringify(data));

    const spy = vi.spyOn(console, 'log');
    await runCommand(['findings', 'list', '--sprint=221']);
    const logged = spy.mock.calls.map(c => c[0]).join('\n');
    spy.mockRestore();

    expect(logged).toContain('12345678');
    expect(logged).toContain('workaround');
    expect(logged).toContain('codification=open cost=s');
  });
});

// --- findings clear ---

describe('review findings clear', () => {
  it('deletes findings file', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/review-findings.json'), '{}');

    await runCommand(['findings', 'clear']);

    expect(existsSync(join(tmpDir, '.slope/review-findings.json'))).toBe(false);
  });

  it('succeeds when no findings file exists', async () => {
    const spy = vi.spyOn(console, 'log');
    await runCommand(['findings', 'clear']);
    const logged = spy.mock.calls.map(c => c[0]).join('\n');
    spy.mockRestore();

    expect(logged).toContain('No findings to clear');
  });
});

// --- unknown findings subcommand ---

describe('review findings unknown', () => {
  it('errors on unknown findings subcommand', async () => {
    await expect(runCommand(['findings', 'bogus']))
      .rejects.toThrow('process.exit(1)');
  });
});
