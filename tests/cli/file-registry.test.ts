import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileRegistry } from '../../src/cli/registries/file-registry.js';

let tmpDir: string;
let claimsPath: string;
let registry: FileRegistry;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-test-'));
  claimsPath = join(tmpDir, '.slope', 'claims.json');
  registry = new FileRegistry(claimsPath);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('FileRegistry', () => {
  it('normalizes legacy inputs and preserves canonical trailing zeroes', async () => {
    const legacy = await registry.claim({
      sprint_number: 65,
      player: 'alice',
      target: 'T-65',
      scope: 'ticket',
    });
    const canonical = await registry.claim({
      sprint_number: 'S458.10',
      player: 'alice',
      target: 'T-458.10',
      scope: 'ticket',
    });

    expect(legacy.sprint_number).toBe('65');
    expect(canonical.sprint_number).toBe('458.10');
    expect((await registry.list('458.1')).map(claim => claim.target)).toEqual([]);
    expect((await registry.list('458.10')).map(claim => claim.target)).toEqual(['T-458.10']);
  });

  it('creates a claim and returns it with id and timestamp', async () => {
    const claim = await registry.claim({
      sprint_number: 2,
      player: 'alice',
      target: 'S2-1',
      scope: 'ticket',
    });

    expect(claim.id).toMatch(/^claim-\d+-[a-z0-9]{6}$/);
    expect(claim.sprint_number).toBe('2');
    expect(claim.player).toBe('alice');
    expect(claim.target).toBe('S2-1');
    expect(claim.scope).toBe('ticket');
    expect(claim.claimed_at).toBeTruthy();
  });

  it('persists claims to disk', async () => {
    await registry.claim({
      sprint_number: 2,
      player: 'alice',
      target: 'S2-1',
      scope: 'ticket',
    });

    const raw = JSON.parse(readFileSync(claimsPath, 'utf8'));
    expect(raw.claims).toHaveLength(1);
    expect(raw.claims[0].player).toBe('alice');
  });

  it('release removes a claim by ID', async () => {
    const claim = await registry.claim({
      sprint_number: 2,
      player: 'alice',
      target: 'S2-1',
      scope: 'ticket',
    });

    const released = await registry.release(claim.id);
    expect(released).toBe(true);

    const remaining = await registry.list(2);
    expect(remaining).toHaveLength(0);
  });

  it('release returns false for unknown ID', async () => {
    const released = await registry.release('nonexistent');
    expect(released).toBe(false);
  });

  it('list filters by sprint number', async () => {
    await registry.claim({ sprint_number: 2, player: 'alice', target: 'S2-1', scope: 'ticket' });
    await registry.claim({ sprint_number: 3, player: 'bob', target: 'S3-1', scope: 'ticket' });
    await registry.claim({ sprint_number: 2, player: 'carol', target: 'S2-2', scope: 'ticket' });

    const sprint2 = await registry.list(2);
    expect(sprint2).toHaveLength(2);
    expect(sprint2.map(c => c.player).sort()).toEqual(['alice', 'carol']);

    const sprint3 = await registry.list(3);
    expect(sprint3).toHaveLength(1);
    expect(sprint3[0].player).toBe('bob');
  });

  it('get returns a claim by ID', async () => {
    const claim = await registry.claim({
      sprint_number: 2,
      player: 'alice',
      target: 'S2-1',
      scope: 'ticket',
    });

    const found = await registry.get(claim.id);
    expect(found).toEqual(claim);
  });

  it('get returns undefined for unknown ID', async () => {
    const found = await registry.get('nonexistent');
    expect(found).toBeUndefined();
  });

  it('handles missing file gracefully', async () => {
    // No file written yet — should return empty
    const claims = await registry.list(2);
    expect(claims).toEqual([]);
  });

  it('handles corrupt file gracefully', async () => {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    mkdirSync(dirname(claimsPath), { recursive: true });
    writeFileSync(claimsPath, 'not-json!!!');

    const claims = await registry.list(2);
    expect(claims).toEqual([]);

    // Can still write after corrupt read
    const claim = await registry.claim({
      sprint_number: 2,
      player: 'alice',
      target: 'S2-1',
      scope: 'ticket',
    });
    expect(claim.player).toBe('alice');
  });

  it('normalizes numeric claims loaded from the legacy file format', async () => {
    mkdirSync(dirname(claimsPath), { recursive: true });
    writeFileSync(claimsPath, JSON.stringify({
      claims: [{
        id: 'legacy',
        sprint_number: 65,
        player: 'alice',
        target: 'T-65',
        scope: 'ticket',
        claimed_at: '2026-01-01T00:00:00.000Z',
      }],
    }));

    expect(await registry.get('legacy')).toMatchObject({ sprint_number: '65' });
  });
});
