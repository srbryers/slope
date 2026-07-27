import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sprintCommand } from '../../../src/cli/commands/sprint.js';
import { createSprintState, saveSprintState } from '../../../src/cli/sprint-state.js';
import type { RoadmapDefinition } from '../../../src/core/index.js';
import { createStore } from '../../../src/store/index.js';

class ProcessExitError extends Error {
  constructor(public code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

let cwd: string;
let originalCwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'slope-sprint-canonical-'));
  originalCwd = process.cwd();
  process.chdir(cwd);
  mkdirSync(join(cwd, '.slope'), { recursive: true });
  mkdirSync(join(cwd, 'docs', 'backlog'), { recursive: true });
  writeFileSync(join(cwd, '.slope', 'config.json'), JSON.stringify({
    currentSprint: 458,
    roadmapPath: 'docs/backlog/roadmap.json',
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
  }));
  writeCanonicalRoadmap();
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(cwd, { recursive: true, force: true });
});

async function captureLog(action: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
    lines.push(args.join(' '));
  });
  try {
    await action();
  } finally {
    spy.mockRestore();
  }
  return lines.join('\n');
}

function writeCanonicalRoadmap(): void {
  const keys = ['458.1', '458.10'];
  const roadmap: RoadmapDefinition = {
    name: 'Canonical Sprint Command Test',
    phases: [{
      name: 'Inserted sprints',
      sprints: keys.map(Number),
      sprint_keys: keys,
    }],
    sprints: keys.map(key => ({
      id: Number(key),
      id_key: key,
      theme: `Sprint ${key}`,
      par: 3,
      slope: 1,
      type: 'feature',
      status: 'planned',
      tickets: [1, 2].map(ticket => ({
        key: `S${key}-${ticket}`,
        title: `Ticket ${ticket}`,
        club: 'wedge',
        complexity: 'small',
      })),
    })),
  };
  writeFileSync(
    join(cwd, 'docs', 'backlog', 'roadmap.json'),
    JSON.stringify(roadmap, null, 2),
  );
}

function writeWorkflow(): void {
  mkdirSync(join(cwd, '.slope', 'workflows'), { recursive: true });
  writeFileSync(join(cwd, '.slope', 'workflows', 'canonical.yaml'), `
name: canonical
version: "1"
variables:
  sprint_id:
    required: true
    type: string
  tickets:
    required: true
    type: array
phases:
  - id: per_ticket
    repeat_for: tickets
    steps:
      - id: implement
        type: agent_work
        prompt: "Implement the ticket"
`);
}

