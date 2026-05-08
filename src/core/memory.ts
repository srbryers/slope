/**
 * Cross-session memory storage — public API.
 *
 * As of S90 (GH #294), persistence routes through a MemoryBackend so the
 * memory module no longer writes JSON directly. Behavior:
 *
 *   - If `.slope/slope.db` exists, SqliteMemoryBackend is used. On first
 *     open it imports any existing `.slope/memories.json` into the store
 *     and renames the JSON to `.bak` (one-time migration).
 *   - Otherwise JsonMemoryBackend is used (legacy default for repos that
 *     haven't initialized the SQLite store).
 *
 * Public API signatures are unchanged — callers (auto-memory hooks, the
 * memory CLI command, briefing) keep working without `await`.
 */

import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import type { MemoryBackend } from './memory-backend.js';
import { JsonMemoryBackend } from './json-memory-backend.js';
import { SqliteMemoryBackend } from '../store/sqlite-memory-backend.js';

import type { Memory, MemoriesFile, MemoryCategory, MemorySource, MemorySearchOptions } from './memory-types.js';

// Re-export types so existing imports continue to work.
export type { Memory, MemoriesFile, MemoryCategory, MemorySource, MemorySearchOptions } from './memory-types.js';

// Re-export validateMemory + secret detection helpers (still part of public API).
export { validateMemoryRow as validateMemory } from './memory-validation.js';

// ── Secret detection (unchanged from pre-S90) ──────────

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

export class SecretDetectedError extends Error {
  constructor(public pattern: string) {
    super(`Memory text matches secret pattern (${pattern}); refusing to persist. Pass allowSecrets:true to override.`);
    this.name = 'SecretDetectedError';
  }
}

// ── Backend resolution ─────────────────────────────────

/**
 * Pick a backend based on whether a SQLite slope.db exists. Lazy-load the
 * SQLite backend so projects without better-sqlite3 binding (or no slope.db)
 * never try to open one.
 *
 * Memoized per-cwd — repeated calls return the same instance to avoid the
 * overhead of opening a fresh DB connection (and re-running schema/migration
 * checks) on every memory operation. Tests can call `clearMemoryBackendCache()`
 * to reset between fixtures.
 *
 * Override via `SLOPE_MEMORY_BACKEND=json|sqlite` for testing.
 */
const _backendCache = new Map<string, MemoryBackend>();

export function clearMemoryBackendCache(): void {
  _backendCache.clear();
}

export function getMemoryBackend(cwd: string): MemoryBackend {
  const override = process.env.SLOPE_MEMORY_BACKEND;
  // Cache key includes the override so a test toggling the env between calls
  // doesn't get a stale instance.
  const cacheKey = `${cwd}::${override ?? 'auto'}`;
  const cached = _backendCache.get(cacheKey);
  if (cached) return cached;

  if (override === 'json') {
    const b = new JsonMemoryBackend(cwd);
    _backendCache.set(cacheKey, b);
    return b;
  }

  const dbPath = join(cwd, '.slope', 'slope.db');
  if (override === 'sqlite' || existsSync(dbPath)) {
    try {
      const b = new SqliteMemoryBackend(cwd, dbPath);
      _backendCache.set(cacheKey, b);
      return b;
    } catch (err) {
      // Distinguish corruption / I/O errors from missing better-sqlite3
      // binding so users can tell which layer is broken (#294 review).
      const msg = (err as Error).message ?? String(err);
      const cause = /better-sqlite3|cannot find module/i.test(msg)
        ? 'better-sqlite3 binding unavailable'
        : 'SQLite open failed (DB corrupt, locked, or unreadable)';
      console.error(`SLOPE memory: ${cause} — ${msg}; falling back to JSON.`);
    }
  }

  const fallback = new JsonMemoryBackend(cwd);
  _backendCache.set(cacheKey, fallback);
  return fallback;
}

// ── Public API ─────────────────────────────────────────

function nowISO(): string {
  return new Date().toISOString();
}

export function loadMemories(cwd: string): MemoriesFile {
  return getMemoryBackend(cwd).load();
}

export function saveMemories(cwd: string, data: MemoriesFile): void {
  getMemoryBackend(cwd).saveAll(data);
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

  const memory: Memory = {
    id: randomUUID(),
    text,
    category: options.category ?? 'other',
    weight: Math.max(1, Math.min(10, options.weight ?? 8)),
    source: options.source ?? 'manual',
    createdAt: nowISO(),
    updatedAt: nowISO(),
    ...(options.sourceSessionId ? { sourceSessionId: options.sourceSessionId } : {}),
  };
  getMemoryBackend(cwd).add(memory);
  return memory;
}

export function removeMemory(cwd: string, id: string): boolean {
  return getMemoryBackend(cwd).remove(id);
}

export function updateMemory(
  cwd: string,
  id: string,
  updates: Partial<Pick<Memory, 'text' | 'category' | 'weight'>>,
): Memory | null {
  const fields: Partial<Pick<Memory, 'text' | 'category' | 'weight' | 'updatedAt'>> = { ...updates };
  if (fields.weight !== undefined) {
    fields.weight = Math.max(1, Math.min(10, fields.weight));
  }
  fields.updatedAt = nowISO();
  return getMemoryBackend(cwd).update(id, fields);
}

export function searchMemories(
  cwd: string,
  options: MemorySearchOptions = {},
): Memory[] {
  // searchMemories is read-mostly; load and filter in memory. Pushing the
  // filter into SQL is a future optimization once we have realistic dataset
  // sizes — current footprint is small (typical project has <50 memories).
  const data = getMemoryBackend(cwd).load();
  let results = data.memories;

  if (options.category) results = results.filter(m => m.category === options.category);
  if (options.source) results = results.filter(m => m.source === options.source);
  if (options.minWeight !== undefined) {
    const min = options.minWeight;
    results = results.filter(m => m.weight >= min);
  }
  if (options.query) {
    const q = options.query.toLowerCase();
    results = results.filter(m => m.text.toLowerCase().includes(q));
  }

  results.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  if (options.limit) results = results.slice(0, options.limit);
  return results;
}

export function getMemoryById(cwd: string, id: string): Memory | undefined {
  return getMemoryBackend(cwd).getById(id);
}
