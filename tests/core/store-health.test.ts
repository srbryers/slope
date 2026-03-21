import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteSlopeStore } from '../../src/store/index.js';
import { checkStoreHealth } from '../../src/core/store-health.js';

let store: SqliteSlopeStore;
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-health-'));
  store = new SqliteSlopeStore(join(tmpDir, 'test.db'));
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('checkStoreHealth', () => {
  it('returns healthy result for a working store', async () => {
    const result = await checkStoreHealth(store, 'sqlite');
    expect(result.healthy).toBe(true);
    expect(result.type).toBe('sqlite');
    expect(result.schemaVersion).toBe(6);
    expect(result.stats.sessions).toBe(0);
    expect(result.stats.claims).toBe(0);
    expect(result.stats.scorecards).toBe(0);
    expect(result.stats.events).toBe(0);
    expect(result.stats.lastEventAt).toBeNull();
    expect(result.errors).toEqual([]);
  });

  it('returns correct stats after data is added', async () => {
    await store.registerSession({ session_id: 'h-s1', role: 'primary', ide: 'vscode' });
    await store.insertEvent({ type: 'decision', data: { test: true }, sprint_number: 1 });

    const result = await checkStoreHealth(store, 'sqlite');
    expect(result.healthy).toBe(true);
    expect(result.stats.sessions).toBe(1);
    expect(result.stats.events).toBe(1);
    expect(result.stats.lastEventAt).toBeTruthy();
  });

  it('returns unhealthy when getStats throws', async () => {
    // Create a mock store with a broken getStats
    const brokenStore = {
      ...store,
      async getSchemaVersion() { return 4; },
      async getStats() { throw new Error('table corrupted'); },
    } as any;

    const result = await checkStoreHealth(brokenStore, 'sqlite');
    expect(result.healthy).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('getStats failed');
    expect(result.errors[0]).toContain('table corrupted');
    expect(result.schemaVersion).toBe(4);
  });

  it('returns unhealthy when getSchemaVersion throws', async () => {
    const brokenStore = {
      ...store,
      async getSchemaVersion() { throw new Error('no such table'); },
      async getStats() { return { sessions: 0, claims: 0, scorecards: 0, events: 0, lastEventAt: null }; },
    } as any;

    const result = await checkStoreHealth(brokenStore, 'sqlite');
    expect(result.healthy).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('getSchemaVersion failed');
  });

  it('defaults type to unknown when not provided', async () => {
    const result = await checkStoreHealth(store);
    expect(result.type).toBe('unknown');
  });
});
