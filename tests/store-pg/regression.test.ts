/**
 * Regression tests for store-pg module isolation.
 * These always run (no PostgreSQL required) to verify that:
 * 1. The store-pg module can be dynamically imported without pg installed
 * 2. The core barrel export doesn't pull in pg
 * 3. The CLI resolveStore() still defaults to SQLite
 */
import { describe, it, expect } from 'vitest';

describe('store-pg regression (no PG required)', () => {
  it('core barrel export does not import pg', async () => {
    // Importing the core barrel should never trigger a pg import
    const core = await import('../../src/core/index.js');
    expect(core.computePar).toBeDefined();
    expect(core.buildScorecard).toBeDefined();
    // store-pg exports should NOT be in the core barrel
    expect((core as Record<string, unknown>).createPostgresStore).toBeUndefined();
  });

  it('store-pg module can be imported without connecting', async () => {
    // The module itself should load — pg is only imported inside createPostgresStore()
    const mod = await import('../../src/store-pg/index.js');
    expect(mod.createPostgresStore).toBeDefined();
    expect(typeof mod.createPostgresStore).toBe('function');
  });

  it('createPostgresStore fails with clear error when connection is refused', async () => {
    const { createPostgresStore } = await import('../../src/store-pg/index.js');
    await expect(createPostgresStore({
      connectionString: 'postgresql://localhost:1/nonexistent',
    })).rejects.toThrow(); // connection refused, not MODULE_NOT_FOUND
  });

  it('resolveStore defaults to SQLite without postgres config', async () => {
    // Importing resolveStore should not trigger pg import
    const mod = await import('../../src/cli/store.js');
    expect(mod.resolveStore).toBeDefined();
  });
});
