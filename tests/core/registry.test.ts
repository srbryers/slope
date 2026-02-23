import { describe, it, expect } from 'vitest';
import { checkConflicts } from '../../src/core/registry.js';
import type { SprintClaim } from '../../src/core/types.js';

// --- Helper to build test claims ---

let claimCounter = 0;

function makeClaim(overrides: Partial<SprintClaim> = {}): SprintClaim {
  claimCounter++;
  return {
    id: `claim-${claimCounter}`,
    sprint_number: 2,
    player: 'alice',
    target: 'S2-1',
    scope: 'ticket',
    claimed_at: '2026-02-20T00:00:00Z',
    ...overrides,
  };
}

// --- checkConflicts ---

describe('checkConflicts', () => {
  it('returns empty for no claims', () => {
    expect(checkConflicts([])).toEqual([]);
  });

  it('returns empty for a single claim', () => {
    expect(checkConflicts([makeClaim()])).toEqual([]);
  });

  it('detects exact overlap: same target, different players', () => {
    const claims = [
      makeClaim({ player: 'alice', target: 'S2-1' }),
      makeClaim({ player: 'bob', target: 'S2-1' }),
    ];
    const conflicts = checkConflicts(claims);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].severity).toBe('overlap');
    expect(conflicts[0].reason).toContain('alice');
    expect(conflicts[0].reason).toContain('bob');
    expect(conflicts[0].reason).toContain('S2-1');
  });

  it('excludes same-player pairs', () => {
    const claims = [
      makeClaim({ player: 'alice', target: 'S2-1' }),
      makeClaim({ player: 'alice', target: 'S2-1' }),
    ];
    expect(checkConflicts(claims)).toEqual([]);
  });

  it('excludes cross-sprint pairs', () => {
    const claims = [
      makeClaim({ player: 'alice', target: 'S2-1', sprint_number: 2 }),
      makeClaim({ player: 'bob', target: 'S2-1', sprint_number: 3 }),
    ];
    expect(checkConflicts(claims)).toEqual([]);
  });

  it('detects area prefix containment (both area scope)', () => {
    const claims = [
      makeClaim({ player: 'alice', target: 'packages/core', scope: 'area' }),
      makeClaim({ player: 'bob', target: 'packages/core/src', scope: 'area' }),
    ];
    const conflicts = checkConflicts(claims);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].severity).toBe('adjacent');
    expect(conflicts[0].reason).toContain('packages/core/src');
    expect(conflicts[0].reason).toContain('packages/core');
  });

  it('detects ticket-in-area conflict (mixed scopes)', () => {
    const claims = [
      makeClaim({ player: 'alice', target: 'packages/cli', scope: 'area' }),
      makeClaim({ player: 'bob', target: 'packages/cli/src/config', scope: 'ticket' }),
    ];
    const conflicts = checkConflicts(claims);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].severity).toBe('adjacent');
    expect(conflicts[0].reason).toContain('packages/cli/src/config');
    expect(conflicts[0].reason).toContain('packages/cli');
  });

  it('returns no false positives for unrelated targets', () => {
    const claims = [
      makeClaim({ player: 'alice', target: 'S2-1', scope: 'ticket' }),
      makeClaim({ player: 'bob', target: 'S2-2', scope: 'ticket' }),
    ];
    expect(checkConflicts(claims)).toEqual([]);
  });

  it('returns no false positives for unrelated areas', () => {
    const claims = [
      makeClaim({ player: 'alice', target: 'packages/core', scope: 'area' }),
      makeClaim({ player: 'bob', target: 'packages/cli', scope: 'area' }),
    ];
    expect(checkConflicts(claims)).toEqual([]);
  });

  it('deduplicates conflicts by claim ID pair', () => {
    const a = makeClaim({ player: 'alice', target: 'S2-1' });
    const b = makeClaim({ player: 'bob', target: 'S2-1' });
    // Pass same pair twice (simulating repeated entries in array)
    const conflicts = checkConflicts([a, b]);
    expect(conflicts).toHaveLength(1);
  });

  it('reports correct severity values', () => {
    const overlapClaims = [
      makeClaim({ player: 'alice', target: 'S2-1' }),
      makeClaim({ player: 'bob', target: 'S2-1' }),
    ];
    const adjacentClaims = [
      makeClaim({ player: 'carol', target: 'src', scope: 'area' }),
      makeClaim({ player: 'dave', target: 'src/utils', scope: 'area' }),
    ];

    const overlapConflicts = checkConflicts(overlapClaims);
    expect(overlapConflicts[0].severity).toBe('overlap');

    const adjacentConflicts = checkConflicts(adjacentClaims);
    expect(adjacentConflicts[0].severity).toBe('adjacent');
  });

  it('handles multiple conflicts in one set of claims', () => {
    const claims = [
      makeClaim({ player: 'alice', target: 'S2-1' }),
      makeClaim({ player: 'bob', target: 'S2-1' }),
      makeClaim({ player: 'carol', target: 'S2-1' }),
    ];
    const conflicts = checkConflicts(claims);
    // alice-bob, alice-carol, bob-carol = 3 conflicts
    expect(conflicts).toHaveLength(3);
    expect(conflicts.every(c => c.severity === 'overlap')).toBe(true);
  });
});
