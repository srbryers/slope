import { describe, it, expect } from 'vitest';
import {
  isWholeRepoClaim,
  isWholeSprintClaim,
  pathWithinClaimedArea,
} from '../../../src/cli/guards/claim-area.js';

describe('claim-area matching (shared by claim-required and scope-drift)', () => {
  describe('isWholeSprintClaim', () => {
    it.each(['sprint:S143', 'sprint:S143.5', 'SPRINT:s60'])('accepts %s', target => {
      expect(isWholeSprintClaim(target)).toBe(true);
    });
    it.each(['src/core', 'sprint:143', 'sprintish'])('rejects %s', target => {
      expect(isWholeSprintClaim(target)).toBe(false);
    });
  });

  describe('isWholeRepoClaim (GH #651)', () => {
    it.each(['.', './', '', '/', '.\\'])('accepts %j', target => {
      expect(isWholeRepoClaim(target)).toBe(true);
    });
    it.each(['src', 'src/core', './src'])('rejects %j', target => {
      expect(isWholeRepoClaim(target)).toBe(false);
    });
  });

  describe('pathWithinClaimedArea', () => {
    it('covers everything for a whole-repo or whole-sprint claim', () => {
      expect(pathWithinClaimedArea('src/core/roadmap.ts', '.')).toBe(true);
      expect(pathWithinClaimedArea('anything.ts', 'sprint:S143.5')).toBe(true);
    });

    it('anchors the prefix so src/core does not match src/core-helpers', () => {
      expect(pathWithinClaimedArea('src/core', 'src/core')).toBe(true);
      expect(pathWithinClaimedArea('src/core/memory.ts', 'src/core')).toBe(true);
      expect(pathWithinClaimedArea('src/core-helpers/x.ts', 'src/core')).toBe(false);
    });

    it('normalizes backslashes and trailing slashes on both sides', () => {
      expect(pathWithinClaimedArea('src\\core\\x.ts', 'src/core')).toBe(true);
      expect(pathWithinClaimedArea('src/core/x.ts', 'src/core/')).toBe(true);
    });

    it('does not match an unrelated area', () => {
      expect(pathWithinClaimedArea('src/core/x.ts', 'src/cli')).toBe(false);
    });
  });
});
