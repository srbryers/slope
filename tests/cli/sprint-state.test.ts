import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadSprintState,
  saveSprintState,
  updateGate,
  isActiveSprintState,
  isSprintComplete,
  pendingGates,
  createSprintState,
  createDefaultReviewGates,
  clearSprintState,
} from '../../src/cli/sprint-state.js';

const tmpDir = join(import.meta.dirname ?? __dirname, '.tmp-sprint-state-test');

function writeRawSprintState(state: unknown): void {
  const dir = join(tmpDir, '.slope');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'sprint-state.json'), JSON.stringify(state));
}

function legacySprintState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sprint: 22,
    phase: 'implementing',
    gates: { tests: false, code_review: false, architect_review: false, scorecard: false, review_md: false },
    started_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function satisfyReviewGates(state: ReturnType<typeof createSprintState>): void {
  state.review_gates.code_review = {
    provenance: 'independent_review',
    evidence: ['agent:code-reviewer-output'],
    reviewer: 'code-reviewer',
  };
  state.review_gates.architect_review = {
    provenance: 'independent_review',
    evidence: ['agent:architect-reviewer-output'],
    reviewer: 'architect-reviewer',
  };
}

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
    writeFileSync(join(dir, 'sprint-state.json'), 'not json');
    expect(loadSprintState(tmpDir)).toBeNull();
  });

  it('returns null for invalid shape', () => {
    const dir = join(tmpDir, '.slope');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'sprint-state.json'), JSON.stringify({ foo: 'bar' }));
    expect(loadSprintState(tmpDir)).toBeNull();
  });

  it('returns null when gate keys are missing', () => {
    writeRawSprintState(legacySprintState({
      gates: { tests: true }, // missing 4 other keys
    }));
    expect(loadSprintState(tmpDir)).toBeNull();
  });

  it('returns null when gate value is not boolean', () => {
    writeRawSprintState(legacySprintState({
      gates: { tests: 'yes', code_review: false, architect_review: false, scorecard: false, review_md: false },
    }));
    expect(loadSprintState(tmpDir)).toBeNull();
  });

  it('loads legacy state without review gate provenance as pending', () => {
    writeRawSprintState(legacySprintState());

    const loaded = loadSprintState(tmpDir);

    expect(loaded).not.toBeNull();
    expect(loaded!.review_gates).toEqual(createDefaultReviewGates());
  });

  it('normalizes partial or invalid review gate provenance', () => {
    writeRawSprintState(legacySprintState({
      review_gates: {
        code_review: {
          provenance: 'independent_review',
          evidence: ['agent:code-review', 17],
          reviewer: 'code-reviewer',
          notes: 'Looks good.',
          updated_at: '2026-01-02T00:00:00Z',
        },
        architect_review: {
          provenance: 'unknown',
          evidence: ['manual note', false],
          reviewer: 42,
          notes: true,
          updated_at: null,
        },
      },
    }));

    const loaded = loadSprintState(tmpDir);

    expect(loaded!.review_gates.code_review).toEqual({
      provenance: 'independent_review',
      evidence: ['agent:code-review'],
      reviewer: 'code-reviewer',
      notes: 'Looks good.',
      updated_at: '2026-01-02T00:00:00Z',
    });
    expect(loaded!.review_gates.architect_review).toEqual({
      provenance: 'pending',
      evidence: ['manual note'],
    });
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
    expect(loaded!.review_gates.code_review.provenance).toBe('pending');
  });

  it('round-trips decimal inserted sprint ids', () => {
    const state = createSprintState(114.5, 'planning');
    saveSprintState(tmpDir, state);
    const loaded = loadSprintState(tmpDir);
    expect(loaded?.sprint).toBe(114.5);
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

  it('does not pass a review gate without explicit provenance', () => {
    saveSprintState(tmpDir, createSprintState(22));

    const result = updateGate(tmpDir, 'code_review', true);

    const state = loadSprintState(tmpDir)!;
    expect(result).toBe(false);
    expect(state.gates.code_review).toBe(false);
    expect(state.review_gates.code_review).toEqual({ provenance: 'pending', evidence: [] });
  });

  it('records explicit self-review provenance as a weaker-mode override', () => {
    saveSprintState(tmpDir, createSprintState(22));

    const result = updateGate(tmpDir, 'code_review', true, {
      review: {
        provenance: 'self_review',
        notes: 'Low-risk docs-only follow-up; independent review not required.',
      },
    });

    const state = loadSprintState(tmpDir)!;
    expect(result).toBe(true);
    expect(state.gates.code_review).toBe(true);
    expect(state.review_gates.code_review).toMatchObject({
      provenance: 'self_review',
      evidence: [],
      notes: 'Low-risk docs-only follow-up; independent review not required.',
      updated_at: expect.any(String),
    });
  });

  it('records independent review provenance when evidence is provided', () => {
    saveSprintState(tmpDir, createSprintState(22));

    const result = updateGate(tmpDir, 'code_review', true, {
      review: {
        provenance: 'independent_review',
        evidence: ['agent:code-reviewer'],
        reviewer: 'code-reviewer',
        notes: 'No blocking findings.',
      },
    });

    const loaded = loadSprintState(tmpDir)!;
    expect(result).toBe(true);
    expect(loaded.gates.code_review).toBe(true);
    expect(loaded.review_gates.code_review).toMatchObject({
      provenance: 'independent_review',
      evidence: ['agent:code-reviewer'],
      reviewer: 'code-reviewer',
      notes: 'No blocking findings.',
      updated_at: expect.any(String),
    });
  });

  it('resets review gate provenance when marking incomplete', () => {
    saveSprintState(tmpDir, createSprintState(22));
    updateGate(tmpDir, 'architect_review', true, {
      review: {
        provenance: 'self_review',
        notes: 'Temporary manual self-review before reset.',
      },
    });

    updateGate(tmpDir, 'architect_review', false);

    const state = loadSprintState(tmpDir)!;
    expect(state.gates.architect_review).toBe(false);
    expect(state.review_gates.architect_review).toEqual({ provenance: 'pending', evidence: [] });
  });
});

