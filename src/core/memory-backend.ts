/**
 * MemoryStore — pluggable backend for cross-session memory persistence.
 *
 * Resolves the architect finding from PR #293 (GH #294): the memory module
 * was writing directly to `.slope/memories.json` via node:fs, bypassing the
 * store-sqlite/store-pg abstraction that already handles sessions, claims,
 * scorecards, and common-issues.
 *
 * The interface is sync to preserve the existing memory.ts public API
 * (addMemory/searchMemories etc.) without forcing a synchronous-to-async
 * migration of every call site (auto-memory hooks, CLI, briefing).
 */

import type { Memory, MemoriesFile } from './memory-types.js';

export interface MemoryBackend {
  /** Read all memories. */
  load(): MemoriesFile;

  /** Replace all memories with the given file (used for import/migration). */
  saveAll(data: MemoriesFile): void;

  /** Insert a new memory. */
  add(memory: Memory): void;

  /** Remove by id. Returns true if removed, false if not found. */
  remove(id: string): boolean;

  /** Patch the memory in place; returns the updated row, or null if not found. */
  update(id: string, fields: Partial<Pick<Memory, 'text' | 'category' | 'weight' | 'updatedAt'>>): Memory | null;

  /** Lookup by id. */
  getById(id: string): Memory | undefined;

  /** Identify the backend (for diagnostics). */
  readonly kind: 'json' | 'sqlite' | 'pg';
}
