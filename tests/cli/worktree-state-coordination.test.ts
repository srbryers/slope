import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordBaseline, loadBaseline, removeBaseline } from '../../src/cli/guards/git-utils.js';
import { sessionBriefingGuard } from '../../src/cli/guards/session-briefing.js';
import { loadSessionState, updateSessionState } from '../../src/cli/session-state.js';
import { createSprintState, saveSprintState } from '../../src/cli/sprint-state.js';
import { createStore } from '../../src/store/index.js';
import { detectSetupHints, findProjectRoot } from '../../src/mcp/index.js';

let primary: string;
let worktree: string;

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

describe('cross-worktree state coordination', () => {
  beforeEach(() => {
    primary = mkdtempSync(join(tmpdir(), 'slope-coordination-primary-'));
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
});
