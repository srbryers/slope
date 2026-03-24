import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { selectModel, selectTimeout, isLocalModel } from '../../../src/cli/loop/model-selector.js';
import { DEFAULT_LOOP_CONFIG } from '../../../src/cli/loop/types.js';
import type { LoopConfig } from '../../../src/cli/loop/types.js';

let tmpDir: string;
let config: LoopConfig;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-loop-model-'));
  mkdirSync(join(tmpDir, 'slope-loop'), { recursive: true });
  config = { ...DEFAULT_LOOP_CONFIG };
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('selectModel', () => {
  // Factor 1: Token-based escalation
  it('routes to API when est_tokens > 24000', () => {
    const model = selectModel('wedge', 1, 25000, config, tmpDir);
    expect(model).toBe(config.modelApi);
  });

  it('does not escalate at exactly 24000 tokens (boundary)', () => {
    const model = selectModel('wedge', 1, 24000, config, tmpDir);
    expect(model).toBe(config.modelLocal);
  });

  // Factor 2: Multi-file routing
  it('routes to API when max_files >= 2', () => {
    const model = selectModel('wedge', 2, 0, config, tmpDir);
    expect(model).toBe(config.modelApi);
  });

  it('does not escalate at max_files = 1 (boundary)', () => {
    const model = selectModel('wedge', 1, 0, config, tmpDir);
    expect(model).toBe(config.modelLocal);
  });

  // Factor 3: Data-driven overrides
  it('uses model-config.json recommendation when available', () => {
    writeFileSync(join(tmpDir, 'slope-loop/model-config.json'), JSON.stringify({
      generated_at: '2026-01-01T00:00:00Z',
      ticket_count: 20,
      escalation_save_rate: 0.5,
      success_rates: {},
      cost_per_success: {},
      recommendations: {
        wedge: { model: 'api', reason: 'low local success rate' },
      },
      notes: [],
    }));
    const model = selectModel('wedge', 1, 0, config, tmpDir);
    expect(model).toBe(config.modelApi);
  });

  it('uses local recommendation from model-config.json', () => {
    writeFileSync(join(tmpDir, 'slope-loop/model-config.json'), JSON.stringify({
      generated_at: '2026-01-01T00:00:00Z',
      ticket_count: 20,
      escalation_save_rate: 0.5,
      success_rates: {},
      cost_per_success: {},
      recommendations: {
        short_iron: { model: 'local', reason: 'high local success rate' },
      },
      notes: [],
    }));
    const model = selectModel('short_iron', 1, 0, config, tmpDir);
    expect(model).toBe(config.modelLocal);
  });

  // Factor 4: Club defaults
  it('routes putter to local by default', () => {
    expect(selectModel('putter', 1, 0, config, tmpDir)).toBe(config.modelLocal);
  });

  it('routes wedge to local by default', () => {
    expect(selectModel('wedge', 1, 0, config, tmpDir)).toBe(config.modelLocal);
  });

  it('routes short_iron to local by default', () => {
    expect(selectModel('short_iron', 1, 0, config, tmpDir)).toBe(config.modelLocal);
  });

  it('routes long_iron to API by default', () => {
    expect(selectModel('long_iron', 1, 0, config, tmpDir)).toBe(config.modelApi);
  });

  it('routes driver to API by default', () => {
    expect(selectModel('driver', 1, 0, config, tmpDir)).toBe(config.modelApi);
  });

  // Factor 5: Strategy-based routing
  it('routes documentation strategy to API regardless of club', () => {
    expect(selectModel('putter', 1, 0, config, tmpDir, 'documentation')).toBe(config.modelApi);
  });

  it('does not escalate non-documentation strategies', () => {
    expect(selectModel('putter', 1, 0, config, tmpDir, 'hardening')).toBe(config.modelLocal);
  });

  it('strategy is optional (backward compat)', () => {
    expect(selectModel('putter', 1, 0, config, tmpDir)).toBe(config.modelLocal);
  });

  it('documentation strategy beats model-config.json local recommendation', () => {
    writeFileSync(join(tmpDir, 'slope-loop/model-config.json'), JSON.stringify({
      generated_at: '2026-01-01T00:00:00Z',
      ticket_count: 20,
      escalation_save_rate: 0.5,
      success_rates: {},
      cost_per_success: {},
      recommendations: {
        putter: { model: 'local', reason: 'high local success rate' },
      },
      notes: [],
    }));
    const model = selectModel('putter', 1, 0, config, tmpDir, 'documentation');
    expect(model).toBe(config.modelApi);
  });

  // Priority: token check beats club default
  it('token escalation takes priority over club default', () => {
    const model = selectModel('putter', 1, 30000, config, tmpDir);
    expect(model).toBe(config.modelApi);
  });

  // Priority: file check beats club default
  it('file escalation takes priority over club default', () => {
    const model = selectModel('putter', 3, 0, config, tmpDir);
    expect(model).toBe(config.modelApi);
  });

  // Handles missing model-config.json gracefully
  it('works without model-config.json', () => {
    const model = selectModel('short_iron', 1, 0, config, tmpDir);
    expect(model).toBe(config.modelLocal);
  });

  // Handles malformed model-config.json
  it('handles malformed model-config.json', () => {
    writeFileSync(join(tmpDir, 'slope-loop/model-config.json'), 'not json');
    const model = selectModel('short_iron', 1, 0, config, tmpDir);
    expect(model).toBe(config.modelLocal);
  });

  // Cross-dimensional recommendations (T2)
  it('uses club+sprintType recommendation over club-only', () => {
    writeFileSync(join(tmpDir, 'slope-loop/model-config.json'), JSON.stringify({
      generated_at: '2026-01-01T00:00:00Z',
      ticket_count: 20,
      escalation_save_rate: 50,
      success_rates: {},
      cost_per_success: {},
      recommendations: {
        wedge: { model: 'local', reason: 'club-level says local' },
      },
      recommendations_by_type: {
        'wedge:chore': { model: 'api', reason: '40% success on chore', samples: 5 },
      },
      notes: [],
    }));
    // sprintType 'chore' overrides club-only 'local' → API
    const model = selectModel('wedge', 1, 0, config, tmpDir, undefined, 'chore');
    expect(model).toBe(config.modelApi);
  });

  it('uses club+strategy recommendation when no sprintType match', () => {
    writeFileSync(join(tmpDir, 'slope-loop/model-config.json'), JSON.stringify({
      generated_at: '2026-01-01T00:00:00Z',
      ticket_count: 20,
      escalation_save_rate: 50,
      success_rates: {},
      cost_per_success: {},
      recommendations: {
        wedge: { model: 'local', reason: 'club-level says local' },
      },
      recommendations_by_strategy: {
        'wedge:hardening': { model: 'api', reason: '45% on hardening', samples: 4 },
      },
      notes: [],
    }));
    // No sprintType match, but strategy 'hardening' matches → API
    const model = selectModel('wedge', 1, 0, config, tmpDir, 'hardening');
    expect(model).toBe(config.modelApi);
  });

  it('falls back to club-only when no cross-dimensional match', () => {
    writeFileSync(join(tmpDir, 'slope-loop/model-config.json'), JSON.stringify({
      generated_at: '2026-01-01T00:00:00Z',
      ticket_count: 20,
      escalation_save_rate: 50,
      success_rates: {},
      cost_per_success: {},
      recommendations: {
        wedge: { model: 'api', reason: 'club-level says api' },
      },
      recommendations_by_type: {
        'short_iron:feature': { model: 'local', reason: 'different club', samples: 5 },
      },
      notes: [],
    }));
    // No type or strategy match for wedge:chore, falls to club-only → API
    const model = selectModel('wedge', 1, 0, config, tmpDir, 'testing', 'chore');
    expect(model).toBe(config.modelApi);
  });

  it('falls to club defaults when all cross-dimensional cells empty (cold start)', () => {
    writeFileSync(join(tmpDir, 'slope-loop/model-config.json'), JSON.stringify({
      generated_at: '2026-01-01T00:00:00Z',
      ticket_count: 20,
      escalation_save_rate: 50,
      success_rates: {},
      cost_per_success: {},
      recommendations: {},
      recommendations_by_type: {},
      recommendations_by_strategy: {},
      notes: [],
    }));
    // No data at all — fall through to club defaults
    expect(selectModel('wedge', 1, 0, config, tmpDir, 'hardening', 'feature')).toBe(config.modelLocal);
    expect(selectModel('long_iron', 1, 0, config, tmpDir, 'hardening', 'feature')).toBe(config.modelApi);
  });

  it('sprintType is optional (backward compat)', () => {
    const model = selectModel('wedge', 1, 0, config, tmpDir, 'hardening');
    expect(model).toBe(config.modelLocal);
  });

  // Cost-adjusted routing (T3)
  it('prefers model with better cost-adjusted score', () => {
    writeFileSync(join(tmpDir, 'slope-loop/model-config.json'), JSON.stringify({
      generated_at: '2026-01-01T00:00:00Z',
      ticket_count: 20,
      escalation_save_rate: 50,
      success_rates: {},
      cost_per_success: {},
      cost_adjusted_scores: {
        // Local has better cost-adjusted score (free + decent rate)
        'short_iron:ollama/qwen2.5-coder:32b': 10.0,
        [`short_iron:${config.modelApi}`]: 2.5,
      },
      recommendations: {},
      notes: [],
    }));
    // Cost-adjusted: local wins (10.0 > 2.5)
    const model = selectModel('short_iron', 1, 0, config, tmpDir);
    expect(model).toBe(config.modelLocal);
  });

  it('routes to API when API has better cost-adjusted score', () => {
    writeFileSync(join(tmpDir, 'slope-loop/model-config.json'), JSON.stringify({
      generated_at: '2026-01-01T00:00:00Z',
      ticket_count: 20,
      escalation_save_rate: 50,
      success_rates: {},
      cost_per_success: {},
      cost_adjusted_scores: {
        // API has better cost-adjusted score (much higher success rate offsets cost)
        'short_iron:ollama/qwen2.5-coder:32b': 1.0,
        [`short_iron:${config.modelApi}`]: 5.0,
      },
      recommendations: {},
      notes: [],
    }));
    const model = selectModel('short_iron', 1, 0, config, tmpDir);
    expect(model).toBe(config.modelApi);
  });

  it('falls through to recommendations when only one model has cost data', () => {
    writeFileSync(join(tmpDir, 'slope-loop/model-config.json'), JSON.stringify({
      generated_at: '2026-01-01T00:00:00Z',
      ticket_count: 20,
      escalation_save_rate: 50,
      success_rates: {},
      cost_per_success: {},
      cost_adjusted_scores: {
        'short_iron:ollama/qwen2.5-coder:32b': 10.0,
        // No API entry for short_iron
      },
      recommendations: {
        short_iron: { model: 'api', reason: 'rec says api' },
      },
      notes: [],
    }));
    // Only one model has cost data → skip cost-adjusted, fall to recommendations → API
    const model = selectModel('short_iron', 1, 0, config, tmpDir);
    expect(model).toBe(config.modelApi);
  });
});

describe('selectTimeout', () => {
  it('returns API timeout for API models', () => {
    expect(selectTimeout('openrouter/anthropic/claude-haiku-4-5', config)).toBe(config.modelApiTimeout);
  });

  it('returns local timeout for ollama models', () => {
    expect(selectTimeout('ollama/qwen3-coder-next-fast', config)).toBe(config.modelLocalTimeout);
  });

  it('returns API timeout for non-ollama models', () => {
    expect(selectTimeout('minimax/m2-5', config)).toBe(config.modelApiTimeout);
  });
});

describe('isLocalModel', () => {
  it('detects ollama models', () => {
    expect(isLocalModel('ollama/qwen3-coder-next-fast')).toBe(true);
  });

  it('rejects API models', () => {
    expect(isLocalModel('openrouter/anthropic/claude-haiku-4-5')).toBe(false);
  });
});
