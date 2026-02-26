import { describe, it, expect } from 'vitest';
import { recommendReviews, findingToHazard } from '../../src/core/review.js';
import type { ReviewFinding } from '../../src/core/types.js';
import { REVIEW_TYPE_HAZARD_MAP } from '../../src/core/constants.js';

// --- recommendReviews ---

describe('recommendReviews', () => {
  it('recommends architect as required for 3+ tickets', () => {
    const recs = recommendReviews({ ticketCount: 3, slope: 1 });
    const arch = recs.find(r => r.review_type === 'architect');
    expect(arch).toBeDefined();
    expect(arch!.priority).toBe('required');
    expect(arch!.reason).toContain('3 tickets');
  });

  it('recommends architect as required for slope >= 3', () => {
    const recs = recommendReviews({ ticketCount: 2, slope: 3 });
    const arch = recs.find(r => r.review_type === 'architect');
    expect(arch).toBeDefined();
    expect(arch!.priority).toBe('required');
    expect(arch!.reason).toContain('Slope 3');
  });

  it('recommends architect as required when hasNewInfra', () => {
    const recs = recommendReviews({ ticketCount: 1, slope: 1, hasNewInfra: true });
    const arch = recs.find(r => r.review_type === 'architect');
    expect(arch).toBeDefined();
    expect(arch!.priority).toBe('required');
    expect(arch!.reason).toContain('infrastructure');
  });

  it('recommends architect as recommended for 2 tickets', () => {
    const recs = recommendReviews({ ticketCount: 2, slope: 1 });
    const arch = recs.find(r => r.review_type === 'architect');
    expect(arch).toBeDefined();
    expect(arch!.priority).toBe('recommended');
  });

  it('does not recommend architect for 1 ticket, low slope, no infra', () => {
    const recs = recommendReviews({ ticketCount: 1, slope: 1 });
    const arch = recs.find(r => r.review_type === 'architect');
    expect(arch).toBeUndefined();
  });

  it('recommends security for auth file patterns', () => {
    const recs = recommendReviews({
      ticketCount: 2,
      slope: 1,
      filePatterns: ['src/auth/login.ts', 'src/utils.ts'],
    });
    const sec = recs.find(r => r.review_type === 'security');
    expect(sec).toBeDefined();
    expect(sec!.priority).toBe('required');
  });

  it('recommends security for crypto file patterns', () => {
    const recs = recommendReviews({
      ticketCount: 1,
      slope: 1,
      filePatterns: ['src/crypto/hash.ts'],
    });
    const sec = recs.find(r => r.review_type === 'security');
    expect(sec).toBeDefined();
  });

  it('recommends ml-engineer for AI file patterns', () => {
    const recs = recommendReviews({
      ticketCount: 2,
      slope: 1,
      filePatterns: ['src/model/inference.ts'],
    });
    const ml = recs.find(r => r.review_type === 'ml-engineer');
    expect(ml).toBeDefined();
    expect(ml!.priority).toBe('recommended');
  });

  it('recommends ml-engineer for research sprint type', () => {
    const recs = recommendReviews({
      ticketCount: 2,
      slope: 1,
      sprintType: 'research',
    });
    const ml = recs.find(r => r.review_type === 'ml-engineer');
    expect(ml).toBeDefined();
    expect(ml!.reason).toContain('Research sprint');
  });

  it('recommends ux for UI file patterns', () => {
    const recs = recommendReviews({
      ticketCount: 2,
      slope: 1,
      filePatterns: ['src/components/Button.tsx'],
    });
    const ux = recs.find(r => r.review_type === 'ux');
    expect(ux).toBeDefined();
    expect(ux!.priority).toBe('recommended');
  });

  it('always includes code review as optional', () => {
    const recs = recommendReviews({ ticketCount: 1, slope: 1 });
    const code = recs.find(r => r.review_type === 'code');
    expect(code).toBeDefined();
    expect(code!.priority).toBe('optional');
    expect(code!.reason).toBe('Baseline code review');
  });

  it('handles empty filePatterns', () => {
    const recs = recommendReviews({ ticketCount: 1, slope: 1, filePatterns: [] });
    expect(recs.some(r => r.review_type === 'security')).toBe(false);
    expect(recs.some(r => r.review_type === 'ml-engineer')).toBe(false);
    expect(recs.some(r => r.review_type === 'ux')).toBe(false);
  });

  it('handles undefined filePatterns', () => {
    const recs = recommendReviews({ ticketCount: 1, slope: 1 });
    expect(recs.some(r => r.review_type === 'security')).toBe(false);
  });

  it('returns multiple recommendations for complex sprint', () => {
    const recs = recommendReviews({
      ticketCount: 4,
      slope: 3,
      sprintType: 'feature',
      filePatterns: ['src/auth/oauth.ts', 'src/components/LoginForm.tsx'],
      hasNewInfra: true,
    });
    const types = recs.map(r => r.review_type);
    expect(types).toContain('architect');
    expect(types).toContain('security');
    expect(types).toContain('ux');
    expect(types).toContain('code');
  });

  it('produces correct recommendations for Sprint 34 profile', () => {
    const recs = recommendReviews({
      ticketCount: 4,
      slope: 2,
      sprintType: 'feature',
      filePatterns: ['src/core/review.ts', 'src/cli/commands/review-state.ts'],
    });
    const arch = recs.find(r => r.review_type === 'architect');
    expect(arch).toBeDefined();
    expect(arch!.priority).toBe('required');
    // No security, ML, or UX patterns
    expect(recs.some(r => r.review_type === 'security')).toBe(false);
    expect(recs.some(r => r.review_type === 'ml-engineer')).toBe(false);
    expect(recs.some(r => r.review_type === 'ux')).toBe(false);
  });
});

