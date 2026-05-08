// Shared validation for Memory rows — extracted so JsonMemoryBackend and
// SqliteMemoryBackend (in src/store/) can both import without circulars.

import { randomUUID } from 'node:crypto';
import type { Memory, MemoryCategory, MemorySource } from './memory-types.js';

const VALID_CATEGORIES: MemoryCategory[] = ['workflow', 'style', 'project', 'hazard', 'other'];
const VALID_SOURCES: MemorySource[] = ['manual', 'auto-guard', 'auto-workflow'];

function nowISO(): string {
  return new Date().toISOString();
}

/** Validate and normalize a Memory row. Throws TypeError on invalid category/source. */
export function validateMemoryRow(input: unknown): Memory {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Memory must be an object');
  }
  const m = input as Record<string, unknown>;
  const category = (m.category as MemoryCategory) ?? 'other';
  const source = (m.source as MemorySource) ?? 'manual';

  if (!VALID_CATEGORIES.includes(category)) {
    throw new TypeError(`Invalid memory category: ${category}`);
  }
  if (!VALID_SOURCES.includes(source)) {
    throw new TypeError(`Invalid memory source: ${source}`);
  }

  const weight = typeof m.weight === 'number' ? m.weight : 5;
  return {
    id: typeof m.id === 'string' ? m.id : randomUUID(),
    text: typeof m.text === 'string' ? m.text : '',
    category,
    weight: Math.max(1, Math.min(10, weight)),
    source,
    createdAt: typeof m.createdAt === 'string' ? m.createdAt : nowISO(),
    updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt : nowISO(),
    ...(typeof m.sourceSessionId === 'string' ? { sourceSessionId: m.sourceSessionId } : {}),
  };
}
