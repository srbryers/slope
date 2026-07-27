import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSprintState, saveSprintState } from '../../../src/cli/sprint-state.js';
import type { HookInput } from '../../../src/core/index.js';

const resolveStoreMock = vi.fn();

vi.mock('../../../src/cli/store.js', () => ({
  resolveStore: resolveStoreMock,
}));

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-briefing-store-'));
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({ metaphor: 'golf' }));
  saveSprintState(tmpDir, createSprintState(74, 'implementing'));
  resolveStoreMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('session briefing store cleanup', () => {
  it('closes stores when execution and claim reads reject', async () => {
    const executionStore = {
      listExecutions: vi.fn().mockRejectedValue(new Error('execution read failed')),
      close: vi.fn(),
    };
    const claimStore = {
      getActiveClaims: vi.fn().mockRejectedValue(new Error('claim read failed')),
      close: vi.fn(),
    };
    resolveStoreMock
      .mockResolvedValueOnce(executionStore)
      .mockResolvedValueOnce(claimStore);
    const input: HookInput = {
      session_id: 'test-session',
      cwd: tmpDir,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'slope status' },
    };
    const { sessionBriefingGuard } = await import('../../../src/cli/guards/session-briefing.js');

    const result = await sessionBriefingGuard(input, tmpDir);

    expect(result.suggestion).toBeDefined();
    expect(executionStore.close).toHaveBeenCalledOnce();
    expect(claimStore.close).toHaveBeenCalledOnce();
  });
});