describe('createSprintState', () => {
  it('initializes review gates as pending', () => {
    expect(createSprintState(22).review_gates).toEqual(createDefaultReviewGates());
  });
});

describe('isSprintComplete', () => {
  it('returns false when gates are incomplete', () => {
    const state = createSprintState(22);
    expect(isSprintComplete(state)).toBe(false);
  });

  it('returns false when review booleans are true without provenance', () => {
    const state = createSprintState(22);
    state.gates.tests = true;
    state.gates.code_review = true;
    state.gates.architect_review = true;
    state.gates.scorecard = true;
    state.gates.review_md = true;
    expect(isSprintComplete(state)).toBe(false);
  });

  it('returns true when all gates and review provenance are complete', () => {
    const state = createSprintState(22);
    state.gates.tests = true;
    state.gates.code_review = true;
    state.gates.architect_review = true;
    state.gates.scorecard = true;
    state.gates.review_md = true;
    satisfyReviewGates(state);
    expect(isSprintComplete(state)).toBe(true);
  });
});

describe('isActiveSprintState', () => {
  it('returns false for scoring state when every closeout gate is complete', () => {
    const state = createSprintState(22, 'scoring');
    state.gates.tests = true;
    state.gates.code_review = true;
    state.gates.architect_review = true;
    state.gates.scorecard = true;
    state.gates.review_md = true;
    satisfyReviewGates(state);

    expect(isActiveSprintState(state)).toBe(false);
  });

  it('returns true for scoring state while any closeout gate is still open', () => {
    const state = createSprintState(22, 'scoring');
    state.gates.tests = true;

    expect(isActiveSprintState(state)).toBe(true);
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
    satisfyReviewGates(state);
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
