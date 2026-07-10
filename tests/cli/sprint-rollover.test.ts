import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RoadmapDefinition, RoadmapSprint } from '../../src/core/roadmap.js';
import type { ResolvedActor } from '../../src/cli/actor.js';
import {
  assessSprintRollover,
  performSprintRollover,
  type SprintRolloverAuditRecord,
} from '../../src/cli/sprint-rollover.js';
import {
  createSprintState,
  loadSprintState,
  saveSprintState,
  type SprintState,
} from '../../src/cli/sprint-state.js';

const workspaces: string[] = [];
const actor: ResolvedActor = {
  name: 'rollover-test-agent',
  displayName: 'rollover-test-agent',
  source: 'override',
  isFallback: false,
};

function sprint(
  id: number,
  status: string = 'planned',
  dependsOn: number[] = [],
): RoadmapSprint {
  return {
    id,
    theme: `Sprint ${id}`,
    par: 3,
    slope: 1,
    type: 'architecture',
    status,
    depends_on: dependsOn,
    tickets: [
      { key: `S${id}-1`, title: 'One', club: 'wedge', complexity: 'small' },
      { key: `S${id}-2`, title: 'Two', club: 'wedge', complexity: 'small' },
      { key: `S${id}-3`, title: 'Three', club: 'wedge', complexity: 'small' },
    ],
  };
}

function roadmap(
  targetStatus: string = 'planned',
  targetDependencies: number[] = [10],
): RoadmapDefinition {
  return {
    name: 'Rollover test roadmap',
    phases: [{ name: 'Recovery', sprints: [10, 11] }],
    sprints: [
      sprint(10, 'active'),
      sprint(11, targetStatus, targetDependencies),
    ],
  };
}

function terminalState(sprintNumber = 10): SprintState {
  const state = createSprintState(sprintNumber, 'complete');
  for (const gate of Object.keys(state.gates) as Array<keyof SprintState['gates']>) {
    state.gates[gate] = true;
  }
  state.review_gates.code_review = {
    provenance: 'independent_review',
    evidence: ['agent:code-review'],
    reviewer: 'code-reviewer',
  };
  state.review_gates.architect_review = {
    provenance: 'independent_review',
    evidence: ['agent:architect-review'],
    reviewer: 'architect-reviewer',
  };
  return state;
}

function setupWorkspace(definition: RoadmapDefinition = roadmap()): string {
  const cwd = mkdtempSync(join(tmpdir(), 'slope-rollover-'));
  workspaces.push(cwd);
  mkdirSync(join(cwd, '.slope'), { recursive: true });
  mkdirSync(join(cwd, 'docs', 'backlog'), { recursive: true });
  writeFileSync(join(cwd, '.slope', 'config.json'), JSON.stringify({
    roadmapPath: 'docs/backlog/roadmap.json',
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
    minSprint: 1,
  }));
  writeFileSync(
    join(cwd, 'docs', 'backlog', 'roadmap.json'),
    JSON.stringify(definition, null, 2) + '\n',
  );
  return cwd;
}

function auditPath(cwd: string, relativePath: string): string {
  return join(cwd, ...relativePath.split('/'));
}

afterEach(() => {
  for (const cwd of workspaces.splice(0)) {
    rmSync(cwd, { recursive: true, force: true });
  }
});

