import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import {
  getMemoryBackend,
  addMemory,
  loadMemories,
  searchMemories,
  clearMemoryBackendCache,
} from '../../src/core/memory.js';

function setupRepo(opts: { withDb?: boolean } = {}): string {
  const cwd = mkdtempSync(join(tmpdir(), 'slope-mem-sel-'));
  mkdirSync(join(cwd, '.slope'), { recursive: true });
  if (opts.withDb) {
    // Touch the db file so the factory picks the SQLite backend
    const db = new Database(join(cwd, '.slope', 'slope.db'));
    db.close();
  }
  return cwd;
}

describe('getMemoryBackend (GH #294 — backend selection)', () => {
  let cwd: string;

  afterEach(() => {
    clearMemoryBackendCache();
    if (cwd) rmSync(cwd, { recursive: true, force: true });
    delete process.env.SLOPE_MEMORY_BACKEND;
  });

  it('picks JSON backend when no slope.db exists', () => {
    cwd = setupRepo();
    expect(getMemoryBackend(cwd).kind).toBe('json');
  });

  it('picks SQLite backend when slope.db exists', () => {
    cwd = setupRepo({ withDb: true });
    expect(getMemoryBackend(cwd).kind).toBe('sqlite');
  });

  it('SLOPE_MEMORY_BACKEND=json forces JSON even with slope.db present', () => {
    cwd = setupRepo({ withDb: true });
    process.env.SLOPE_MEMORY_BACKEND = 'json';
    expect(getMemoryBackend(cwd).kind).toBe('json');
  });

  it('addMemory writes through the SQLite backend when slope.db exists', () => {
    cwd = setupRepo({ withDb: true });
    addMemory(cwd, 'remember me', { category: 'workflow', weight: 9 });

    // Memory should be queryable via the public API
    const all = loadMemories(cwd);
    expect(all.memories).toHaveLength(1);
    expect(all.memories[0].text).toBe('remember me');

    // No JSON file should exist (SQLite path doesn't write one)
    expect(existsSync(join(cwd, '.slope', 'memories.json'))).toBe(false);
  });

  it('one-time JSON migration moves data into the store on first SQLite open', () => {
    cwd = setupRepo({ withDb: true });
    // Simulate a pre-existing JSON file from before S90
    const jsonPath = join(cwd, '.slope', 'memories.json');
    writeFileSync(jsonPath, JSON.stringify({
      version: 1,
      memories: [{
        id: 'pre-existing',
        text: 'legacy memory',
        category: 'project',
        weight: 7,
        source: 'manual',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }],
    }));

    // First call to a public function triggers the SQLite backend, which migrates
    const found = searchMemories(cwd, { query: 'legacy' });
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe('pre-existing');

    // JSON should have been renamed to .bak
    expect(existsSync(jsonPath)).toBe(false);
    expect(existsSync(`${jsonPath}.bak`)).toBe(true);
  });
});
