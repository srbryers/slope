/**
 * SqliteMemoryBackend — better-sqlite3 backed memory storage.
 *
 * Lives in src/store/ alongside SqliteSlopeStore. Uses the same
 * `.slope/slope.db` file but a dedicated `memories` table (added in
 * migration v8). Keeps the API sync via better-sqlite3 prepared statements.
 *
 * Migration: on first open, if a sibling `.slope/memories.json` exists and
 * the memories table is empty, contents are imported and the JSON file is
 * renamed to `.slope/memories.json.bak` so the original is preserved as a
 * one-time backup.
 */

import { existsSync, renameSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import type { MemoryBackend } from '../core/memory-backend.js';
import type { Memory, MemoriesFile, MemoryCategory, MemorySource } from '../core/memory-types.js';
import { validateMemoryRow } from '../core/memory-validation.js';

const CURRENT_VERSION = 1;

interface MemoryRow {
  id: string;
  text: string;
  category: string;
  weight: number;
  source: string;
  created_at: string;
  updated_at: string;
  source_session_id: string | null;
}

function rowToMemory(r: MemoryRow): Memory {
  return {
    id: r.id,
    text: r.text,
    category: r.category as MemoryCategory,
    weight: r.weight,
    source: r.source as MemorySource,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(r.source_session_id ? { sourceSessionId: r.source_session_id } : {}),
  };
}

export class SqliteMemoryBackend implements MemoryBackend {
  readonly kind = 'sqlite' as const;
  private db: DatabaseType;
  private cwd: string;

  /** True after the importJsonIfPresent() pass has run for this instance. */
  private importedJson = false;

  constructor(cwd: string, dbPath: string) {
    this.cwd = cwd;
    this.db = new Database(dbPath);
    this.ensureSchema();
    this.importJsonIfPresent();
  }

  /**
   * Idempotent: create the memories table if it doesn't exist. Independent
   * of the SqliteSlopeStore migration system so the backend can be used
   * standalone (tests, embedded use). The full migration is owned by
   * SqliteSlopeStore (v8).
   */
  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        category TEXT NOT NULL,
        weight INTEGER NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        source_session_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
      CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source);
      CREATE INDEX IF NOT EXISTS idx_memories_weight ON memories(weight);
    `);
  }

  /** One-time migration from .slope/memories.json. Runs at most once per
   *  backend instance and only if the table is currently empty. */
  private importJsonIfPresent(): void {
    if (this.importedJson) return;
    this.importedJson = true;

    const jsonPath = join(this.cwd, '.slope', 'memories.json');
    if (!existsSync(jsonPath)) return;

    // Skip when the table already has rows (avoids re-importing on every open)
    const count = (this.db.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number }).c;
    if (count > 0) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(jsonPath, 'utf8'));
    } catch (err) {
      console.error(`SLOPE memory: could not parse ${jsonPath} during migration (${(err as Error).message}). Leaving JSON in place.`);
      return;
    }

    const rows: unknown[] = Array.isArray(parsed)
      ? parsed
      : (parsed as { memories?: unknown[] })?.memories ?? [];

    if (rows.length === 0) {
      // Empty JSON — still rename so we don't keep checking
      this.renameJsonBackup(jsonPath);
      return;
    }

    let imported = 0;
    const insert = this.prepareInsert();
    const txn = this.db.transaction((rs: unknown[]) => {
      for (const r of rs) {
        try {
          const m = validateMemoryRow(r);
          insert.run(toRow(m));
          imported++;
        } catch (err) {
          console.error(`SLOPE memory: skipping invalid row during migration (${(err as Error).message})`);
        }
      }
    });
    txn(rows);

    this.renameJsonBackup(jsonPath);
    console.error(`SLOPE memory: imported ${imported} row(s) from memories.json into store; original renamed to .bak`);
  }

  private renameJsonBackup(jsonPath: string): void {
    try {
      renameSync(jsonPath, `${jsonPath}.bak`);
    } catch (err) {
      console.error(`SLOPE memory: could not rename ${jsonPath} after import (${(err as Error).message}). Manual cleanup recommended.`);
    }
  }

  private prepareInsert() {
    return this.db.prepare(`
      INSERT OR REPLACE INTO memories (id, text, category, weight, source, created_at, updated_at, source_session_id)
      VALUES (@id, @text, @category, @weight, @source, @created_at, @updated_at, @source_session_id)
    `);
  }

  load(): MemoriesFile {
    const rows = this.db.prepare('SELECT * FROM memories ORDER BY weight DESC, updated_at DESC').all() as MemoryRow[];
    return { version: CURRENT_VERSION, memories: rows.map(rowToMemory) };
  }

  saveAll(data: MemoriesFile): void {
    const txn = this.db.transaction((rs: Memory[]) => {
      this.db.prepare('DELETE FROM memories').run();
      const insert = this.prepareInsert();
      for (const m of rs) insert.run(toRow(m));
    });
    txn(data.memories);
  }

  add(memory: Memory): void {
    this.prepareInsert().run(toRow(memory));
  }

  remove(id: string): boolean {
    const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return result.changes > 0;
  }

  update(id: string, fields: Partial<Pick<Memory, 'text' | 'category' | 'weight' | 'updatedAt'>>): Memory | null {
    const existing = this.getById(id);
    if (!existing) return null;
    const next: Memory = {
      ...existing,
      ...(fields.text !== undefined ? { text: fields.text } : {}),
      ...(fields.category !== undefined ? { category: fields.category } : {}),
      ...(fields.weight !== undefined ? { weight: Math.max(1, Math.min(10, fields.weight)) } : {}),
      updatedAt: fields.updatedAt ?? new Date().toISOString(),
    };
    this.prepareInsert().run(toRow(next));
    return next;
  }

  getById(id: string): Memory | undefined {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow | undefined;
    return row ? rowToMemory(row) : undefined;
  }

  /** Close the underlying connection. Test/teardown helper. */
  close(): void {
    this.db.close();
  }
}

function toRow(m: Memory): Record<string, unknown> {
  return {
    id: m.id,
    text: m.text,
    category: m.category,
    weight: m.weight,
    source: m.source,
    created_at: m.createdAt,
    updated_at: m.updatedAt,
    source_session_id: m.sourceSessionId ?? null,
  };
}
