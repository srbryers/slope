import { describe, it, expect } from 'vitest';
import { claimOverlapsPath } from '../../../src/cli/guards/claim-required.js';

describe('claimOverlapsPath', () => {
  describe('area scope', () => {
    it('matches exact path', () => {
      expect(claimOverlapsPath('area', 'src/core', 'src/core', 'src')).toBe(true);
    });

    it('matches deeper file inside the claimed area', () => {
      expect(claimOverlapsPath('area', 'src/core', 'src/core/memory.ts', 'src/core')).toBe(true);
    });

    it('matches when fileArea equals the target', () => {
      expect(claimOverlapsPath('area', 'src/core', 'src/core/memory.ts', 'src/core')).toBe(true);
    });

    it('matches a deeper fileArea below the target', () => {
      expect(claimOverlapsPath('area', 'src/core', 'src/core/sub/x.ts', 'src/core/sub')).toBe(true);
    });

    it('does NOT match a sibling directory with a shared prefix (regression)', () => {
      // Pre-fix bug: "src/core-helpers".startsWith("src/core") was true.
      expect(claimOverlapsPath('area', 'src/core', 'src/core-helpers/x.ts', 'src/core-helpers')).toBe(false);
    });

    it('does NOT match an unrelated path', () => {
      expect(claimOverlapsPath('area', 'src/core', 'src/cli/x.ts', 'src/cli')).toBe(false);
    });

    it('handles target with trailing slash', () => {
      expect(claimOverlapsPath('area', 'src/core/', 'src/core/x.ts', 'src/core')).toBe(true);
      expect(claimOverlapsPath('area', 'src/core/', 'src/core-helpers/x.ts', 'src/core-helpers')).toBe(false);
    });
  });

  describe('non-area scope (file)', () => {
    it('matches exact target only', () => {
      expect(claimOverlapsPath('file', 'src/core/memory.ts', 'src/core/memory.ts', 'src/core')).toBe(true);
    });

    it('does NOT match a different file in the same directory', () => {
      expect(claimOverlapsPath('file', 'src/core/memory.ts', 'src/core/auto-memory.ts', 'src/core')).toBe(false);
    });

    it('does NOT match a prefix-only path', () => {
      expect(claimOverlapsPath('file', 'src/core/mem', 'src/core/memory.ts', 'src/core')).toBe(false);
    });
  });
});
