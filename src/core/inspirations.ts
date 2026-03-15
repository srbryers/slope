// Inspiration tracking — record external OSS projects and ideas adapted into SLOPE.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

/** Status of an inspiration entry */
export type InspirationStatus = 'backlogged' | 'planned' | 'implemented' | 'rejected';

/** A single inspiration entry tracking an external project and extracted ideas */
export interface InspirationEntry {
  id: string;
  source_url: string;
  project_name: string;
  ideas: string[];
  status: InspirationStatus;
  rejected_reason?: string;
  tags?: string[];
  linked_sprints: number[];
  added_at: string;
  notes?: string;
}

/** Top-level inspirations file schema */
export interface InspirationsFile {
  version: '1';
  last_updated: string;
  inspirations: InspirationEntry[];
}

/** Result of inspiration validation */
export interface InspirationValidationResult {
  errors: string[];
  warnings: string[];
}

/** Parse and validate an inspirations JSON string */
export function parseInspirations(json: string): InspirationsFile {
  const raw = JSON.parse(json);

  if (!raw || typeof raw !== 'object') {
    throw new Error('inspirations.json must be an object');
  }
  if (raw.version !== '1') {
    throw new Error(`Unsupported inspirations version: ${raw.version}`);
  }
  if (!Array.isArray(raw.inspirations)) {
    throw new Error('inspirations.json must have an "inspirations" array');
  }

  for (const entry of raw.inspirations) {
    if (!entry.id || typeof entry.id !== 'string') {
      throw new Error('Each inspiration must have a string "id"');
    }
    if (!entry.source_url || typeof entry.source_url !== 'string') {
      throw new Error(`Inspiration "${entry.id}": must have a string "source_url"`);
    }
    if (!entry.project_name || typeof entry.project_name !== 'string') {
      throw new Error(`Inspiration "${entry.id}": must have a string "project_name"`);
    }
    if (!Array.isArray(entry.ideas)) {
      throw new Error(`Inspiration "${entry.id}": must have an "ideas" array`);
    }
    if (!entry.status || !['backlogged', 'planned', 'implemented', 'rejected'].includes(entry.status)) {
      throw new Error(`Inspiration "${entry.id}": must have a valid "status" (backlogged, planned, implemented, rejected)`);
    }
    if (!Array.isArray(entry.linked_sprints)) {
      throw new Error(`Inspiration "${entry.id}": must have a "linked_sprints" array`);
    }
  }

  return raw as InspirationsFile;
}

/** Validate inspirations — check for duplicate IDs and structural issues */
export function validateInspirations(file: InspirationsFile): InspirationValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenIds = new Set<string>();

  for (const entry of file.inspirations) {
    if (seenIds.has(entry.id)) {
      errors.push(`Duplicate inspiration ID: "${entry.id}"`);
    }
    seenIds.add(entry.id);

    if (entry.ideas.length === 0) {
      warnings.push(`Inspiration "${entry.id}": has no ideas`);
    }

    if (entry.status === 'rejected' && !entry.rejected_reason) {
      warnings.push(`Inspiration "${entry.id}": rejected but no rejected_reason provided`);
    }
  }

  return { errors, warnings };
}

/** Load and parse inspirations from a file path. Returns null if file doesn't exist. */
export function loadInspirations(inspirationsPath: string): InspirationsFile | null {
  if (!existsSync(inspirationsPath)) {
    return null;
  }
  try {
    const content = readFileSync(inspirationsPath, 'utf8');
    return parseInspirations(content);
  } catch {
    return null;
  }
}

/** Derive a kebab-case ID from a project name */
export function deriveId(projectName: string): string {
  return projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Link an inspiration to a sprint number. Idempotent — no error if already linked.
 * Writes the updated file back to disk.
 */
export function linkInspirationToSprint(
  inspirationsPath: string,
  inspirationId: string,
  sprintNumber: number,
): InspirationsFile {
  const file = loadInspirations(inspirationsPath);
  if (!file) {
    throw new Error(`Inspirations file not found at ${inspirationsPath}`);
  }

  const entry = file.inspirations.find(e => e.id === inspirationId);
  if (!entry) {
    throw new Error(`Inspiration "${inspirationId}" not found`);
  }

  if (!entry.linked_sprints.includes(sprintNumber)) {
    entry.linked_sprints.push(sprintNumber);
    entry.linked_sprints.sort((a, b) => a - b);
  }

  file.last_updated = new Date().toISOString();
  const dir = dirname(inspirationsPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(inspirationsPath, JSON.stringify(file, null, 2) + '\n');

  return file;
}
