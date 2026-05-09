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
      started_at: '2026-05-07T00:00:00Z',
      updated_at: '2026-05-07T00:00:00Z',
    });

    const status = await collectAgentStatus(cwd);
    expect(status.phase).toBe('scoring');
    expect(status.requiredGates).toEqual(['scorecard', 'review_md']);
    expect(status.recommendedCommands).toContain('slope auto-card --sprint=8');
    expect(status.recommendedCommands).toContain('slope review');
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
