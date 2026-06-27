import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectAgentStatus, renderAgentMarkdown } from '../../../src/cli/commands/agent.js';
import type { AgentStatus } from '../../../src/cli/commands/agent.js';
import { resolveStore } from '../../../src/cli/store.js';

function makeTmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'slope-agent-'));
  mkdirSync(join(dir, '.slope'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'backlog'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'retros'), { recursive: true });
  writeFileSync(join(dir, '.slope', 'config.json'), JSON.stringify({
    roadmapPath: 'docs/backlog/roadmap.json',
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
  }));
  return dir;
}

function writeRoadmap(cwd: string, sprints: Array<Record<string, unknown>>) {
  const sprintIds = sprints.map(s => s.id as number);
  writeFileSync(
    join(cwd, 'docs', 'backlog', 'roadmap.json'),
    JSON.stringify({
      name: 'Test',
      phases: [{ name: 'P1', sprints: sprintIds }],
      sprints,
    }, null, 2),
  );
}

function writeVision(cwd: string) {
  writeFileSync(join(cwd, '.slope', 'vision.json'), JSON.stringify({
    purpose: 'test',
    priorities: ['a', 'b', 'c'],
  }));
}

function writeSprintState(cwd: string, state: object) {
  writeFileSync(join(cwd, '.slope', 'sprint-state.json'), JSON.stringify(state));
}

function reviewGatesJson(): object {
  return {
    code_review: {
      provenance: 'independent_review',
      evidence: ['agent:code-reviewer-output'],
      reviewer: 'code-reviewer',
    },
    architect_review: {
      provenance: 'independent_review',
      evidence: ['agent:architect-reviewer-output'],
      reviewer: 'architect-reviewer',
    },
  };
}

