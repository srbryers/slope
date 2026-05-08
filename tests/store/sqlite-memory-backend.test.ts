import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteMemoryBackend } from '../../src/store/sqlite-memory-backend.js';
import type { Memory } from '../../src/core/memory-types.js';

function setupRepo(): { cwd: string; dbPath: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'slope-sqlite-mem-'));
  mkdirSync(join(cwd, '.slope'), { recursive: true });
  return { cwd, dbPath: join(cwd, '.slope', 'slope.db') };
}

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  const now = new Date().toISOString();
  return {
    id: `mem-${Math.random().toString(36).slice(2, 10)}`,
    text: 'test memory',
    category: 'project',
    weight: 5,
    source: 'manual',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('SqliteMemoryBackend (GH #294)', () => {
  let cwd: string;
  let dbPath: string;
  let backend: SqliteMemoryBackend;

  beforeEach(() => {
    ({ cwd, dbPath } = setupRepo());
    backend = new SqliteMemoryBackend(cwd, dbPath);
  });

  afterEach(() => {
    backend.close();
    rmSync(cwd, { recursive: true, force: true });
  });

  it('reports kind: sqlite', () => {
    expect(backend.kind).toBe('sqlite');
  });

  it('returns empty list when table is fresh', () => {
    const data = backend.load();
    expect(data.version).toBe(1);
    expect(data.memories).toEqual([]);
  });

  it('add then load round-trips a memory', () => {
    const m = makeMemory({ text: 'remember this', weight: 8 });
    backend.add(m);
    const { memories } = backend.load();
    expect(memories).toHaveLength(1);
    expect(memories[0]).toEqual(m);
  });

  it('sorts load() by weight desc, then updated_at desc', () => {
    const a = makeMemory({ id: 'a', weight: 3, updatedAt: '2026-01-01T00:00:00Z' });
    const b = makeMemory({ id: 'b', weight: 9, updatedAt: '2026-01-02T00:00:00Z' });
    const c = makeMemory({ id: 'c', weight: 9, updatedAt: '2026-01-03T00:00:00Z' });
    backend.add(a); backend.add(b); backend.add(c);
    const ids = backend.load().memories.map(m => m.id);
    expect(ids).toEqual(['c', 'b', 'a']);
  });

  it('remove deletes by id', () => {
    const m = makeMemory();
    backend.add(m);
    expect(backend.remove(m.id)).toBe(true);
    expect(backend.load().memories).toHaveLength(0);
  });

  it('remove returns false when id is missing', () => {
    expect(backend.remove('does-not-exist')).toBe(false);
  });

  it('update patches the row in place', () => {
    const m = makeMemory({ text: 'old', weight: 5 });
    backend.add(m);
    const updated = backend.update(m.id, { text: 'new', weight: 9 });
    expect(updated?.text).toBe('new');
    expect(updated?.weight).toBe(9);
    expect(backend.getById(m.id)?.text).toBe('new');
  });

  it('update returns null when id is missing', () => {
    expect(backend.update('missing', { text: 'x' })).toBeNull();
  });

  it('update clamps weight to [1,10]', () => {
    const m = makeMemory();
    backend.add(m);
    expect(backend.update(m.id, { weight: 99 })?.weight).toBe(10);
    expect(backend.update(m.id, { weight: 0 })?.weight).toBe(1);
  });

  it('saveAll replaces the entire dataset', () => {
    backend.add(makeMemory({ id: 'a' }));
    backend.add(makeMemory({ id: 'b' }));
    backend.saveAll({ version: 1, memories: [makeMemory({ id: 'c' })] });
    const ids = backend.load().memories.map(m => m.id);
    expect(ids).toEqual(['c']);
  });

  it('preserves sourceSessionId across round-trip', () => {
    const m = makeMemory({ sourceSessionId: 'session-xyz' });
    backend.add(m);
    expect(backend.getById(m.id)?.sourceSessionId).toBe('session-xyz');
  });
});

describe('SqliteMemoryBackend JSON migration', () => {
  let cwd: string;
  let dbPath: string;

  beforeEach(() => {
    ({ cwd, dbPath } = setupRepo());
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('imports existing memories.json on first open', () => {
    const jsonPath = join(cwd, '.slope', 'memories.json');
    const m = makeMemory({ id: 'imported', text: 'from json' });
    writeFileSync(jsonPath, JSON.stringify({ version: 1, memories: [m] }));

    const backend = new SqliteMemoryBackend(cwd, dbPath);
    try {
      const loaded = backend.load();
      expect(loaded.memories).toHaveLength(1);
      expect(loaded.memories[0].id).toBe('imported');
      expect(loaded.memories[0].text).toBe('from json');

      // Original JSON should be renamed to .bak
      expect(existsSync(jsonPath)).toBe(false);
      expect(existsSync(`${jsonPath}.bak`)).toBe(true);
    } finally {
      backend.close();
    }
  });

  it('migrates v0 plain-array JSON shape', () => {
    const jsonPath = join(cwd, '.slope', 'memories.json');
    const m = makeMemory({ id: 'legacy', text: 'pre-v1' });
    writeFileSync(jsonPath, JSON.stringify([m]));

    const backend = new SqliteMemoryBackend(cwd, dbPath);
    try {
      expect(backend.load().memories[0].id).toBe('legacy');
    } finally {
      backend.close();
    }
  });

  it('skips migration when table is already populated', () => {
    // First open imports
    const jsonPath = join(cwd, '.slope', 'memories.json');
    writeFileSync(jsonPath, JSON.stringify({ version: 1, memories: [makeMemory({ id: 'first' })] }));
    new SqliteMemoryBackend(cwd, dbPath).close();

    // Re-create the JSON (different content) and re-open
    writeFileSync(jsonPath, JSON.stringify({ version: 1, memories: [makeMemory({ id: 'second' })] }));
    const backend = new SqliteMemoryBackend(cwd, dbPath);
    try {
      const ids = backend.load().memories.map(m => m.id);
      // 'first' came from the original migration; 'second' should NOT be imported
      expect(ids).toContain('first');
      expect(ids).not.toContain('second');
    } finally {
      backend.close();
    }
  });
});
