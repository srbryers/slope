import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildScorecard } from '../../src/core/builder.js';
import type { ShotRecord, GolfScorecard } from '../../src/core/types.js';
import type { FindingsFile } from '../../src/cli/commands/review-state.js';

let tmpDir: string;
let origCwd: typeof process.cwd;
let origExit: typeof process.exit;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-review-amend-'));
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

function makeShot(overrides: Partial<ShotRecord> = {}): ShotRecord {
  return {
    ticket_key: 'S33-1',
    title: 'Test ticket',
    club: 'short_iron',
    result: 'in_the_hole',
    hazards: [],
    ...overrides,
  };
}

function setupScorecardAndFindings(sprintNumber: number, findings: FindingsFile['findings']): void {
  // Create config
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  writeFileSync(join(tmpDir, '.slope/config.json'), JSON.stringify({ scorecardDir: 'docs/retros' }));

  // Create scorecard
  const retrosDir = join(tmpDir, 'docs', 'retros');
  mkdirSync(retrosDir, { recursive: true });
  const scorecard = buildScorecard({
    sprint_number: sprintNumber,
    theme: 'Test Sprint',
    par: 4,
    slope: 2,
    date: '2026-02-26',
    shots: [
      makeShot({ ticket_key: `S${sprintNumber}-1`, title: 'Ticket 1' }),
      makeShot({ ticket_key: `S${sprintNumber}-2`, title: 'Ticket 2' }),
      makeShot({ ticket_key: `S${sprintNumber}-3`, title: 'Ticket 3' }),
      makeShot({ ticket_key: `S${sprintNumber}-4`, title: 'Ticket 4' }),
    ],
  });
  writeFileSync(join(retrosDir, `sprint-${sprintNumber}.json`), JSON.stringify(scorecard, null, 2));

  // Create findings
  const findingsData: FindingsFile = { sprint_number: sprintNumber, findings };
  writeFileSync(join(tmpDir, '.slope/review-findings.json'), JSON.stringify(findingsData));
}