describe('agent status (GH #310)', () => {
  let cwd: string;

  beforeEach(() => { cwd = makeTmpRepo(); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it('reports missing vision and recommends create', async () => {
    const status = await collectAgentStatus(cwd);
    expect(status.vision).toBe('missing');
    expect(status.recommendedCommands[0]).toContain('slope vision create');
  });

  it('reports missing roadmap and recommends generate when vision present', async () => {
    writeVision(cwd);
    const status = await collectAgentStatus(cwd);
    expect(status.roadmap).toBe('missing');
    expect(status.recommendedCommands[0]).toContain('slope roadmap generate');
  });

  it('marks roadmap valid and surfaces current sprint when both exist', async () => {
    writeVision(cwd);
    writeRoadmap(cwd, [
      { id: 7, theme: 'A', par: 4, slope: 1, type: 'feature', status: 'complete', tickets: [
        { key: 'S7-1', title: 't1', club: 'wedge', complexity: 'small' },
        { key: 'S7-2', title: 't2', club: 'wedge', complexity: 'small' },
        { key: 'S7-3', title: 't3', club: 'wedge', complexity: 'small' },
      ] },
      { id: 8, theme: 'B', par: 4, slope: 1, type: 'feature', tickets: [
        { key: 'S8-1', title: 't1', club: 'wedge', complexity: 'small' },
        { key: 'S8-2', title: 't2', club: 'wedge', complexity: 'small' },
        { key: 'S8-3', title: 't3', club: 'wedge', complexity: 'small' },
      ] },
    ]);
    writeSprintState(cwd, {
      sprint: 8,
      phase: 'planning',
      gates: { tests: false, code_review: false, architect_review: false, scorecard: false, review_md: false },
      started_at: '2026-05-07T00:00:00Z',
      updated_at: '2026-05-07T00:00:00Z',
    });

    const status = await collectAgentStatus(cwd);
    expect(status.roadmap).toBe('valid');
    expect(status.currentSprint).toBe(8);
    expect(status.phase).toBe('planning');
    expect(status.nextTicket).toBe('S8-1');
    expect(status.requiredGates).toEqual(['tests', 'code_review', 'architect_review', 'scorecard', 'review_md']);
    expect(status.recommendedCommands).toContain('slope briefing');
  });

  it('uses pending inserted roadmap sprint when no active sprint state exists (#364)', async () => {
    writeVision(cwd);
    writeRoadmap(cwd, [
      { id: 43, theme: 'Done', par: 4, slope: 1, type: 'feature', status: 'complete', tickets: [
        { key: 'S43-1', title: 't1', club: 'wedge', complexity: 'small' },
        { key: 'S43-2', title: 't2', club: 'wedge', complexity: 'small' },
        { key: 'S43-3', title: 't3', club: 'wedge', complexity: 'small' },
      ] },
      { id: 435, theme: 'Inserted', par: 4, slope: 1, type: 'bug fix', status: 'planned', tickets: [
        { key: 'S43.5-1', title: 't1', club: 'wedge', complexity: 'small' },
        { key: 'S43.5-2', title: 't2', club: 'wedge', complexity: 'small' },
        { key: 'S43.5-3', title: 't3', club: 'wedge', complexity: 'small' },
      ] },
    ]);
    writeFileSync(join(cwd, 'docs', 'retros', 'sprint-99.json'), JSON.stringify({
      sprint_number: 99,
      theme: 'Latest',
      par: 4,
      slope: 1,
      score: 4,
      score_label: 'par',
      shots: [],
      stats: { fairways_hit: 0, fairways_total: 0, greens_in_regulation: 0, greens_total: 0, putts: 0, penalties: 0, hazards_hit: 0, hazard_penalties: 0, miss_directions: { long: 0, short: 0, left: 0, right: 0 } },
      conditions: [],
      special_plays: [],
      bunker_locations: [],
      yardage_book_updates: [],
      course_management_notes: [],
    }));

    const status = await collectAgentStatus(cwd);
    expect(status.currentSprint).toBe(435);
    expect(status.phase).toBe('unknown');
    expect(status.nextTicket).toBe('S43.5-1');
    expect(status.recommendedCommands).toContain('slope sprint start --number=435');
  });

  it('clears blockedBy when upstream sprint has a scorecard but no roadmap status field (#356)', async () => {
    writeVision(cwd);
    writeRoadmap(cwd, [
      // S1 has NO `status: complete` — closing a sprint via gates+scorecard
      // doesn't currently mutate the roadmap JSON. roadmap status reads
      // scorecard files directly; agent status now does the same.
      { id: 1, theme: 'Foundation', par: 4, slope: 1, type: 'feature', tickets: [
        { key: 'S1-1', title: 't1', club: 'wedge', complexity: 'small' },
      ] },
      { id: 2, theme: 'Next', par: 4, slope: 1, type: 'feature', depends_on: [1], tickets: [
        { key: 'S2-1', title: 't1', club: 'wedge', complexity: 'small' },
        { key: 'S2-2', title: 't2', club: 'wedge', complexity: 'small' },
      ] },
    ]);
    // Drop a real S1 scorecard on disk — this is the signal `roadmap status`
    // already trusts as "S1 is done".
    writeFileSync(join(cwd, 'docs', 'retros', 'sprint-1.json'), JSON.stringify({
      sprint_number: 1,
      theme: 'Foundation',
      par: 4,
      slope: 1,
      score: 4,
      score_label: 'par',
      date: '2026-05-08',
      shots: [],
      stats: { fairways_hit: 0, fairways_total: 0, greens_in_regulation: 0, greens_total: 0, putts: 0, penalties: 0, hazards_hit: 0, hazard_penalties: 0, miss_directions: { long: 0, short: 0, left: 0, right: 0 } },
      conditions: [],
      special_plays: [],
      bunker_locations: [],
      yardage_book_updates: [],
      course_management_notes: [],
    }));
    writeSprintState(cwd, {
      sprint: 2,
      phase: 'implementing',
      gates: { tests: false, code_review: false, architect_review: false, scorecard: false, review_md: false },
      started_at: '2026-05-09T00:00:00Z',
      updated_at: '2026-05-09T00:00:00Z',
    });

    const status = await collectAgentStatus(cwd);
    // S1 IS complete (scorecard exists); S2 is no longer blocked
    expect(status.blockedBy).toEqual([]);
    expect(status.recommendedCommands).not.toContain('slope roadmap status');
  });

  it('reports blockedBy when current sprint depends on incomplete sprint', async () => {
    writeVision(cwd);
    writeRoadmap(cwd, [
      { id: 7, theme: 'A', par: 4, slope: 1, type: 'feature', status: 'planned', tickets: [
        { key: 'S7-1', title: 't1', club: 'wedge', complexity: 'small' },
        { key: 'S7-2', title: 't2', club: 'wedge', complexity: 'small' },
        { key: 'S7-3', title: 't3', club: 'wedge', complexity: 'small' },
      ] },
      { id: 8, theme: 'B', par: 4, slope: 1, type: 'feature', depends_on: [7], tickets: [
        { key: 'S8-1', title: 't1', club: 'wedge', complexity: 'small' },
        { key: 'S8-2', title: 't2', club: 'wedge', complexity: 'small' },
        { key: 'S8-3', title: 't3', club: 'wedge', complexity: 'small' },
      ] },
    ]);
    writeSprintState(cwd, {
      sprint: 8,
      phase: 'planning',
      gates: { tests: false, code_review: false, architect_review: false, scorecard: false, review_md: false },
      started_at: '2026-05-07T00:00:00Z',
      updated_at: '2026-05-07T00:00:00Z',
    });

    const status = await collectAgentStatus(cwd);
    expect(status.blockedBy).toEqual([7]);
    expect(status.recommendedCommands).toContain('slope roadmap status');
  });

  it('recommends scorecard generation in scoring phase with missing gate', async () => {
    writeVision(cwd);
    writeRoadmap(cwd, [
      { id: 8, theme: 'B', par: 4, slope: 1, type: 'feature', tickets: [
        { key: 'S8-1', title: 't1', club: 'wedge', complexity: 'small' },
        { key: 'S8-2', title: 't2', club: 'wedge', complexity: 'small' },
        { key: 'S8-3', title: 't3', club: 'wedge', complexity: 'small' },
      ] },
    ]);
    writeSprintState(cwd, {
      sprint: 8,
      phase: 'scoring',
      gates: { tests: true, code_review: true, architect_review: true, scorecard: false, review_md: false },
      review_gates: reviewGatesJson(),
      started_at: '2026-05-07T00:00:00Z',
      updated_at: '2026-05-07T00:00:00Z',
    });

    const status = await collectAgentStatus(cwd);
    expect(status.phase).toBe('scoring');
    expect(status.requiredGates).toEqual(['scorecard', 'review_md']);
    expect(status.recommendedCommands).toContain('slope auto-card --sprint=8');
    expect(status.recommendedCommands).toContain('slope review');
  });

  it('keeps review gates pending when sprint-state booleans lack evidence', async () => {
    writeVision(cwd);
    writeRoadmap(cwd, [
      { id: 8, theme: 'B', par: 4, slope: 1, type: 'feature', tickets: [
        { key: 'S8-1', title: 't1', club: 'wedge', complexity: 'small' },
        { key: 'S8-2', title: 't2', club: 'wedge', complexity: 'small' },
        { key: 'S8-3', title: 't3', club: 'wedge', complexity: 'small' },
      ] },
    ]);
    writeSprintState(cwd, {
      sprint: 8,
      phase: 'scoring',
      gates: { tests: true, code_review: true, architect_review: true, scorecard: false, review_md: false },
      started_at: '2026-05-07T00:00:00Z',
      updated_at: '2026-05-07T00:00:00Z',
    });

    const status = await collectAgentStatus(cwd);

    expect(status.requiredGates).toEqual(['code_review', 'architect_review', 'scorecard', 'review_md']);
    expect(status.recommendedCommands).toContain('slope auto-card --sprint=8');
  });

  it('renders agent markdown with sprint, claim, and recommended commands (#315)', () => {
    const status: AgentStatus = {
      _version: 1,
      vision: 'present',
      roadmap: 'valid',
      currentSprint: 8,
      phase: 'planning',
      activeClaims: ['S8-1'],
      nextTicket: 'S8-2',
      blockedBy: [],
      requiredGates: ['tests', 'code_review'],
      recommendedCommands: ['slope prep S8-2 --lite', 'slope briefing'],
    };
    const md = renderAgentMarkdown(status, { sprintTheme: 'The Compass' });

    expect(md).toContain('# Agent Next');
    expect(md).toContain('Current sprint: S8 The Compass');
    expect(md).toContain('Current phase: planning');
    expect(md).toContain('Current claim: S8-1 active');
    expect(md).toContain('Next ticket: S8-2');
    expect(md).toContain('Next command: slope prep S8-2 --lite');
    expect(md).toContain('## Pending gates');
    expect(md).toContain('- tests');
    expect(md).toContain('## Recommended commands');
    expect(md).toContain('`slope briefing`');
    expect(md).toContain('## Status snapshot');
    expect(md).toContain('"currentSprint": 8');
  });

  it('renders blocked section when blockedBy is non-empty', () => {
    const status: AgentStatus = {
      _version: 1,
      vision: 'present',
      roadmap: 'valid',
      currentSprint: 9,
      phase: 'planning',
      activeClaims: [],
      nextTicket: null,
      blockedBy: [7, 8],
      requiredGates: [],
      recommendedCommands: ['slope roadmap status'],
    };
    const md = renderAgentMarkdown(status);
    expect(md).toContain('## Blocked');
    expect(md).toContain('S7, S8');
  });

  it('renders gracefully with all-empty status', () => {
    const status: AgentStatus = {
      _version: 1,
      vision: 'missing',
      roadmap: 'missing',
      currentSprint: null,
      phase: 'unknown',
      activeClaims: [],
      nextTicket: null,
      blockedBy: [],
      requiredGates: [],
      recommendedCommands: [],
    };
    const md = renderAgentMarkdown(status);
    expect(md).toContain('Current sprint: —');
    expect(md).toContain('Current claim: none');
    expect(md).toContain('Next command: —');
    expect(md).not.toContain('## Pending gates');
    expect(md).not.toContain('## Blocked');
  });

  it('reports the active claim as nextTicket instead of skipping ahead (#342)', async () => {
    writeVision(cwd);
    writeRoadmap(cwd, [
      { id: 1, theme: 'A', par: 4, slope: 1, type: 'feature', tickets: [
        { key: 'S1-1', title: 't1', club: 'wedge', complexity: 'small' },
        { key: 'S1-2', title: 't2', club: 'wedge', complexity: 'small' },
        { key: 'S1-3', title: 't3', club: 'wedge', complexity: 'small' },
      ] },
    ]);
    writeSprintState(cwd, {
      sprint: 1,
      phase: 'implementing',
      gates: { tests: false, code_review: false, architect_review: false, scorecard: false, review_md: false },
      started_at: '2026-05-07T00:00:00Z',
      updated_at: '2026-05-07T00:00:00Z',
    });

    // Create a real claim on S1-1 so the agent has work in flight
    const store = await resolveStore(cwd);
    await store.claim({ sprint_number: 1, player: 'agent', target: 'S1-1', scope: 'ticket' });
    store.close();

    const status = await collectAgentStatus(cwd);
    expect(status.activeClaims).toContain('S1-1');
    // The bug: status used to skip to S1-2 here. Finishing the in-flight
    // ticket beats starting a new one — nextTicket should be S1-1.
    expect(status.nextTicket).toBe('S1-1');
    // And we shouldn't be told to claim again — we already hold one.
    expect(status.recommendedCommands).not.toContain('slope claim S1-1');
    expect(status.recommendedCommands).not.toContain('slope claim S1-2');
  });

  it('advances past tickets recorded as done by `slope ticket done` (#348)', async () => {
    writeVision(cwd);
    writeRoadmap(cwd, [
      { id: 1, theme: 'A', par: 4, slope: 1, type: 'feature', tickets: [
        { key: 'S1-1', title: 't1', club: 'wedge', complexity: 'small' },
        { key: 'S1-2', title: 't2', club: 'wedge', complexity: 'small' },
        { key: 'S1-3', title: 't3', club: 'wedge', complexity: 'small' },
      ] },
    ]);
    writeSprintState(cwd, {
      sprint: 1,
      phase: 'implementing',
      gates: { tests: false, code_review: false, architect_review: false, scorecard: false, review_md: false },
      started_at: '2026-05-07T00:00:00Z',
      updated_at: '2026-05-07T00:00:00Z',
    });

    // Mirror what `slope ticket done S1-1` writes: a `decision` event with
    // kind=ticket_done. The claim has already been released, so activeClaims
    // is empty. Without the #348 fix, status would still recommend S1-1.
    const store = await resolveStore(cwd);
    await store.insertEvent({
      type: 'decision',
      sprint_number: 1,
      ticket_key: 'S1-1',
      data: { kind: 'ticket_done', player: 'agent', commit: 'abc1234' },
    });
    store.close();

    const status = await collectAgentStatus(cwd);
    expect(status.activeClaims).toEqual([]);
    expect(status.nextTicket).toBe('S1-2');
  });

  it('returns null nextTicket when every ticket is done (#348)', async () => {
    writeVision(cwd);
    writeRoadmap(cwd, [
      { id: 1, theme: 'A', par: 4, slope: 1, type: 'feature', tickets: [
        { key: 'S1-1', title: 't1', club: 'wedge', complexity: 'small' },
        { key: 'S1-2', title: 't2', club: 'wedge', complexity: 'small' },
      ] },
    ]);
    writeSprintState(cwd, {
      sprint: 1,
      phase: 'implementing',
      gates: { tests: true, code_review: true, architect_review: true, scorecard: false, review_md: false },
      review_gates: reviewGatesJson(),
      started_at: '2026-05-07T00:00:00Z',
      updated_at: '2026-05-07T00:00:00Z',
    });

    const store = await resolveStore(cwd);
    for (const k of ['S1-1', 'S1-2']) {
      await store.insertEvent({
        type: 'decision',
        sprint_number: 1,
        ticket_key: k,
        data: { kind: 'ticket_done', player: 'agent' },
      });
    }
    store.close();

    const status = await collectAgentStatus(cwd);
    expect(status.nextTicket).toBeNull();
  });

  it('falls back to first un-claimed ticket when no claims exist (#342 regression)', async () => {
    writeVision(cwd);
    writeRoadmap(cwd, [
      { id: 1, theme: 'A', par: 4, slope: 1, type: 'feature', tickets: [
        { key: 'S1-1', title: 't1', club: 'wedge', complexity: 'small' },
        { key: 'S1-2', title: 't2', club: 'wedge', complexity: 'small' },
      ] },
    ]);
    writeSprintState(cwd, {
      sprint: 1,
      phase: 'implementing',
      gates: { tests: false, code_review: false, architect_review: false, scorecard: false, review_md: false },
      started_at: '2026-05-07T00:00:00Z',
      updated_at: '2026-05-07T00:00:00Z',
    });

    const status = await collectAgentStatus(cwd);
    expect(status.activeClaims).toEqual([]);
    expect(status.nextTicket).toBe('S1-1');
  });

  it('returns null nextTicket when sprint is unknown to roadmap', async () => {
    writeVision(cwd);
    writeRoadmap(cwd, [
      { id: 1, theme: 'A', par: 4, slope: 1, type: 'feature', tickets: [
        { key: 'S1-1', title: 't1', club: 'wedge', complexity: 'small' },
        { key: 'S1-2', title: 't2', club: 'wedge', complexity: 'small' },
        { key: 'S1-3', title: 't3', club: 'wedge', complexity: 'small' },
      ] },
    ]);
    writeSprintState(cwd, {
      sprint: 999,
      phase: 'planning',
      gates: { tests: false, code_review: false, architect_review: false, scorecard: false, review_md: false },
      started_at: '2026-05-07T00:00:00Z',
      updated_at: '2026-05-07T00:00:00Z',
    });

    const status = await collectAgentStatus(cwd);
    expect(status.currentSprint).toBe(999);
    expect(status.nextTicket).toBeNull();
  });
});
