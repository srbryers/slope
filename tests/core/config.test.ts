import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveConfig, loadConfig } from '../../src/core/config.js';

describe('saveConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slope-config-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes valid JSON and returns path', () => {
    const config = loadConfig(tmpDir); // get defaults
    config.metaphor = 'gaming';
    const result = saveConfig(config, tmpDir);

    expect(result).toBe(join(tmpDir, '.slope', 'config.json'));
    expect(existsSync(result)).toBe(true);

    const written = JSON.parse(readFileSync(result, 'utf8'));
    expect(written.metaphor).toBe('gaming');
  });

  it('creates .slope/ directory if missing', () => {
    const slopeDir = join(tmpDir, '.slope');
    expect(existsSync(slopeDir)).toBe(false);

    const config = loadConfig(tmpDir);
    saveConfig(config, tmpDir);

    expect(existsSync(slopeDir)).toBe(true);
  });

  it('round-trips with loadConfig', () => {
    const config = loadConfig(tmpDir);
    config.metaphor = 'tennis';
    config.currentSprint = 5;
    saveConfig(config, tmpDir);

    const loaded = loadConfig(tmpDir);
    expect(loaded.metaphor).toBe('tennis');
    expect(loaded.currentSprint).toBe(5);
  });
});
