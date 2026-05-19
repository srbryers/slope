import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sessionBriefingGuard } from '../../../src/cli/guards/session-briefing.js';
import { loadSessionState, setSessionMode, updateSessionState } from '../../../src/cli/session-state.js';
import { createSprintState, saveSprintState } from '../../../src/cli/sprint-state.js';
import type { HookInput } from '../../../src/core/index.js';

let tmpDir: string;

function makeInput(): HookInput {
  return {
    session_id: 'test-session',
    cwd: tmpDir,
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'slope sprint start --number=74 --phase=planning' },
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-session-briefing-'));
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({ metaphor: 'golf' }));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('sessionBriefingGuard', () => {
  it('promotes an already-briefed adhoc session after sprint-state appears', async () => {
    updateSessionState(tmpDir, 'briefing_session_id', 'test-session');
    setSessionMode(tmpDir, 'test-session', 'adhoc');
    saveSprintState(tmpDir, createSprintState(74, 'planning'));

    const result = await sessionBriefingGuard(makeInput(), tmpDir);

    expect(result).toEqual({});
    expect(loadSessionState(tmpDir).session_mode).toBe('sprint');
  });
});
