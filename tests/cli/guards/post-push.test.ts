import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HookInput } from '../../../src/core/index.js';
import { postPushGuard } from '../../../src/cli/guards/post-push.js';
import { createStore } from '../../../src/store/index.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `slope-post-push-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({
    roadmapPath: 'docs/backlog/roadmap.json',
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
    store_path: '.slope/slope.db',
  }));
  writeFileSync(join(tmpDir, '.slope', 'sprint-state.json'), JSON.stringify({
    sprint: 135,
    phase: 'implementing',
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
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function pushInput(command = 'git push'): HookInput {
  return {
    session_id: 'post-push-session',
    cwd: tmpDir,
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    tool_response: { exit_code: 0 },
  };
}

describe('postPushGuard claim state (#494)', () => {
  it('counts store-backed claims before suggesting scoring workflow', async () => {
    const store = createStore({ storePath: '.slope/slope.db', cwd: tmpDir });
    await store.claim({
      sprint_number: 135,
      player: 'test',
      target: 'sprint:S135',
      scope: 'area',
    });
    store.close();

    const result = await postPushGuard(pushInput(), tmpDir);

    expect(result.suggestion?.context).toContain('1 claim(s) active');
    expect(result.suggestion?.context).not.toContain('all tickets done');
  });
});
