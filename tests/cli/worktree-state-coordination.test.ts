import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordBaseline, loadBaseline, removeBaseline } from '../../src/cli/guards/git-utils.js';
import { sessionBriefingGuard } from '../../src/cli/guards/session-briefing.js';
import { workflowStepGateGuard } from '../../src/cli/guards/workflow-step-gate.js';
import { loadSessionState, updateSessionState } from '../../src/cli/session-state.js';
import { createSprintState, saveSprintState } from '../../src/cli/sprint-state.js';
import {
  addMemory,
  clearMemoryBackendCache,
  searchMemories,
} from '../../src/core/memory.js';
import { loadWorkflow } from '../../src/core/workflow-loader.js';
import { createStore } from '../../src/store/index.js';
import { detectSetupHints, findProjectRoot } from '../../src/mcp/index.js';
import { makeTempDir } from '../helpers/temp-dir.js';

let primary: string;
let worktree: string;

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

describe('cross-worktree state coordination', () => {
  beforeEach(() => {
    clearMemoryBackendCache();
    primary = makeTempDir('slope-coordination-primary-');
    worktree = `${primary}-worktree`;
    git(primary, ['init', '-q', '-b', 'main']);
    git(primary, ['config', 'user.email', 'test@example.com']);
    git(primary, ['config', 'user.name', 'Test User']);

    mkdirSync(join(primary, '.claude'), { recursive: true });
    writeFileSync(join(primary, '.gitignore'), '.slope/\n');
    writeFileSync(join(primary, 'README.md'), 'primary\n');
    writeFileSync(join(primary, 'worktree.txt'), 'worktree\n');
    writeFileSync(join(primary, '.claude', 'settings.json'), JSON.stringify({
      hooks: {
        PreToolUse: [{ hooks: [{ command: '$CLAUDE_PROJECT_DIR/.claude/hooks/slope-guard.sh explore' }] }],
      },
    }));
    git(primary, ['add', '.gitignore', 'README.md', 'worktree.txt', '.claude/settings.json']);
    git(primary, ['commit', '-q', '-m', 'init']);

    mkdirSync(join(primary, '.slope'), { recursive: true });
    writeFileSync(join(primary, '.slope', 'config.json'), JSON.stringify({
      scorecardDir: 'docs/retros',
      scorecardPattern: 'sprint-*.json',
      minSprint: 1,
      metaphor: 'golf',
      store_path: '.slope/slope.db',
    }));
    writeFileSync(join(primary, '.slope', 'hooks.json'), JSON.stringify({
      installed: {
        'guard-explore': { provider: 'claude-code' },
        'session-start': { provider: 'claude-code' },
        'session-end': { provider: 'claude-code' },
      },
    }));
    saveSprintState(primary, createSprintState(261, 'planning'));
    git(primary, ['worktree', 'add', '-q', worktree, '-b', 'feature']);
  });

  afterEach(() => {
    clearMemoryBackendCache();
    delete process.env.SLOPE_MEMORY_BACKEND;
    rmSync(worktree, { recursive: true, force: true });
    rmSync(primary, { recursive: true, force: true });
  });

  it('shares claims and keeps linked-worktree briefing in sprint mode', async () => {
    const fromWorktree = createStore({ storePath: '.slope/slope.db', cwd: worktree });
    await fromWorktree.claim({
      sprint_number: 261,
      player: 'secondary',
      target: 'S261-4',
      scope: 'ticket',
    });
    fromWorktree.close();

    const fromPrimary = createStore({ storePath: '.slope/slope.db', cwd: primary });
    expect((await fromPrimary.getActiveClaims(261)).map(claim => claim.target)).toContain('S261-4');
    fromPrimary.close();

    const result = await sessionBriefingGuard({
      session_id: 'worktree-briefing',
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: {},
    }, worktree);

    expect(result.suggestion?.context).toContain('Sprint: S261  Phase: planning');
    expect(result.suggestion?.context).toContain('Active claims: S261-4');
    expect(result.suggestion?.context).not.toContain('Session mode: adhoc');
    expect(existsSync(join(worktree, '.slope'))).toBe(false);
  });

  it('shares session state without creating a linked-worktree state directory', () => {
    updateSessionState(worktree, 'briefing_session_id', 'shared-session');

    expect(loadSessionState(primary).briefing_session_id).toBe('shared-session');
    expect(loadSessionState(worktree).briefing_session_id).toBe('shared-session');
    expect(existsSync(join(worktree, '.slope'))).toBe(false);
  });

  it('stores distinct guard baselines for the same session in each worktree', () => {
    writeFileSync(join(primary, 'README.md'), 'primary dirty\n');
    writeFileSync(join(worktree, 'worktree.txt'), 'worktree dirty\n');

    expect(recordBaseline('shared-session', primary)).toBe(true);
    expect(recordBaseline('shared-session', worktree)).toBe(true);
    expect(loadBaseline('shared-session', primary)).toContain('README.md');
    expect(loadBaseline('shared-session', worktree)).toContain('worktree.txt');

    removeBaseline('shared-session', worktree);
    expect(loadBaseline('shared-session', worktree)).toEqual(new Set());
    expect(loadBaseline('shared-session', primary)).toContain('README.md');
    expect(existsSync(join(worktree, '.slope'))).toBe(false);
  });

  it('keeps MCP source root local while detecting hooks from shared state', () => {
    const nested = join(worktree, 'src', 'nested');
    mkdirSync(nested, { recursive: true });

    expect(realpathSync(findProjectRoot(nested))).toBe(realpathSync(worktree));
    expect(detectSetupHints(worktree)).toEqual({
      guardsInstalled: true,
      lifecycleHooksInstalled: true,
      settingsConfigured: true,
    });
  });

  it('loads a primary custom workflow and keeps its guard active in a linked worktree', async () => {
    const workflowDir = join(primary, '.slope', 'workflows');
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(join(workflowDir, 'custom-block.yaml'), [
      "version: '1'",
      'name: custom-block',
      'phases:',
      '  - id: phase1',
      '    steps:',
      '      - id: step1',
      '        type: command',
      '        command: echo test',
    ].join('\n'));
    expect(loadWorkflow('custom-block', worktree).name).toBe('custom-block');

    const store = createStore({ storePath: '.slope/slope.db', cwd: primary });
    const execution = await store.startExecution({
      workflow_name: 'custom-block',
      sprint_id: 'S261',
      session_id: 'worktree-workflow',
    });
    await store.updateExecutionState(execution.id, 'phase1', 'step1');
    store.close();

    const result = await workflowStepGateGuard({
      session_id: 'worktree-workflow',
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: join(worktree, 'src', 'feature.ts') },
    }, worktree);

    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('type "command"');
    expect(existsSync(join(worktree, '.slope'))).toBe(false);
  });

  it('uses the shared SQLite memory backend from a linked worktree', () => {
    const store = createStore({ storePath: '.slope/slope.db', cwd: primary });
    store.close();

    addMemory(worktree, 'shared SQLite memory');

    expect(searchMemories(primary).map(memory => memory.text)).toContain('shared SQLite memory');
    expect(existsSync(join(worktree, '.slope'))).toBe(false);
  });

  it('uses the primary JSON memory fallback from a linked worktree', () => {
    process.env.SLOPE_MEMORY_BACKEND = 'json';

    addMemory(worktree, 'shared JSON memory');

    expect(searchMemories(primary).map(memory => memory.text)).toContain('shared JSON memory');
    expect(existsSync(join(primary, '.slope', 'memories.json'))).toBe(true);
    expect(existsSync(join(worktree, '.slope'))).toBe(false);
  });
});
