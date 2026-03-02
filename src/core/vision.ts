// SLOPE — Vision Document: project intent and direction
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { VisionDocument } from './analyzers/types.js';

const DEFAULT_VISION_PATH = '.slope/vision.json';

export function loadVision(cwd?: string): VisionDocument | null {
  const root = cwd ?? process.cwd();
  const filePath = join(root, DEFAULT_VISION_PATH);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as VisionDocument;
  } catch {
    return null;
  }
}

export function saveVision(vision: VisionDocument, cwd?: string): void {
  const root = cwd ?? process.cwd();
  const filePath = join(root, DEFAULT_VISION_PATH);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(vision, null, 2) + '\n');
}

/** Create a new vision document with timestamps. Validates, saves, and returns it. */
export function createVision(fields: {
  purpose: string;
  priorities: string[];
  audience?: string;
  techDirection?: string;
  nonGoals?: string[];
}, cwd?: string): VisionDocument {
  const existing = loadVision(cwd);
  if (existing) throw new Error('Vision already exists. Use updateVision() to modify it.');
  const now = new Date().toISOString();
  const vision: VisionDocument = {
    purpose: fields.purpose,
    priorities: fields.priorities,
    audience: fields.audience,
    techDirection: fields.techDirection,
    nonGoals: fields.nonGoals,
    createdAt: now,
    updatedAt: now,
  };
  const errors = validateVision(vision);
  if (errors.length > 0) throw new Error(`Invalid vision: ${errors.join(', ')}`);
  saveVision(vision, cwd);
  return vision;
}

/** Update fields of an existing vision document. Preserves createdAt, bumps updatedAt. */
export function updateVision(fields: Partial<Omit<VisionDocument, 'createdAt' | 'updatedAt'>>, cwd?: string): VisionDocument {
  const existing = loadVision(cwd);
  if (!existing) throw new Error('No vision exists. Use createVision() first.');
  const updated: VisionDocument = {
    ...existing,
    ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
    updatedAt: new Date().toISOString(),
  };
  const errors = validateVision(updated);
  if (errors.length > 0) throw new Error(`Invalid vision: ${errors.join(', ')}`);
  saveVision(updated, cwd);
  return updated;
}

export function validateVision(vision: unknown): string[] {
  const errors: string[] = [];

  if (!vision || typeof vision !== 'object') {
    errors.push('Vision must be an object');
    return errors;
  }

  const v = vision as Record<string, unknown>;

  if (!v.purpose || typeof v.purpose !== 'string' || v.purpose.trim() === '') {
    errors.push('purpose is required and must be a non-empty string');
  }

  if (!Array.isArray(v.priorities)) {
    errors.push('priorities must be an array');
  } else {
    for (let i = 0; i < v.priorities.length; i++) {
      if (typeof v.priorities[i] !== 'string') {
        errors.push(`priorities[${i}] must be a string`);
      }
    }
  }

  if (v.createdAt !== undefined && typeof v.createdAt === 'string') {
    if (isNaN(Date.parse(v.createdAt))) {
      errors.push('createdAt must be a valid ISO date string');
    }
  }

  if (v.updatedAt !== undefined && typeof v.updatedAt === 'string') {
    if (isNaN(Date.parse(v.updatedAt))) {
      errors.push('updatedAt must be a valid ISO date string');
    }
  }

  return errors;
}
