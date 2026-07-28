import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { phaseBoundaryGuard } from '../../../src/cli/guards/phase-boundary.js';
import type { HookInput } from '../../../src/core/index.js';

let tmpDir: string;

function makeInput(command: string): HookInput {
  return {
    session_id: 'test-session',
    cwd: tmpDir,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
  };
}

function writeConfig(): void {
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({
    roadmapPath: 'docs/backlog/roadmap.json',
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
    metaphor: 'golf',
  }));
}

function writeRoadmap(): void {
  mkdirSync(join(tmpDir, 'docs', 'backlog'), { recursive: true });
  writeFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), JSON.stringify({
    name: 'Test',
    phases: [
      { name: 'Phase 1', sprints: [1] },
      { name: 'Phase 2', sprints: [2] },
    ],
    sprints: [
      { id: 1, theme: 'First', par: 4, slope: 1, type: 'feature', tickets: [
        { id: 'S1-1', title: 'one', club: 'wedge', complexity: 'small' },
        { id: 'S1-2', title: 'two', club: 'wedge', complexity: 'small' },
        { id: 'S1-3', title: 'three', club: 'wedge', complexity: 'small' },
      ] },
      { id: 2, theme: 'Second', par: 4, slope: 1, type: 'feature', depends_on: [1], tickets: [
        { id: 'S2-1', title: 'one', club: 'wedge', complexity: 'small' },
        { id: 'S2-2', title: 'two', club: 'wedge', complexity: 'small' },
        { id: 'S2-3', title: 'three', club: 'wedge', complexity: 'small' },
      ] },
    ],
  }));
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-phase-boundary-'));
  writeConfig();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeModernRoadmap(): void {
  const ticket = (sprint: number, index: number) =>
    ({ id: `S${sprint}-${index}`, title: `t${index}`, club: 'wedge', complexity: 'small' });
  mkdirSync(join(tmpDir, 'docs', 'backlog'), { recursive: true });
  writeFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), JSON.stringify({
    name: 'Modern',
    phases: [
      { name: 'Phase 53', sprints: [243] },
      { name: 'Phase 54', sprints: [245, 246] },
    ],
    sprints: [
      { id: 243, theme: 'Prior', par: 4, slope: 1, type: 'feature', tickets: [ticket(243, 1), ticket(243, 2), ticket(243, 3)] },
      { id: 245, theme: 'Next', par: 4, slope: 1, type: 'feature', tickets: [ticket(245, 1), ticket(245, 2), ticket(245, 3)] },
      { id: 246, theme: 'Later', par: 4, slope: 1, type: 'feature', tickets: [ticket(246, 1), ticket(246, 2), ticket(246, 3)] },
    ],
  }));
}

