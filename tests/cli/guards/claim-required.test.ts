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
import { createStore } from '../../../src/store/index.js';
import { createSprintState, saveSprintState } from '../../../src/cli/sprint-state.js';

function makeInput(cwd: string, filePath: string): HookInput {
  return {
    session_id: 'test-session',
    cwd,
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { file_path: filePath },
  };
}

function makeApplyPatchInput(cwd: string, filePath: string): HookInput {
  return {
    session_id: 'test-session',
    cwd,
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      command: [
        '*** Begin Patch',
        `*** Update File: ${filePath}`,
        '@@',
        '-old',
        '+new',
        '*** End Patch',
      ].join('\n'),
    },
  };
}

function writeConfig(cwd: string, guidance: Record<string, unknown> = {}): void {
  mkdirSync(join(cwd, '.slope'), { recursive: true });
  writeFileSync(join(cwd, '.slope', 'config.json'), JSON.stringify({
    roadmapPath: 'docs/backlog/roadmap.json',
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
    metaphor: 'golf',
    guidance,
  }));
}

function writeInsertedRoadmap(cwd: string): void {
  mkdirSync(join(cwd, 'docs', 'backlog'), { recursive: true });
  writeFileSync(join(cwd, 'docs', 'backlog', 'roadmap.json'), JSON.stringify({
    name: 'Test',
    phases: [{ name: 'P1', sprints: [43, 435] }],
    sprints: [
      { id: 43, theme: 'Done', par: 4, slope: 1, type: 'feature', status: 'complete', tickets: [
        { key: 'S43-1', title: 'done', club: 'wedge', complexity: 'small' },
        { key: 'S43-2', title: 'done', club: 'wedge', complexity: 'small' },
        { key: 'S43-3', title: 'done', club: 'wedge', complexity: 'small' },
      ] },
      { id: 435, theme: 'Inserted', par: 4, slope: 1, type: 'bug fix', status: 'planned', tickets: [
        { key: 'S43.5-1', title: 'inserted', club: 'wedge', complexity: 'small' },
        { key: 'S43.5-2', title: 'inserted', club: 'wedge', complexity: 'small' },
        { key: 'S43.5-3', title: 'inserted', club: 'wedge', complexity: 'small' },
      ] },
    ],
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
  describe('whole-repo area claim (GH #651)', () => {
    it.each(['.', './', ''])('treats %j as covering every path', target => {
      // `slope claim --target=. --scope=area` is how you say "working across this
      // repo". The prefix test built `./`, which no relative path starts with, so a
      // root claim silenced nothing and every write was reported as scope drift.
      expect(claimOverlapsPath('area', target, 'src/core/roadmap.ts', 'src/core')).toBe(true);
      expect(claimOverlapsPath('area', target, 'package.json', '.')).toBe(true);
    });

    it('still scopes a narrow area claim', () => {
      expect(claimOverlapsPath('area', 'src/cli', 'src/core/roadmap.ts', 'src/core')).toBe(false);
      expect(claimOverlapsPath('area', 'src/cli', 'src/cli/guards/x.ts', 'src/cli/guards')).toBe(true);
    });
  });

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

    it('treats sprint auto-claims as whole-sprint coverage', () => {
      expect(claimOverlapsPath('area', 'sprint:S94', 'src/core/foo.ts', 'src/core')).toBe(true);
      expect(claimOverlapsPath('area', 'sprint:S94', 'docs/retros/sprint-94.json', 'docs/retros')).toBe(true);
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
  describe('implementation-write policy (GH #643, #650)', () => {
    function writeConfigWithPolicy(cwd: string, policy: string): void {
      mkdirSync(join(cwd, '.slope'), { recursive: true });
      writeFileSync(join(cwd, '.slope', 'config.json'), JSON.stringify({
        scorecardDir: 'docs/retros',
        guidance: { requireSprintForImplementationWrites: policy },
      }));
    }

    it('emits advisory context rather than gating under the default ask policy', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'slope-claim-policy-'));
      try {
        writeConfig(cwd);
        const result = await claimRequiredGuard(makeInput(cwd, join(cwd, 'src/foo.ts')), cwd);

        // Every remedy this guard prints is agent-actionable, so it must not ask
        // the operator to approve it.
        expect(result.decision).toBeUndefined();
        expect(result.context).toContain('not a permission request');
        expect(result.context).toContain('src/foo.ts');
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });

    it('warns once per session rather than on every write', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'slope-claim-policy-'));
      try {
        writeConfig(cwd);
        const first = await claimRequiredGuard(makeInput(cwd, join(cwd, 'src/foo.ts')), cwd);
        const second = await claimRequiredGuard(makeInput(cwd, join(cwd, 'src/bar.ts')), cwd);

        expect(first.context).toBeTruthy();
        expect(second).toEqual({});
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });

    // These deny assertions are the coverage whose absence let an earlier attempt
    // at this change silently disable strict mode (GH #650).
    it('still blocks under the deny policy when no sprint state exists', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'slope-claim-deny-'));
      try {
        writeConfigWithPolicy(cwd, 'deny');
        const result = await claimRequiredGuard(makeInput(cwd, join(cwd, 'src/foo.ts')), cwd);

        expect(result.decision).toBe('deny');
        expect(result.blockReason).toContain('no active sprint state');
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });

    it('still blocks under the deny policy when the sprint is not implementing', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'slope-claim-deny-'));
      try {
        writeConfigWithPolicy(cwd, 'deny');
        saveSprintState(cwd, createSprintState(300, 'scoring'));
        const result = await claimRequiredGuard(makeInput(cwd, join(cwd, 'src/foo.ts')), cwd);

        expect(result.decision).toBe('deny');
        expect(result.blockReason).toContain('scoring');
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });

    it('stays silent under the off policy', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'slope-claim-off-'));
      try {
        writeConfigWithPolicy(cwd, 'off');
        const result = await claimRequiredGuard(makeInput(cwd, join(cwd, 'src/foo.ts')), cwd);

        expect(result).toEqual({});
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });
  });

  it('reports implementation writes without gating when no sprint state is active', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-claim-required-'));
    try {
      writeConfig(cwd);
      const result = await claimRequiredGuard(makeInput(cwd, join(cwd, 'src/foo.ts')), cwd);

      expect(result.decision).toBeUndefined();
      expect(result.context).toContain('not a permission request');
      expect(result.context).toContain('no active sprint state');
      expect(result.context).toContain('slope sprint start');
      expect(result.context).toContain('slope claim');
      expect(result.context).toContain('deny');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('reports Codex apply_patch implementation writes without gating when no sprint state is active', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-claim-required-'));
    try {
      writeConfig(cwd);
      const result = await claimRequiredGuard(makeApplyPatchInput(cwd, join(cwd, 'src/foo.ts')), cwd);

      expect(result.decision).toBeUndefined();
      expect(result.context).toContain('src/foo.ts');
      expect(result.context).toContain('no active sprint state');
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

  it('ignores direct implementation-looking paths outside the project root', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-claim-required-'));
    try {
      writeConfig(cwd);
      const outsidePath = join(tmpdir(), 'slope-outside-settings.json');
      const result = await claimRequiredGuard(makeInput(cwd, outsidePath), cwd);
      expect(result).toEqual({});
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('ignores apply_patch implementation-looking paths outside the project root', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-claim-required-'));
    try {
      writeConfig(cwd);
      const outsidePath = join(tmpdir(), 'slope-outside-package.json');
      const result = await claimRequiredGuard(makeApplyPatchInput(cwd, outsidePath), cwd);
      expect(result).toEqual({});
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('includes pending inserted sprint context when no sprint state is active', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-claim-required-'));
    try {
      writeConfig(cwd);
      writeInsertedRoadmap(cwd);
      const result = await claimRequiredGuard(makeInput(cwd, join(cwd, 'src/foo.ts')), cwd);

      expect(result.decision).toBeUndefined();
      expect(result.context).toContain('Detected likely sprint context: S43.5');
      expect(result.context).toContain('slope sprint start --number=43.5 --phase=implementing');
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

  it('reports implementation writes without gating when sprint is not in implementing phase', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-claim-required-'));
    try {
      writeConfig(cwd);
      writeSprintState(cwd, 'planning');
      const result = await claimRequiredGuard(makeInput(cwd, join(cwd, 'src/foo.ts')), cwd);

      expect(result.decision).toBeUndefined();
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
      expect(result.context).toContain('advisory (non-blocking)');
      expect(result.context).toContain('no active sprint claim');
      expect(result.context).toContain('does not grant or deny the host tool permission');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('honors store-backed sprint auto-claims during implementing phase', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-claim-required-'));
    try {
      writeConfig(cwd);
      writeSprintState(cwd, 'implementing');
      const store = createStore({ storePath: '.slope/slope.db', cwd });
      await store.claim({
        sprint_number: 94,
        player: 'test',
        target: 'sprint:S94',
        scope: 'area',
      });
      store.close();

      const result = await claimRequiredGuard(makeInput(cwd, join(cwd, 'src/foo.ts')), cwd);

      expect(result).toEqual({});
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
