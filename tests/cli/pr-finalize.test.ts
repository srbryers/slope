import { describe, it, expect } from 'vitest';
import {
  defaultReviewType,
  extractIssueRefs,
  existingAutoCloseRefs,
  formatReviewRecommendations,
} from '../../src/cli/commands/pr.js';

describe('extractIssueRefs (GH #321)', () => {
  it('extracts a single issue ref', () => {
    expect(extractIssueRefs('fix: handle null (closes #123)')).toEqual([123]);
  });

  it('extracts multiple unique refs sorted ascending', () => {
    expect(extractIssueRefs('fix: GH #299, #297 — multi-sprint findings')).toEqual([297, 299]);
  });

  it('deduplicates repeats', () => {
    expect(extractIssueRefs('mentions #42 once and #42 again and #42')).toEqual([42]);
  });

  it('ignores in-word numbers', () => {
    expect(extractIssueRefs('SHA abc#1234 in body')).toEqual([]);
  });

  it('handles "GH #N" parenthetical form (the original #321 motivator)', () => {
    expect(extractIssueRefs('fix: ... (GH #297, #299)')).toEqual([297, 299]);
  });

  it('returns empty for no refs', () => {
    expect(extractIssueRefs('refactor: rename foo')).toEqual([]);
  });
});

describe('existingAutoCloseRefs (GH #321)', () => {
  it('detects "Closes #N"', () => {
    expect(existingAutoCloseRefs('Closes #42.')).toEqual(new Set([42]));
  });

  it('detects "Fixes #N" and "Resolves #N"', () => {
    expect(existingAutoCloseRefs('Fixes #1\nResolves #2')).toEqual(new Set([1, 2]));
  });

  it('is case-insensitive', () => {
    expect(existingAutoCloseRefs('closes #1\nFIXES #2\nResolved #3')).toEqual(new Set([1, 2, 3]));
  });

  it('handles "Closes #1, #2, #3" comma list', () => {
    // Note: GitHub itself only auto-closes the FIRST in this style, but the
    // detector is conservative — flagging anything that looks intentional
    // so we don't double-up. The first ref will be detected.
    const refs = existingAutoCloseRefs('Closes #1, #2, #3');
    expect(refs.has(1)).toBe(true);
  });

  it('does not match plain mentions', () => {
    expect(existingAutoCloseRefs('See #42 for details.')).toEqual(new Set());
  });

  it('matches bare keyword forms (GitHub auto-close also accepts these)', () => {
    // GitHub treats "close #N", "fix #N", "resolve #N" as auto-close keywords too
    expect(existingAutoCloseRefs('To close #42 we will need...')).toEqual(new Set([42]));
  });

  it('matches "fixed" / "closed" past tense', () => {
    expect(existingAutoCloseRefs('Fixed #42')).toEqual(new Set([42]));
    expect(existingAutoCloseRefs('Closed #43')).toEqual(new Set([43]));
  });
});

describe('pr review workflow helpers (S94-5)', () => {
  it('defaults transport-independent PR review to both architect and code prompts', () => {
    expect(defaultReviewType([
      { review_type: 'architect', priority: 'required', reason: '4 tickets warrants architectural review' },
      { review_type: 'code', priority: 'optional', reason: 'Baseline code review' },
    ])).toBe('both');
  });

  it('formats review recommendations for command output', () => {
    const output = formatReviewRecommendations([
      { review_type: 'architect', priority: 'required', reason: '4 tickets warrants architectural review' },
      { review_type: 'code', priority: 'optional', reason: 'Baseline code review' },
    ]);

    expect(output).toContain('architect');
    expect(output).toContain('required');
    expect(output).toContain('Baseline code review');
  });
});
