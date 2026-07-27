import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildScorecard } from '../../src/core/builder.js';
import type { SkillRegistryFile } from '../../src/core/skills.js';
import { SqliteSlopeStore } from '../../src/store/index.js';

let tmpDir: string;
let exitCode: number | undefined;

vi.spyOn(process, 'cwd').mockImplementation(() => tmpDir);
vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
  exitCode = code as number;
  throw new Error(`process.exit(${code})`);
});

import { validateCommand } from '../../src/cli/commands/validate.js';

function writeConfig(): void {
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
    minSprint: 1,
    skillsPath: '.slope/skills.json',
  }));
}

function writeRegistry(ids: string[]): void {
  const registry: SkillRegistryFile = {
    version: '1',
    generated_at: '2026-05-23T00:00:00.000Z',
    roots: ['.agents/skills'],
    skills: ids.map(id => ({
      id,
      name: id,
      description: `${id} description`,
      path: `.agents/skills/${id}/SKILL.md`,
      directory: `.agents/skills/${id}`,
      root: '.agents/skills',
      sources: [{
        path: `.agents/skills/${id}/SKILL.md`,
        directory: `.agents/skills/${id}`,
        root: '.agents/skills',
        metadata_sources: ['SKILL.md'],
      }],
      triggers: ['test'],
    })),
  };
  writeFileSync(join(tmpDir, '.slope', 'skills.json'), JSON.stringify(registry, null, 2));
}

function writeScorecard(skillsUsed: string[], sprintNumber = 1): string {
  const retrosDir = join(tmpDir, 'docs', 'retros');
  mkdirSync(retrosDir, { recursive: true });
  const card = buildScorecard({
    sprint_number: sprintNumber,
    theme: 'Skill validation',
    par: 3,
    slope: 1,
    date: '2026-05-23',
    player: 'test',
    shots: [{
      ticket_key: `S${sprintNumber}-1`,
      title: 'Test',
      club: 'wedge',
      result: 'in_the_hole',
      hazards: [],
    }],
    training: [{ type: 'lessons', description: 'test', outcome: 'ok' }],
    nutrition: [{ category: 'hydration', description: 'test', status: 'healthy' }],
    bunker_locations: ['none'],
    skills_used: skillsUsed,
  });
  const path = join(retrosDir, `sprint-${sprintNumber}.json`);
  writeFileSync(path, JSON.stringify(card, null, 2));
  return `docs/retros/sprint-${sprintNumber}.json`;
}

function writeNestedScorecard(sprintNumber: number): void {
  const nestedDir = join(tmpDir, 'docs', 'retros', `s${sprintNumber}`);
  mkdirSync(nestedDir, { recursive: true });
  const card = buildScorecard({
    sprint_number: sprintNumber,
    theme: 'Nested validation',
    par: 3,
    slope: 1,
    date: '2026-05-23',
    player: 'test',
    shots: [{
      ticket_key: `S${sprintNumber}-1`,
      title: 'Test',
      club: 'wedge',
      result: 'in_the_hole',
      hazards: [],
    }],
    training: [{ type: 'lessons', description: 'test', outcome: 'ok' }],
    nutrition: [{ category: 'hydration', description: 'test', status: 'healthy' }],
    bunker_locations: ['none'],
  });
  writeFileSync(join(nestedDir, 'scorecard.json'), JSON.stringify(card, null, 2));
}

