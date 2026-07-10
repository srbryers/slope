import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sessionBriefingGuard } from '../../../src/cli/guards/session-briefing.js';
import { loadSessionState, setSessionMode, updateSessionState } from '../../../src/cli/session-state.js';
import { createSprintState, saveSprintState } from '../../../src/cli/sprint-state.js';
import type { HookInput } from '../../../src/core/index.js';

let tmpDir: string;

function makeInput(): HookInput {
  return {
    session_id: 'test-session',
    cwd: tmpDir,
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'slope sprint start --number=74 --phase=planning' },
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-session-briefing-'));
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({ metaphor: 'golf' }));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('sessionBriefingGuard', () => {
  it('promotes an already-briefed adhoc session after sprint-state appears', async () => {
    updateSessionState(tmpDir, 'briefing_session_id', 'test-session');
    setSessionMode(tmpDir, 'test-session', 'adhoc');
    saveSprintState(tmpDir, createSprintState(74, 'planning'));

    const result = await sessionBriefingGuard(makeInput(), tmpDir);

    expect(result).toEqual({});
    expect(loadSessionState(tmpDir).session_mode).toBe('sprint');
  });

  it('uses inferred roadmap context instead of stale completed sprint-state in adhoc mode', async () => {
    mkdirSync(join(tmpDir, 'docs', 'backlog'), { recursive: true });
    mkdirSync(join(tmpDir, 'docs', 'retros'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({
      roadmapPath: 'docs/backlog/roadmap.json',
      scorecardDir: 'docs/retros',
      scorecardPattern: 'sprint-*.json',
    }));
    writeFileSync(join(tmpDir, 'docs', 'retros', 'sprint-29.json'), JSON.stringify({
      sprint_number: 29,
      theme: 'Previous',
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
    writeFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), JSON.stringify({
      name: 'Test',
      phases: [{ name: 'P1', sprints: [1, 30, 31] }],
      sprints: [
        { id: 1, theme: 'Historical', par: 4, slope: 1, type: 'feature', status: 'complete', tickets: [
          { key: 'S1-1', title: 'old', club: 'wedge', complexity: 'small' },
          { key: 'S1-2', title: 'old', club: 'wedge', complexity: 'small' },
          { key: 'S1-3', title: 'old', club: 'wedge', complexity: 'small' },
        ] },
        { id: 30, theme: 'Current work', par: 4, slope: 1, type: 'feature', status: 'planned', tickets: [
          { key: 'S30-1', title: 'current', club: 'wedge', complexity: 'small' },
          { key: 'S30-2', title: 'current', club: 'wedge', complexity: 'small' },
          { key: 'S30-3', title: 'current', club: 'wedge', complexity: 'small' },
        ] },
        { id: 31, theme: 'Next work', par: 4, slope: 1, type: 'feature', status: 'planned', depends_on: [30], tickets: [
          { key: 'S31-1', title: 'next', club: 'wedge', complexity: 'small' },
          { key: 'S31-2', title: 'next', club: 'wedge', complexity: 'small' },
          { key: 'S31-3', title: 'next', club: 'wedge', complexity: 'small' },
        ] },
      ],
    }));
    const state = createSprintState(1, 'scoring');
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

    const result = await sessionBriefingGuard(makeInput(), tmpDir);

    const context = result.suggestion?.context ?? '';
    expect(context).toContain('No active sprint');
    expect(context).toContain('S30: Current work');
    expect(context).not.toContain('S1: Historical');
  });

  it('surfaces weaker self-review provenance in active sprint briefing gates', async () => {
    const state = createSprintState(74, 'implementing');
    state.gates.tests = true;
    state.gates.code_review = true;
    state.review_gates.code_review = {
      provenance: 'self_review',
      evidence: [],
      notes: 'Local-only docs change.',
      updated_at: '2026-06-27T00:00:00Z',
    };
    state.gates.architect_review = true;
    saveSprintState(tmpDir, state);

    const result = await sessionBriefingGuard(makeInput(), tmpDir);

    const context = result.suggestion?.context ?? '';
    expect(context).toContain('[x] code_review:self_review(weaker)');
    expect(context).toContain('[!] architect_review:review_evidence_missing');
  });

  it('surfaces a required independent-review waiver as a downgrade', async () => {
    const state = createSprintState(74, 'implementing');
    state.gates.architect_review = true;
    state.review_gates.architect_review = {
      provenance: 'independent_review_waived',
      evidence: [],
      notes: 'Reviewer unavailable.',
    };
    saveSprintState(tmpDir, state);

    const result = await sessionBriefingGuard(makeInput(), tmpDir);

    expect(result.suggestion?.context).toContain('[~] architect_review:independent_review_waived(required_downgrade)');
  });
});
