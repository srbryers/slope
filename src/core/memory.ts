/**
 * Cross-session memory storage core.
 * Persistent learned patterns, preferences, and project quirks in .slope/memories.json
 */

import { existsSync, readFileSync, writeFileSync, renameSync, copyFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
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
  /** Optional session that produced this memory (auto-* sources). */
  sourceSessionId?: string;
}

/**
 * Detect probable secrets in a memory's text. Used as a guardrail before
 * writing memories that auto-inject into briefings (S73-3).
 *
 * Detects: sk-* (OpenAI/Anthropic), ghp_* / gho_* (GitHub), AWS access keys
 * (AKIA prefix + 16 chars), JWT-shaped 3-part dot-separated base64, and
 * generic hex/base64 strings ≥ 32 chars after `password=`/`token=` etc.
 */
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  /\b(?:password|secret|token|api[-_]?key|access[-_]?key)\s*[:=]\s*['"]?[A-Za-z0-9+/=_-]{16,}['"]?/i,
];

export function detectSecret(text: string): string | null {
  for (const re of SECRET_PATTERNS) {
    if (re.test(text)) return re.source;
  }
  return null;
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
  return randomUUID();
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
    ...(typeof mem.sourceSessionId === 'string' ? { sourceSessionId: mem.sourceSessionId } : {}),
  };
}

/** Public for callers that want to validate before pushing (e.g. import). */
export { validateMemory };

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
      // Unknown future version — back up before returning empty so we don't silently nuke user data
      const backupPath = `${path}.v${version}.bak`;
      try {
        copyFileSync(path, backupPath);
        console.error(`SLOPE memory: unknown memories.json version=${version}; backed up to ${backupPath} and starting fresh.`);
      } catch (err) {
        console.error(`SLOPE memory: unknown memories.json version=${version}; backup failed (${(err as Error).message}). Starting fresh — original file untouched until next write.`);
      }
      return { version: CURRENT_VERSION, memories: [] };
    }

    // No version field — try v0 migration
    return migrateV0toV1(raw);
  } catch (err) {
    console.error(`SLOPE memory: failed to parse ${path} (${(err as Error).message}). Treating as empty.`);
    return { version: CURRENT_VERSION, memories: [] };
  }
}

/**
 * Atomic write: write to temp file then rename. Reduces (but doesn't eliminate)
 * the multi-agent last-write-wins window — concurrent writers each load,
 * mutate, and write, so the loser's changes can still be lost. A future
 * follow-up should layer this on the store interface with proper locking.
 */
export function saveMemories(cwd: string, data: MemoriesFile): void {
  const path = getPath(cwd);
  mkdirSync(join(cwd, '.slope'), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, path);
}

export class SecretDetectedError extends Error {
  constructor(public pattern: string) {
    super(`Memory text matches secret pattern (${pattern}); refusing to persist. Pass allowSecrets:true to override.`);
    this.name = 'SecretDetectedError';
  }
}

export function addMemory(
  cwd: string,
  text: string,
  options: {
    category?: MemoryCategory;
    weight?: number;
    source?: MemorySource;
    sourceSessionId?: string;
    /** Set true to bypass secret detection. Default false. */
    allowSecrets?: boolean;
  } = {},
): Memory {
  if (!options.allowSecrets) {
    const matched = detectSecret(text);
    if (matched) throw new SecretDetectedError(matched);
  }

  const data = loadMemories(cwd);
  const memory: Memory = {
    id: generateId(),
    text,
    category: options.category ?? 'other',
    weight: Math.max(1, Math.min(10, options.weight ?? 8)),
    source: options.source ?? 'manual',
    createdAt: now(),
    updatedAt: now(),
    ...(options.sourceSessionId ? { sourceSessionId: options.sourceSessionId } : {}),
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
