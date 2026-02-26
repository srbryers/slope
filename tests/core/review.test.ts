import { describe, it, expect } from 'vitest';
import { recommendReviews, findingToHazard, amendScorecardWithFindings } from '../../src/core/review.js';
import type { ReviewFinding, GolfScorecard, ShotRecord } from '../../src/core/types.js';
import { REVIEW_TYPE_HAZARD_MAP } from '../../src/core/constants.js';
import { buildScorecard } from '../../src/core/builder.js';

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
      filePatterns: ['src/auth/oauth.ts', 'src/ui/Button.tsx'],
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

// --- amendScorecardWithFindings ---

function makeShot(overrides: Partial<ShotRecord> = {}): ShotRecord {
  return {
    ticket_key: 'S33-1',
    title: 'Test ticket',
    club: 'short_iron',
    result: 'in_the_hole',
    hazards: [],
    ...overrides,
  };
}

function makeScorecard(overrides: Partial<GolfScorecard> = {}): GolfScorecard {
  const shots = overrides.shots ?? [
    makeShot({ ticket_key: 'S33-1', title: 'Ticket 1' }),
    makeShot({ ticket_key: 'S33-2', title: 'Ticket 2' }),
    makeShot({ ticket_key: 'S33-3', title: 'Ticket 3' }),
    makeShot({ ticket_key: 'S33-4', title: 'Ticket 4' }),
  ];
  const base = buildScorecard({
    sprint_number: 33,
    theme: 'Test Sprint',
    par: 4,
    slope: 2,
    date: '2026-02-26',
    shots,
    ...(overrides.type ? { type: overrides.type } : {}),
  });
  return { ...base, ...overrides, shots: overrides.shots ?? base.shots };
}

describe('amendScorecardWithFindings', () => {
  it('injects hazards into matching shots and recalculates score', () => {
    const scorecard = makeScorecard();
    expect(scorecard.score).toBe(4); // par
    expect(scorecard.score_label).toBe('par');

    const findings: ReviewFinding[] = [
      { review_type: 'architect', ticket_key: 'S33-1', severity: 'moderate', description: 'Malformed JSONL crash', resolved: true },
      { review_type: 'architect', ticket_key: 'S33-1', severity: 'minor', description: 'Sort instability', resolved: true },
    ];

    const result = amendScorecardWithFindings(scorecard, findings);

    expect(result.score_before).toBe(4);
    // 4 shots + 0.5 hazard penalty (moderate) + 0 (minor) = 4.5 → rounds to 5
    expect(result.score_after).toBe(5);
    expect(result.label_before).toBe('par');
    expect(result.label_after).toBe('bogey');
    expect(result.amendments).toHaveLength(2);
    // Original scorecard should not be mutated
    expect(scorecard.shots[0].hazards).toHaveLength(0);
  });

  it('is idempotent — deduplicates existing review hazards', () => {
    const scorecard = makeScorecard();
    const findings: ReviewFinding[] = [
      { review_type: 'architect', ticket_key: 'S33-1', severity: 'moderate', description: 'Test issue', resolved: true },
    ];

    // First amend
    const result1 = amendScorecardWithFindings(scorecard, findings);
    expect(result1.amendments).toHaveLength(1);

    // Second amend on already-amended scorecard
    const result2 = amendScorecardWithFindings(result1.scorecard, findings);
    expect(result2.amendments).toHaveLength(0);
    expect(result2.score_after).toBe(result1.score_after);
  });

  it('skips findings with no matching ticket_key', () => {
    const scorecard = makeScorecard();
    const findings: ReviewFinding[] = [
      { review_type: 'architect', ticket_key: 'S99-1', severity: 'moderate', description: 'No match', resolved: true },
    ];

    const result = amendScorecardWithFindings(scorecard, findings);
    expect(result.amendments).toHaveLength(0);
    expect(result.score_after).toBe(result.score_before);
  });

  it('handles empty findings array', () => {
    const scorecard = makeScorecard();
    const result = amendScorecardWithFindings(scorecard, []);
    expect(result.amendments).toHaveLength(0);
    expect(result.score_after).toBe(result.score_before);
  });

  it('distributes findings across multiple shots', () => {
    const scorecard = makeScorecard();
    const findings: ReviewFinding[] = [
      { review_type: 'architect', ticket_key: 'S33-1', severity: 'moderate', description: 'Issue in T1', resolved: true },
      { review_type: 'ml-engineer', ticket_key: 'S33-3', severity: 'moderate', description: 'Issue in T3', resolved: true },
    ];

    const result = amendScorecardWithFindings(scorecard, findings);
    expect(result.amendments).toHaveLength(2);

    // Check hazards are on correct shots
    const shot1 = result.scorecard.shots.find(s => s.ticket_key === 'S33-1');
    const shot3 = result.scorecard.shots.find(s => s.ticket_key === 'S33-3');
    expect(shot1!.hazards).toHaveLength(1);
    expect(shot1!.hazards[0].type).toBe('bunker');
    expect(shot3!.hazards).toHaveLength(1);
    expect(shot3!.hazards[0].type).toBe('rough');
  });

  it('preserves non-computed fields', () => {
    const scorecard = makeScorecard({
      nineteenth_hole: { how_did_it_feel: 'Great' },
      bunker_locations: ['test bunker'],
      nutrition: [{ category: 'hydration', description: 'test', status: 'healthy' }],
      course_management_notes: ['note 1'],
    });

    const findings: ReviewFinding[] = [
      { review_type: 'code', ticket_key: 'S33-1', severity: 'minor', description: 'test', resolved: true },
    ];

    const result = amendScorecardWithFindings(scorecard, findings);
    expect(result.scorecard.nineteenth_hole?.how_did_it_feel).toBe('Great');
    expect(result.scorecard.bunker_locations).toEqual(['test bunker']);
    expect(result.scorecard.nutrition).toHaveLength(1);
    expect(result.scorecard.course_management_notes).toEqual(['note 1']);
  });

  it('models Sprint 33 amendment correctly (par → bogey)', () => {
    // Sprint 33: 4 shots all in_the_hole, 0 hazards, score=4, par=4
    const scorecard = makeScorecard();
    expect(scorecard.score).toBe(4);
    expect(scorecard.score_label).toBe('par');

    // 5 findings from architect + ML reviews
    const findings: ReviewFinding[] = [
      { review_type: 'architect', ticket_key: 'S33-1', severity: 'moderate', description: 'Malformed JSONL crash', resolved: true },
      { review_type: 'architect', ticket_key: 'S33-1', severity: 'minor', description: 'Sort instability', resolved: true },
      { review_type: 'ml-engineer', ticket_key: 'S33-3', severity: 'moderate', description: 'Stats underutilizes schema', resolved: true },
      { review_type: 'ml-engineer', ticket_key: 'S33-3', severity: 'minor', description: 'Missing per-tool breakdown', resolved: true },
      { review_type: 'ml-engineer', ticket_key: 'S33-2', severity: 'minor', description: 'Token data notice missing', resolved: true },
    ];

    const result = amendScorecardWithFindings(scorecard, findings);

    // 4 shots + 0.5 (moderate) + 0 (minor) + 0.5 (moderate) + 0 (minor) + 0 (minor) = 5
    expect(result.score_after).toBe(5);
    expect(result.label_after).toBe('bogey');
    expect(result.amendments).toHaveLength(5);
  });
});
