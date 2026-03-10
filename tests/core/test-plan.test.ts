import { describe, it, expect } from 'vitest';
import { parseTestPlan, getTestPlanSummary, getAreasNeedingTest } from '../../src/core/test-plan.js';

const SAMPLE_PLAN = `# Manual Test Plan

Last updated: 2026-03-10

## How to use this plan

1. Pick focus areas marked \`untested\`

## Status key

- \`untested\` — Never tested
- \`passed\` — Tested, no issues

---

## Onboarding & Auth

| Area | Status | Last Tested | Notes |
|------|--------|-------------|-------|
| First launch → onboarding flow | untested | — | Rehearsal-first onboarding |
| Auth screen (Apple/Google) | passed | 2026-03-01 | Works on iOS 18 |
| Sign-out + cleanup | issues | 2026-02-28 | Local data not cleared |

## Rehearsal (Voice)

| Area | Status | Last Tested | Notes |
|------|--------|-------------|-------|
| Voice mode toggle | passed | 2026-03-05 | |
| TTS playback | stale | 2026-02-15 | Code changed in S40 |
| Audio replay button | fixed | 2026-03-08 | S40 fix shipped |

## Settings

| Area | Status | Last Tested | Notes |
|------|--------|-------------|-------|
| Profile editing | untested | — | |
| Voice selection | passed | 2026-03-05 | |

---

## Session Log

| # | Date | Focus | Findings | Session File |
|---|------|-------|----------|-------------|
| 1 | 2026-03-01 | Auth | 1 | sessions/2026-03-01.md |
`;

describe('parseTestPlan', () => {
  it('parses sections and areas from markdown', () => {
    const result = parseTestPlan(SAMPLE_PLAN);
    expect(result.sections).toHaveLength(3);
    expect(result.sections[0].name).toBe('Onboarding & Auth');
    expect(result.sections[0].areas).toHaveLength(3);
    expect(result.sections[1].name).toBe('Rehearsal (Voice)');
    expect(result.sections[1].areas).toHaveLength(3);
    expect(result.sections[2].name).toBe('Settings');
    expect(result.sections[2].areas).toHaveLength(2);
  });

  it('extracts area details correctly', () => {
    const result = parseTestPlan(SAMPLE_PLAN);
    const auth = result.sections[0].areas[1];
    expect(auth.area).toBe('Auth screen (Apple/Google)');
    expect(auth.status).toBe('passed');
    expect(auth.lastTested).toBe('2026-03-01');
    expect(auth.notes).toBe('Works on iOS 18');
  });

  it('normalizes status to lowercase', () => {
    const md = `## Test\n\n| Area | Status | Last Tested | Notes |\n|---|---|---|---|\n| Foo | PASSED | — | |\n`;
    const result = parseTestPlan(md);
    expect(result.sections[0].areas[0].status).toBe('passed');
  });

  it('skips meta sections (How to use, Status key, Session Log)', () => {
    const result = parseTestPlan(SAMPLE_PLAN);
    const names = result.sections.map(s => s.name);
    expect(names).not.toContain('How to use this plan');
    expect(names).not.toContain('Status key');
    expect(names).not.toContain('Session Log');
  });

  it('handles empty markdown', () => {
    const result = parseTestPlan('');
    expect(result.sections).toHaveLength(0);
    expect(result.summary.total).toBe(0);
  });

  it('handles section with no table', () => {
    const md = `## My Section\n\nSome description text, no table here.\n\n## Another\n\n| Area | Status | Last Tested | Notes |\n|---|---|---|---|\n| Foo | untested | — | |\n`;
    const result = parseTestPlan(md);
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].areas).toHaveLength(0);
    expect(result.sections[1].areas).toHaveLength(1);
  });

  it('handles rows with missing columns', () => {
    const md = `## Test\n\n| Area | Status | Last Tested | Notes |\n|---|---|---|---|\n| Foo | passed |\n`;
    const result = parseTestPlan(md);
    expect(result.sections[0].areas).toHaveLength(1);
    expect(result.sections[0].areas[0].area).toBe('Foo');
    expect(result.sections[0].areas[0].status).toBe('passed');
    expect(result.sections[0].areas[0].lastTested).toBe('—');
  });

  it('handles extra whitespace in cells', () => {
    const md = `## Test\n\n| Area | Status | Last Tested | Notes |\n|---|---|---|---|\n|  Foo Bar  |  passed  |  2026-01-01  |  some note  |\n`;
    const result = parseTestPlan(md);
    const area = result.sections[0].areas[0];
    expect(area.area).toBe('Foo Bar');
    expect(area.status).toBe('passed');
    expect(area.lastTested).toBe('2026-01-01');
    expect(area.notes).toBe('some note');
  });
});

describe('getTestPlanSummary', () => {
  it('computes correct counts', () => {
    const { summary } = parseTestPlan(SAMPLE_PLAN);
    expect(summary.total).toBe(8);
    expect(summary.untested).toBe(2);
    expect(summary.passed).toBe(3);
    expect(summary.issues).toBe(1);
    expect(summary.stale).toBe(1);
    expect(summary.fixed).toBe(1);
    expect(summary.other).toBe(0);
  });

  it('returns zeros for empty sections', () => {
    const summary = getTestPlanSummary([]);
    expect(summary.total).toBe(0);
    expect(summary.untested).toBe(0);
    expect(summary.passed).toBe(0);
  });

  it('counts unknown statuses as other', () => {
    const md = `## Test\n\n| Area | Status | Last Tested | Notes |\n|---|---|---|---|\n| Foo | blocked | — | |\n`;
    const { summary } = parseTestPlan(md);
    expect(summary.other).toBe(1);
  });
});

describe('getAreasNeedingTest', () => {
  it('returns untested, stale, and fixed areas', () => {
    const { sections } = parseTestPlan(SAMPLE_PLAN);
    const needs = getAreasNeedingTest(sections);
    expect(needs).toHaveLength(4);

    const statuses = needs.map(n => n.status);
    expect(statuses).toContain('untested');
    expect(statuses).toContain('stale');
    expect(statuses).toContain('fixed');
    expect(statuses).not.toContain('passed');
    expect(statuses).not.toContain('issues');
  });

  it('includes section name for each area', () => {
    const { sections } = parseTestPlan(SAMPLE_PLAN);
    const needs = getAreasNeedingTest(sections);
    const onboarding = needs.filter(n => n.section === 'Onboarding & Auth');
    expect(onboarding).toHaveLength(1);
    expect(onboarding[0].area).toBe('First launch → onboarding flow');
  });

  it('returns empty array when everything is passed', () => {
    const md = `## Test\n\n| Area | Status | Last Tested | Notes |\n|---|---|---|---|\n| Foo | passed | 2026-01-01 | |\n`;
    const { sections } = parseTestPlan(md);
    const needs = getAreasNeedingTest(sections);
    expect(needs).toHaveLength(0);
  });
});
