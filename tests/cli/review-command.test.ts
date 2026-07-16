import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildScorecard } from '../../src/core/builder.js';
import { reviewCommand } from '../../src/cli/commands/review.js';
import { createSprintState, loadSprintState, saveSprintState } from '../../src/cli/sprint-state.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-review-command-'));
  vi.spyOn(process, 'cwd').mockImplementation(() => tmpDir);
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  mkdirSync(join(tmpDir, 'docs', 'retros'), { recursive: true });
  writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
    minSprint: 1,
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

describe('reviewCommand', () => {
  it('writes the canonical sprint review markdown by default', () => {
    const card = buildScorecard({
      sprint_number: 132,
      theme: 'Review materialization',
      par: 3,
      slope: 1,
      date: '2026-06-03',
      shots: [{
        ticket_key: 'S132-1',
        title: 'Generate review',
        club: 'wedge',
        result: 'in_the_hole',
        hazards: [],
      }],
    });
    const scorecardPath = join(tmpDir, 'docs', 'retros', 'sprint-132.json');
    writeFileSync(scorecardPath, JSON.stringify(card, null, 2));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    reviewCommand(scorecardPath);
    logSpy.mockRestore();

    const reviewPath = join(tmpDir, 'docs', 'retros', 'sprint-132-review.md');
    expect(existsSync(reviewPath)).toBe(true);
    expect(readFileSync(reviewPath, 'utf8')).toContain('## Sprint 132 Review: Review materialization');
  });

  it('refuses to guess a scorecard when multiple sprint artifacts exist', () => {
    for (const sprint of [109, 122]) {
      const card = buildScorecard({
        sprint_number: sprint,
        theme: `Sprint ${sprint}`,
        par: 3,
        slope: 1,
        date: '2026-07-10',
        shots: [{ ticket_key: `S${sprint}-1`, title: 'Review', club: 'wedge', result: 'green', hazards: [] }],
      });
      writeFileSync(join(tmpDir, 'docs', 'retros', `sprint-${sprint}.json`), JSON.stringify(card));
    }
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args.join(' ')); });
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as never);

    expect(() => reviewCommand()).toThrow('process.exit(1)');

    expect(errors.join('\n')).toContain('Multiple scorecards found; refusing to guess');
    expect(errors.join('\n')).toContain('slope review docs');
    expect(existsSync(join(tmpDir, 'docs', 'retros', 'sprint-122-review.md'))).toBe(false);
  });

  it('scopes explicit scorecard output and gate mutation to the selected sprint', () => {
    for (const sprint of [109, 122]) {
      const card = buildScorecard({
        sprint_number: sprint,
        theme: `Sprint ${sprint}`,
        par: 3,
        slope: 1,
        date: '2026-07-10',
        shots: [{ ticket_key: `S${sprint}-1`, title: 'Review', club: 'wedge', result: 'green', hazards: [] }],
      });
      writeFileSync(join(tmpDir, 'docs', 'retros', `sprint-${sprint}.json`), JSON.stringify(card));
    }
    const latestReviewPath = join(tmpDir, 'docs', 'retros', 'sprint-122-review.md');
    writeFileSync(latestReviewPath, 'existing latest review\n');
    saveSprintState(tmpDir, createSprintState(122, 'scoring'));
    const logs: string[] = [];
    const errors: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });
    vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args.join(' ')); });

    reviewCommand(join(tmpDir, 'docs', 'retros', 'sprint-109.json'));

    expect(readFileSync(join(tmpDir, 'docs', 'retros', 'sprint-109-review.md'), 'utf8'))
      .toContain('## Sprint 109 Review: Sprint 109');
    expect(readFileSync(latestReviewPath, 'utf8')).toBe('existing latest review\n');
    expect(loadSprintState(tmpDir)?.gates.review_md).toBe(false);
    expect(logs.join('\n')).not.toContain('Review written:');
    expect(errors.join('\n')).toContain('Review written: docs');
    expect(errors.join('\n')).toContain('sprint-109-review.md');
  });

  it('selects one scorecard by --sprint semantics when multiple exist', () => {
    for (const sprint of [109, 122]) {
      const card = buildScorecard({
        sprint_number: sprint,
        theme: `Sprint ${sprint}`,
        par: 3,
        slope: 1,
        date: '2026-07-10',
        shots: [{ ticket_key: `S${sprint}-1`, title: 'Review', club: 'wedge', result: 'green', hazards: [] }],
      });
      writeFileSync(join(tmpDir, 'docs', 'retros', `sprint-${sprint}.json`), JSON.stringify(card));
    }
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    reviewCommand(undefined, undefined, undefined, undefined, 'S109');

    expect(existsSync(join(tmpDir, 'docs', 'retros', 'sprint-109-review.md'))).toBe(true);
    expect(existsSync(join(tmpDir, 'docs', 'retros', 'sprint-122-review.md'))).toBe(false);
  });
});

