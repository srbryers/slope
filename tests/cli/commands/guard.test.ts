import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { execFileSync } from 'node:child_process';
import type { HookInput } from '../../../src/core/index.js';

// Ensure adapters are registered
import '../../../src/core/adapters/claude-code.js';
import '../../../src/core/adapters/cursor.js';
import '../../../src/core/adapters/windsurf.js';
import '../../../src/core/adapters/generic.js';

import { guardCommand, guardManageCommand, shouldSuppressGuardInAdhoc } from '../../../src/cli/commands/guard.js';
import { loadSessionState, setSessionMode } from '../../../src/cli/session-state.js';
import { createSprintState, saveSprintState } from '../../../src/cli/sprint-state.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `slope-guard-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeTmpPath(prefix: string): string {
  return join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function writeMinimalSlopeConfig(cwd: string): void {
  mkdirSync(join(cwd, '.slope'), { recursive: true });
  writeFileSync(join(cwd, '.slope', 'config.json'), JSON.stringify({
    scorecardDir: 'docs/retros',
    metaphor: 'golf',
  }));
}

function initGitRepo(cwd: string, branch: string): void {
  execFileSync('git', ['init', '-q'], { cwd, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd, stdio: 'ignore' });
  execFileSync('git', ['checkout', '-q', '-b', branch], { cwd, stdio: 'ignore' });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'initial'], { cwd, stdio: 'ignore' });
}

function makeHookInput(cwd: string, overrides: Partial<HookInput> = {}): HookInput {
  return {
    session_id: 'test-session',
    cwd,
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { file_path: join(cwd, 'src/example.ts') },
    ...overrides,
  };
}

async function runGuardCommandWithInput(args: string[], input: HookInput): Promise<string> {
  const stdin = new PassThrough();
  const originalStdin = process.stdin;
  let output = '';
  const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  });

  Object.defineProperty(process, 'stdin', { value: stdin, configurable: true });
  try {
    const command = guardCommand(args);
    stdin.end(JSON.stringify(input));
    await command;
    return output;
  } finally {
    writeSpy.mockRestore();
    Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
  }
}

