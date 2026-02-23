// SLOPE — Sprint Claims Registry
// Provides the SprintRegistry interface and pure conflict detection logic.

import type { SprintClaim, SprintConflict } from './types.js';

/** Async registry for managing sprint claims */
export interface SprintRegistry {
  claim(claim: Omit<SprintClaim, 'id' | 'claimed_at'>): Promise<SprintClaim>;
  release(id: string): Promise<boolean>;
  list(sprintNumber: number): Promise<SprintClaim[]>;
  get(id: string): Promise<SprintClaim | undefined>;
}

/**
 * Detect conflicts among a set of sprint claims.
 *
 * Rules:
 *  1. Same target, different players → 'overlap'
 *  2. Area prefix containment (both 'area' scope) → 'adjacent'
 *  3. Ticket target starts with area target (mixed scopes) → 'adjacent'
 *
 * Skips same-player pairs and cross-sprint pairs.
 */
export function checkConflicts(claims: SprintClaim[]): SprintConflict[] {
  const conflicts: SprintConflict[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const a = claims[i];
      const b = claims[j];

      // Skip same player or different sprints
      if (a.player === b.player) continue;
      if (a.sprint_number !== b.sprint_number) continue;

      let reason: string | null = null;
      let severity: 'overlap' | 'adjacent' | null = null;

      // Rule 1: exact same target
      if (a.target === b.target) {
        reason = `Both ${a.player} and ${b.player} claimed "${a.target}"`;
        severity = 'overlap';
      }
      // Rule 2: area prefix containment (both area scope)
      else if (a.scope === 'area' && b.scope === 'area') {
        if (b.target.startsWith(a.target) || a.target.startsWith(b.target)) {
          const parent = a.target.length <= b.target.length ? a.target : b.target;
          const child = a.target.length <= b.target.length ? b.target : a.target;
          reason = `Area "${child}" is within area "${parent}"`;
          severity = 'adjacent';
        }
      }
      // Rule 3: ticket target starts with area target (mixed scopes)
      else if (a.scope !== b.scope) {
        const areaClaim = a.scope === 'area' ? a : b;
        const ticketClaim = a.scope === 'area' ? b : a;
        if (ticketClaim.target.startsWith(areaClaim.target)) {
          reason = `Ticket "${ticketClaim.target}" falls within area "${areaClaim.target}"`;
          severity = 'adjacent';
        }
      }

      if (reason && severity) {
        // Deduplicate by sorted claim IDs
        const key = [a.id, b.id].sort().join(':');
        if (!seen.has(key)) {
          seen.add(key);
          conflicts.push({ claims: [a, b], reason, severity });
        }
      }
    }
  }

  return conflicts;
}
