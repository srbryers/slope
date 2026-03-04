import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadSprintState,
  saveSprintState,
  updateGate,
  isSprintComplete,
  pendingGates,
  createSprintState,
  clearSprintState,
} from '../../src/cli/sprint-state.js';

const tmpDir = join(import.meta.dirname ?? __dirname, '.tmp-sprint-state-test');

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadSprintState', () => {
  it('returns null for missing file', () => {
    expect(loadSprintState(tmpDir)).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    const dir = join(tmpDir, '.slope');
    mkdirSync(dir, { recursive: true });
    const { writeFileSync } = require('node:fs');
    writeFileSync(join(dir, 'sprint-state.json'), 'not json');
    expect(loadSprintState(tmpDir)).toBeNull();
  });

  it('returns null for invalid shape', () => {
    const dir = join(tmpDir, '.slope');
    mkdirSync(dir, { recursive: true });
    const { writeFileSync } = require('node:fs');
    writeFileSync(join(dir, 'sprint-state.json'), JSON.stringify({ foo: 'bar' }));
    expect(loadSprintState(tmpDir)).toBeNull();
  });

  it('returns null when gate keys are missing', () => {
    const dir = join(tmpDir, '.slope');
    mkdirSync(dir, { recursive: true });
    const { writeFileSync } = require('node:fs');
    writeFileSync(join(dir, 'sprint-state.json'), JSON.stringify({
      sprint: 22,
      phase: 'implementing',
      gates: { tests: true }, // missing 4 other keys
      started_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }));
    expect(loadSprintState(tmpDir)).toBeNull();
  });

  it('returns null when gate value is not boolean', () => {
    const dir = join(tmpDir, '.slope');
    mkdirSync(dir, { recursive: true });
    const { writeFileSync } = require('node:fs');
    writeFileSync(join(dir, 'sprint-state.json'), JSON.stringify({
      sprint: 22,
      phase: 'implementing',
      gates: { tests: 'yes', code_review: false, architect_review: false, scorecard: false, review_md: false },
      started_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }));
    expect(loadSprintState(tmpDir)).toBeNull();
  });
});

describe('saveSprintState', () => {
  it('creates .slope/ dir if needed', () => {
    const state = createSprintState(22);
    saveSprintState(tmpDir, state);
    expect(existsSync(join(tmpDir, '.slope', 'sprint-state.json'))).toBe(true);
  });

  it('round-trips correctly', () => {
    const state = createSprintState(22, 'implementing');
    saveSprintState(tmpDir, state);
    const loaded = loadSprintState(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.sprint).toBe(22);
    expect(loaded!.phase).toBe('implementing');
    expect(loaded!.gates.tests).toBe(false);
  });
});

describe('updateGate', () => {
  it('updates a gate and persists', () => {
    saveSprintState(tmpDir, createSprintState(22));
    updateGate(tmpDir, 'tests', true);
    const state = loadSprintState(tmpDir)!;
    expect(state.gates.tests).toBe(true);
    expect(state.gates.code_review).toBe(false);
  });

  it('no-ops when no sprint state exists', () => {
    // Should not throw
    updateGate(tmpDir, 'tests', true);
    expect(loadSprintState(tmpDir)).toBeNull();
  });
});

describe('isSprintComplete', () => {
  it('returns false when gates are incomplete', () => {
    const state = createSprintState(22);
    expect(isSprintComplete(state)).toBe(false);
  });

  it('returns true when all gates are true', () => {
    const state = createSprintState(22);
    state.gates.tests = true;
    state.gates.code_review = true;
    state.gates.architect_review = true;
    state.gates.scorecard = true;
    state.gates.review_md = true;
    expect(isSprintComplete(state)).toBe(true);
  });
});

describe('pendingGates', () => {
  it('returns all gates when none complete', () => {
    const state = createSprintState(22);
    const pending = pendingGates(state);
    expect(pending).toHaveLength(5);
    expect(pending).toContain('Tests passing');
    expect(pending).toContain('Code review');
  });

  it('returns empty when all complete', () => {
    const state = createSprintState(22);
    state.gates.tests = true;
    state.gates.code_review = true;
    state.gates.architect_review = true;
    state.gates.scorecard = true;
    state.gates.review_md = true;
    expect(pendingGates(state)).toHaveLength(0);
  });

  it('returns only incomplete gates', () => {
    const state = createSprintState(22);
    state.gates.tests = true;
    state.gates.scorecard = true;
    const pending = pendingGates(state);
    expect(pending).toHaveLength(3);
    expect(pending).not.toContain('Tests passing');
    expect(pending).not.toContain('Scorecard validated');
  });
});

describe('clearSprintState', () => {
  it('deletes the file', () => {
    saveSprintState(tmpDir, createSprintState(22));
    expect(loadSprintState(tmpDir)).not.toBeNull();
    clearSprintState(tmpDir);
    expect(loadSprintState(tmpDir)).toBeNull();
  });

  it('no-ops when file does not exist', () => {
    // Should not throw
    clearSprintState(tmpDir);
  });
});
