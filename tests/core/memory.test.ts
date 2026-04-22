import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadMemories,
  saveMemories,
  addMemory,
  removeMemory,
  updateMemory,
  searchMemories,
  getMemoryById,
} from '../../src/core/memory.js';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'slope-memory-'));
}

describe('memory storage', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = createTempDir();
  });

  describe('loadMemories', () => {
    it('returns empty file when no memories exist', () => {
      const data = loadMemories(cwd);
      expect(data.version).toBe(1);
      expect(data.memories).toEqual([]);
    });

    it('migrates v0 plain array to v1', () => {
      const dir = join(cwd, '.slope');
      const path = join(dir, 'memories.json');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, JSON.stringify([{ text: 'legacy', category: 'project', weight: 7 }]));
      const data = loadMemories(cwd);
      expect(data.version).toBe(1);
      expect(data.memories).toHaveLength(1);
      expect(data.memories[0].text).toBe('legacy');
    });

    it('handles corrupted file gracefully', () => {
      const dir = join(cwd, '.slope');
      const path = join(dir, 'memories.json');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, 'not json');
      const data = loadMemories(cwd);
      expect(data.memories).toEqual([]);
    });
  });

  describe('saveMemories', () => {
    it('creates .slope directory if missing', () => {
      saveMemories(cwd, { version: 1, memories: [] });
      expect(existsSync(join(cwd, '.slope', 'memories.json'))).toBe(true);
    });
  });

  describe('addMemory', () => {
    it('adds a memory with default values', () => {
      const mem = addMemory(cwd, 'test memory');
      expect(mem.text).toBe('test memory');
      expect(mem.category).toBe('other');
      expect(mem.weight).toBe(8);
      expect(mem.source).toBe('manual');
      expect(mem.id).toBeDefined();
    });

    it('respects custom options', () => {
      const mem = addMemory(cwd, 'custom', { category: 'workflow', weight: 3, source: 'auto-guard' });
      expect(mem.category).toBe('workflow');
      expect(mem.weight).toBe(3);
      expect(mem.source).toBe('auto-guard');
    });

    it('clamps weight to 1-10 range', () => {
      expect(addMemory(cwd, 'low', { weight: 0 }).weight).toBe(1);
      expect(addMemory(cwd, 'high', { weight: 15 }).weight).toBe(10);
    });
  });

  describe('removeMemory', () => {
    it('removes existing memory', () => {
      const mem = addMemory(cwd, 'to remove');
      expect(removeMemory(cwd, mem.id)).toBe(true);
      expect(searchMemories(cwd)).toHaveLength(0);
    });

    it('returns false for missing id', () => {
      expect(removeMemory(cwd, 'nonexistent')).toBe(false);
    });
  });

  describe('updateMemory', () => {
    it('updates text and weight', () => {
      const mem = addMemory(cwd, 'original');
      const updated = updateMemory(cwd, mem.id, { text: 'updated', weight: 9 });
      expect(updated).not.toBeNull();
      expect(updated!.text).toBe('updated');
      expect(updated!.weight).toBe(9);
    });

    it('returns null for missing id', () => {
      expect(updateMemory(cwd, 'nonexistent', { text: 'x' })).toBeNull();
    });
  });

  describe('searchMemories', () => {
    beforeEach(() => {
      addMemory(cwd, 'Alpha workflow tip', { category: 'workflow', weight: 8 });
      addMemory(cwd, 'Beta style guide', { category: 'style', weight: 6 });
      addMemory(cwd, 'Gamma project note', { category: 'project', weight: 9 });
    });

    it('returns all memories sorted by weight desc', () => {
      const results = searchMemories(cwd);
      expect(results).toHaveLength(3);
      expect(results[0].weight).toBe(9);
      expect(results[1].weight).toBe(8);
      expect(results[2].weight).toBe(6);
    });

    it('filters by category', () => {
      const results = searchMemories(cwd, { category: 'workflow' });
      expect(results).toHaveLength(1);
      expect(results[0].text).toBe('Alpha workflow tip');
    });

    it('filters by query', () => {
      const results = searchMemories(cwd, { query: 'beta' });
      expect(results).toHaveLength(1);
      expect(results[0].text).toBe('Beta style guide');
    });

    it('respects limit', () => {
      const results = searchMemories(cwd, { limit: 2 });
      expect(results).toHaveLength(2);
    });

    it('filters by minWeight', () => {
      const results = searchMemories(cwd, { minWeight: 8 });
      expect(results.every(m => m.weight >= 8)).toBe(true);
    });
  });

  describe('getMemoryById', () => {
    it('finds memory by id', () => {
      const mem = addMemory(cwd, 'find me');
      expect(getMemoryById(cwd, mem.id)?.text).toBe('find me');
    });

    it('returns undefined for missing id', () => {
      expect(getMemoryById(cwd, 'nonexistent')).toBeUndefined();
    });
  });
});