function writeModularRoadmap(sprint: number, status: string): void {
  const roadmapDir = join(tmpDir, 'docs', 'roadmap');
  mkdirSync(join(roadmapDir, 'phases'), { recursive: true });
  writeFileSync(join(roadmapDir, 'project.yaml'), `version: "1"
name: Validate Workflow Test
output: ../backlog/roadmap.json
sources:
  - path: phases/phase-01.yaml
    kind: phase
`);
  writeFileSync(join(roadmapDir, 'phases', 'phase-01.yaml'), `version: "1"
phase:
  name: Phase 1
  status: in_progress
  sprints: [${sprint}]
sprints:
  - id: ${sprint}
    theme: Validation lifecycle
    par: 3
    slope: 1
    type: bugfix
    status: ${status}
    tickets:
      - {key: S${sprint}-1, title: Validate, club: wedge, complexity: small}
`);
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-validate-skills-'));
  writeConfig();
  exitCode = undefined;
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.SLOPE_WORKFLOW_EXECUTION_ID;
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

describe('slope validate --skills', () => {
  it('passes when scorecard skill references exist in the registry', async () => {
    writeRegistry(['slope-sprint-workflow']);
    const path = writeScorecard(['slope-sprint-workflow']);

    await expect(validateCommand([path, '--skills'])).rejects.toThrow('process.exit(0)');
    expect(exitCode).toBe(0);
  });

  it('fails when scorecard skill references are unknown', async () => {
    writeRegistry(['slope-sprint-workflow']);
    const path = writeScorecard(['missing-skill']);

    await expect(validateCommand([path, '--skills'])).rejects.toThrow('process.exit(1)');
    expect(exitCode).toBe(1);
  });

  it('fails when --skills is used before scanning a registry', async () => {
    const path = writeScorecard(['slope-sprint-workflow']);

    await expect(validateCommand([path, '--skills'])).rejects.toThrow('process.exit(1)');
    expect(exitCode).toBe(1);
  });

  it('includes decimal inserted sprint scorecards during default validation', async () => {
    writeScorecard([], 114.5);

    await expect(validateCommand()).rejects.toThrow('process.exit(0)');
    expect(exitCode).toBe(0);
  });

  it('includes nested sN/scorecard.json scorecards during default validation', async () => {
    writeNestedScorecard(155);

    await expect(validateCommand()).rejects.toThrow('process.exit(0)');
    expect(exitCode).toBe(0);
  });

  it('validates only the requested sprint with --sprint=N', async () => {
    writeScorecard([], 348);
    mkdirSync(join(tmpDir, 'docs', 'retros'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs', 'retros', 'sprint-349.json'), '{not-json');

    await expect(validateCommand(['--sprint=348'])).rejects.toThrow('process.exit(0)');
    expect(exitCode).toBe(0);
  });

  it('fails when --sprint requests a missing scorecard', async () => {
    writeScorecard([], 348);

    await expect(validateCommand(['--sprint=349'])).rejects.toThrow('process.exit(1)');
    expect(exitCode).toBe(1);
  });

  it('completes stale duplicates while preserving the current validated workflow execution (#668)', async () => {
    const path = writeScorecard([], 348);
    const store = new SqliteSlopeStore(join(tmpDir, '.slope', 'slope.db'));
    const stale = await store.startExecution({ workflow_name: 'sprint-standard', sprint_id: 'S348' });
    await new Promise(resolve => setTimeout(resolve, 5));
    const current = await store.startExecution({ workflow_name: 'sprint-standard', sprint_id: 'S348' });
    const unrelated = await store.startExecution({ workflow_name: 'sprint-standard', sprint_id: 'S349' });
    store.close();

    await expect(validateCommand([path])).rejects.toThrow('process.exit(0)');

    const updated = new SqliteSlopeStore(join(tmpDir, '.slope', 'slope.db'));
    try {
      await expect(updated.getExecution(stale.id)).resolves.toMatchObject({ status: 'completed' });
      await expect(updated.getExecution(current.id)).resolves.toMatchObject({ status: 'running' });
      await expect(updated.getExecution(unrelated.id)).resolves.toMatchObject({ status: 'running' });
    } finally {
      updated.close();
    }
  });

  it('preserves the workflow execution that invoked validation even when it is not newest (#668)', async () => {
    const path = writeScorecard([], 348);
    const store = new SqliteSlopeStore(join(tmpDir, '.slope', 'slope.db'));
    const invoking = await store.startExecution({ workflow_name: 'sprint-standard', sprint_id: 'S348' });
    await new Promise(resolve => setTimeout(resolve, 5));
    const duplicate = await store.startExecution({ workflow_name: 'sprint-standard', sprint_id: 'S348' });
    store.close();
    process.env.SLOPE_WORKFLOW_EXECUTION_ID = invoking.id;

    await expect(validateCommand([path])).rejects.toThrow('process.exit(0)');

    const updated = new SqliteSlopeStore(join(tmpDir, '.slope', 'slope.db'));
    try {
      await expect(updated.getExecution(invoking.id)).resolves.toMatchObject({ status: 'running' });
      await expect(updated.getExecution(duplicate.id)).resolves.toMatchObject({ status: 'completed' });
    } finally {
      updated.close();
    }
  });

  it('preserves every newest execution tied at the same start timestamp (#668)', async () => {
    const path = writeScorecard([], 348);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T18:00:00.000Z'));
    const store = new SqliteSlopeStore(join(tmpDir, '.slope', 'slope.db'));
    const first = await store.startExecution({ workflow_name: 'sprint-standard', sprint_id: 'S348' });
    const second = await store.startExecution({ workflow_name: 'sprint-standard', sprint_id: 'S348' });
    store.close();
    vi.useRealTimers();

    await expect(validateCommand([path])).rejects.toThrow('process.exit(0)');

    const updated = new SqliteSlopeStore(join(tmpDir, '.slope', 'slope.db'));
    try {
      await expect(updated.getExecution(first.id)).resolves.toMatchObject({ status: 'running' });
      await expect(updated.getExecution(second.id)).resolves.toMatchObject({ status: 'running' });
    } finally {
      updated.close();
    }
  });

  it('leaves workflow executions running when scorecard validation fails (#668)', async () => {
    writeRegistry(['slope-sprint-workflow']);
    const path = writeScorecard(['missing-skill'], 348);
    const store = new SqliteSlopeStore(join(tmpDir, '.slope', 'slope.db'));
    const execution = await store.startExecution({ workflow_name: 'sprint-standard', sprint_id: 'S348' });
    store.close();

    await expect(validateCommand([path, '--skills'])).rejects.toThrow('process.exit(1)');

    const updated = new SqliteSlopeStore(join(tmpDir, '.slope', 'slope.db'));
    try {
      await expect(updated.getExecution(execution.id)).resolves.toMatchObject({ status: 'running' });
    } finally {
      updated.close();
    }
  });

  it.each(['absorbed', 'blocked', 'deferred', 'superseded', 'cancelled', 'skipped'])(
    'does not complete workflow execution when roadmap status remains %s',
    async status => {
      const path = writeScorecard([], 9);
      writeModularRoadmap(9, status);
      const store = new SqliteSlopeStore(join(tmpDir, '.slope', 'slope.db'));
      const execution = await store.startExecution({ workflow_name: 'sprint-standard', sprint_id: 'S9' });
      store.close();

      await expect(validateCommand([path])).rejects.toThrow('process.exit(0)');

      const updated = new SqliteSlopeStore(join(tmpDir, '.slope', 'slope.db'));
      try {
        await expect(updated.getExecution(execution.id)).resolves.toMatchObject({ status: 'running' });
      } finally {
        updated.close();
      }
    },
  );
});
