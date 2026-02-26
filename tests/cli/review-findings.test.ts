import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadFindings } from '../../src/cli/commands/review-state.js';
import type { FindingsFile } from '../../src/cli/commands/review-state.js';

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

// --- loadFindings ---

describe('loadFindings', () => {
  it('returns null when no findings file', () => {
    expect(loadFindings(tmpDir)).toBeNull();
  });

  it('loads valid findings', () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    const data: FindingsFile = {
      sprint_number: 33,
      findings: [{
        review_type: 'architect',
        ticket_key: 'S33-1',
        severity: 'moderate',
        description: 'Test finding',
        resolved: true,
      }],
    };
    writeFileSync(join(tmpDir, '.slope/review-findings.json'), JSON.stringify(data));
    const loaded = loadFindings(tmpDir);
    expect(loaded).toEqual(data);
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
  });

  it('outputs no recommendations when no plan', async () => {
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
    expect(data!.sprint_number).toBe(33);
    expect(data!.findings).toHaveLength(1);
    expect(data!.findings[0].review_type).toBe('architect');
    expect(data!.findings[0].ticket_key).toBe('S33-1');
    expect(data!.findings[0].severity).toBe('moderate');
    expect(data!.findings[0].description).toBe('Malformed JSONL crash');
    expect(data!.findings[0].resolved).toBe(false);
  });

  it('appends to existing findings', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    const existing: FindingsFile = {
      sprint_number: 33,
      findings: [{
        review_type: 'architect',
        ticket_key: 'S33-1',
        severity: 'moderate',
        description: 'First finding',
        resolved: true,
      }],
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
    expect(data!.findings).toHaveLength(2);
    expect(data!.findings[1].review_type).toBe('code');
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
    expect(data!.findings[0].severity).toBe('moderate');
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
    expect(data!.findings[0].resolved).toBe(true);
  });

  it('errors when adding findings for different sprint than existing', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    const existing: FindingsFile = {
      sprint_number: 33,
      findings: [{
        review_type: 'architect',
        ticket_key: 'S33-1',
        severity: 'moderate',
        description: 'Existing finding',
        resolved: true,
      }],
    };
    writeFileSync(join(tmpDir, '.slope/review-findings.json'), JSON.stringify(existing));

    await expect(runCommand([
      'findings', 'add',
      '--type=code',
      '--ticket=S34-1',
      '--description=New finding',
      '--sprint=34',
    ])).rejects.toThrow('process.exit(1)');

    // Verify original data is preserved
    const data = loadFindings(tmpDir);
    expect(data!.sprint_number).toBe(33);
    expect(data!.findings).toHaveLength(1);
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
      sprint_number: 33,
      findings: [
        { review_type: 'architect', ticket_key: 'S33-1', severity: 'moderate', description: 'Malformed JSONL crash', resolved: true },
        { review_type: 'ml-engineer', ticket_key: 'S33-3', severity: 'moderate', description: 'Stats underutilizes schema', resolved: true },
      ],
    };
    writeFileSync(join(tmpDir, '.slope/review-findings.json'), JSON.stringify(data));

    const spy = vi.spyOn(console, 'log');
    await runCommand(['findings', 'list']);
    const logged = spy.mock.calls.map(c => c[0]).join('\n');
    spy.mockRestore();

    expect(logged).toContain('Sprint 33');
    expect(logged).toContain('2 total');
    expect(logged).toContain('S33-1');
    expect(logged).toContain('architect');
    expect(logged).toContain('Malformed JSONL crash');
    expect(logged).toContain('S33-3');
    expect(logged).toContain('ml-engineer');
  });

  it('filters by sprint number', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    const data: FindingsFile = {
      sprint_number: 33,
      findings: [
        { review_type: 'architect', ticket_key: 'S33-1', severity: 'moderate', description: 'test', resolved: true },
      ],
    };
    writeFileSync(join(tmpDir, '.slope/review-findings.json'), JSON.stringify(data));

    const spy = vi.spyOn(console, 'log');
    await runCommand(['findings', 'list', '--sprint=99']);
    const logged = spy.mock.calls.map(c => c[0]).join('\n');
    spy.mockRestore();

    expect(logged).toContain('No findings for Sprint 99');
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
