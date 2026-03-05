import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { sprintCompletionGuard } from '../../../src/cli/guards/sprint-completion.js';
import { saveSprintState, createSprintState, loadSprintState } from '../../../src/cli/sprint-state.js';
import type { HookInput } from '../../../src/core/index.js';

const tmpDir = join(import.meta.dirname ?? __dirname, '.tmp-sprint-completion-test');

function makePreToolUse(command: string): HookInput {
  return {
    session_id: 'test-session',
    cwd: tmpDir,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
  };
}

function makeStop(): HookInput {
  return {
    session_id: 'test-session',
    cwd: tmpDir,
    hook_event_name: 'Stop',
  };
}

function makePostToolUse(command: string, exitCode: number | string): HookInput {
  return {
    session_id: 'test-session',
    cwd: tmpDir,
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    tool_response: { exit_code: exitCode },
  };
}

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('sprint-completion guard', () => {
  describe('no sprint state', () => {
    it('no-ops on PreToolUse when no sprint-state', async () => {
      const result = await sprintCompletionGuard(makePreToolUse('gh pr create --title "t"'), tmpDir);
      expect(result).toEqual({});
    });

    it('no-ops on Stop when no sprint-state', async () => {
      const result = await sprintCompletionGuard(makeStop(), tmpDir);
      expect(result).toEqual({});
    });

    it('no-ops on PostToolUse when no sprint-state', async () => {
      const result = await sprintCompletionGuard(makePostToolUse('bun test', 0), tmpDir);
      expect(result).toEqual({});
    });
  });

  describe('all gates complete', () => {
    beforeEach(() => {
      const state = createSprintState(22, 'implementing');
      state.gates.tests = true;
      state.gates.code_review = true;
      state.gates.architect_review = true;
      state.gates.scorecard = true;
      state.gates.review_md = true;
      saveSprintState(tmpDir, state);
    });

    it('allows gh pr create', async () => {
      const result = await sprintCompletionGuard(makePreToolUse('gh pr create --title "t"'), tmpDir);
      expect(result).toEqual({});
    });

    it('allows Stop', async () => {
      const result = await sprintCompletionGuard(makeStop(), tmpDir);
      expect(result).toEqual({});
    });
  });

  describe('phase = complete', () => {
    beforeEach(() => {
      const state = createSprintState(22, 'complete');
      saveSprintState(tmpDir, state);
    });

    it('allows gh pr create even with incomplete gates', async () => {
      const result = await sprintCompletionGuard(makePreToolUse('gh pr create --title "t"'), tmpDir);
      expect(result).toEqual({});
    });

    it('allows Stop', async () => {
      const result = await sprintCompletionGuard(makeStop(), tmpDir);
      expect(result).toEqual({});
    });
  });

  describe('incomplete gates', () => {
    beforeEach(() => {
      const state = createSprintState(22, 'implementing');
      state.gates.tests = true; // only tests done
      saveSprintState(tmpDir, state);
    });

    it('denies gh pr create with gate list', async () => {
      const result = await sprintCompletionGuard(makePreToolUse('gh pr create --title "feat"'), tmpDir);
      expect(result.decision).toBe('deny');
      expect(result.blockReason).toContain('Sprint 22');
      expect(result.blockReason).toContain('Code review');
      expect(result.blockReason).toContain('Architect review');
      expect(result.blockReason).toContain('Scorecard validated');
      expect(result.blockReason).toContain('Review markdown generated');
      // Tests should NOT be listed (already complete)
      expect(result.blockReason).not.toContain('Tests passing');
    });

    it('blocks Stop with gate list', async () => {
      const result = await sprintCompletionGuard(makeStop(), tmpDir);
      expect(result.blockReason).toContain('Sprint 22');
      expect(result.blockReason).toContain('Code review');
    });

    it('does not block non-PR Bash commands', async () => {
      const result = await sprintCompletionGuard(makePreToolUse('git push -u origin main'), tmpDir);
      expect(result).toEqual({});
    });
  });

  describe('Stop only blocks during implementing/scoring phases', () => {
    it('does not block during planning phase', async () => {
      saveSprintState(tmpDir, createSprintState(22, 'planning'));
      const result = await sprintCompletionGuard(makeStop(), tmpDir);
      expect(result).toEqual({});
    });

    it('does not block during reviewing phase', async () => {
      saveSprintState(tmpDir, createSprintState(22, 'reviewing'));
      const result = await sprintCompletionGuard(makeStop(), tmpDir);
      expect(result).toEqual({});
    });

    it('blocks during scoring phase', async () => {
      saveSprintState(tmpDir, createSprintState(22, 'scoring'));
      const result = await sprintCompletionGuard(makeStop(), tmpDir);
      expect(result.blockReason).toContain('Sprint 22');
    });
  });

  describe('PostToolUse auto-detect test pass', () => {
    beforeEach(() => {
      saveSprintState(tmpDir, createSprintState(22, 'implementing'));
    });

    it('marks tests gate on jest exit 0', async () => {
      const result = await sprintCompletionGuard(makePostToolUse('npx jest', 0), tmpDir);
      expect(result.context).toContain('Tests passed');
      const state = loadSprintState(tmpDir)!;
      expect(state.gates.tests).toBe(true);
    });

    it('marks tests gate on bun test exit 0', async () => {
      const result = await sprintCompletionGuard(makePostToolUse('bun test', 0), tmpDir);
      expect(result.context).toContain('Tests passed');
    });

    it('marks tests gate on vitest exit 0', async () => {
      const result = await sprintCompletionGuard(makePostToolUse('npx vitest', 0), tmpDir);
      expect(result.context).toContain('Tests passed');
    });

    it('does not mark gate on test failure (exit 1)', async () => {
      const result = await sprintCompletionGuard(makePostToolUse('npx jest', 1), tmpDir);
      expect(result).toEqual({});
      const state = loadSprintState(tmpDir)!;
      expect(state.gates.tests).toBe(false);
    });

    it('does not mark gate for non-test commands', async () => {
      const result = await sprintCompletionGuard(makePostToolUse('npm run build', 0), tmpDir);
      expect(result).toEqual({});
      const state = loadSprintState(tmpDir)!;
      expect(state.gates.tests).toBe(false);
    });

    it('skips if tests gate already marked', async () => {
      const state = createSprintState(22, 'implementing');
      state.gates.tests = true;
      saveSprintState(tmpDir, state);

      const result = await sprintCompletionGuard(makePostToolUse('npx jest', 0), tmpDir);
      expect(result).toEqual({});
    });
  });

  describe('PostToolUse PR merge detection', () => {
    beforeEach(() => {
      saveSprintState(tmpDir, createSprintState(22, 'implementing'));
    });

    it('transitions phase to scoring on gh pr merge exit 0', async () => {
      const result = await sprintCompletionGuard(makePostToolUse('gh pr merge 117 --squash', 0), tmpDir);
      expect(result.context).toContain('scoring');
      expect(result.context).toContain('Scorecard validated');
      const state = loadSprintState(tmpDir)!;
      expect(state.phase).toBe('scoring');
    });

    it('does not transition on merge failure (exit 1)', async () => {
      const result = await sprintCompletionGuard(makePostToolUse('gh pr merge 117 --squash', 1), tmpDir);
      expect(result).toEqual({});
      const state = loadSprintState(tmpDir)!;
      expect(state.phase).toBe('implementing');
    });

    it('no-ops if already in scoring phase', async () => {
      const state = createSprintState(22, 'scoring');
      saveSprintState(tmpDir, state);
      const result = await sprintCompletionGuard(makePostToolUse('gh pr merge 117 --squash', 0), tmpDir);
      expect(result).toEqual({});
    });

    it('no-ops if already complete', async () => {
      const state = createSprintState(22, 'complete');
      saveSprintState(tmpDir, state);
      const result = await sprintCompletionGuard(makePostToolUse('gh pr merge 117 --squash', 0), tmpDir);
      expect(result).toEqual({});
    });
  });
});
