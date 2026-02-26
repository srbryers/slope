import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadVision, saveVision, validateVision } from '../../src/core/vision.js';
import type { VisionDocument } from '../../src/core/analyzers/types.js';

function makeVision(overrides: Partial<VisionDocument> = {}): VisionDocument {
  return {
    purpose: 'Build a sprint scoring engine',
    priorities: ['reliability', 'developer experience'],
    createdAt: '2026-02-25T00:00:00.000Z',
    updatedAt: '2026-02-25T00:00:00.000Z',
    ...overrides,
  };
}

describe('loadVision', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slope-vision-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when no vision exists', () => {
    expect(loadVision(tmpDir)).toBeNull();
  });

  it('returns null on invalid JSON', () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/vision.json'), 'bad json');
    expect(loadVision(tmpDir)).toBeNull();
  });

  it('loads a saved vision', () => {
    const vision = makeVision();
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/vision.json'), JSON.stringify(vision));
    const loaded = loadVision(tmpDir);
    expect(loaded).toEqual(vision);
  });
});

describe('saveVision', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slope-vision-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates .slope dir and writes vision', () => {
    const vision = makeVision();
    saveVision(vision, tmpDir);
    expect(existsSync(join(tmpDir, '.slope/vision.json'))).toBe(true);
    const loaded = loadVision(tmpDir);
    expect(loaded).toEqual(vision);
  });

  it('round-trips through save and load', () => {
    const vision = makeVision({ audience: 'engineering teams', nonGoals: ['project management'] });
    saveVision(vision, tmpDir);
    const loaded = loadVision(tmpDir);
    expect(loaded).toEqual(vision);
    expect(loaded!.audience).toBe('engineering teams');
    expect(loaded!.nonGoals).toEqual(['project management']);
  });
});

describe('validateVision', () => {
  it('passes for valid vision', () => {
    const errors = validateVision(makeVision());
    expect(errors).toHaveLength(0);
  });

  it('rejects non-object', () => {
    const errors = validateVision('not an object');
    expect(errors).toContain('Vision must be an object');
  });

  it('rejects null', () => {
    const errors = validateVision(null);
    expect(errors).toContain('Vision must be an object');
  });

  it('rejects missing purpose', () => {
    const errors = validateVision({ priorities: [] });
    expect(errors.some(e => e.includes('purpose'))).toBe(true);
  });

  it('rejects empty purpose', () => {
    const errors = validateVision({ purpose: '', priorities: [] });
    expect(errors.some(e => e.includes('purpose'))).toBe(true);
  });

  it('rejects non-array priorities', () => {
    const errors = validateVision({ purpose: 'test', priorities: 'not array' });
    expect(errors.some(e => e.includes('priorities must be an array'))).toBe(true);
  });

  it('rejects non-string priority items', () => {
    const errors = validateVision({ purpose: 'test', priorities: [123] });
    expect(errors.some(e => e.includes('priorities[0] must be a string'))).toBe(true);
  });

  it('rejects invalid date format', () => {
    const errors = validateVision({ purpose: 'test', priorities: [], createdAt: 'not-a-date' });
    expect(errors.some(e => e.includes('createdAt'))).toBe(true);
  });
});
