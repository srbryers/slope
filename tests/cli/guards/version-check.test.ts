import { describe, it, expect, vi, beforeEach } from 'vitest';
import { versionCheckGuard } from '../../../src/cli/guards/version-check.js';
import type { HookInput } from '../../../src/core/index.js';

vi.mock('node:child_process', () => ({ execSync: vi.fn() }));
vi.mock('node:fs', () => ({ readFileSync: vi.fn() }));

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const mockExecSync = vi.mocked(execSync);
const mockReadFileSync = vi.mocked(readFileSync);

function makeInput(command: string): HookInput {
  return {
    session_id: 'test',
    cwd: '/tmp/test',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    tool_response: {},
  };
}

/** Local version equal to published — the condition the guard blocks on. */
function mockUnbumped() {
  mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.64.1' }) as never);
  mockExecSync.mockReturnValue('1.64.1' as never);
}

describe('versionCheckGuard', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
    mockReadFileSync.mockReset();
  });

  it('blocks a push to main when the version has not been bumped', async () => {
    mockUnbumped();
    const result = await versionCheckGuard(makeInput('git push origin main'), '/tmp/test');
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('Version not bumped');
  });

  it('allows a push to main once the version differs from npm', async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.65.0' }) as never);
    mockExecSync.mockReturnValue('1.64.1' as never);
    const result = await versionCheckGuard(makeInput('git push origin main'), '/tmp/test');
    expect(result).toEqual({});
  });

  it('allows a push to a feature branch', async () => {
    mockUnbumped();
    const result = await versionCheckGuard(makeInput('git push origin feat/thing'), '/tmp/test');
    expect(result).toEqual({});
  });

  it('blocks a HEAD:main refspec', async () => {
    mockUnbumped();
    const result = await versionCheckGuard(makeInput('git push origin HEAD:main'), '/tmp/test');
    expect(result.decision).toBe('deny');
  });

  // #683 — the trigger was `includes('git push')` plus `/(main|master)/`
  // over the raw text, so any command mentioning both strings was blocked.
  describe('command-text precision (#683)', () => {
    it('does not fire when both phrases only appear in a quoted argument', async () => {
      mockUnbumped();
      const result = await versionCheckGuard(
        makeInput('gh issue create --body "never git push to main without a bump"'),
        '/tmp/test',
      );
      expect(result).toEqual({});
    });

    it('does not fire when both phrases only appear in a heredoc body', async () => {
      mockUnbumped();
      const command = "cat <<'EOF' > RELEASE.md\nDo not git push origin main directly.\nEOF";
      const result = await versionCheckGuard(makeInput(command), '/tmp/test');
      expect(result).toEqual({});
    });

    it('does not fire on a branch whose name merely contains main', async () => {
      mockUnbumped();
      const result = await versionCheckGuard(makeInput('git push origin feat/maintenance'), '/tmp/test');
      expect(result).toEqual({});
    });

    it('still blocks a genuine push to main inside a compound command', async () => {
      mockUnbumped();
      const result = await versionCheckGuard(
        makeInput('pnpm build && git push origin main'),
        '/tmp/test',
      );
      expect(result.decision).toBe('deny');
    });
  });
});
