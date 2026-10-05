import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PRELUDE_DRAFT,
  activeState,
  cleanupFixtures,
  initRepo,
  nullGateActiveState,
  writeConfig,
  writeState,
} from '../../helpers/sprint-evidence-fixtures.js';

const SLOPE_BIN = resolve(__dirname, '..', '..', '..', 'dist', 'cli', 'index.js');

function slope(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [SLOPE_BIN, ...args], { cwd, encoding: 'utf8' });
}

afterEach(cleanupFixtures);

describe('slope sprint refuses bad or draft evidence without rewriting it', () => {
  it('names the file, the null gate and the repair when starting over corrupt evidence', () => {
    const root = initRepo();
    writeConfig(root);
    const path = writeState(root, nullGateActiveState());
    const before = readFileSync(path, 'utf8');

    const result = slope(root, ['sprint', 'start', '--number=5']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('corrupt evidence was preserved');
    expect(result.stderr).toContain(`Sprint evidence file: ${path}`);
    expect(result.stderr).toContain('`gates.tests` must be true or false (found null)');
    expect(result.stderr).toContain('`slope doctor`');
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('refuses to overwrite a planned draft and says how to set it aside', () => {
    const root = initRepo();
    writeConfig(root);
    const path = writeState(root, PRELUDE_DRAFT);
    const before = readFileSync(path, 'utf8');

    const result = slope(root, ['sprint', 'start', '--number=5']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('planned draft');
    expect(result.stderr).toContain(`mv "${path}" "${path}.bak"`);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('does not treat a draft as corruption when gating', () => {
    const root = initRepo();
    writeConfig(root);
    const path = writeState(root, PRELUDE_DRAFT);
    const before = readFileSync(path, 'utf8');

    const result = slope(root, ['sprint', 'gate', 'tests']);

    expect(result.stderr).not.toContain('corrupt');
    expect(readFileSync(path, 'utf8')).toBe(before);
  });
});

describe('gate and phase refuse bad evidence with the diagnosis, never "No active sprint"', () => {
  function nestedReviewCorrupt(): Record<string, unknown> {
    const state = activeState('72') as any;
    state.review_gates.code_review.provenance = 'vibes';
    return state;
  }

  it.each<[string, () => Record<string, unknown>, string]>([
    ['a null gate', nullGateActiveState, '`gates.tests` must be true or false (found null)'],
    ['a bad nested review field', nestedReviewCorrupt, '`review_gates.code_review.provenance` must be one of'],
  ])('names the file and field for %s', (_label, make, problem) => {
    for (const args of [['sprint', 'gate', 'tests'], ['sprint', 'phase', 'scoring']]) {
      const root = initRepo();
      writeConfig(root);
      const path = writeState(root, make());
      const before = readFileSync(path, 'utf8');

      const result = slope(root, args);

      expect(result.status, args.join(' ')).not.toBe(0);
      expect(result.stderr, args.join(' ')).toContain(`Sprint evidence file: ${path}`);
      expect(result.stderr, args.join(' ')).toContain(problem);
      expect(result.stderr, args.join(' ')).not.toContain('No active sprint');
      expect(readFileSync(path, 'utf8'), args.join(' ')).toBe(before);
    }
  });

  it('shows the diagnosis from `sprint status` instead of "No active sprint state"', () => {
    const root = initRepo();
    writeConfig(root);
    const path = writeState(root, nullGateActiveState());

    const text = slope(root, ['sprint', 'status']);
    const json = JSON.parse(slope(root, ['sprint', 'status', '--json']).stdout);

    expect(text.stdout).toContain(`Sprint evidence file: ${path}`);
    expect(text.stdout).not.toContain('No active sprint state');
    expect(json.evidence_error).toMatchObject({ path, field: 'gates.tests' });
  });
});

describe('an all-false planned draft is no sprint for every command', () => {
  const draft = {
    phase: 'planned',
    sprint: '70',
    gates: { tests: false, code_review: false, architect_review: false, scorecard: false, review_md: false },
  };

  it('reports no sprint from status', () => {
    const root = initRepo();
    writeConfig(root);
    writeState(root, draft);

    const json = JSON.parse(slope(root, ['sprint', 'status', '--json']).stdout);

    expect(json).toMatchObject({ sprint: null, status: 'not_started', phase: null });
    expect(json.evidence_error).toBeUndefined();
  });

  it.each([['phase', 'implementing'], ['gate', 'tests']])('does not report success from `sprint %s %s` and keeps the bytes', (verb, arg) => {
    const root = initRepo();
    writeConfig(root);
    const path = writeState(root, draft);
    const before = readFileSync(path, 'utf8');

    const result = slope(root, ['sprint', verb, arg]);

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('phase updated');
    expect(result.stdout).not.toContain('marked complete');
    expect(result.stderr).toContain('planned draft');
    expect(readFileSync(path, 'utf8')).toBe(before);
  });
});

describe('slope doctor reports what the guard reports', () => {
  it('prints the same file, field and repair, and exits non-zero', () => {
    const root = initRepo();
    writeConfig(root);
    const path = writeState(root, nullGateActiveState());

    const result = slope(root, ['doctor']);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain(`Sprint evidence file: ${path}`);
    expect(result.stdout).toContain('`gates.tests` must be true or false (found null)');
    expect(result.stdout).toContain(`Edit ${path} and set \`gates.tests\` to \`false\``);
  });

  it('reports a planned draft as healthy', () => {
    const root = initRepo();
    writeConfig(root);
    writeState(root, PRELUDE_DRAFT);

    const result = slope(root, ['doctor']);

    expect(result.stdout).toContain('planned draft; no sprint in progress');
    expect(result.stdout).not.toContain('Sprint evidence is invalid');
  });
});
