import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectAgentStatus } from '../../../src/cli/commands/agent.js';

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