describe('review amend', () => {
  it('amends scorecard and recalculates score', async () => {
    setupScorecardAndFindings(33, [
      { review_type: 'architect', ticket_key: 'S33-1', severity: 'moderate', description: 'Malformed JSONL crash', resolved: true },
      { review_type: 'architect', ticket_key: 'S33-1', severity: 'minor', description: 'Sort instability', resolved: true },
    ]);

    const spy = vi.spyOn(console, 'log');
    await runCommand(['amend', '--sprint=33']);
    const logged = spy.mock.calls.map(c => c[0]).join('\n');
    spy.mockRestore();

    expect(logged).toContain('Amending Sprint 33');
    expect(logged).toContain('Score:');
    expect(logged).toContain('Scorecard updated');

    // Verify scorecard was written
    const scorecardPath = join(tmpDir, 'docs/retros/sprint-33.json');
    const amended = JSON.parse(readFileSync(scorecardPath, 'utf8')) as GolfScorecard;
    // 4 shots + 0.5 (moderate) + 0 (minor) = 4.5 → 5
    expect(amended.score).toBe(5);
    expect(amended.score_label).toBe('bogey');
    expect(amended.shots[0].hazards.length).toBeGreaterThan(0);
  });

  it('shows no-op message when no findings exist', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/config.json'), JSON.stringify({ scorecardDir: 'docs/retros' }));
    mkdirSync(join(tmpDir, 'docs/retros'), { recursive: true });
    const scorecard = buildScorecard({
      sprint_number: 33, theme: 'Test', par: 4, slope: 2, date: '2026-02-26',
      shots: [makeShot()],
    });
    writeFileSync(join(tmpDir, 'docs/retros/sprint-33.json'), JSON.stringify(scorecard));

    const spy = vi.spyOn(console, 'log');
    await runCommand(['amend', '--sprint=33']);
    const logged = spy.mock.calls.map(c => c[0]).join('\n');
    spy.mockRestore();

    expect(logged).toContain('No review findings to amend');
  });

  it('GH #292: errors clearly when scorecard has no shots array (sub-sprint parent stub)', async () => {
    // Repro: parent scorecard sprint-180.json with no `shots` field.
    // Was crashing as "Cannot read properties of undefined (reading 'map')".
    // Should now exit cleanly with actionable error.
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/config.json'), JSON.stringify({ scorecardDir: 'docs/retros' }));
    mkdirSync(join(tmpDir, 'docs/retros'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'docs/retros/sprint-180.json'),
      JSON.stringify({ sprint_number: 180, theme: 'Parent', par: 5, slope: 2, date: '2026-04-30' }),
    );
    writeFileSync(join(tmpDir, '.slope/review-findings.json'), JSON.stringify({
      sprint_number: 180,
      findings: [{ review_type: 'architect', ticket_key: 'S180-1', severity: 'minor', description: 'test', resolved: true }],
    }));

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(runCommand(['amend', '--sprint=180'])).rejects.toThrow('process.exit(1)');
    const errored = errSpy.mock.calls.map(c => c[0]).join('\n');
    errSpy.mockRestore();

    expect(errored).toContain('no `shots` array');
    expect(errored).toContain('sub-sprint');
  });

  it('errors when scorecard not found', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/config.json'), JSON.stringify({ scorecardDir: 'docs/retros' }));
    writeFileSync(join(tmpDir, '.slope/review-findings.json'), JSON.stringify({
      sprint_number: 99,
      findings: [{ review_type: 'architect', ticket_key: 'S99-1', severity: 'minor', description: 'test', resolved: true }],
    }));

    await expect(runCommand(['amend', '--sprint=99']))
      .rejects.toThrow('process.exit(1)');
  });

  it('clears findings file after successful amend', async () => {
    setupScorecardAndFindings(33, [
      { review_type: 'architect', ticket_key: 'S33-1', severity: 'moderate', description: 'Test issue', resolved: true },
    ]);

    await runCommand(['amend', '--sprint=33']);

    // Findings file should be cleared
    expect(existsSync(join(tmpDir, '.slope/review-findings.json'))).toBe(false);

    // Score should be 5 (not double-counted on re-amend)
    const scorecardPath = join(tmpDir, 'docs/retros/sprint-33.json');
    const amended = JSON.parse(readFileSync(scorecardPath, 'utf8')) as GolfScorecard;
    expect(amended.score).toBe(5);
  });

  it('second amend after clear shows no findings message', async () => {
    setupScorecardAndFindings(33, [
      { review_type: 'architect', ticket_key: 'S33-1', severity: 'moderate', description: 'Test issue', resolved: true },
    ]);

    await runCommand(['amend', '--sprint=33']);

    // Run amend again — findings were cleared
    const spy = vi.spyOn(console, 'log');
    await runCommand(['amend', '--sprint=33']);
    const logged = spy.mock.calls.map(c => c[0]).join('\n');
    spy.mockRestore();

    expect(logged).toContain('No review findings to amend');
  });

  it('models Sprint 33 scenario: par → bogey with 5 findings', async () => {
    setupScorecardAndFindings(33, [
      { review_type: 'architect', ticket_key: 'S33-1', severity: 'moderate', description: 'Malformed JSONL crash', resolved: true },
      { review_type: 'architect', ticket_key: 'S33-1', severity: 'minor', description: 'Sort instability', resolved: true },
      { review_type: 'ml-engineer', ticket_key: 'S33-3', severity: 'moderate', description: 'Stats underutilizes schema', resolved: true },
      { review_type: 'ml-engineer', ticket_key: 'S33-3', severity: 'minor', description: 'Missing per-tool breakdown', resolved: true },
      { review_type: 'ml-engineer', ticket_key: 'S33-2', severity: 'minor', description: 'Token data notice missing', resolved: true },
    ]);

    await runCommand(['amend', '--sprint=33']);

    const scorecardPath = join(tmpDir, 'docs/retros/sprint-33.json');
    const amended = JSON.parse(readFileSync(scorecardPath, 'utf8')) as GolfScorecard;
    // 4 shots + 0.5 + 0 + 0.5 + 0 + 0 = 5
    expect(amended.score).toBe(5);
    expect(amended.score_label).toBe('bogey');
  });
});
