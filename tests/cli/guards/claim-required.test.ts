import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  claimOverlapsPath,
  claimRequiredGuard,
  isImplementationWritePath,
} from '../../../src/cli/guards/claim-required.js';
import type { HookInput } from '../../../src/core/index.js';

function makeInput(cwd: string, filePath: string): HookInput {
  return {
    session_id: 'test-session',
    cwd,
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { file_path: filePath },
  };
}

function writeConfig(cwd: string, guidance: Record<string, unknown> = {}): void {
  mkdirSync(join(cwd, '.slope'), { recursive: true });
  writeFileSync(join(cwd, '.slope', 'config.json'), JSON.stringify({
    scorecardDir: 'docs/retros',
    metaphor: 'golf',
    guidance,
  }));
}

function writeSprintState(cwd: string, phase: string): void {
  mkdirSync(join(cwd, '.slope'), { recursive: true });
  writeFileSync(join(cwd, '.slope', 'sprint-state.json'), JSON.stringify({
    sprint: 94,
    phase,
    gates: {
      tests: false,
      code_review: false,
      architect_review: false,
      scorecard: false,
      review_md: false,
    },
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
}

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

describe('isImplementationWritePath', () => {
  it('matches common implementation paths', () => {
    expect(isImplementationWritePath('src/core/index.ts')).toBe(true);
    expect(isImplementationWritePath('packages/app/config.json')).toBe(true);
    expect(isImplementationWritePath('data/recipes.json')).toBe(true);
    expect(isImplementationWritePath('package.json')).toBe(true);
  });

  it('ignores docs, SLOPE state, and dependency directories', () => {
    expect(isImplementationWritePath('README.md')).toBe(false);
    expect(isImplementationWritePath('docs/retros/sprint-1.json')).toBe(false);
    expect(isImplementationWritePath('.slope/sprint-state.json')).toBe(false);
    expect(isImplementationWritePath('node_modules/pkg/index.js')).toBe(false);
  });
});

describe('claimRequiredGuard', () => {
  it('asks before implementation writes when no sprint state is active', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-claim-required-'));
    try {
      writeConfig(cwd);
      const result = await claimRequiredGuard(makeInput(cwd, join(cwd, 'src/foo.ts')), cwd);

      expect(result.decision).toBe('ask');
      expect(result.context).toContain('no active sprint state');
      expect(result.context).toContain('slope sprint start');
      expect(result.context).toContain('slope claim');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('does not interrupt non-implementation writes when no sprint state is active', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-claim-required-'));
    try {
      writeConfig(cwd);
      const result = await claimRequiredGuard(makeInput(cwd, join(cwd, 'README.md')), cwd);
      expect(result).toEqual({});
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('denies no-sprint implementation writes in strict mode', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-claim-required-'));
    try {
      writeConfig(cwd, { requireSprintForImplementationWrites: 'deny' });
      const result = await claimRequiredGuard(makeInput(cwd, join(cwd, 'src/foo.ts')), cwd);

      expect(result.decision).toBe('deny');
      expect(result.blockReason).toContain('Strict mode');
      expect(result.blockReason).toContain('no active sprint state');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('allows no-sprint implementation writes when the policy is off', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-claim-required-'));
    try {
      writeConfig(cwd, { requireSprintForImplementationWrites: 'off' });
      const result = await claimRequiredGuard(makeInput(cwd, join(cwd, 'src/foo.ts')), cwd);
      expect(result).toEqual({});
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('asks before implementation writes when sprint is not in implementing phase', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-claim-required-'));
    try {
      writeConfig(cwd);
      writeSprintState(cwd, 'planning');
      const result = await claimRequiredGuard(makeInput(cwd, join(cwd, 'src/foo.ts')), cwd);

      expect(result.decision).toBe('ask');
      expect(result.context).toContain('planning phase');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('denies implementation writes outside implementing phase in strict mode', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-claim-required-'));
    try {
      writeConfig(cwd, { requireSprintForImplementationWrites: 'deny' });
      writeSprintState(cwd, 'reviewing');
      const result = await claimRequiredGuard(makeInput(cwd, join(cwd, 'src/foo.ts')), cwd);

      expect(result.decision).toBe('deny');
      expect(result.blockReason).toContain('reviewing phase');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('preserves the implementing phase missing-claim advisory by default', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-claim-required-'));
    try {
      writeConfig(cwd);
      writeSprintState(cwd, 'implementing');
      const result = await claimRequiredGuard(makeInput(cwd, join(cwd, 'src/foo.ts')), cwd);

      expect(result.decision).toBeUndefined();
      expect(result.context).toContain('No active sprint claim');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('upgrades implementing phase missing-claim edits to deny in strict mode', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-claim-required-'));
    try {
      writeConfig(cwd, { requireSprintForImplementationWrites: 'deny' });
      writeSprintState(cwd, 'implementing');
      const result = await claimRequiredGuard(makeInput(cwd, join(cwd, 'src/foo.ts')), cwd);

      expect(result.decision).toBe('deny');
      expect(result.blockReason).toContain('No active sprint claim');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