describe('slope guard recommend (S65-3)', () => {
  let cwd: string;
  let origCwd: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    cwd = makeTmpDir();
    origCwd = process.cwd();
    process.chdir(cwd);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    writeMinimalSlopeConfig(cwd);
    writeFileSync(join(cwd, '.slope', 'hooks.json'), JSON.stringify({ installed: {} }));
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(cwd, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('shows missing guards with relevance', async () => {
    await guardManageCommand(['recommend']);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Missing guards:');
    expect(output).toContain('Guard');
    expect(output).toContain('Relevant');
  });

  it('detects sprint-workflow profile', async () => {
    // Create roadmap + retros to trigger sprint-workflow
    mkdirSync(join(cwd, 'docs', 'retros'), { recursive: true });
    mkdirSync(join(cwd, 'docs', 'backlog'), { recursive: true });
    writeFileSync(join(cwd, 'docs', 'backlog', 'roadmap.json'), JSON.stringify({ sprints: [] }));

    await guardManageCommand(['recommend']);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('sprint-workflow');
  });

  it('detects monorepo profile', async () => {
    mkdirSync(join(cwd, 'packages'), { recursive: true });

    await guardManageCommand(['recommend']);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('monorepo');
  });

  it('detects has-flows profile', async () => {
    writeFileSync(join(cwd, '.slope', 'flows.json'), JSON.stringify([{ id: 'test', title: 'Test flow' }]));

    await guardManageCommand(['recommend']);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('has-flows');
  });

  it('marks always-relevant guards as YES', async () => {
    await guardManageCommand(['recommend']);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    // Guards with when:'always' should show YES
    expect(output).toContain('YES');
  });
});

describe('guardCommand dispatcher path', () => {
  let cwd: string;
  let origCwd: string;
  let originalCodexWorkdirStore: string | undefined;

  beforeEach(() => {
    cwd = makeTmpDir();
    origCwd = process.cwd();
    originalCodexWorkdirStore = process.env.SLOPE_CODEX_WORKDIR_STORE;
    process.chdir(cwd);
    writeMinimalSlopeConfig(cwd);
    process.env.SLOPE_CODEX_WORKDIR_STORE = join(cwd, '.slope', 'codex-workdirs');
    setSessionMode(cwd, 'test-session', 'adhoc');
  });

  afterEach(() => {
    process.chdir(origCwd);
    if (originalCodexWorkdirStore === undefined) {
      delete process.env.SLOPE_CODEX_WORKDIR_STORE;
    } else {
      process.env.SLOPE_CODEX_WORKDIR_STORE = originalCodexWorkdirStore;
    }
    rmSync(cwd, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('emits advisory context, not ask, for claim-required on adhoc implementation writes (GH #643)', async () => {
    const output = await runGuardCommandWithInput(['claim-required'], makeHookInput(cwd));
    const parsed = JSON.parse(output);

    expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    // Adhoc mode advertises "sprint-workflow guards silenced", so the guard
    // reports but must not gate the host on every write.
    expect(parsed.hookSpecificOutput.permissionDecision).toBeUndefined();
    expect(parsed.hookSpecificOutput.additionalContext).toContain('adhoc session');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('no active sprint state');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('slope sprint start');

    const metrics = readFileSync(join(cwd, '.slope', 'guard-metrics.jsonl'), 'utf8');
    expect(metrics).toContain('"guard":"claim-required"');
  });

  it('ignores out-of-repo scratchpad writes instead of adopting them as the workspace (GH #625)', async () => {
    const scratchpad = makeTmpPath('slope-scratchpad');
    mkdirSync(scratchpad, { recursive: true });
    try {
      const output = await runGuardCommandWithInput(['claim-required'], makeHookInput(cwd, {
        tool_input: { file_path: join(scratchpad, 'probe.config.ts'), content: 'x' },
      }));

      expect(output).toBe('');
    } finally {
      rmSync(scratchpad, { recursive: true, force: true });
    }
  });

  it('does not cache a non-workspace cwd for later tool calls (GH #625)', async () => {
    const scratchpad = makeTmpPath('slope-scratchpad');
    mkdirSync(scratchpad, { recursive: true });
    try {
      await runGuardCommandWithInput(['claim-required'], makeHookInput(cwd, {
        tool_input: { file_path: join(scratchpad, 'probe.ts'), content: 'x' },
      }));

      const store = join(cwd, '.slope', 'codex-workdirs');
      const memos = existsSync(store) ? readdirSync(store) : [];
      const remembered = memos.map(name => JSON.parse(readFileSync(join(store, name), 'utf8')).cwd);
      expect(remembered).not.toContain(scratchpad);
    } finally {
      rmSync(scratchpad, { recursive: true, force: true });
    }
  });

  it('refuses to replay a remembered cwd that is not a workspace (GH #625)', async () => {
    const scratchpad = makeTmpPath('slope-scratchpad');
    mkdirSync(scratchpad, { recursive: true });
    const store = join(cwd, '.slope', 'codex-workdirs');
    mkdirSync(store, { recursive: true });
    // Simulate a memo written by an older version that pinned a non-workspace dir.
    writeFileSync(
      join(store, `${'0'.repeat(32)}.json`),
      JSON.stringify({ session_id: 'test-session', cwd: scratchpad, source: 'tool-path' }),
    );
    try {
      const output = await runGuardCommandWithInput(['claim-required'], makeHookInput(cwd, {
        tool_input: { file_path: join(cwd, 'src/example.ts') },
      }));

      // Falls back to the real workspace, so the in-repo edit is still classified.
      expect(output).toContain('src/example.ts');
      expect(output).not.toContain('scratchpad');
    } finally {
      rmSync(scratchpad, { recursive: true, force: true });
    }
  });

  it('records suppressed metrics for adhoc workflow guards that do not run', async () => {
    const output = await runGuardCommandWithInput(['workflow-step-gate'], makeHookInput(cwd));

    expect(output).toBe('');
    const metrics = readFileSync(join(cwd, '.slope', 'guard-metrics.jsonl'), 'utf8');
    expect(metrics).toContain('"guard":"workflow-step-gate"');
    expect(metrics).toContain('"decision":"suppressed"');
    expect(metrics).toContain('"reason":"adhoc-session"');
  });

  it('records guard-specific silent reason metrics', async () => {
    const output = await runGuardCommandWithInput(
      ['hazard'],
      makeHookInput(cwd, { tool_input: {} }),
    );

    expect(output).toBe('');
    const metrics = readFileSync(join(cwd, '.slope', 'guard-metrics.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    expect(metrics.at(-1)).toMatchObject({
      guard: 'hazard',
      decision: 'silent',
      reason: 'no-file-path',
    });
  });

  it('does not emit hook output for duplicate hazard context', async () => {
    writeFileSync(join(cwd, '.slope', 'common-issues.json'), JSON.stringify({
      recurring_patterns: [
        {
          id: 1,
          title: 'Core issue',
          category: 'testing',
          sprints_hit: [8],
          gotcha_refs: [],
          description: 'Affects core package testing',
          prevention: 'Run tests after editing core',
        },
      ],
    }));

    const input = makeHookInput(cwd, {
      tool_input: { file_path: join(cwd, 'packages/core/src/foo.ts') },
    });

    const first = await runGuardCommandWithInput(['hazard'], input);
    const firstParsed = JSON.parse(first);
    expect(firstParsed.hookSpecificOutput.additionalContext).toContain('SLOPE hazards');

    const second = await runGuardCommandWithInput(['hazard'], input);
    expect(second).toBe('');

    const metrics = readFileSync(join(cwd, '.slope', 'guard-metrics.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    expect(metrics.at(-1)).toMatchObject({
      guard: 'hazard',
      decision: 'silent',
      reason: 'deduped',
    });
  });

  it('keeps claim-required effective when batched with suppressed write guards', async () => {
    const output = await runGuardCommandWithInput(
      ['__batch', 'workflow-step-gate', 'claim-required'],
      makeHookInput(cwd),
    );
    const parsed = JSON.parse(output);

    // Still effective — it produces output where workflow-step-gate is fully
    // suppressed — but advisory in adhoc rather than gating (GH #643).
    expect(parsed.hookSpecificOutput.permissionDecision).toBeUndefined();
    expect(parsed.hookSpecificOutput.additionalContext).toContain('slope claim');

    const metrics = readFileSync(join(cwd, '.slope', 'guard-metrics.jsonl'), 'utf8');
    expect(metrics).toContain('"guard":"workflow-step-gate"');
    expect(metrics).toContain('"decision":"suppressed"');
    expect(metrics).toContain('"guard":"claim-required"');
  });

  it('uses hook input cwd instead of launcher cwd when running branch-before-commit', async () => {
    initGitRepo(cwd, 'main');
    const worktreeCwd = makeTmpDir();

    try {
      writeMinimalSlopeConfig(worktreeCwd);
      initGitRepo(worktreeCwd, 'feat/hook-cwd');

      const output = await runGuardCommandWithInput(
        ['branch-before-commit'],
        makeHookInput(worktreeCwd, {
          tool_name: 'Bash',
          tool_input: { command: 'git commit -m "feat: keep worktree branch"' },
        }),
      );

      expect(output).toBe('');
      const worktreeMetrics = readFileSync(join(worktreeCwd, '.slope', 'guard-metrics.jsonl'), 'utf8');
      expect(worktreeMetrics).toContain('"guard":"branch-before-commit"');
      expect(worktreeMetrics).toContain('"decision":"silent"');
      expect(existsSync(join(cwd, '.slope', 'guard-metrics.jsonl'))).toBe(false);
    } finally {
      rmSync(worktreeCwd, { recursive: true, force: true });
    }
  });

  it('prefers Codex exec workdir over hook cwd when running branch-before-commit', async () => {
    initGitRepo(cwd, 'main');
    const worktreeCwd = makeTmpDir();

    try {
      writeMinimalSlopeConfig(worktreeCwd);
      initGitRepo(worktreeCwd, 'feat/codex-workdir');

      const output = await runGuardCommandWithInput(
        ['branch-before-commit'],
        makeHookInput(cwd, {
          session_id: 'explicit-workdir-session',
          tool_name: 'Bash',
          tool_input: {
            command: 'git commit -m "feat: keep worktree branch"',
            workdir: worktreeCwd,
          },
        }),
      );

      expect(output).toBe('');
      expect(readFileSync(join(worktreeCwd, '.slope', 'guard-metrics.jsonl'), 'utf8')).toContain('"guard":"branch-before-commit"');
      expect(existsSync(join(cwd, '.slope', 'guard-metrics.jsonl'))).toBe(false);
    } finally {
      rmSync(worktreeCwd, { recursive: true, force: true });
    }
  });

  it('recovers and remembers Codex exec workdir from transcript tool_use_id', async () => {
    initGitRepo(cwd, 'main');
    const worktreeCwd = makeTmpDir();

    try {
      writeMinimalSlopeConfig(worktreeCwd);
      initGitRepo(worktreeCwd, 'feat/codex-transcript-workdir');
      const transcriptPath = join(cwd, '.slope', 'codex-transcript.jsonl');
      writeFileSync(transcriptPath, JSON.stringify({
        type: 'tool_call',
        id: 'toolu_123',
        cwd,
        input: {
          command: 'git commit -m "feat: from transcript"',
          workdir: worktreeCwd,
        },
      }) + '\n');

      const firstOutput = await runGuardCommandWithInput(
        ['branch-before-commit'],
        makeHookInput(cwd, {
          session_id: 'remember-workdir-session',
          tool_name: 'Bash',
          tool_input: { command: 'git commit -m "feat: from transcript"' },
          transcript_path: transcriptPath,
          tool_use_id: 'toolu_123',
        }),
      );
      expect(readdirSync(join(cwd, '.slope', 'codex-workdirs'))).toHaveLength(1);
      const secondOutput = await runGuardCommandWithInput(
        ['branch-before-commit'],
        makeHookInput(cwd, {
          session_id: 'remember-workdir-session',
          tool_name: 'Bash',
          tool_input: { command: 'git commit -m "feat: remembered"' },
        }),
      );

      expect(firstOutput).toBe('');
      expect(secondOutput).toBe('');
      const metrics = readFileSync(join(worktreeCwd, '.slope', 'guard-metrics.jsonl'), 'utf8')
        .trim()
        .split('\n');
      expect(metrics).toHaveLength(2);
      expect(existsSync(join(cwd, '.slope', 'guard-metrics.jsonl'))).toBe(false);
    } finally {
      rmSync(worktreeCwd, { recursive: true, force: true });
    }
  });

  it('infers the single staged non-main worktree when Codex omits exec workdir', async () => {
    initGitRepo(cwd, 'main');
    const worktreeCwd = makeTmpPath('slope-guard-inferred-worktree');

    try {
      execFileSync('git', ['worktree', 'add', '-q', '-b', 'feat/inferred-workdir', worktreeCwd], { cwd, stdio: 'ignore' });
      writeMinimalSlopeConfig(worktreeCwd);
      writeFileSync(join(worktreeCwd, 'feature.txt'), 'ready\n');
      execFileSync('git', ['add', 'feature.txt'], { cwd: worktreeCwd, stdio: 'ignore' });

      const output = await runGuardCommandWithInput(
        ['branch-before-commit'],
        makeHookInput(cwd, {
          session_id: 'infer-workdir-session',
          tool_name: 'Bash',
          tool_input: { command: 'git commit -m "feat: inferred worktree"' },
        }),
      );

      expect(output).toBe('');
      expect(readFileSync(join(worktreeCwd, '.slope', 'guard-metrics.jsonl'), 'utf8')).toContain('"guard":"branch-before-commit"');
      expect(existsSync(join(cwd, '.slope', 'guard-metrics.jsonl'))).toBe(false);
    } finally {
      try {
        execFileSync('git', ['worktree', 'remove', '--force', worktreeCwd], { cwd, stdio: 'ignore' });
      } catch { /* ignore */ }
      rmSync(worktreeCwd, { recursive: true, force: true });
    }
  });

  it('routes worktree-check through the edited file repository when hook cwd is another repo', async () => {
    initGitRepo(cwd, 'main');
    const worktreeCwd = makeTmpPath('slope-guard-edit-worktree');

    try {
      execFileSync('git', ['worktree', 'add', '-q', '-b', 'feat/edit-workdir', worktreeCwd], { cwd, stdio: 'ignore' });
      writeMinimalSlopeConfig(worktreeCwd);
      mkdirSync(join(worktreeCwd, 'src'), { recursive: true });
      writeFileSync(join(worktreeCwd, 'src', 'foo.ts'), 'export const foo = 1;\n');

      const output = await runGuardCommandWithInput(
        ['worktree-check'],
        makeHookInput(cwd, {
          session_id: 'worktree-check-edit-session',
          tool_name: 'Edit',
          tool_input: {
            file_path: join(worktreeCwd, 'src', 'foo.ts'),
            old_string: '1',
            new_string: '2',
          },
        }),
      );

      expect(output).toBe('');
      expect(readFileSync(join(worktreeCwd, '.slope', 'guard-metrics.jsonl'), 'utf8')).toContain('"guard":"worktree-check"');
      expect(existsSync(join(cwd, '.slope', 'guard-metrics.jsonl'))).toBe(false);
    } finally {
      try {
        execFileSync('git', ['worktree', 'remove', '--force', worktreeCwd], { cwd, stdio: 'ignore' });
      } catch { /* ignore */ }
      rmSync(worktreeCwd, { recursive: true, force: true });
    }
  });

  it('prints metric reason counts in the metrics command', async () => {
    writeFileSync(join(cwd, '.slope', 'guard-metrics.jsonl'), [
      JSON.stringify({ ts: '2026-05-21T00:00:00.000Z', guard: 'hazard', event: 'PreToolUse', tool: 'apply_patch', decision: 'silent', reason: 'no-file-path' }),
      JSON.stringify({ ts: '2026-05-21T00:00:01.000Z', guard: 'hazard', event: 'PreToolUse', tool: 'apply_patch', decision: 'context', reason: 'deduped' }),
    ].join('\n') + '\n');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await guardManageCommand(['metrics']);
    const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');

    expect(output).toContain('Reasons (silent/context/suppressed)');
    expect(output).toContain('no-file-path');
    expect(output).toContain('deduped');
  });
});

describe('adhoc guard suppression', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
    writeMinimalSlopeConfig(cwd);
    setSessionMode(cwd, 'test-session', 'adhoc');
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('keeps most sprint workflow guards suppressed in adhoc sessions', () => {
    expect(shouldSuppressGuardInAdhoc('workflow-step-gate', cwd, 'test-session')).toBe(true);
  });

  it('promotes adhoc sessions when live sprint-state appears', () => {
    saveSprintState(cwd, createSprintState(74, 'planning'));

    expect(shouldSuppressGuardInAdhoc('workflow-step-gate', cwd, 'test-session')).toBe(false);
    expect(loadSessionState(cwd).session_mode).toBe('sprint');
  });

  it('allows claim-required to run in adhoc sessions', () => {
    expect(shouldSuppressGuardInAdhoc('claim-required', cwd, 'test-session')).toBe(false);
  });
});
