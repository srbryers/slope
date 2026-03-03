import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadLoopConfig, resolveLoopConfig } from '../../../src/cli/loop/config.js';
import { DEFAULT_LOOP_CONFIG } from '../../../src/cli/loop/types.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-loop-config-'));
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  // Clean up env vars
  delete process.env.MODEL_LOCAL;
  delete process.env.MODEL_API;
  delete process.env.OLLAMA_API_BASE;
  delete process.env.AIDER_TIMEOUT;
  delete process.env.ESCALATE_ON_FAIL;
  delete process.env.OLLAMA_FLASH_ATTENTION;
});

describe('loadLoopConfig', () => {
  it('returns defaults when no config file exists', () => {
    const { config, sources } = loadLoopConfig(tmpDir);
    expect(config.modelLocal).toBe(DEFAULT_LOOP_CONFIG.modelLocal);
    expect(config.modelApi).toBe(DEFAULT_LOOP_CONFIG.modelApi);
    expect(sources.modelLocal).toBe('default');
    expect(sources.modelApi).toBe('default');
  });

  it('loads from .slope/loop.config.json', () => {
    writeFileSync(
      join(tmpDir, '.slope/loop.config.json'),
      JSON.stringify({ modelLocal: 'ollama/custom-model', aiderTimeout: 7200 }),
    );
    const { config, sources } = loadLoopConfig(tmpDir);
    expect(config.modelLocal).toBe('ollama/custom-model');
    expect(sources.modelLocal).toBe('file');
    expect(config.aiderTimeout).toBe(7200);
    expect(sources.aiderTimeout).toBe('file');
    // Non-overridden keys remain default
    expect(config.modelApi).toBe(DEFAULT_LOOP_CONFIG.modelApi);
    expect(sources.modelApi).toBe('default');
  });

  it('env vars override file config', () => {
    writeFileSync(
      join(tmpDir, '.slope/loop.config.json'),
      JSON.stringify({ modelLocal: 'ollama/file-model' }),
    );
    process.env.MODEL_LOCAL = 'ollama/env-model';

    const { config, sources } = loadLoopConfig(tmpDir);
    expect(config.modelLocal).toBe('ollama/env-model');
    expect(sources.modelLocal).toBe('env');
  });

  it('parses boolean env vars', () => {
    process.env.ESCALATE_ON_FAIL = 'false';
    const { config } = loadLoopConfig(tmpDir);
    expect(config.escalateOnFail).toBe(false);
  });

  it('parses numeric env vars', () => {
    process.env.AIDER_TIMEOUT = '1800';
    const { config } = loadLoopConfig(tmpDir);
    expect(config.aiderTimeout).toBe(1800);
  });

  it('ignores invalid numeric env vars', () => {
    process.env.AIDER_TIMEOUT = 'not-a-number';
    const { config } = loadLoopConfig(tmpDir);
    expect(config.aiderTimeout).toBe(DEFAULT_LOOP_CONFIG.aiderTimeout);
  });

  it('handles malformed JSON config file gracefully', () => {
    writeFileSync(join(tmpDir, '.slope/loop.config.json'), 'not json');
    const { config } = loadLoopConfig(tmpDir);
    expect(config.modelLocal).toBe(DEFAULT_LOOP_CONFIG.modelLocal);
  });
});

describe('resolveLoopConfig', () => {
  it('returns just the config object', () => {
    const config = resolveLoopConfig(tmpDir);
    expect(config.modelLocal).toBe(DEFAULT_LOOP_CONFIG.modelLocal);
    expect(config.backlogPath).toBe('slope-loop/backlog.json');
  });
});