describe('assessSprintRollover', () => {
  it('accepts a completed source and its dependency-eligible authored successor', () => {
    const assessment = assessSprintRollover(
      terminalState(),
      roadmap(),
      'docs/backlog/roadmap.json',
      { from: 10, to: 11 },
    );

    expect(assessment.valid).toBe(true);
    expect(assessment.from_terminal).toBe(true);
    expect(assessment.expected_next).toBe(11);
    expect(assessment.blocking_dependencies).toEqual([]);
    expect(assessment.issues).toEqual([]);
  });

  it('does not treat phase complete as terminal while required gates remain open', () => {
    const state = createSprintState(10, 'complete');

    const assessment = assessSprintRollover(
      state,
      roadmap('planned', []),
      'docs/backlog/roadmap.json',
      { from: 10, to: 11 },
    );

    expect(assessment.from_terminal).toBe(false);
    expect(assessment.issues.map(issue => issue.code)).toContain('from_not_terminal');
  });

  it('requires an explicit reason to force an in-progress source', () => {
    const state = createSprintState(10, 'implementing');
    const definition = roadmap('planned', []);

    const missingForce = assessSprintRollover(
      state,
      definition,
      'docs/backlog/roadmap.json',
      { from: 10, to: 11 },
    );
    const missingReason = assessSprintRollover(
      state,
      definition,
      'docs/backlog/roadmap.json',
      { from: 10, to: 11, force: true },
    );
    const forced = assessSprintRollover(
      state,
      definition,
      'docs/backlog/roadmap.json',
      { from: 10, to: 11, force: true, reason: 'Source work moved to a follow-up.' },
    );

    expect(missingForce.issues.map(issue => issue.code)).toContain('from_not_terminal');
    expect(missingReason.issues.map(issue => issue.code)).toContain('force_reason_required');
    expect(forced.valid).toBe(true);
    expect(forced.reason).toBe('Source work moved to a follow-up.');
  });

  it('does not let force satisfy a target dependency on the unfinished source', () => {
    const assessment = assessSprintRollover(
      createSprintState(10, 'implementing'),
      roadmap(),
      'docs/backlog/roadmap.json',
      { from: 10, to: 11, force: true, reason: 'Intentional handoff.' },
    );

    expect(assessment.valid).toBe(false);
    expect(assessment.blocking_dependencies).toEqual([10]);
    expect(assessment.issues.map(issue => issue.code)).toContain('target_dependency_blocked');
  });

  it('matches legacy encoded and decimal sprint identities without relabeling canonical ids', () => {
    const definition: RoadmapDefinition = {
      name: 'Encoded inserted sprint',
      phases: [{ name: 'Recovery', sprints: [435, 44] }],
      sprints: [
        {
          ...sprint(435),
          tickets: [{ key: 'S43.5-1', title: 'Inserted', club: 'wedge', complexity: 'small' }],
        },
        sprint(44),
      ],
    };
    const assessment = assessSprintRollover(
      terminalState(43.5),
      definition,
      'docs/backlog/roadmap.json',
      { from: 435, to: 44 },
    );

    expect(assessment.valid).toBe(true);
    expect(assessment.from).toBe(43.5);
    expect(assessment.from_label).toBe('S43.5');
    expect(assessment.to_label).toBe('S44');
  });

  it('rejects ambiguous roadmap rows that share one logical sprint identity', () => {
    const definition: RoadmapDefinition = {
      name: 'Ambiguous inserted sprint',
      phases: [{ name: 'Recovery', sprints: [435, 43.5, 44] }],
      sprints: [
        {
          ...sprint(435),
          tickets: [{ key: 'S43.5-1', title: 'Encoded', club: 'wedge', complexity: 'small' }],
        },
        sprint(43.5),
        sprint(44),
      ],
    };
    const assessment = assessSprintRollover(
      terminalState(43.5),
      definition,
      'docs/backlog/roadmap.json',
      { from: 43.5, to: 44 },
    );

    expect(assessment.valid).toBe(false);
    expect(assessment.issues.map(issue => issue.code)).toContain('from_roadmap_ambiguous');
  });

  it.each([
    'complete',
    'superseded',
    'skipped',
    'cancelled',
    'cancelled-absorbed',
    'absorbed',
  ])('rejects a %s target as terminal roadmap work', status => {
    const assessment = assessSprintRollover(
      terminalState(),
      roadmap(status),
      'docs/backlog/roadmap.json',
      { from: 10, to: 11 },
    );

    expect(assessment.valid).toBe(false);
    expect(assessment.issues.map(issue => issue.code)).toContain('target_not_pending');
  });
});

