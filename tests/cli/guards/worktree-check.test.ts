import { describe, it, expect, vi, beforeEach } from 'vitest';
import { worktreeCheckGuard, resetWorktreeCheckState } from '../../../src/cli/guards/worktree-check.js';
import type { HookInput } from '../../../src/core/index.js';
import { STALE_SESSION_THRESHOLD_MS } from '../../../src/core/constants.js';
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
import { writeFileSync } from 'node:fs';
import { resolveStore } from '../../../src/cli/store.js';

const mockExecSync = vi.mocked(execSync);
const mockResolveStore = vi.mocked(resolveStore);
const mockWriteFileSync = vi.mocked(writeFileSync);

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

/** Set up execSync to return main repo on a given branch */
function mockGitMainRepo(branch = 'feat/foo'): void {
  mockExecSync
    .mockReturnValueOnce('.git' as never)       // git-common-dir
    .mockReturnValueOnce(branch as never);       // branch
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
    expect(result.blockReason).toContain('other-session');
    expect(result.blockReason).toContain('EnterWorktree');
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

  it('silently passes on store resolve error (#263)', async () => {
    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('feat/foo' as never);

    mockResolveStore.mockRejectedValueOnce(new Error('no store'));

    const result = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(result).toEqual({});
  });

  it('silently passes on store query error (#263)', async () => {
    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('feat/foo' as never);

    (mockStore.cleanStaleSessions as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('db locked'));

    const result = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(result).toEqual({});
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
    expect(mockStore.cleanStaleSessions).toHaveBeenCalledWith(STALE_SESSION_THRESHOLD_MS);
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

  it('writes sentinel only on pass, not on deny', async () => {
    mockGitMainRepo();
    (mockStore.getActiveSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeSession({ session_id: 'test-session' }),
      makeSession({ session_id: 'other-session' }),
    ]);

    const result = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(result.decision).toBe('deny');
    // Sentinel should NOT be written on deny
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('writes sentinel on pass', async () => {
    mockGitMainRepo();
    (mockStore.getActiveSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeSession({ session_id: 'test-session' }),
    ]);

    const result = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(result).toEqual({});
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it('re-checks after deny when conflict resolves', async () => {
    // First call: conflict exists -> deny, no sentinel
    mockGitMainRepo();
    (mockStore.getActiveSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeSession({ session_id: 'test-session' }),
      makeSession({ session_id: 'other-session' }),
    ]);
    const first = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(first.decision).toBe('deny');

    // Second call: conflict resolved -> pass
    mockGitMainRepo();
    (mockStore.getActiveSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeSession({ session_id: 'test-session' }),
    ]);
    const second = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(second).toEqual({});
  });

  it('fires only once per session after pass (sentinel file)', async () => {
    mockGitMainRepo();
    (mockStore.getActiveSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeSession({ session_id: 'test-session' }),
    ]);

    const first = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(first).toEqual({});

    // Second invocation — sentinel exists, should be silent without hitting store
    const second = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(second).toEqual({});
    expect(mockResolveStore).toHaveBeenCalledTimes(1);
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
    mockGitMainRepo('feat/my-branch');
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

  it('allows when other session is in the same swarm', async () => {
    mockGitMainRepo();
    (mockStore.registerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      session_id: 'test-session',
      role: 'primary',
      ide: 'claude-code',
      swarm_id: 'swarm-1',
      started_at: new Date().toISOString(),
      last_heartbeat_at: new Date().toISOString(),
    });
    (mockStore.getActiveSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeSession({ session_id: 'test-session', swarm_id: 'swarm-1' }),
      makeSession({ session_id: 'other-session', swarm_id: 'swarm-1' }),
    ]);

    const result = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(result).toEqual({});
  });

  it('denies when other session is in a different swarm', async () => {
    mockGitMainRepo();
    (mockStore.registerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      session_id: 'test-session',
      role: 'primary',
      ide: 'claude-code',
      swarm_id: 'swarm-1',
      started_at: new Date().toISOString(),
      last_heartbeat_at: new Date().toISOString(),
    });
    (mockStore.getActiveSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeSession({ session_id: 'test-session', swarm_id: 'swarm-1' }),
      makeSession({ session_id: 'other-session', swarm_id: 'swarm-2' }),
    ]);

    const result = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(result.decision).toBe('deny');
  });

  it('generates random session ID when input has none', async () => {
    mockGitMainRepo();
    (mockStore.getActiveSessions as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await worktreeCheckGuard(makeInput(''), '/tmp/test');
    const call = (mockStore.registerSession as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.session_id).not.toBe('unknown');
    expect(call.session_id).not.toBe('');
    expect(call.session_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('recovers swarm_id via SESSION_CONFLICT and still allows same-swarm', async () => {
    mockGitMainRepo();
    // registerSession throws SESSION_CONFLICT (session already exists)
    (mockStore.registerSession as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new SlopeStoreError('SESSION_CONFLICT', 'session already exists'),
    );
    // getActiveSessions returns both sessions in same swarm
    (mockStore.getActiveSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeSession({ session_id: 'test-session', swarm_id: 'swarm-1' }),
      makeSession({ session_id: 'other-session', swarm_id: 'swarm-1' }),
    ]);

    const result = await worktreeCheckGuard(makeInput(), '/tmp/test');
    // Same swarm — should pass despite SESSION_CONFLICT recovery path
    expect(result).toEqual({});
  });

  it('silently passes when registerSession throws non-SlopeStoreError (#263)', async () => {
    mockGitMainRepo();
    (mockStore.registerSession as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('database disk image is malformed'),
    );

    const result = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(result).toEqual({});
  });

  it('uses branch unknown fallback when git branch fails', async () => {
    mockExecSync
      .mockReturnValueOnce('.git' as never)                              // git-common-dir
      .mockImplementationOnce(() => { throw new Error('detached'); });    // branch fails

    (mockStore.getActiveSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeSession({ session_id: 'test-session' }),
    ]);

    await worktreeCheckGuard(makeInput(), '/tmp/test');
    const call = (mockStore.registerSession as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.branch).toBe('unknown');
  });

  it('caches getActiveSessions on SESSION_CONFLICT path (single call)', async () => {
    mockGitMainRepo();
    (mockStore.registerSession as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new SlopeStoreError('SESSION_CONFLICT', 'session already exists'),
    );
    (mockStore.getActiveSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeSession({ session_id: 'test-session' }),
    ]);

    await worktreeCheckGuard(makeInput(), '/tmp/test');
    // getActiveSessions should be called only once (cached from conflict recovery)
    expect(mockStore.getActiveSessions).toHaveBeenCalledTimes(1);
  });
});
