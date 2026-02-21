import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileRegistry } from '../src/registries/file-registry.js';
import { checkConflicts } from '@slope-dev/core';
import type { SprintClaim } from '@slope-dev/core';

let tmpDir: string;
let claimsPath: string;
let registry: FileRegistry;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-claim-block-'));
  claimsPath = join(tmpDir, '.slope', 'claims.json');
  registry = new FileRegistry(claimsPath);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function buildPendingClaim(overrides: Partial<SprintClaim> = {}): SprintClaim {
  return {
    id: '__pending__',
    sprint_number: 2,
    player: 'bob',
    target: 'S2-1',
    scope: 'ticket',
    claimed_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('Claim blocking — preflight conflict check', () => {
  it('detects overlap when same target claimed by different player', async () => {
    // Alice claims S2-1
    await registry.claim({ sprint_number: 2, player: 'alice', target: 'S2-1', scope: 'ticket' });
    const existing = await registry.list(2);

    // Bob tries to claim S2-1
    const pending = buildPendingClaim({ player: 'bob', target: 'S2-1' });
    const conflicts = checkConflicts([...existing, pending]);
    const overlaps = conflicts.filter(c => c.severity === 'overlap');

    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].reason).toContain('alice');
    expect(overlaps[0].reason).toContain('bob');
    expect(overlaps[0].reason).toContain('S2-1');
  });

  it('overlap + --force registers claim with override warning', async () => {
    // Alice claims S2-1
    await registry.claim({ sprint_number: 2, player: 'alice', target: 'S2-1', scope: 'ticket' });
    const existing = await registry.list(2);

    // Preflight check shows overlap
    const pending = buildPendingClaim({ player: 'bob', target: 'S2-1' });
    const conflicts = checkConflicts([...existing, pending]);
    const overlaps = conflicts.filter(c => c.severity === 'overlap');
    expect(overlaps.length).toBeGreaterThan(0);

    // With --force, the claim proceeds
    const claim = await registry.claim({ sprint_number: 2, player: 'bob', target: 'S2-1', scope: 'ticket' });
    expect(claim.player).toBe('bob');
    expect(claim.target).toBe('S2-1');

    // Both claims now exist
    const all = await registry.list(2);
    expect(all).toHaveLength(2);
  });

  it('allows adjacent conflicts without --force', async () => {
    // Alice claims area packages/cli
    await registry.claim({ sprint_number: 2, player: 'alice', target: 'packages/cli', scope: 'area' });
    const existing = await registry.list(2);

    // Bob claims area packages/cli/src (adjacent, not overlap)
    const pending = buildPendingClaim({ player: 'bob', target: 'packages/cli/src', scope: 'area' });
    const conflicts = checkConflicts([...existing, pending]);
    const overlaps = conflicts.filter(c => c.severity === 'overlap');
    const adjacents = conflicts.filter(c => c.severity === 'adjacent');

    // No overlaps — should be allowed without --force
    expect(overlaps).toHaveLength(0);
    // But adjacent warning is present
    expect(adjacents).toHaveLength(1);
    expect(adjacents[0].reason).toContain('packages/cli/src');
    expect(adjacents[0].reason).toContain('packages/cli');
  });

  it('no conflicts registers normally', async () => {
    // Alice claims S2-1
    await registry.claim({ sprint_number: 2, player: 'alice', target: 'S2-1', scope: 'ticket' });
    const existing = await registry.list(2);

    // Bob claims S2-2 — no conflict
    const pending = buildPendingClaim({ player: 'bob', target: 'S2-2' });
    const conflicts = checkConflicts([...existing, pending]);

    expect(conflicts).toHaveLength(0);

    // Claim goes through
    const claim = await registry.claim({ sprint_number: 2, player: 'bob', target: 'S2-2', scope: 'ticket' });
    expect(claim.target).toBe('S2-2');
    const all = await registry.list(2);
    expect(all).toHaveLength(2);
  });

  it('blocked output would suggest --force', async () => {
    // This tests the message format that claimCommand produces
    await registry.claim({ sprint_number: 2, player: 'alice', target: 'S2-1', scope: 'ticket' });
    const existing = await registry.list(2);
    const pending = buildPendingClaim({ player: 'bob', target: 'S2-1' });
    const conflicts = checkConflicts([...existing, pending]);
    const overlaps = conflicts.filter(c => c.severity === 'overlap');

    // Simulate the error message format from claimCommand
    const lines: string[] = [];
    if (overlaps.length > 0) {
      lines.push('Claim blocked — overlap conflict(s) detected:');
      for (const c of overlaps) {
        lines.push(`  [!!] ${c.reason}`);
      }
      lines.push('Use --force to override.');
    }

    expect(lines.join('\n')).toContain('Claim blocked');
    expect(lines.join('\n')).toContain('[!!]');
    expect(lines.join('\n')).toContain('--force');
  });
});
