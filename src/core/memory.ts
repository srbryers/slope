/**
 * Cross-session memory storage core.
 * Persistent learned patterns, preferences, and project quirks in .slope/memories.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ── Types ───────────────────────────────────────────

export type MemoryCategory = 'workflow' | 'style' | 'project' | 'hazard' | 'other';
export type MemorySource = 'manual' | 'auto-guard' | 'auto-workflow';

export interface Memory {
  id: string;
  text: string;
  category: MemoryCategory;
  weight: number; // 1–10 relevance
  source: MemorySource;
  createdAt: string;
  updatedAt: string;
}

export interface MemoriesFile {
  version: number;
  memories: Memory[];
}

export interface MemorySearchOptions {
  query?: string;
  category?: MemoryCategory;
  source?: MemorySource;
  limit?: number;
  minWeight?: number;
}

// ── Constants ───────────────────────────────────────

const MEMORIES_FILE = 'memories.json';
const CURRENT_VERSION = 1;

// ── Internal helpers ────────────────────────────────

function getPath(cwd: string): string {
  return join(cwd, '.slope', MEMORIES_FILE);
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

function validateMemory(m: unknown): Memory {
  if (!m || typeof m !== 'object') {
    throw new TypeError('Memory must be an object');
  }
  const mem = m as Record<string, unknown>;

  const validCategories: MemoryCategory[] = ['workflow', 'style', 'project', 'hazard', 'other'];
  const validSources: MemorySource[] = ['manual', 'auto-guard', 'auto-workflow'];

  const category = (mem.category as MemoryCategory) ?? 'other';
  const source = (mem.source as MemorySource) ?? 'manual';

  if (!validCategories.includes(category)) {
    throw new TypeError(`Invalid memory category: ${category}`);
  }
  if (!validSources.includes(source)) {
    throw new TypeError(`Invalid memory source: ${source}`);
  }

  const weight = typeof mem.weight === 'number' ? mem.weight : 5;
  const clampedWeight = Math.max(1, Math.min(10, weight));

  return {
    id: typeof mem.id === 'string' ? mem.id : generateId(),
    text: typeof mem.text === 'string' ? mem.text : '',
    category,
    weight: clampedWeight,
    source,
    createdAt: typeof mem.createdAt === 'string' ? mem.createdAt : now(),
    updatedAt: typeof mem.updatedAt === 'string' ? mem.updatedAt : now(),
  };
}

function migrateV0toV1(raw: unknown): MemoriesFile {
  // v0: plain array of memories without version wrapper
  if (Array.isArray(raw)) {
    return {
      version: 1,
      memories: raw.map(validateMemory),
    };
  }
  // Unknown shape — start fresh
  return { version: 1, memories: [] };
}

// ── Public API ──────────────────────────────────────

export function loadMemories(cwd: string): MemoriesFile {
  const path = getPath(cwd);
  if (!existsSync(path)) {
    return { version: CURRENT_VERSION, memories: [] };
  }

  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));

    if (raw && typeof raw === 'object' && 'version' in raw) {
      const version = Number(raw.version);
      if (version === 1) {
        const memories = Array.isArray(raw.memories)
          ? raw.memories.map(validateMemory)
          : [];
        return { version: CURRENT_VERSION, memories };
      }
      // Future migrations go here
      return { version: CURRENT_VERSION, memories: [] };
    }

    // No version field — try v0 migration
    return migrateV0toV1(raw);
  } catch {
    return { version: CURRENT_VERSION, memories: [] };
  }
}

export function saveMemories(cwd: string, data: MemoriesFile): void {
  const path = getPath(cwd);
  mkdirSync(join(cwd, '.slope'), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

export function addMemory(
  cwd: string,
  text: string,
  options: {
    category?: MemoryCategory;
    weight?: number;
    source?: MemorySource;
  } = {},
): Memory {
  const data = loadMemories(cwd);
  const memory: Memory = {
    id: generateId(),
    text,
    category: options.category ?? 'other',
    weight: Math.max(1, Math.min(10, options.weight ?? 8)),
    source: options.source ?? 'manual',
    createdAt: now(),
    updatedAt: now(),
  };
  data.memories.push(memory);
  saveMemories(cwd, data);
  return memory;
}

export function removeMemory(cwd: string, id: string): boolean {
  const data = loadMemories(cwd);
  const idx = data.memories.findIndex(m => m.id === id);
  if (idx === -1) return false;
  data.memories.splice(idx, 1);
  saveMemories(cwd, data);
  return true;
}

export function updateMemory(
  cwd: string,
  id: string,
  updates: Partial<Pick<Memory, 'text' | 'category' | 'weight'>>,
): Memory | null {
  const data = loadMemories(cwd);
  const mem = data.memories.find(m => m.id === id);
  if (!mem) return null;

  if (updates.text !== undefined) mem.text = updates.text;
  if (updates.category !== undefined) mem.category = updates.category;
  if (updates.weight !== undefined) mem.weight = Math.max(1, Math.min(10, updates.weight));
  mem.updatedAt = now();

  saveMemories(cwd, data);
  return mem;
}

export function searchMemories(
  cwd: string,
  options: MemorySearchOptions = {},
): Memory[] {
  const data = loadMemories(cwd);
  let results = data.memories;

  if (options.category) {
    results = results.filter(m => m.category === options.category);
  }

  if (options.source) {
    results = results.filter(m => m.source === options.source);
  }

  if (options.minWeight !== undefined) {
    const min = options.minWeight;
    results = results.filter(m => m.weight >= min);
  }

  if (options.query) {
    const q = options.query.toLowerCase();
    results = results.filter(m => m.text.toLowerCase().includes(q));
  }

  // Sort by weight desc, then recency desc
  results.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  if (options.limit) {
    results = results.slice(0, options.limit);
  }

  return results;
}

export function getMemoryById(cwd: string, id: string): Memory | undefined {
  const data = loadMemories(cwd);
  return data.memories.find(m => m.id === id);
}
