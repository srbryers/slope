import { describe, expect, it } from 'vitest';
import {
  buildReviewerAgentSpecs,
  formatReviewerAgentGuidance,
  formatReviewerAgentSummary,
} from '../../src/cli/reviewer-agents.js';

describe('reviewer agent guidance', () => {
  it('derives purpose-built reviewer roles from sprint domain and artifacts', () => {
    const specs = buildReviewerAgentSpecs([
      { review_type: 'architect', priority: 'required', reason: '4 tickets warrants architectural review' },
      { review_type: 'code', priority: 'optional', reason: 'Baseline code review' },
    ], {
      sprintNumber: 562,
      theme: 'Stock recommendation scoring safety',
      filePatterns: ['src/scoring/methodology.ts', 'src/recommendations/ranking.ts'],
      hazards: ['Risk: scoring methodology can overstate confidence.'],
    });

    expect(specs.map(spec => spec.name)).toEqual([
      'architecture/product-safety reviewer',
      'data/scoring-methodology reviewer',
    ]);
    expect(specs[0].prompt).toContain('does not need to be an existing cc-them agent');
    expect(specs[0].prompt).toContain('Risk: scoring methodology can overstate confidence.');
    expect(specs[0].evidence).toContain('agent id/name');
    expect(specs[0].evidence).toContain('how fixes were addressed');
  });

  it('formats gate evidence commands and summary for agent-facing output', () => {
    const specs = buildReviewerAgentSpecs([
      { review_type: 'security', priority: 'required', reason: 'auth files changed' },
    ], {
      filePatterns: ['src/auth/token.ts'],
    });

    const guidance = formatReviewerAgentGuidance(specs);
    expect(guidance).toContain('Purpose-built reviewer agents');
    expect(guidance).toContain('they do not need to be existing cc-them agents');
    expect(guidance).toContain('slope sprint gate code_review --reviewer=security-risk-boundary-reviewer --evidence=<transcript-or-output>');

    const summary = formatReviewerAgentSummary(specs);
    expect(summary).toContain('Create purpose-built reviewer agents');
    expect(summary).toContain('agent id/name, lane, verdict');
  });
});
