import { describe, it, expect } from 'vitest';
import {
  buildIssueCandidates,
  classifySlopeIssue,
  dedupeCandidates,
  formatIssueBody,
  mergeIssueScoutState,
  parseIssueScoutState,
  renderIssueScoutDigest,
} from '../../src/core/issue-scout.js';
import type { ExistingIssue, IssueScoutEvidence, IssueScoutState } from '../../src/core/issue-scout.js';

function fathomsEvidence(): IssueScoutEvidence[] {
  return [
    {
      source: 'fathoms-s342',
      sourcePath: '.slope/common-issues.json',
      sprint: 342,
      quote: 'Ticket-style scorecard result: "short" was rendered as Green in slope review for S342-T5.',
      command: 'slope review docs/retros/sprint-342.json',
    },
    {
      source: 'fathoms-s341',
      sourcePath: '.slope/common-issues.json',
      sprint: 341,
      quote: 'slope review docs/retros/sprint-341.json printed to stdout but did not create docs/retros/sprint-341-review.md, leaving the canonical review markdown missing.',
      command: 'slope review docs/retros/sprint-341.json',
    },
    {
      source: 'fathoms-s341-pr',
      sourcePath: '.slope/common-issues.json',
      sprint: 341,
      quote: 'slope pr status reported PR review: reviewed after slope pr review only generated prompts; review rounds had not completed.',
      command: 'slope pr status --sprint=341',
    },
    {
      source: 'fathoms-s345-s362',
      sourcePath: '.slope/common-issues.json',
      sprint: 362,
      quote: 'SLOPE explore warning loop flooded output 650x and slope briefing hung after dumping a huge hazard ledger; stale-map warnings around CODEBASE.md did not clear.',
      command: 'slope briefing --sprint=362',
    },
    {
      source: 'fathoms-s348',
      sourcePath: '.slope/common-issues.json',
      sprint: 348,
      quote: 'slope validate --sprint=348 behaved like a historical project-wide validation pass and failed because older scorecards were invalid.',
      command: 'slope validate --sprint=348',
    },
    {
      source: 'fathoms-s351',
      sourcePath: '.slope/common-issues.json',
      sprint: 351,
      quote: 'slope sprint status failed with better-sqlite3 native ABI drift: module compiled for NODE_MODULE_VERSION 127 while active Node required 147.',
      command: 'slope sprint status',
    },
  ];
}

const EXPECTED_TITLES = [
  'Ticket-style scorecards break review/recommend/amend normalization',
  'Sprint review should materialize or verify the canonical review markdown',
  'PR review state should not mark prompt generation as reviewed',
  'Explore/stale-map warnings flood output and can hang briefing across long sprint runs',
  'validate --sprint should isolate the requested sprint result',
  'sprint status should detect or recover better-sqlite3 native ABI drift',
];

describe('classifySlopeIssue', () => {
  it('classifies known Fathoms S341-S362 SLOPE issue shapes', () => {
    const candidates = buildIssueCandidates(fathomsEvidence());
    expect(candidates.map(candidate => candidate.title).sort()).toEqual(EXPECTED_TITLES.sort());
    expect(candidates.every(candidate => candidate.confidence >= 0.7)).toBe(true);
  });

  it('ignores project work that lacks enough SLOPE product signals', () => {
    const classification = classifySlopeIssue('Unity terrain material needed a render-pass repair in Fathoms.');
    expect(classification.slopeDriven).toBe(false);
  });

  it('uses evidence headings instead of source paths for fallback titles', () => {
    const [candidate] = buildIssueCandidates([{
      source: 'docs/issues/post-implementation-gate-gap.md',
      sourcePath: 'docs/issues/post-implementation-gate-gap.md',
      quote: 'Issue: No Post-Implementation Workflow Gate\nSLOPE guard coverage is missing after implementation and sprints can stop without review or PR.',
    }]);

    expect(candidate.title).toBe('No Post-Implementation Workflow Gate');
  });
});

describe('dedupeCandidates', () => {
  it('dedupes exact existing GitHub issue titles', () => {
    const candidates = buildIssueCandidates(fathomsEvidence());
    const existingIssues: ExistingIssue[] = EXPECTED_TITLES.map((title, index) => ({
      number: 485 + index,
      title,
      state: 'OPEN',
      url: `https://github.com/srbryers/slope/issues/${485 + index}`,
    }));

    const deduped = dedupeCandidates(candidates, existingIssues);

    expect(deduped.every(candidate => candidate.dedupe?.status === 'duplicate')).toBe(true);
    expect(deduped.map(candidate => candidate.dedupe?.matchedIssue?.title).sort()).toEqual(EXPECTED_TITLES.sort());
  });

  it('dedupes by scout fingerprint in an existing issue body', () => {
    const [candidate] = buildIssueCandidates([fathomsEvidence()[0]]);
    const deduped = dedupeCandidates([candidate], [{
      number: 999,
      title: 'Different title',
      body: `metadata\nslope-issue-scout:fingerprint:${candidate.fingerprint}\n`,
    }]);

    expect(deduped[0].dedupe?.status).toBe('duplicate');
    expect(deduped[0].dedupe?.matchedIssue?.number).toBe(999);
  });
});

describe('issue body and digest formatting', () => {
  it('includes evidence, acceptance criteria, and fingerprint metadata', () => {
    const [candidate] = buildIssueCandidates([fathomsEvidence()[0]]);
    const body = formatIssueBody(candidate);

    expect(body).toContain('## Evidence');
    expect(body).toContain('## Acceptance Criteria');
    expect(body).toContain(`slope-issue-scout:fingerprint:${candidate.fingerprint}`);
  });

  it('renders a daily approval request digest', () => {
    const candidates = dedupeCandidates(buildIssueCandidates(fathomsEvidence()), []);
    const digest = renderIssueScoutDigest(candidates, {
      generatedAt: '2026-06-03T12:00:00.000Z',
      repo: 'srbryers/slope',
    });

    expect(digest).toContain('## Request Approval To Fix');
    expect(digest).toContain('requested decision: approve fix, defer, or reject');
    expect(digest).toContain('srbryers/slope');
  });
});

describe('issue scout state', () => {
  it('parses corrupt state as empty and merges records by fingerprint', () => {
    const state = parseIssueScoutState('{not-json') satisfies IssueScoutState;
    const merged = mergeIssueScoutState(state, [
      {
        fingerprint: 'abc',
        title: 'First',
        status: 'created',
        updatedAt: '2026-06-03T12:00:00.000Z',
        sourcePaths: ['a'],
      },
      {
        fingerprint: 'abc',
        title: 'First',
        status: 'commented',
        updatedAt: '2026-06-03T13:00:00.000Z',
        sourcePaths: ['b', 'a'],
      },
    ]);

    expect(merged.records).toHaveLength(1);
    expect(merged.records[0]).toMatchObject({ fingerprint: 'abc', status: 'commented' });
    expect(merged.records[0].sourcePaths).toEqual(['a', 'b']);
  });
});
