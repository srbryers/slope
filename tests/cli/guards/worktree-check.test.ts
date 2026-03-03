import { describe, it, expect, vi, beforeEach } from 'vitest';
import { worktreeCheckGuard, resetWorktreeCheckState } from '../../../src/cli/guards/worktree-check.js';
import type { HookInput } from '../../../src/core/index.js';
import { SlopeStoreError } from '../../../src/core/store.js';
import type { SlopeStore, SlopeSession } from '../../../src/core/store.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

// Track sentinel files in memory instead of real filesystem
const sentinelFiles = new Set<string>();

vi.mock('node:fs', () => ({
  existsSync: vi.fn((p: string) => sentinelFiles.has(p)),
  writeFileSync: vi.fn((p: string) => { sentinelFiles.add(p); }),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn((p: string) => { sentinelFiles.delete(p); }),
}));

vi.mock('node:os', () => ({
  tmpdir: vi.fn(() => '/tmp'),
}));

// Mock store
const mockStore = {
  getActiveSessions: vi.fn().mockResolvedValue([]),
  cleanStaleSessions: vi.fn().mockResolvedValue(0),
  registerSession: vi.fn().mockResolvedValue({
    session_id: 'test-session',
    role: 'primary',
    ide: 'claude-code',
    started_at: new Date().toISOString(),
    last_heartbeat_at: new Date().toISOString(),
  }),
  close: vi.fn(),
} as unknown as SlopeStore;

vi.mock('../../../src/cli/store.js', () => ({
  resolveStore: vi.fn(),
}));

import { execSync } from 'node:child_process';
import { resolveStore } from '../../../src/cli/store.js';

const mockExecSync = vi.mocked(execSync);
const mockResolveStore = vi.mocked(resolveStore);

function makeInput(sessionId = 'test-session'): HookInput {
  return {
    session_id: sessionId,
    cwd: '/tmp/test',
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: '/tmp/test/src/foo.ts', old_string: 'a', new_string: 'b' },
  };
}

