import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { stopCheckGuard } from '../../../src/cli/guards/stop-check.js';
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

  it('warns on untracked files only', async () => {
    writeFileSync(join(tmpDir, 'new-file.txt'), 'new');

    const result = await stopCheckGuard(makeStop(), tmpDir);
    expect(result.blockReason).toBeUndefined();
    expect(result.context).toContain('untracked');
  });

  describe('post-squash-merge scenario', () => {
    it('does not false-positive when HEAD is at origin/main', async () => {
      // Simulate a remote by creating a bare repo and pushing
      const bareDir = mkdtempSync(join(tmpdir(), 'slope-bare-'));
      execSync('git init --bare', { cwd: bareDir });
      git(`remote add origin ${bareDir}`);
      git('push -u origin main');

      // Create a branch, make a commit, push it
      git('checkout -b feature');
      writeFileSync(join(tmpDir, 'feature.txt'), 'feat');
      git('add .');
      git('commit -m "feature"');
      git('push -u origin feature');

      // Simulate squash-merge: apply changes to main on remote
      git('checkout main');
      writeFileSync(join(tmpDir, 'feature.txt'), 'feat');
      git('add .');
      git('commit -m "feat: feature (#1)"');
      git('push origin main');

      // Now switch back to feature branch and reset to origin/main
      // (this is what happens in a worktree after squash merge)
      git('checkout feature');
      git('reset --hard origin/main');

      // HEAD is now at origin/main, but tracking branch (origin/feature) is behind
      // The guard should NOT block
      const result = await stopCheckGuard(makeStop(), tmpDir);
      expect(result.blockReason).toBeUndefined();

      rmSync(bareDir, { recursive: true, force: true });
    });
  });
});