describe('performSprintRollover audit recovery', () => {
  it('persists an immutable audit before installing the linked next state', () => {
    const cwd = setupWorkspace();
    saveSprintState(cwd, terminalState());

    const result = performSprintRollover(cwd, { from: 10, to: 11 }, actor);
    const persisted = loadSprintState(cwd);
    const diskAudit = JSON.parse(
      readFileSync(auditPath(cwd, result.audit_path), 'utf8'),
    ) as SprintRolloverAuditRecord;

    expect(result.already_applied).toBe(false);
    expect(result.record).toEqual(diskAudit);
    expect(result.state).toEqual(diskAudit.next_state);
    expect(persisted).toEqual(diskAudit.next_state);
    expect(persisted).toMatchObject({
      sprint: 11,
      phase: 'planning',
      rollover: {
        transition_id: diskAudit.transition_id,
        from_sprint: 10,
        audit_path: result.audit_path,
        forced: false,
      },
    });
    expect(diskAudit).toMatchObject({
      kind: 'sprint_rollover',
      from_sprint: 10,
      to_sprint: 11,
      claims_policy: 'unchanged',
      sessions_policy: 'unchanged',
      eligibility: {
        from_terminal: true,
        target_dependency_eligible: true,
        blocking_dependencies: [],
        expected_next: 11,
        target_dependencies: [10],
        completion_evidence: {
          roadmap_complete: [],
          scorecards: [],
          local_terminal: [10],
        },
      },
    });
    expect(diskAudit.prior_state.sprint).toBe(10);
  });

  it('records the dependency and scorecard evidence used for target eligibility', () => {
    const definition = roadmap();
    definition.sprints.unshift(sprint(9));
    definition.phases[0].sprints.unshift(9);
    definition.sprints.at(-1)!.depends_on = [9, 10];
    const cwd = setupWorkspace(definition);
    mkdirSync(join(cwd, 'docs', 'retros'), { recursive: true });
    writeFileSync(join(cwd, 'docs', 'retros', 'sprint-9.json'), JSON.stringify({ sprint_number: 9 }));
    saveSprintState(cwd, terminalState());

    const result = performSprintRollover(cwd, { from: 10, to: 11 }, actor);

    expect(result.record.eligibility).toMatchObject({
      target_dependencies: [9, 10],
      completion_evidence: {
        roadmap_complete: [],
        scorecards: [9],
        local_terminal: [10],
      },
    });
  });

  it('records the force decision and trimmed reason for an eligible independent target', () => {
    const cwd = setupWorkspace(roadmap('planned', []));
    saveSprintState(cwd, createSprintState(10, 'implementing'));

    const result = performSprintRollover(cwd, {
      from: 10,
      to: 11,
      force: true,
      reason: '  Source work moved to a follow-up.  ',
    }, actor);

    expect(result.record).toMatchObject({
      forced: true,
      reason: 'Source work moved to a follow-up.',
      eligibility: { from_terminal: false },
    });
    expect(result.state.rollover).toMatchObject({
      forced: true,
      reason: 'Source work moved to a follow-up.',
    });
  });

  it('reuses the exact audited next state after a crash between audit and state replacement', () => {
    const cwd = setupWorkspace();
    saveSprintState(cwd, terminalState());
    const first = performSprintRollover(cwd, { from: 10, to: 11 }, actor);
    const statePath = join(cwd, '.slope', 'sprint-state.json');

    writeFileSync(statePath, JSON.stringify(first.record.prior_state, null, 2) + '\n');
    const recovered = performSprintRollover(cwd, { from: 10, to: 11 }, actor);

    expect(recovered.already_applied).toBe(false);
    expect(recovered.record).toEqual(first.record);
    expect(recovered.state).toEqual(first.record.next_state);
    expect(loadSprintState(cwd)).toEqual(first.record.next_state);

    const stateBytes = readFileSync(statePath, 'utf8');
    const idempotent = performSprintRollover(cwd, { from: 10, to: 11 }, actor);
    expect(idempotent.already_applied).toBe(true);
    expect(idempotent.record).toEqual(first.record);
    expect(idempotent.state).toEqual(first.record.next_state);
    expect(readFileSync(statePath, 'utf8')).toBe(stateBytes);
  });

  it('remains idempotent when unrelated scorecard evidence is added later', () => {
    const cwd = setupWorkspace();
    saveSprintState(cwd, terminalState());
    const first = performSprintRollover(cwd, { from: 10, to: 11 }, actor);
    mkdirSync(join(cwd, 'docs', 'retros'), { recursive: true });
    writeFileSync(join(cwd, 'docs', 'retros', 'sprint-8.json'), JSON.stringify({ sprint_number: 8 }));

    const retried = performSprintRollover(cwd, { from: 10, to: 11 }, actor);

    expect(retried.already_applied).toBe(true);
    expect(retried.record).toEqual(first.record);
    expect(retried.state).toEqual(first.state);
  });

  it('fails closed and preserves corrupt sprint state', () => {
    const cwd = setupWorkspace();
    const statePath = join(cwd, '.slope', 'sprint-state.json');
    writeFileSync(statePath, '{broken state');

    expect(() => performSprintRollover(cwd, { from: 10, to: 11 }, actor)).toThrow(/corrupt/i);
    expect(readFileSync(statePath, 'utf8')).toBe('{broken state');
  });

  it('rejects a tampered audit without changing the installed target state', () => {
    const cwd = setupWorkspace();
    saveSprintState(cwd, terminalState());
    const first = performSprintRollover(cwd, { from: 10, to: 11 }, actor);
    const statePath = join(cwd, '.slope', 'sprint-state.json');
    const absoluteAuditPath = auditPath(cwd, first.audit_path);
    const beforeState = readFileSync(statePath, 'utf8');
    const tampered = JSON.parse(readFileSync(absoluteAuditPath, 'utf8')) as SprintRolloverAuditRecord;
    tampered.prior_state.updated_at = '1999-01-01T00:00:00.000Z';
    writeFileSync(absoluteAuditPath, JSON.stringify(tampered, null, 2) + '\n');

    expect(() => performSprintRollover(cwd, { from: 10, to: 11 }, actor)).toThrow(/integrity|audit/i);
    expect(readFileSync(statePath, 'utf8')).toBe(beforeState);
  });

  it.each([
    ['from_label', 'S999'],
    ['to_label', 'S998'],
  ])('rejects a tampered %s during crash recovery', (field, value) => {
    const cwd = setupWorkspace();
    saveSprintState(cwd, terminalState());
    const first = performSprintRollover(cwd, { from: 10, to: 11 }, actor);
    const statePath = join(cwd, '.slope', 'sprint-state.json');
    const absoluteAuditPath = auditPath(cwd, first.audit_path);
    const tampered = JSON.parse(readFileSync(absoluteAuditPath, 'utf8'));
    tampered[field] = value;
    writeFileSync(absoluteAuditPath, JSON.stringify(tampered, null, 2) + '\n');
    writeFileSync(statePath, JSON.stringify(first.record.prior_state, null, 2) + '\n');
    const beforeState = readFileSync(statePath, 'utf8');

    expect(() => performSprintRollover(cwd, { from: 10, to: 11 }, actor)).toThrow(/integrity|audit/i);
    expect(readFileSync(statePath, 'utf8')).toBe(beforeState);
  });

  it('rejects a tampered recorded_at during crash recovery', () => {
    const cwd = setupWorkspace();
    saveSprintState(cwd, terminalState());
    const first = performSprintRollover(cwd, { from: 10, to: 11 }, actor);
    const statePath = join(cwd, '.slope', 'sprint-state.json');
    const absoluteAuditPath = auditPath(cwd, first.audit_path);
    const tampered = JSON.parse(readFileSync(absoluteAuditPath, 'utf8'));
    tampered.recorded_at = '1999-01-01T00:00:00.000Z';
    writeFileSync(absoluteAuditPath, JSON.stringify(tampered, null, 2) + '\n');
    writeFileSync(statePath, JSON.stringify(first.record.prior_state, null, 2) + '\n');
    const beforeState = readFileSync(statePath, 'utf8');

    expect(() => performSprintRollover(cwd, { from: 10, to: 11 }, actor)).toThrow(/integrity|audit/i);
    expect(readFileSync(statePath, 'utf8')).toBe(beforeState);
  });

  it('rejects a self-consistently tampered transition id during crash recovery', () => {
    const cwd = setupWorkspace();
    saveSprintState(cwd, terminalState());
    const first = performSprintRollover(cwd, { from: 10, to: 11 }, actor);
    const statePath = join(cwd, '.slope', 'sprint-state.json');
    const absoluteAuditPath = auditPath(cwd, first.audit_path);
    const tampered = JSON.parse(readFileSync(absoluteAuditPath, 'utf8'));
    tampered.transition_id = '0000000000000000';
    tampered.next_state.rollover.transition_id = '0000000000000000';
    writeFileSync(absoluteAuditPath, JSON.stringify(tampered, null, 2) + '\n');
    writeFileSync(statePath, JSON.stringify(first.record.prior_state, null, 2) + '\n');
    const beforeState = readFileSync(statePath, 'utf8');

    expect(() => performSprintRollover(cwd, { from: 10, to: 11 }, actor)).toThrow(/integrity|audit/i);
    expect(readFileSync(statePath, 'utf8')).toBe(beforeState);
  });

  it('rejects tampered dependency completion evidence during crash recovery', () => {
    const definition = roadmap();
    definition.sprints.unshift(sprint(9));
    definition.phases[0].sprints.unshift(9);
    definition.sprints.at(-1)!.depends_on = [9, 10];
    const cwd = setupWorkspace(definition);
    mkdirSync(join(cwd, 'docs', 'retros'), { recursive: true });
    writeFileSync(join(cwd, 'docs', 'retros', 'sprint-9.json'), JSON.stringify({ sprint_number: 9 }));
    saveSprintState(cwd, terminalState());
    const first = performSprintRollover(cwd, { from: 10, to: 11 }, actor);
    const statePath = join(cwd, '.slope', 'sprint-state.json');
    const absoluteAuditPath = auditPath(cwd, first.audit_path);
    const tampered = JSON.parse(readFileSync(absoluteAuditPath, 'utf8'));
    tampered.eligibility.target_dependencies = [];
    tampered.eligibility.completion_evidence.scorecards = [];
    writeFileSync(absoluteAuditPath, JSON.stringify(tampered, null, 2) + '\n');
    writeFileSync(statePath, JSON.stringify(first.record.prior_state, null, 2) + '\n');
    const beforeState = readFileSync(statePath, 'utf8');

    expect(() => performSprintRollover(cwd, { from: 10, to: 11 }, actor)).toThrow(/integrity|audit/i);
    expect(readFileSync(statePath, 'utf8')).toBe(beforeState);
  });
});