function makeSession(overrides: Partial<SlopeSession> = {}): SlopeSession {
  return {
    session_id: 'other-session',
    role: 'primary',
    ide: 'claude-code',
    started_at: new Date().toISOString(),
    last_heartbeat_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('worktreeCheckGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sentinelFiles.clear();
    mockResolveStore.mockResolvedValue(mockStore);
    (mockStore.getActiveSessions as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (mockStore.cleanStaleSessions as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    (mockStore.registerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      session_id: 'test-session',
      role: 'primary',
      ide: 'claude-code',
      started_at: new Date().toISOString(),
      last_heartbeat_at: new Date().toISOString(),
    });
  });

  it('denies when concurrent session exists in same repo', async () => {
    mockExecSync
      .mockReturnValueOnce('.git' as never)         // git-common-dir
      .mockReturnValueOnce('feat/foo' as never);     // branch

    const otherSession = makeSession({ session_id: 'other-session' });
    (mockStore.getActiveSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeSession({ session_id: 'test-session' }),
      otherSession,
    ]);

    const result = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(result.decision).toBe('deny');
    expect(result.context).toContain('other-session');
    expect(result.context).toContain('EnterWorktree');
  });

  it('allows when other session has worktree_path (isolated)', async () => {
    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('feat/foo' as never);

    (mockStore.getActiveSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeSession({ session_id: 'test-session' }),
      makeSession({ session_id: 'other-session', worktree_path: '/tmp/worktree' }),
    ]);

    const result = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(result).toEqual({});
  });

  it('allows when current session is alone', async () => {
    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('feat/foo' as never);

    (mockStore.getActiveSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeSession({ session_id: 'test-session' }),
    ]);

    const result = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(result).toEqual({});
  });

  it('allows when in a worktree (already isolated)', async () => {
    mockExecSync
      .mockReturnValueOnce('../../.git' as never); // git-common-dir != '.git'

    const result = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(result).toEqual({});
    // Should not open the store at all
    expect(mockResolveStore).not.toHaveBeenCalled();
  });

  it('falls back to soft ask on store resolve error', async () => {
    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('feat/foo' as never);

    mockResolveStore.mockRejectedValueOnce(new Error('no store'));

    const result = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(result.decision).toBe('ask');
    expect(result.context).toContain('store unavailable');
  });

  it('falls back to soft ask on store query error', async () => {
    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('feat/foo' as never);

    (mockStore.cleanStaleSessions as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('db locked'));

    const result = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(result.decision).toBe('ask');
    expect(result.context).toContain('db locked');
  });

  it('fires on feature branch (no longer gated to main/master)', async () => {
    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('feat/worktree-guard' as never);

    (mockStore.getActiveSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeSession({ session_id: 'test-session' }),
      makeSession({ session_id: 'other-session' }),
    ]);

    const result = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(result.decision).toBe('deny');
  });

  it('cleans stale sessions before checking', async () => {
    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('main' as never);

    (mockStore.getActiveSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeSession({ session_id: 'test-session' }),
    ]);

    await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(mockStore.cleanStaleSessions).toHaveBeenCalledWith(7_200_000);
  });

  it('handles SESSION_CONFLICT on register (session already exists)', async () => {
    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('main' as never);

    (mockStore.registerSession as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new SlopeStoreError('SESSION_CONFLICT', 'session already exists'),
    );
    (mockStore.getActiveSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeSession({ session_id: 'test-session' }),
    ]);

    const result = await worktreeCheckGuard(makeInput(), '/tmp/test');
    // Should proceed normally despite the conflict error
    expect(result).toEqual({});
  });

  it('closes store in finally block even on error', async () => {
    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('main' as never);

    (mockStore.cleanStaleSessions as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));

    await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(mockStore.close).toHaveBeenCalled();
  });

  it('closes store on successful path', async () => {
    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('main' as never);

    (mockStore.getActiveSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeSession({ session_id: 'test-session' }),
    ]);

    await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(mockStore.close).toHaveBeenCalled();
  });

  it('fires only once per session (sentinel file)', async () => {
    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('main' as never);

    (mockStore.getActiveSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeSession({ session_id: 'test-session' }),
      makeSession({ session_id: 'other-session' }),
    ]);

    const first = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(first.decision).toBe('deny');

    // Second invocation with same session_id — sentinel exists, should be silent
    const second = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(second).toEqual({});
  });

  it('fires separately for different sessions', async () => {
    (mockStore.getActiveSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeSession({ session_id: 'session-a' }),
      makeSession({ session_id: 'session-b' }),
    ]);

    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('main' as never);
    const first = await worktreeCheckGuard(makeInput('session-a'), '/tmp/test');
    expect(first.decision).toBe('deny');

    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('main' as never);
    const second = await worktreeCheckGuard(makeInput('session-b'), '/tmp/test');
    expect(second.decision).toBe('deny');
  });

  it('resets state correctly via unlinkSync', async () => {
    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('main' as never);

    (mockStore.getActiveSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeSession({ session_id: 'reset-test' }),
      makeSession({ session_id: 'other' }),
    ]);

    await worktreeCheckGuard(makeInput('reset-test'), '/tmp/test');

    resetWorktreeCheckState('reset-test');

    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('main' as never);
    const result = await worktreeCheckGuard(makeInput('reset-test'), '/tmp/test');
    expect(result.decision).toBe('deny');
  });

  it('returns empty when not a git repo', async () => {
    mockExecSync.mockImplementation(() => { throw new Error('not a git repo'); });
    const result = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(result).toEqual({});
  });

  it('auto-registers current session with correct params', async () => {
    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('feat/my-branch' as never);

    (mockStore.getActiveSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeSession({ session_id: 'test-session' }),
    ]);

    await worktreeCheckGuard(makeInput('test-session'), '/tmp/test');
    expect(mockStore.registerSession).toHaveBeenCalledWith({
      session_id: 'test-session',
      role: 'primary',
      ide: 'claude-code',
      branch: 'feat/my-branch',
    });
  });
});