describe('slope sprint canonical identity (S266 review)', () => {
  it('keeps S458.10 exact through start, gates, claims, and mismatch checks', async () => {
    mkdirSync(join(cwd, 'docs', 'retros'), { recursive: true });
    writeFileSync(
      join(cwd, 'docs', 'retros', 'sprint-458.1.json'),
      JSON.stringify({ sprint_number: '458.1' }),
    );

    const output = await captureLog(() =>
      sprintCommand(['start', '--number=458.10', '--phase=planning'])
    );
    await captureLog(() => sprintCommand(['gate', 'tests']));
    const status = await captureLog(() => sprintCommand(['status']));
    const statePath = join(cwd, '.slope', 'sprint-state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));

    expect(output).toContain('Sprint 458.10 started');
    expect(status).toContain('Sprint 458.10 - status');
    expect(state).toMatchObject({ sprint: '458.10', gates: { tests: true } });

    const store = createStore({ storePath: '.slope/slope.db', cwd });
    try {
      expect((await store.list('458.10')).map(claim => claim.target))
        .toContain('sprint:S458.10');
      expect(await store.list('458.1')).toHaveLength(0);
    } finally {
      store.close();
    }

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(code => {
      throw new ProcessExitError(code as number);
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(
        sprintCommand(['start', '--number=458.1', '--phase=planning'])
      ).rejects.toThrow(ProcessExitError);
      expect(errorSpy.mock.calls.map(call => call.join(' ')).join('\n'))
        .toContain('sprint-state.json is for S458.10, not S458.1');
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }

    expect(JSON.parse(readFileSync(statePath, 'utf8')).sprint).toBe('458.10');
  });

  it('keeps S458.10 exact through begin and ticket claim creation', async () => {
    const output = await captureLog(() =>
      sprintCommand(['begin', '--sprint=S458.10', '--ticket=S458.10-1'])
    );
    const state = JSON.parse(
      readFileSync(join(cwd, '.slope', 'sprint-state.json'), 'utf8'),
    );

    expect(output).toContain('Sprint 458.10: started');
    expect(state.sprint).toBe('458.10');

    const store = createStore({ storePath: '.slope/slope.db', cwd });
    try {
      expect((await store.list('458.10')).map(claim => claim.target))
        .toContain('S458.10-1');
      expect(await store.list('458.1')).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  it('uses exact S458.10 roadmap tickets and state for workflow execution', async () => {
    writeWorkflow();

    await captureLog(() =>
      sprintCommand(['run', 'S458.10', '--workflow=canonical'])
    );

    const store = createStore({ storePath: '.slope/slope.db', cwd });
    try {
      const execution = await store.getExecutionBySprint('458.10');
      expect(execution).not.toBeNull();
      expect(execution).toMatchObject({
        sprint_id: '458.10',
        variables: {
          sprint_id: 'S458.10',
          tickets: 'S458.10-1,S458.10-2',
        },
      });
      expect(await store.getExecutionBySprint('458.1')).toBeNull();
    } finally {
      store.close();
    }

    const state = JSON.parse(
      readFileSync(join(cwd, '.slope', 'sprint-state.json'), 'utf8'),
    );
    expect(state).toMatchObject({ sprint: '458.10', phase: 'implementing' });
  });

  it('preserves S458.10 in rollover audits and portable resume pointers', async () => {
    const roadmapPath = join(cwd, 'docs', 'backlog', 'roadmap.json');
    const roadmap = JSON.parse(readFileSync(roadmapPath, 'utf8')) as RoadmapDefinition;
    roadmap.phases[0].sprints.push(459);
    roadmap.phases[0].sprint_keys!.push('459');
    roadmap.sprints.push({
      id: 459,
      theme: 'Sprint 459',
      par: 3,
      slope: 1,
      type: 'feature',
      status: 'planned',
      depends_on: ['458.10'],
      tickets: [],
    });
    writeFileSync(roadmapPath, JSON.stringify(roadmap, null, 2));

    const state = createSprintState('458.10', 'complete');
    for (const gate of Object.keys(state.gates) as Array<keyof typeof state.gates>) {
      state.gates[gate] = true;
    }
    state.review_gates.code_review = {
      provenance: 'independent_review',
      reviewer: 'code-reviewer',
      evidence: ['review:code'],
    };
    state.review_gates.architect_review = {
      provenance: 'independent_review',
      reviewer: 'architect-reviewer',
      evidence: ['review:architecture'],
    };
    saveSprintState(cwd, state);

    const output = await captureLog(() =>
      sprintCommand(['rollover', '--from=458.10', '--to=459'])
    );
    expect(output).toContain('S458.10 -> S459');

    const installed = JSON.parse(
      readFileSync(join(cwd, '.slope', 'sprint-state.json'), 'utf8'),
    );
    const audit = JSON.parse(
      readFileSync(join(cwd, installed.rollover.audit_path), 'utf8'),
    );
    expect(audit.request).toMatchObject({ from: '458.10', to: '459' });
    expect(audit.from_sprint).toBe('458.10');

    await captureLog(() =>
      sprintCommand(['resume', '--write-pointer', '--sprint=458.10'])
    );
    const pointer = JSON.parse(
      readFileSync(join(cwd, 'docs', 'backlog', '.sprint-active.json'), 'utf8'),
    );
    expect(pointer.sprint).toBe('458.10');
  });
});