// --- findingToHazard ---

describe('findingToHazard', () => {
  it('maps architect finding to bunker hazard', () => {
    const finding: ReviewFinding = {
      review_type: 'architect',
      ticket_key: 'S33-1',
      severity: 'moderate',
      description: 'Malformed JSONL crash',
      resolved: true,
    };
    const hazard = findingToHazard(finding);
    expect(hazard.type).toBe('bunker');
    expect(hazard.severity).toBe('moderate');
    expect(hazard.description).toBe('[architect review] Malformed JSONL crash');
    expect(hazard.gotcha_id).toBe('review:architect');
  });

  it('maps code finding to rough hazard', () => {
    const hazard = findingToHazard({
      review_type: 'code',
      ticket_key: 'S33-2',
      severity: 'minor',
      description: 'Sort instability',
      resolved: true,
    });
    expect(hazard.type).toBe('rough');
    expect(hazard.gotcha_id).toBe('review:code');
  });

  it('maps ml-engineer finding to rough hazard', () => {
    const hazard = findingToHazard({
      review_type: 'ml-engineer',
      ticket_key: 'S33-3',
      severity: 'moderate',
      description: 'Stats underutilizes schema',
      resolved: true,
    });
    expect(hazard.type).toBe('rough');
    expect(hazard.gotcha_id).toBe('review:ml-engineer');
  });

  it('maps security finding to water hazard', () => {
    const hazard = findingToHazard({
      review_type: 'security',
      ticket_key: 'S1-1',
      severity: 'critical',
      description: 'SQL injection in query builder',
      resolved: false,
    });
    expect(hazard.type).toBe('water');
    expect(hazard.severity).toBe('critical');
  });

  it('maps ux finding to trees hazard', () => {
    const hazard = findingToHazard({
      review_type: 'ux',
      ticket_key: 'S1-1',
      severity: 'minor',
      description: 'Button contrast too low',
      resolved: true,
    });
    expect(hazard.type).toBe('trees');
  });

  it('covers all review types in REVIEW_TYPE_HAZARD_MAP', () => {
    const reviewTypes: Array<'architect' | 'code' | 'ml-engineer' | 'security' | 'ux'> = [
      'architect', 'code', 'ml-engineer', 'security', 'ux',
    ];
    for (const rt of reviewTypes) {
      expect(REVIEW_TYPE_HAZARD_MAP[rt]).toBeDefined();
      const hazard = findingToHazard({
        review_type: rt,
        ticket_key: 'T-1',
        severity: 'minor',
        description: 'test',
        resolved: true,
      });
      expect(hazard.type).toBe(REVIEW_TYPE_HAZARD_MAP[rt]);
    }
  });
});
