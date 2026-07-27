import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { stopCheckGuard } from '../../../src/cli/guards/stop-check.js';
import { recordBaseline } from '../../../src/cli/guards/git-utils.js';
import type { HookInput } from '../../../src/core/index.js';

let tmpDir: string;

function makeStop(): HookInput {
  return {
    session_id: 'test-session',
    cwd: tmpDir,
    hook_event_name: 'Stop',
  };
}

function git(cmd: string): string {
  return execSync(`git ${cmd}`, { cwd: tmpDir, encoding: 'utf8' }).trim();
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-stop-check-'));
  // Init a git repo with a remote
  git('init -b main');
  git('config user.email "test@test.com"');
  git('config user.name "Test"');
  writeFileSync(join(tmpDir, 'file.txt'), 'hello');
  git('add .');
  git('commit -m "initial"');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('stop-check guard', () => {
  it('returns empty when repo is clean with no upstream', async () => {
    const result = await stopCheckGuard(makeStop(), tmpDir);
    // No upstream configured — no unpushed check possible
    expect(result.blockReason).toBeUndefined();
  });

  it('warns on uncommitted changes', async () => {
    writeFileSync(join(tmpDir, 'file.txt'), 'modified');
    git('add file.txt');

    const result = await stopCheckGuard(makeStop(), tmpDir);
    expect(result.blockReason).toBeUndefined();
    expect(result.context).toContain('uncommitted');
  });

  it('does not treat an unstaged pre-session modification as a new session change', async () => {
    writeFileSync(join(tmpDir, 'file.txt'), 'modified before session');
    expect(recordBaseline('test-session', tmpDir)).toBe(true);

    const result = await stopCheckGuard(makeStop(), tmpDir);

    expect(result.blockReason).toBeUndefined();
    expect(result.context).toContain('pre-existing dirty file');
    expect(result.context).not.toContain('uncommitted change');
  });

  it('ignores untracked files (no warning)', async () => {
    writeFileSync(join(tmpDir, 'new-file.txt'), 'new');

    const result = await stopCheckGuard(makeStop(), tmpDir);
    expect(result.blockReason).toBeUndefined();
    expect(result.context).toBeUndefined();
  });

  describe('post-squash-merge scenario', () => {
    it('does not false-positive when HEAD is at origin/main', async () => {
      git('update-ref refs/remotes/origin/main HEAD');

      // Create a feature branch whose stale remote-tracking ref would look
      // unpushed if the guard did not first recognize HEAD at origin/main.
      git('checkout -b feature');
      writeFileSync(join(tmpDir, 'feature.txt'), 'feat');
      git('add .');
      git('commit -m "feature"');
      git('update-ref refs/remotes/origin/feature HEAD');

      // Simulate squash-merge: apply equivalent changes to main, then move
      // origin/main to that squash commit without invoking a temp remote.
      git('checkout main');
      writeFileSync(join(tmpDir, 'feature.txt'), 'feat');
      git('add .');
      git('commit -m "feat: feature (#1)"');
      git('update-ref refs/remotes/origin/main HEAD');

      // Now switch back to feature branch and reset to origin/main
      // (this is what happens in a worktree after squash merge)
      git('checkout feature');
      git('reset --hard origin/main');

      // HEAD is now at origin/main, but tracking branch (origin/feature) is behind
      // The guard should NOT block
      const result = await stopCheckGuard(makeStop(), tmpDir);
      expect(result.blockReason).toBeUndefined();
    });
  });

  describe('session cleanup on exit', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('calls removeSession on clean exit with correct sessionId', async () => {
      const mockStore = {
        removeSession: vi.fn().mockResolvedValue(true),
        close: vi.fn(),
      };
      const resolveStoreMock = vi.fn().mockResolvedValue(mockStore);

      vi.resetModules();
      vi.doMock('../../../src/cli/store.js', () => ({
        resolveStore: resolveStoreMock,
      }));

      const { stopCheckGuard: guardWithMock } = await import('../../../src/cli/guards/stop-check.js');

      const result = await guardWithMock(makeStop(), tmpDir);
      expect(result.blockReason).toBeUndefined();
      expect(resolveStoreMock).toHaveBeenCalledWith(tmpDir);
      expect(mockStore.removeSession).toHaveBeenCalledWith('test-session');
      expect(mockStore.close).toHaveBeenCalled();
    });

    it('removeSession failure does not block stop', async () => {
      vi.resetModules();
      vi.doMock('../../../src/cli/store.js', () => ({
        resolveStore: vi.fn().mockRejectedValue(new Error('store unavailable')),
      }));

      const { stopCheckGuard: guardWithMock } = await import('../../../src/cli/guards/stop-check.js');

      // Should not throw
      const result = await guardWithMock(makeStop(), tmpDir);
      expect(result.blockReason).toBeUndefined();
    });

    it('sentinel file cleaned on exit', async () => {
      // Create sentinel file
      const sentinelDir = join(tmpdir(), 'slope-guards');
      const sentinelFile = join(sentinelDir, 'worktree-check-test-session');
      writeFileSync(sentinelFile, new Date().toISOString());
      expect(existsSync(sentinelFile)).toBe(true);

      vi.resetModules();
      vi.doMock('../../../src/cli/store.js', () => ({
        resolveStore: vi.fn().mockResolvedValue({
          removeSession: vi.fn().mockResolvedValue(true),
          close: vi.fn(),
        }),
      }));

      const { stopCheckGuard: guardWithMock } = await import('../../../src/cli/guards/stop-check.js');
      await guardWithMock(makeStop(), tmpDir);

      expect(existsSync(sentinelFile)).toBe(false);
    });

    it('cleanup skipped when no session_id', async () => {
      const resolveStoreMock = vi.fn();

      vi.resetModules();
      vi.doMock('../../../src/cli/store.js', () => ({
        resolveStore: resolveStoreMock,
      }));

      const { stopCheckGuard: guardWithMock } = await import('../../../src/cli/guards/stop-check.js');
      const input: HookInput = { session_id: '', cwd: tmpDir, hook_event_name: 'Stop' };
      await guardWithMock(input, tmpDir);

      expect(resolveStoreMock).not.toHaveBeenCalled();
    });
  });
});
