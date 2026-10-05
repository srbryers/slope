import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import {
  PRELUDE_DRAFT,
  activeState,
  cleanupFixtures,
  initRepo,
  nullGateActiveState,
  writeConfig,
  writeFile,
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

describe('sprint status classifies evidence before projecting it', () => {
  function badProvenance(): Record<string, unknown> {
    const state = activeState('72') as any;
    state.review_gates.code_review.provenance = 'vibes';
    return state;
  }

  it.each<[string, () => Record<string, unknown>, string]>([
    ['bad nested review provenance', badProvenance, 'review_gates.code_review.provenance'],
    ['unknown phase', () => ({ ...activeState('72'), phase: 'vibes' }), 'phase'],
    ['unreadable start time', () => ({ ...activeState('72'), started_at: 'last tuesday' }), 'started_at'],
  ])('reports %s with the same file, field and repair as doctor and gate, preserving bytes', (_label, make, field) => {
    const root = initRepo();
    writeConfig(root);
    const path = writeState(root, make());
    const before = readFileSync(path, 'utf8');

    const text = slope(root, ['sprint', 'status']);
    const jsonRun = slope(root, ['sprint', 'status', '--json']);
    const doctor = slope(root, ['doctor']);
    const gate = slope(root, ['sprint', 'gate', 'tests']);
    const json = JSON.parse(jsonRun.stdout);

    expect(text.stdout).toContain(`Sprint evidence file: ${path}`);
    expect(text.stdout).toContain(`Problem: \`${field}\``);
    expect(text.stdout).not.toContain('Sprint 72 - status');
    expect(text.status).not.toBe(0);
    expect(jsonRun.status).not.toBe(0);
    expect(json).toMatchObject({ sprint: null, status: 'evidence_error', phase: null, gates: null, review_gates: null });
    expect(json.evidence_error).toMatchObject({ path, field });
    expect(isAbsolute(json.evidence_error.path)).toBe(true);
    expect(json.evidence_error.repair.length).toBeGreaterThan(0);

    for (const output of [doctor.stdout, gate.stderr]) {
      expect(output).toContain(`Sprint evidence file: ${path}`);
      expect(output).toContain(`\`${field}\` ${json.evidence_error.message}`);
      for (const step of json.evidence_error.repair) expect(output).toContain(step);
    }
    for (const step of json.evidence_error.repair) expect(text.stdout).toContain(step);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });
});

describe('sprint evidence refusals name the selected file and field', () => {
  function roadmapSprint(id: number, dependsOn: number[] = []) {
    return {
      id, theme: `Sprint ${id}`, par: 3, slope: 1, type: 'architecture', status: 'planned', depends_on: dependsOn,
      tickets: [1, 2, 3].map(n => ({ key: `S${id}-${n}`, title: `T${n}`, club: 'wedge', complexity: 'small' })),
    };
  }

  function activeSeventy(): { root: string; path: string; before: string } {
    const root = initRepo();
    writeConfig(root);
    writeFile(root, 'docs/backlog/roadmap.json', JSON.stringify({
      name: 'Evidence roadmap',
      phases: [{ name: 'P', sprints: [69, 70, 71] }],
      sprints: [roadmapSprint(69), roadmapSprint(70), roadmapSprint(71)],
    }, null, 2));
    const path = writeState(root, activeState('70'));
    return { root, path, before: readFileSync(path, 'utf8') };
  }

  it.each([
    [['sprint', 'start', '--number=71', '--force']],
    [['sprint', 'begin', '--sprint=71', '--ticket=S71-1']],
  ])('`%s` names the file and sprint field, offers audited rollover, and preserves bytes', (args) => {
    const { root, path, before } = activeSeventy();
    const result = slope(root, args);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('sprint-state.json is for S70, not S71');
    expect(isAbsolute(path)).toBe(true);
    expect(result.stderr).toContain(`Sprint evidence file: ${path}`);
    expect(result.stderr).toContain('State: Sprint 70 (`sprint`); requested Sprint 71.');
    expect(result.stderr).toContain('slope sprint rollover --from=70 --to=71 --force --reason="<why>"');
    expect(result.stderr).toContain(`retry: slope sprint ${args[1]}`);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it.each(['start', 'begin'])('%s names the file and rollover field when its lineage audit is missing', (command) => {
    const { root } = activeSeventy();
    const path = writeState(root, {
      ...activeState('70'),
      rollover: {
        transition_id: '0123456789abcdef', from_sprint: '69',
        audit_path: 'docs/retros/rollovers/missing.json', recorded_at: '2026-10-01T00:00:00.000Z',
        forced: true, reason: 'test',
      },
    });
    const before = readFileSync(path, 'utf8');
    const args = command === 'start' ? ['--number=70'] : ['--sprint=70', '--ticket=S70-1'];
    const result = slope(root, ['sprint', command, ...args]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('lineage audit is missing');
    expect(isAbsolute(path)).toBe(true);
    expect(result.stderr).toContain(`Sprint evidence file: ${path}`);
    expect(result.stderr).toContain('`rollover`');
    expect(result.stderr).toContain('After restoring the tracked rollover audit, retry:');
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('names the file and sprint field when roadmap eligibility cannot be read', () => {
    const { root, path, before } = activeSeventy();
    writeFile(root, 'docs/backlog/roadmap.json', '{broken');
    const result = slope(root, ['sprint', 'start', '--number=71', '--force']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Could not parse roadmap');
    expect(result.stderr).toContain(`Sprint evidence file: ${path}`);
    expect(result.stderr).toContain('State: Sprint 70 (`sprint`); requested Sprint 71.');
    expect(result.stderr).toContain('After resolving the sprint state, retry:');
    expect(readFileSync(path, 'utf8')).toBe(before);
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
