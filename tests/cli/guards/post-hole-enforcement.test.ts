import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { postHoleEnforcementGuard } from '../../../src/cli/guards/post-hole-enforcement.js';
import type { HookInput } from '../../../src/core/index.js';

function makeTmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'slope-posthole-'));
  mkdirSync(join(dir, 'docs', 'backlog'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'retros'), { recursive: true });
  mkdirSync(join(dir, '.slope'), { recursive: true });
  writeFileSync(join(dir, '.slope', 'config.json'), JSON.stringify({
    roadmapPath: 'docs/backlog/roadmap.json',
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
  }));
  // Initialize git so findShippedSprintsOnMain has a repo to query
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email test@test', { cwd: dir });
  execSync('git config user.name test', { cwd: dir });
  return dir;
}

function commit(cwd: string, message: string) {
  writeFileSync(join(cwd, `f-${Date.now()}-${Math.random()}.txt`), message);
  execSync('git add -A', { cwd });
  execSync(`git commit -q --allow-empty -m "${message}"`, { cwd });
}

function writeRoadmap(cwd: string, sprints: object[]) {
  writeFileSync(
    join(cwd, 'docs', 'backlog', 'roadmap.json'),
    JSON.stringify({ name: 'Test', phases: [], sprints }, null, 2),
  );
}

function writeScorecard(cwd: string, sprintId: number) {
  writeFileSync(
    join(cwd, 'docs', 'retros', `sprint-${sprintId}.json`),
    JSON.stringify({ sprint_number: sprintId }),
  );
}

const stopInput: HookInput = {
  session_id: 'test',
  cwd: '/will-be-overridden',
  hook_event_name: 'Stop',
  tool_response: {},
};

describe('postHoleEnforcementGuard', () => {
  let cwd: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    cwd = makeTmpRepo();
    originalEnv = process.env.SLOPE_POST_HOLE_BLOCK;
    delete process.env.SLOPE_POST_HOLE_BLOCK;
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    if (originalEnv !== undefined) process.env.SLOPE_POST_HOLE_BLOCK = originalEnv;
    else delete process.env.SLOPE_POST_HOLE_BLOCK;
  });

  it('returns empty when no roadmap exists', async () => {
    const result = await postHoleEnforcementGuard(stopInput, cwd);
    expect(result).toEqual({});
  });

  it('returns empty when no shipped sprints found', async () => {
    writeRoadmap(cwd, [{ id: 1, status: 'planned' }]);
    commit(cwd, 'chore: bump version'); // no S\d+ refs
    const result = await postHoleEnforcementGuard(stopInput, cwd);
    expect(result).toEqual({});
  });

  it('returns empty when shipped sprint is fully closed out', async () => {
    writeRoadmap(cwd, [{ id: 7, status: 'complete' }]);
    writeScorecard(cwd, 7);
    commit(cwd, 'feat(S7): closed out');

    const result = await postHoleEnforcementGuard(stopInput, cwd);
    expect(result).toEqual({});
  });

  it('warns when shipped sprint has no scorecard', async () => {
    writeRoadmap(cwd, [{ id: 7, status: 'complete' }]);
    commit(cwd, 'feat(S7): shipped without scorecard');

    const result = await postHoleEnforcementGuard(stopInput, cwd);
    expect(result.context).toBeDefined();
    expect(result.context).toContain('S7');
    expect(result.context).toContain('no scorecard');
    expect(result.decision).toBeUndefined();
  });

  it('warns when shipped sprint has wrong status', async () => {
    writeRoadmap(cwd, [{ id: 7, status: 'planned' }]);
    writeScorecard(cwd, 7);
    commit(cwd, 'feat(S7): shipped but status not updated');

    const result = await postHoleEnforcementGuard(stopInput, cwd);
    expect(result.context).toContain('S7');
    expect(result.context).toContain('status="planned"');
  });

  it('lists multiple drifting sprints sorted newest-first', async () => {
    writeRoadmap(cwd, [
      { id: 5, status: 'planned' },
      { id: 6, status: 'complete' },
      { id: 7, status: 'planned' },
    ]);
    writeScorecard(cwd, 6);
    commit(cwd, 'feat(S5+S6+S7): all shipped, S5/S7 drift');

    const result = await postHoleEnforcementGuard(stopInput, cwd);
    expect(result.context).toContain('S7');
    expect(result.context).toContain('S5');
    // Newest first: S7 line should appear before S5 line
    const idxS7 = result.context!.indexOf('S7');
    const idxS5 = result.context!.indexOf('S5');
    expect(idxS7).toBeLessThan(idxS5);
  });

  it('caps the list and shows remainder count beyond 5', async () => {
    const sprints: object[] = [];
    for (let i = 1; i <= 7; i++) {
      sprints.push({ id: i, status: 'planned' });
    }
    writeRoadmap(cwd, sprints);
    commit(cwd, 'feat(S1+S2+S3+S4+S5+S6+S7): seven drifting sprints');

    const result = await postHoleEnforcementGuard(stopInput, cwd);
    expect(result.context).toContain('and 2 more');
  });

  it('blocks instead of warns when SLOPE_POST_HOLE_BLOCK=1', async () => {
    writeRoadmap(cwd, [{ id: 7, status: 'planned' }]);
    commit(cwd, 'feat(S7): shipped');
    process.env.SLOPE_POST_HOLE_BLOCK = '1';

    const result = await postHoleEnforcementGuard(stopInput, cwd);
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('S7');
  });

  it('handles malformed roadmap JSON gracefully', async () => {
    writeFileSync(join(cwd, 'docs', 'backlog', 'roadmap.json'), '{ malformed');
    const result = await postHoleEnforcementGuard(stopInput, cwd);
    expect(result).toEqual({});
  });
});
