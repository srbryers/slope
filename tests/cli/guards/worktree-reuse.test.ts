import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(() => {
    throw new Error('not a git repo');
  }),
}));

import { worktreeReuseGuard } from '../../../src/cli/guards/worktree-reuse.js';
import type { HookInput } from '../../../src/core/index.js';

let cwd: string;

function makeInput(name: string): HookInput {
  return {
    session_id: 'test-session',
    cwd,
    hook_event_name: 'PreToolUse',
    tool_name: 'EnterWorktree',
    tool_input: { name },
  };
}

describe('worktreeReuseGuard', () => {
  beforeEach(() => {
    cwd = join(tmpdir(), `slope-worktree-reuse-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cwd, { recursive: true });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('prefers existing SLOPE worktrees outside .claude', async () => {
    mkdirSync(join(cwd, '.slope', 'worktrees', 'ticket-477'), { recursive: true });
    mkdirSync(join(cwd, '.claude', 'worktrees', 'ticket-477'), { recursive: true });

    const result = await worktreeReuseGuard(makeInput('ticket-477'), cwd);

    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain(join(cwd, '.slope', 'worktrees', 'ticket-477'));
    expect(result.blockReason).not.toContain(join(cwd, '.claude', 'worktrees', 'ticket-477'));
  });

  it('warns when an existing worktree is under Claude protected config', async () => {
    mkdirSync(join(cwd, '.claude', 'worktrees', 'ticket-477'), { recursive: true });

    const result = await worktreeReuseGuard(makeInput('ticket-477'), cwd);

    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('protected config tree');
    expect(result.blockReason).toContain('self-configuration edits');
    expect(result.blockReason).toContain('prompt on every Edit/Write');
    expect(result.blockReason).toContain('slope worktree start');
    expect(result.blockReason).toContain(join('.slope', 'worktrees', 'ticket-477'));
    expect(result.blockReason).toContain('git worktree move');
  });
});
