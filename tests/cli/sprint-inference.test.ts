import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inferSprintContext } from '../../src/cli/sprint-inference.js';
import { createSprintState, saveSprintState } from '../../src/cli/sprint-state.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-sprint-inference-'));
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({
    currentSprint: 18,
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
  }));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('inferSprintContext', () => {
  it('prefers active sprint-state over stale config currentSprint', () => {
    saveSprintState(tmpDir, createSprintState(74, 'planning'));

    const context = inferSprintContext(tmpDir);

    expect(context.sprint).toBe(74);
    expect(context.source).toBe('sprint-state');
  });

  it('ignores completed sprint-state when inferring current work', () => {
    saveSprintState(tmpDir, createSprintState(74, 'complete'));

    const context = inferSprintContext(tmpDir);

    expect(context.sprint).toBe(18);
    expect(context.source).toBe('config');
  });

  it('ignores fully gated scoring sprint-state when inferring current work', () => {
    const state = createSprintState(74, 'scoring');
    state.gates.tests = true;
    state.gates.code_review = true;
    state.gates.architect_review = true;
    state.gates.scorecard = true;
    state.gates.review_md = true;
    state.review_gates.code_review = {
      provenance: 'independent_review',
      evidence: ['agent:code-reviewer-output'],
      reviewer: 'code-reviewer',
    };
    state.review_gates.architect_review = {
      provenance: 'independent_review',
      evidence: ['agent:architect-reviewer-output'],
      reviewer: 'architect-reviewer',
    };
    saveSprintState(tmpDir, state);

    const context = inferSprintContext(tmpDir);

    expect(context.sprint).toBe(18);
    expect(context.source).toBe('config');
  });

  it('ignores active local sprint-state older than completed scorecard evidence (#601)', () => {
    mkdirSync(join(tmpDir, 'docs', 'retros'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs', 'retros', 'sprint-453.json'), JSON.stringify({
      sprint_number: 453,
      theme: 'Merged feature',
      par: 3,
      slope: 1,
      score: 3,
      shots: [],
    }));
    saveSprintState(tmpDir, createSprintState(444, 'planning'));

    const context = inferSprintContext(tmpDir);

    expect(context.sprint).toBe(454);
    expect(context.source).toBe('scorecards');
    expect(context.latestScorecard).toBe('453');
    expect(context.staleSprintState).toMatchObject({
      sprint: 444,
      phase: 'planning',
    });
    expect(context.staleConfigSprint).toMatchObject({ sprint: 18 });
  });

  it('prefers a ready focused successor over older pending backlog after the latest scorecard (#610)', () => {
    writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({
      scorecardDir: 'docs/retros',
      scorecardPattern: 'sprint-*.json',
      roadmapPath: 'docs/backlog/roadmap.json',
    }));
    mkdirSync(join(tmpDir, 'docs', 'retros'), { recursive: true });
    mkdirSync(join(tmpDir, 'docs', 'backlog'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs', 'retros', 'sprint-455.json'), JSON.stringify({
      sprint_number: 455,
      theme: 'Merged feature',
      par: 3,
      slope: 1,
      score: 3,
      shots: [],
    }));
    writeFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), JSON.stringify({
      name: 'Focused roadmap',
      phases: [{ name: 'Old backlog', sprints: [115] }, { name: 'Current phase', sprints: [455, 456] }],
      sprints: [
        { id: 115, theme: 'Historical backlog', par: 3, slope: 1, type: 'feature', status: 'planned', tickets: [] },
        { id: 455, theme: 'Merged feature', par: 3, slope: 1, type: 'feature', status: 'complete', tickets: [] },
        { id: 456, theme: 'Ready successor', par: 3, slope: 1, type: 'feature', status: 'planned', depends_on: [455], tickets: [] },
      ],
    }));

    const context = inferSprintContext(tmpDir);

    expect(context.sprint).toBe(456);
    expect(context.source).toBe('roadmap');
    expect(context.roadmapSprint?.theme).toBe('Ready successor');
  });
});
