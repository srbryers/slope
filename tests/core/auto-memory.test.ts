import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  captureGuardOverride,
  extractWorkflowPatterns,
  recordGuardFire,
} from '../../src/core/auto-memory.js';
import { searchMemories, loadMemories } from '../../src/core/memory.js';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'slope-auto-memory-'));
}

describe('auto-memory', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = createTempDir();
    mkdirSync(join(cwd, '.slope'), { recursive: true });
  });

  describe('captureGuardOverride', () => {
    it('creates a memory for guard override', () => {
      captureGuardOverride(cwd, 'main-branch', 'committed directly to main');
      const mems = searchMemories(cwd, { source: 'auto-guard' });
      expect(mems).toHaveLength(1);
      expect(mems[0].text).toContain('main-branch');
      expect(mems[0].weight).toBe(5);
      expect(mems[0].category).toBe('hazard');
    });

    it('deduplicates within 7 days', () => {
      captureGuardOverride(cwd, 'main-branch', 'committed directly to main');
      captureGuardOverride(cwd, 'main-branch', 'committed directly to main');
      const mems = searchMemories(cwd, { source: 'auto-guard' });
      expect(mems).toHaveLength(1);
    });
  });

  describe('extractWorkflowPatterns', () => {
    it('detects over-scope pattern', () => {
      extractWorkflowPatterns(cwd, {
        score_label: 'double_bogey',
        par: 3,
        score: 5,
      });
      const mems = searchMemories(cwd, { source: 'auto-workflow' });
      expect(mems.some(m => m.text.includes('over-scope'))).toBe(true);
    });

    it('detects wedge ticket hazard pattern', () => {
      extractWorkflowPatterns(cwd, {
        score_label: 'par',
        par: 4,
        score: 4,
        shots: [
          { result: 'green', club: 'wedge', hazards: ['rough'] },
          { result: 'green', club: 'wedge', hazards: ['bunker'] },
        ],
      });
      const mems = searchMemories(cwd, { source: 'auto-workflow' });
      expect(mems.some(m => m.text.includes('wedge'))).toBe(true);
    });

    it('detects repeated rough hazards', () => {
      extractWorkflowPatterns(cwd, {
        score_label: 'par',
        par: 4,
        score: 4,
        shots: [
          { result: 'green', club: 'short_iron', hazards: ['rough: file not found'] },
          { result: 'fairway', club: 'wedge', hazards: ['rough: typo'] },
        ],
      });
      const mems = searchMemories(cwd, { source: 'auto-workflow' });
      expect(mems.some(m => m.text.includes('rough'))).toBe(true);
    });

    it('skips when no patterns match', () => {
      extractWorkflowPatterns(cwd, {
        score_label: 'birdie',
        par: 4,
        score: 3,
        shots: [{ result: 'green', club: 'short_iron' }],
      });
      const mems = searchMemories(cwd, { source: 'auto-workflow' });
      expect(mems).toHaveLength(0);
    });
  });

  describe('recordGuardFire', () => {
    it('records guard fire count', () => {
      recordGuardFire(cwd, 'stop-check', 'uncommitted changes');
      recordGuardFire(cwd, 'stop-check', 'uncommitted changes');
      // Below threshold — no memory yet
      let mems = searchMemories(cwd, { source: 'auto-guard' });
      expect(mems).toHaveLength(0);

      recordGuardFire(cwd, 'stop-check', 'uncommitted changes');
      mems = searchMemories(cwd, { source: 'auto-guard' });
      expect(mems).toHaveLength(1);
      expect(mems[0].text).toContain('3 times');
      expect(mems[0].text).toContain('stop-check');
    });

    it('tracks different patterns separately', () => {
      recordGuardFire(cwd, 'stop-check', 'uncommitted changes');
      recordGuardFire(cwd, 'stop-check', 'uncommitted changes');
      recordGuardFire(cwd, 'stop-check', 'uncommitted changes');
      recordGuardFire(cwd, 'hazard', 'file collision');
      recordGuardFire(cwd, 'hazard', 'file collision');
      recordGuardFire(cwd, 'hazard', 'file collision');

      const mems = searchMemories(cwd, { source: 'auto-guard' });
      expect(mems).toHaveLength(2);
    });

    it('deduplicates repeated fire memories', () => {
      recordGuardFire(cwd, 'stop-check', 'uncommitted changes');
      recordGuardFire(cwd, 'stop-check', 'uncommitted changes');
      recordGuardFire(cwd, 'stop-check', 'uncommitted changes');
      // Fire again — should not create duplicate memory
      recordGuardFire(cwd, 'stop-check', 'uncommitted changes');

      const mems = searchMemories(cwd, { source: 'auto-guard' });
      expect(mems).toHaveLength(1);
    });
  });
});
