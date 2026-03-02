import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createVision, updateVision } from '../../src/core/vision.js';
import type { VisionDocument } from '../../src/core/analyzers/types.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'slope-vision-helpers-'));
}

function seedVision(tmpDir: string, overrides: Partial<VisionDocument> = {}): void {
  const vision: VisionDocument = {
    purpose: 'Existing purpose',
    priorities: ['reliability'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  writeFileSync(join(tmpDir, '.slope/vision.json'), JSON.stringify(vision));
}

describe('createVision', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a valid vision document with timestamps', () => {
    const before = new Date().toISOString();
    const vision = createVision({
      purpose: 'Build a sprint scoring engine',
      priorities: ['reliability', 'dx'],
    }, tmpDir);
    const after = new Date().toISOString();

    expect(vision.purpose).toBe('Build a sprint scoring engine');
    expect(vision.priorities).toEqual(['reliability', 'dx']);
    expect(vision.createdAt).toBeTruthy();
    expect(vision.updatedAt).toBeTruthy();
    expect(vision.createdAt >= before).toBe(true);
    expect(vision.updatedAt <= after).toBe(true);
    expect(vision.createdAt).toBe(vision.updatedAt);

    const raw = readFileSync(join(tmpDir, '.slope/vision.json'), 'utf8');
    const saved = JSON.parse(raw);
    expect(saved.purpose).toBe('Build a sprint scoring engine');
  });

  it('saves optional fields when provided', () => {
    const vision = createVision({
      purpose: 'Test',
      priorities: ['speed'],
      audience: 'developers',
      techDirection: 'TypeScript monorepo',
      nonGoals: ['mobile support'],
    }, tmpDir);

    expect(vision.audience).toBe('developers');
    expect(vision.techDirection).toBe('TypeScript monorepo');
    expect(vision.nonGoals).toEqual(['mobile support']);
  });

  it('throws on empty purpose', () => {
    expect(() => createVision({
      purpose: '',
      priorities: ['speed'],
    }, tmpDir)).toThrow('Invalid vision');
  });

  it('accepts empty priorities array (validation allows it)', () => {
    const vision = createVision({
      purpose: 'Valid purpose',
      priorities: [],
    }, tmpDir);
    expect(vision.priorities).toEqual([]);
  });

  it('throws if vision already exists', () => {
    seedVision(tmpDir);
    expect(() => createVision({
      purpose: 'New purpose',
      priorities: ['speed'],
    }, tmpDir)).toThrow('Vision already exists');
  });
});

describe('updateVision', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws when no vision exists', () => {
    expect(() => updateVision({ purpose: 'New' }, tmpDir)).toThrow('No vision exists');
  });

  it('updates purpose and bumps updatedAt', () => {
    seedVision(tmpDir);
    const updated = updateVision({ purpose: 'New purpose' }, tmpDir);

    expect(updated.purpose).toBe('New purpose');
    expect(updated.priorities).toEqual(['reliability']);
    expect(updated.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(updated.updatedAt > '2026-01-01T00:00:00.000Z').toBe(true);
  });

  it('updates priorities while preserving other fields', () => {
    seedVision(tmpDir, { audience: 'engineers' });
    const updated = updateVision({ priorities: ['speed', 'dx'] }, tmpDir);

    expect(updated.priorities).toEqual(['speed', 'dx']);
    expect(updated.audience).toBe('engineers');
    expect(updated.purpose).toBe('Existing purpose');
  });

  it('does not overwrite fields with undefined', () => {
    seedVision(tmpDir, { audience: 'engineers', techDirection: 'monorepo' });
    const updated = updateVision({ purpose: 'Changed' }, tmpDir);

    expect(updated.audience).toBe('engineers');
    expect(updated.techDirection).toBe('monorepo');
  });

  it('rejects invalid updates', () => {
    seedVision(tmpDir);
    expect(() => updateVision({ purpose: '' }, tmpDir)).toThrow('Invalid vision');
  });
});
