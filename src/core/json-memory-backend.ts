/**
 * JsonMemoryBackend — file-backed implementation (legacy default).
 *
 * Wraps the original `.slope/memories.json` behavior in the MemoryBackend
 * interface so callers can swap to a store-backed adapter without changing
 * the memory.ts public API. Preserves atomic writes (temp + rename) and
 * v0 → v1 migration.
 */

import { existsSync, readFileSync, writeFileSync, renameSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { MemoryBackend } from './memory-backend.js';
import type { Memory, MemoriesFile } from './memory-types.js';
import { validateMemoryRow } from './memory-validation.js';

const MEMORIES_FILE = 'memories.json';
const CURRENT_VERSION = 1;

export class JsonMemoryBackend implements MemoryBackend {
  readonly kind = 'json' as const;
  private path: string;
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.path = join(cwd, '.slope', MEMORIES_FILE);
  }

  load(): MemoriesFile {
    if (!existsSync(this.path)) {
      return { version: CURRENT_VERSION, memories: [] };
    }
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8'));
      if (raw && typeof raw === 'object' && 'version' in raw) {
        const version = Number(raw.version);
        if (version === 1) {
          const memories = Array.isArray(raw.memories) ? raw.memories.map(validateMemoryRow) : [];
          return { version: CURRENT_VERSION, memories };
        }
        // Unknown future version — back up before returning empty
        const backupPath = `${this.path}.v${version}.bak`;
        try {
          copyFileSync(this.path, backupPath);
          console.error(`SLOPE memory: unknown memories.json version=${version}; backed up to ${backupPath} and starting fresh.`);
        } catch (err) {
          console.error(`SLOPE memory: unknown memories.json version=${version}; backup failed (${(err as Error).message}). Starting fresh.`);
        }
        return { version: CURRENT_VERSION, memories: [] };
      }
      // No version field — try v0 migration (plain array)
      if (Array.isArray(raw)) {
        return { version: CURRENT_VERSION, memories: raw.map(validateMemoryRow) };
      }
      return { version: CURRENT_VERSION, memories: [] };
    } catch (err) {
      console.error(`SLOPE memory: failed to parse ${this.path} (${(err as Error).message}). Treating as empty.`);
      return { version: CURRENT_VERSION, memories: [] };
    }
  }

  saveAll(data: MemoriesFile): void {
    mkdirSync(join(this.cwd, '.slope'), { recursive: true });
    const tmp = `${this.path}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
    renameSync(tmp, this.path);
  }

  add(memory: Memory): void {
    const data = this.load();
    data.memories.push(memory);
    this.saveAll(data);
  }

  remove(id: string): boolean {
    const data = this.load();
    const idx = data.memories.findIndex(m => m.id === id);
    if (idx === -1) return false;
    data.memories.splice(idx, 1);
    this.saveAll(data);
    return true;
  }

  update(id: string, fields: Partial<Pick<Memory, 'text' | 'category' | 'weight' | 'updatedAt'>>): Memory | null {
    const data = this.load();
    const mem = data.memories.find(m => m.id === id);
    if (!mem) return null;
    if (fields.text !== undefined) mem.text = fields.text;
    if (fields.category !== undefined) mem.category = fields.category;
    if (fields.weight !== undefined) mem.weight = Math.max(1, Math.min(10, fields.weight));
    if (fields.updatedAt !== undefined) mem.updatedAt = fields.updatedAt;
    else mem.updatedAt = new Date().toISOString();
    this.saveAll(data);
    return mem;
  }

  getById(id: string): Memory | undefined {
    return this.load().memories.find(m => m.id === id);
  }
}