describe('reviewCommand overwrite protection (#616)', () => {
  function writeCard(sprint: number): string {
    const card = buildScorecard({
      sprint_number: sprint,
      theme: `Sprint ${sprint}`,
      par: 3,
      slope: 1,
      date: '2026-07-15',
      shots: [{ ticket_key: `S${sprint}-1`, title: 'Review', club: 'wedge', result: 'green', hazards: [] }],
    });
    const path = join(tmpDir, 'docs', 'retros', `sprint-${sprint}.json`);
    writeFileSync(path, JSON.stringify(card));
    return path;
  }

  it('refuses to overwrite a project-authored review without --force but still honors the gate', () => {
    const scorecardPath = writeCard(130);
    const reviewPath = join(tmpDir, 'docs', 'retros', 'sprint-130-review.md');
    const authored = '# Closeout\n\n## What was done\nRich project-authored review.\n';
    writeFileSync(reviewPath, authored);
    saveSprintState(tmpDir, createSprintState(130, 'scoring'));
    const errors: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args.join(' ')); });

    reviewCommand(scorecardPath);

    expect(readFileSync(reviewPath, 'utf8')).toBe(authored);
    expect(errors.join('\n')).toContain('Refusing to overwrite existing review');
    expect(loadSprintState(tmpDir)?.gates.review_md).toBe(true);
  });

  it('overwrites with --force and regenerates marker-carrying reviews without it', () => {
    const scorecardPath = writeCard(131);
    const reviewPath = join(tmpDir, 'docs', 'retros', 'sprint-131-review.md');
    writeFileSync(reviewPath, 'authored\n');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    reviewCommand(scorecardPath, undefined, undefined, undefined, undefined, { force: true });
    const generated = readFileSync(reviewPath, 'utf8');
    expect(generated).toContain('<!-- generated by slope review; content-hash: ');
    expect(generated).toContain('## Sprint 131 Review');

    // A pristine generated file regenerates freely on a later run.
    writeFileSync(join(tmpDir, 'docs', 'retros', 'sprint-131.json'), readFileSync(scorecardPath, 'utf8').replace('Sprint 131', 'Sprint 131 amended'));
    reviewCommand(scorecardPath);
    expect(readFileSync(reviewPath, 'utf8')).toContain('Sprint 131 amended');
  });

  it('protects a human-edited generated review — the marker alone is not consent (#616 F1)', () => {
    const scorecardPath = writeCard(134);
    const reviewPath = join(tmpDir, 'docs', 'retros', 'sprint-134-review.md');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args.join(' ')); });

    reviewCommand(scorecardPath, undefined, undefined, undefined, undefined, { force: true });
    const enriched = `${readFileSync(reviewPath, 'utf8')}\n## What went wrong\nHand-written analysis.\n`;
    writeFileSync(reviewPath, enriched);

    reviewCommand(scorecardPath);

    expect(readFileSync(reviewPath, 'utf8')).toBe(enriched);
    expect(errors.join('\n')).toContain('Refusing to overwrite existing review');
  });

  it('protects an authored review that merely quotes the marker (#616 F2)', () => {
    const scorecardPath = writeCard(135);
    const reviewPath = join(tmpDir, 'docs', 'retros', 'sprint-135-review.md');
    const authored = '# Closeout\n\nDiscussing the `<!-- generated by slope review; content-hash: 0123456789abcdef -->` marker format.\n';
    writeFileSync(reviewPath, authored);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    reviewCommand(scorecardPath);

    expect(readFileSync(reviewPath, 'utf8')).toBe(authored);
  });

  it('reopens a previously closed review_md gate when required sections go missing (#616 F4)', () => {
    const scorecardPath = writeCard(136);
    writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({
      scorecardDir: 'docs/retros',
      scorecardPattern: 'sprint-*.json',
      minSprint: 1,
      reviewRequiredSections: ['## What went wrong'],
    }));
    const state = createSprintState(136, 'scoring');
    state.gates.review_md = true;
    saveSprintState(tmpDir, state);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args.join(' ')); });

    reviewCommand(scorecardPath, undefined, undefined, undefined, undefined, { force: true });

    expect(loadSprintState(tmpDir)?.gates.review_md).toBe(false);
    expect(errors.join('\n')).toContain('review_md gate reopened');
  });

  it('leaves the review_md gate open when configured required sections are missing', () => {
    const scorecardPath = writeCard(132);
    writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({
      scorecardDir: 'docs/retros',
      scorecardPattern: 'sprint-*.json',
      minSprint: 1,
      reviewRequiredSections: ['## What went wrong', '## Next steps'],
    }));
    saveSprintState(tmpDir, createSprintState(132, 'scoring'));
    const errors: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args.join(' ')); });

    reviewCommand(scorecardPath);

    expect(loadSprintState(tmpDir)?.gates.review_md).toBe(false);
    expect(errors.join('\n')).toContain('required section(s) missing');
    expect(errors.join('\n')).toContain('## What went wrong');
  });

  it('never mutates gate state on view-only runs (--stdout / --output) (#616 R1)', () => {
    const scorecardPath = writeCard(137);
    writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({
      scorecardDir: 'docs/retros',
      scorecardPattern: 'sprint-*.json',
      minSprint: 1,
      reviewRequiredSections: ['## What went wrong'],
    }));
    const state = createSprintState(137, 'scoring');
    state.gates.review_md = true;
    saveSprintState(tmpDir, state);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    reviewCommand(scorecardPath, undefined, undefined, null);
    expect(loadSprintState(tmpDir)?.gates.review_md).toBe(true);

    reviewCommand(scorecardPath, undefined, undefined, 'docs/retros/elsewhere.md');
    expect(loadSprintState(tmpDir)?.gates.review_md).toBe(true);
  });

  it('repairs cp1252 mojibake sequences in written reviews', () => {
    const card = buildScorecard({
      sprint_number: 133,
      theme: 'Encoding â€” hardening',
      par: 3,
      slope: 1,
      date: '2026-07-15',
      shots: [{ ticket_key: 'S133-1', title: 'Review', club: 'wedge', result: 'green', hazards: [], notes: 'Itâ€™s â€œdoneâ€ nowâ€¦' }],
    });
    const scorecardPath = join(tmpDir, 'docs', 'retros', 'sprint-133.json');
    writeFileSync(scorecardPath, JSON.stringify(card));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    reviewCommand(scorecardPath);

    const written = readFileSync(join(tmpDir, 'docs', 'retros', 'sprint-133-review.md'), 'utf8');
    expect(written).toContain('Encoding — hardening');
    expect(written).toContain('It’s “done” now…');
    expect(written).not.toContain('â€');
  });
});