describe('phaseBoundaryGuard', () => {
  it('blocks canonical trailing-zero sprints using authoritative phase keys', async () => {
    mkdirSync(join(tmpDir, 'docs', 'backlog'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), JSON.stringify({
      name: 'Canonical',
      phases: [
        { name: 'Phase 1', sprints: [458.1], sprint_keys: ['458.1'] },
        { name: 'Phase 2', sprints: [458.1], sprint_keys: ['458.10'] },
      ],
      sprints: [
        {
          id: 458.1,
          id_key: '458.1',
          theme: 'Prior',
          par: 3,
          slope: 1,
          type: 'feature',
          tickets: [{ id: 'S458.1-1', title: 'one', club: 'wedge', complexity: 'small' }],
        },
        {
          id: 458.1,
          id_key: '458.10',
          theme: 'Target',
          par: 3,
          slope: 1,
          type: 'feature',
          tickets: [{ id: 'S458.10-1', title: 'one', club: 'wedge', complexity: 'small' }],
        },
      ],
    }));

    const result = await phaseBoundaryGuard(
      makeInput('slope sprint start --sprint=458.10'),
      tmpDir,
    );

    expect(result.decision).toBe('deny');
    expect(result.suggestion?.context).toContain('Sprint 458.10');
  });

  it('blocks actual slope sprint starts when the previous phase is incomplete', async () => {
    writeRoadmap();

    const result = await phaseBoundaryGuard(makeInput('slope sprint start --sprint=2'), tmpDir);

    expect(result.decision).toBe('deny');
    expect(result.suggestion?.id).toBe('phase-boundary');
    expect(result.suggestion?.context).toContain('Phase 1 cleanup is incomplete');
  });

  it('downgrades to an advisory when scorecards already exist past the boundary (#621)', async () => {
    writeRoadmap();
    mkdirSync(join(tmpDir, 'docs', 'retros'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs', 'retros', 'sprint-2.json'), JSON.stringify({ sprint_number: 2 }));

    const result = await phaseBoundaryGuard(makeInput('slope sprint start --sprint=2'), tmpDir);

    expect(result.decision).toBeUndefined();
    expect(result.suggestion).toBeUndefined();
    expect(result.context).toContain('phase ledger looks stale');
    expect(result.context).toContain('slope phase complete 1');
  });

  it('still denies at a boundary whose sprint id ends in 5 with only pre-boundary scorecards', async () => {
    // sprintOrderValue would decode 245 as legacy half-sprint 24.5; the guard
    // must use roadmap-aware ordering so this boundary stays enforceable.
    writeModernRoadmap();
    mkdirSync(join(tmpDir, 'docs', 'retros'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs', 'retros', 'sprint-243.json'), JSON.stringify({ sprint_number: 243 }));

    const result = await phaseBoundaryGuard(makeInput('slope sprint start --sprint=245'), tmpDir);

    expect(result.decision).toBe('deny');
  });

  it('downgrades an ends-in-5 boundary when a roadmap-member scorecard exists past it', async () => {
    writeModernRoadmap();
    mkdirSync(join(tmpDir, 'docs', 'retros'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs', 'retros', 'sprint-245.json'), JSON.stringify({ sprint_number: 245 }));

    const result = await phaseBoundaryGuard(makeInput('slope sprint start --sprint=245'), tmpDir);

    expect(result.decision).toBeUndefined();
    expect(result.context).toContain('phase ledger looks stale');
  });

  it('ignores stray non-roadmap scorecards as staleness evidence', async () => {
    writeModernRoadmap();
    mkdirSync(join(tmpDir, 'docs', 'retros'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs', 'retros', 'sprint-999.json'), JSON.stringify({ sprint_number: 999 }));

    const result = await phaseBoundaryGuard(makeInput('slope sprint start --sprint=245'), tmpDir);

    expect(result.decision).toBe('deny');
  });

  it('never matches non-slope commands like gh issue create (#621)', async () => {
    writeRoadmap();

    const result = await phaseBoundaryGuard(
      makeInput('gh issue create --repo srbryers/slope --title "sprint 2 bug" --body "slope sprint start --sprint=2 failed"'),
      tmpDir,
    );

    expect(result).toEqual({});
  });

  it('matches package-manager slope claim invocations', async () => {
    writeRoadmap();

    const result = await phaseBoundaryGuard(makeInput('pnpm exec slope claim --target=S2-1'), tmpDir);

    expect(result.decision).toBe('deny');
    expect(result.suggestion?.context).toContain('Sprint 2');
  });

  it('matches front-door slope start invocations', async () => {
    writeRoadmap();

    const result = await phaseBoundaryGuard(makeInput('slope start --ticket=S2-1'), tmpDir);

    expect(result.decision).toBe('deny');
    expect(result.suggestion?.context).toContain('Sprint 2');
  });

  it('matches slope invocations in pipeline segments', async () => {
    writeRoadmap();

    const result = await phaseBoundaryGuard(makeInput('printf ok | slope sprint start --sprint=2'), tmpDir);

    expect(result.decision).toBe('deny');
    expect(result.suggestion?.context).toContain('Sprint 2');
  });

  it('does not match slope commands mentioned inside another command body', async () => {
    writeRoadmap();

    const result = await phaseBoundaryGuard(
      makeInput('gh issue create --title bug --body "mentions slope sprint start --sprint=2 and slope claim --target=S2-1"'),
      tmpDir,
    );

    expect(result).toEqual({});
  });

  it('ignores narrative sprint mentions on relevant slope commands without target flags', async () => {
    writeRoadmap();

    const result = await phaseBoundaryGuard(
      makeInput('slope claim --notes "mentions S2 from an abandoned execution but does not target it"'),
      tmpDir,
    );

    expect(result).toEqual({});
  });

  it('uses the validated roadmap shape without requiring project-specific sprint fields', async () => {
    writeRoadmap();

    const result = await phaseBoundaryGuard(makeInput('slope sprint start --sprint=1'), tmpDir);

    expect(result).toEqual({});
  });

  it('warns instead of blocking when the roadmap is unreadable', async () => {
    mkdirSync(join(tmpDir, 'docs', 'backlog'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), '{');

    const result = await phaseBoundaryGuard(makeInput('slope sprint start --sprint=2'), tmpDir);

    expect(result.decision).toBeUndefined();
    expect(result.blockReason).toBeUndefined();
    expect(result.context).toContain('advisory (non-blocking)');
    expect(result.context).toContain('could not read the roadmap');
    expect(result.context).toContain('this command is allowed');
  });
});
