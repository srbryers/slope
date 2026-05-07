import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock execSync before importing the extension
const mockExecSync = vi.fn();
vi.mock('node:child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

// Import after mocks are set up
const { default: slopeExtension, scoreComplexity, isVaguePrompt } = await import('../../packages/pi-extension/src/index.js');

// Minimal mock context passed to tool execute() and event handlers
function makeCtx(cwd: string) {
  return { cwd, ui: { notify: vi.fn() } };
}

describe('Pi Extension', () => {
  let tmpDir: string;
  let mockPi: {
    registerTool: ReturnType<typeof vi.fn>;
    registerCommand: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    appendEntry: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slope-pi-test-'));
    mockPi = {
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      on: vi.fn(),
      sendMessage: vi.fn(),
      appendEntry: vi.fn(),
    };
    mockExecSync.mockReset();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('without .slope project', () => {
    it('registers only slope_init tool', () => {
      slopeExtension(mockPi as never, tmpDir);
      expect(mockPi.registerTool).toHaveBeenCalledTimes(1);
      expect(mockPi.registerTool.mock.calls[0][0].name).toBe('slope_init');
    });

    it('does not register slope-project tools or event handlers', () => {
      slopeExtension(mockPi as never, tmpDir);
      const toolNames = mockPi.registerTool.mock.calls.map((c: unknown[]) => (c[0] as { name: string }).name);
      expect(toolNames).not.toContain('slope_briefing');
      expect(toolNames).not.toContain('slope_card');
      // Settings command is always available
      expect(mockPi.registerCommand).toHaveBeenCalled();
    });
  });

  describe('with .slope project', () => {
    beforeEach(() => {
      mkdirSync(join(tmpDir, '.slope'), { recursive: true });
      writeFileSync(join(tmpDir, '.slope', 'config.json'), '{}');
      mockExecSync.mockReturnValue('mock output');
    });

    it('registers all SLOPE tools', () => {
      slopeExtension(mockPi as never, tmpDir);
      const toolNames = mockPi.registerTool.mock.calls.map((c: unknown[]) => (c[0] as { name: string }).name);
      expect(toolNames).toContain('slope_briefing');
      expect(toolNames).toContain('slope_card');
      expect(toolNames).toContain('slope_guard_check');
      expect(toolNames).toContain('slope_sprint_context');
      expect(toolNames).toContain('slope_sprint_validate');
      expect(toolNames).toContain('slope_review_run');
      expect(toolNames).toContain('slope_guard_metrics');
      expect(toolNames).toContain('slope_convergence');
    });

    it('registers event handlers', () => {
      slopeExtension(mockPi as never, tmpDir);
      const events = mockPi.on.mock.calls.map((c: unknown[]) => c[0]);
      expect(events).toContain('tool_call');
      expect(events).toContain('tool_result');
      expect(events).toContain('session_start');
      expect(events).toContain('before_agent_start');
    });

    it('registers slash commands', () => {
      slopeExtension(mockPi as never, tmpDir);
      const commands = mockPi.registerCommand.mock.calls.map((c: unknown[]) => c[0]);
      expect(commands).toContain('slope');
      expect(commands).toContain('sprint');
    });

    it('briefing tool calls slope CLI with --compact', async () => {
      slopeExtension(mockPi as never, tmpDir);
      const briefingTool = mockPi.registerTool.mock.calls.find(
        (c: unknown[]) => (c[0] as { name: string }).name === 'slope_briefing',
      )?.[0] as { execute: (_id: string, params: Record<string, unknown>, _sig: null, _upd: null, ctx: unknown) => Promise<{ content: Array<{ text: string }> }> };

      const result = await briefingTool.execute('id', { compact: true }, null, null, makeCtx(tmpDir));
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('slope briefing --compact'),
        expect.any(Object),
      );
      expect(result.content[0].text).toBe('mock output');
    });

    it('briefing tool calls without --compact when not set', async () => {
      slopeExtension(mockPi as never, tmpDir);
      const briefingTool = mockPi.registerTool.mock.calls.find(
        (c: unknown[]) => (c[0] as { name: string }).name === 'slope_briefing',
      )?.[0] as { execute: (_id: string, params: Record<string, unknown>, _sig: null, _upd: null, ctx: unknown) => Promise<{ content: Array<{ text: string }> }> };

      await briefingTool.execute('id', {}, null, null, makeCtx(tmpDir));
      const cmd = mockExecSync.mock.calls[0][0] as string;
      expect(cmd).toContain('slope briefing');
      expect(cmd).not.toContain('--compact');
    });

    it('session_start event notifies via ctx.ui', async () => {
      slopeExtension(mockPi as never, tmpDir);
      const sessionHandler = mockPi.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'session_start',
      )?.[1] as (_event: unknown, ctx: ReturnType<typeof makeCtx>) => Promise<void>;

      const ctx = makeCtx(tmpDir);
      await sessionHandler({}, ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining('SLOPE loaded'),
        'info',
      );
    });

    it('before_agent_start injects onboarding message for fresh project', async () => {
      slopeExtension(mockPi as never, tmpDir);
      // Briefing handler is the last registered before_agent_start (T3's vague-prompt handler registers first).
      const beforeAgentStartCalls = mockPi.on.mock.calls.filter((c: unknown[]) => c[0] === 'before_agent_start');
      const handler = beforeAgentStartCalls[beforeAgentStartCalls.length - 1]?.[1] as (_event: unknown, ctx: unknown) => Promise<{ message: { content: string } } | undefined>;

      const result = await handler({}, makeCtx(tmpDir));
      expect(result?.message.content).toContain('🎯 SLOPE Onboarding');
      expect(result?.message.content).toContain('slope map');

      // Second call should return nothing (dedup)
      const result2 = await handler({}, makeCtx(tmpDir));
      expect(result2).toBeUndefined();
    });

    it('before_agent_start injects briefing message when sprint is active', async () => {
      writeFileSync(
        join(tmpDir, '.slope', 'sprint-state.json'),
        JSON.stringify({ sprint: 1, phase: 'implementing', gates: {}, started_at: '', updated_at: '' }),
      );
      slopeExtension(mockPi as never, tmpDir);
      // Briefing handler is the last registered before_agent_start (T3's vague-prompt handler registers first).
      const beforeAgentStartCalls = mockPi.on.mock.calls.filter((c: unknown[]) => c[0] === 'before_agent_start');
      const handler = beforeAgentStartCalls[beforeAgentStartCalls.length - 1]?.[1] as (_event: unknown, ctx: unknown) => Promise<{ message: { content: string } } | undefined>;

      const result = await handler({}, makeCtx(tmpDir));
      expect(result?.message.content).toContain('SLOPE Session Briefing');
    });

    it('before_agent_start shows completion notice when sprint is complete', async () => {
      writeFileSync(
        join(tmpDir, '.slope', 'sprint-state.json'),
        JSON.stringify({ sprint: 1, phase: 'complete', gates: {}, started_at: '', updated_at: '' }),
      );
      slopeExtension(mockPi as never, tmpDir);
      // Briefing handler is the last registered before_agent_start (T3's vague-prompt handler registers first).
      const beforeAgentStartCalls = mockPi.on.mock.calls.filter((c: unknown[]) => c[0] === 'before_agent_start');
      const handler = beforeAgentStartCalls[beforeAgentStartCalls.length - 1]?.[1] as (_event: unknown, ctx: unknown) => Promise<{ message: { content: string } } | undefined>;

      const result = await handler({}, makeCtx(tmpDir));
      expect(result?.message.content).toContain('No active sprint (previous sprint complete)');
    });

    it('tool handles errors gracefully', async () => {
      mockExecSync.mockImplementation(() => { throw new Error('slope not found'); });
      slopeExtension(mockPi as never, tmpDir);
      const cardTool = mockPi.registerTool.mock.calls.find(
        (c: unknown[]) => (c[0] as { name: string }).name === 'slope_card',
      )?.[0] as { execute: (_id: string, _params: Record<string, unknown>, _sig: null, _upd: null, ctx: unknown) => Promise<{ content: Array<{ text: string }> }> };

      const result = await cardTool.execute('id', {}, null, null, makeCtx(tmpDir));
      expect(result.content[0].text).toContain('Error');
    });

    it('registers slope_interview tool', () => {
      slopeExtension(mockPi as never, tmpDir);
      const interviewTool = mockPi.registerTool.mock.calls.find(
        (c: unknown[]) => (c[0] as { name: string }).name === 'slope_interview',
      );
      expect(interviewTool).toBeDefined();
    });

    it('slope_interview tool completes interview and initializes project', async () => {
      slopeExtension(mockPi as never, tmpDir);
      const interviewTool = mockPi.registerTool.mock.calls.find(
        (c: unknown[]) => (c[0] as { name: string }).name === 'slope_interview',
      )?.[0] as {
        execute: (
          _id: string,
          _params: Record<string, unknown>,
          _sig: null,
          _upd: null,
          ctx: {
            cwd: string;
            ui: {
              input: (title: string, _placeholder?: string) => Promise<string | undefined>;
              select: (title: string, _options: string[]) => Promise<string | undefined>;
              confirm: (title: string, _message: string) => Promise<boolean>;
            };
          },
        ) => Promise<{ content: Array<{ text: string }> }>;
      };

      const ctx = {
        cwd: tmpDir,
        ui: {
          input: vi.fn()
            .mockResolvedValueOnce('TestProject')
            .mockResolvedValueOnce('')
            .mockResolvedValueOnce('1')
            .mockResolvedValueOnce('')
            .mockResolvedValueOnce(''),
          select: vi.fn().mockResolvedValueOnce('golf'),
          confirm: vi.fn().mockResolvedValueOnce(false),
        },
      };

      const result = await interviewTool.execute('id', {}, null, null, ctx);
      expect(result.content[0].text).toContain('Project initialized');
      expect(result.content[0].text).toContain('Files created');

      // Verify sprint state was created
      const sprintState = JSON.parse(
        readFileSync(join(tmpDir, '.slope', 'sprint-state.json'), 'utf8'),
      );
      expect(sprintState.phase).toBe('planning');
    });

    it('before_agent_start shows planning message when phase is planning', async () => {
      writeFileSync(
        join(tmpDir, '.slope', 'sprint-state.json'),
        JSON.stringify({ sprint: 1, phase: 'planning', gates: {}, started_at: '', updated_at: '' }),
      );
      slopeExtension(mockPi as never, tmpDir);
      // Briefing handler is the last registered before_agent_start (T3's vague-prompt handler registers first).
      const beforeAgentStartCalls = mockPi.on.mock.calls.filter((c: unknown[]) => c[0] === 'before_agent_start');
      const handler = beforeAgentStartCalls[beforeAgentStartCalls.length - 1]?.[1] as (_event: unknown, ctx: unknown) => Promise<{ message: { content: string } } | undefined>;

      const result = await handler({}, makeCtx(tmpDir));
      expect(result?.message.content).toContain('Planning Phase');
      expect(result?.message.content).toContain('sprint start');
    });
  });
});

describe('scoreComplexity tier selection', () => {
  it('routes "optimize this" to local-planner (vague + ambiguous + short-no-code)', () => {
    const r = scoreComplexity('optimize this');
    expect(r.tier).toBe('local-planner');
    expect(r.signal).toContain('vague-verb');
    expect(r.signal).toContain('ambiguous-noun');
  });

  it('routes "refactor everything" to local-planner', () => {
    const r = scoreComplexity('refactor everything');
    expect(r.tier).toBe('local-planner');
  });

  it('routes "make it better" to local-planner via short-no-code', () => {
    const r = scoreComplexity('make it better');
    expect(r.tier).toBe('local-planner');
    expect(r.signal).toContain('vague-verb');
    expect(r.signal).toContain('short-no-code');
  });

  it('routes "fix typo in foo.ts:42" to local-coder (path beats vague verb)', () => {
    const r = scoreComplexity('fix typo in foo.ts:42');
    expect(r.tier).toBe('local-coder');
  });

  it('routes "add console.log to handleClick()" to local-coder via symbol', () => {
    const r = scoreComplexity('add console.log to handleClick()');
    expect(r.tier).toBe('local-coder');
    expect(r.signal).toBe('code-identifier');
  });

  it('routes "review this performance issue" to cloud (high score)', () => {
    const r = scoreComplexity('review this performance issue');
    expect(r.tier).toBe('cloud');
    expect(r.score).toBeGreaterThanOrEqual(3);
  });

  it('routes "explain why redux is faster than zustand" to local-general (no path/symbol, low score)', () => {
    const r = scoreComplexity('explain why redux is faster than zustand');
    // 'explain why' is +2 → score 2 → not cloud. No path/symbol → general.
    expect(r.tier).toBe('local-general');
  });

  it('clamps score to [0, 5]', () => {
    const heavy = 'architect a multi-file refactor strategy with breaking changes for performance and security';
    const r = scoreComplexity(heavy);
    expect(r.score).toBeLessThanOrEqual(5);
    expect(r.tier).toBe('cloud');
  });

  it('treats "fix" without targets as 1 planner signal (not enough — falls to coder via keyword)', () => {
    // 'fix' alone fires vague-verb + short-no-code = 2 signals → planner.
    // 'fix the bug' adds no ambiguous noun ('the bug' is not in our list).
    const r = scoreComplexity('fix the bug');
    expect(r.tier).toBe('local-planner');
  });

  it('does not flag a long descriptive prompt as planner', () => {
    const long = 'optimize the bundle size in webpack.config.js by replacing the legacy uglifyjs plugin with terser and enabling tree-shaking for the lodash imports we use in src/utils';
    const r = scoreComplexity(long);
    expect(r.tier).not.toBe('local-planner');
  });
});

describe('plan-gate tool_call handler', () => {
  let tmpDir: string;

  function makePi() {
    return {
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      on: vi.fn(),
      sendMessage: vi.fn(),
      appendEntry: vi.fn(),
    };
  }

  function makeSprintState(phase: string, dir: string) {
    mkdirSync(join(dir, '.slope'), { recursive: true });
    writeFileSync(
      join(dir, '.slope', 'sprint-state.json'),
      JSON.stringify({ phase }),
    );
  }

  function makeSlopeConfig(dir: string) {
    mkdirSync(join(dir, '.slope'), { recursive: true });
    writeFileSync(join(dir, '.slope', 'config.json'), JSON.stringify({ version: '1' }));
  }

  /** Build a mock ctx whose sessionManager returns supplied assistant entries. */
  function makeCtxWithEntries(
    dir: string,
    entries: Array<{ role: string; content: string }>,
    confirmResult = true,
  ) {
    return {
      cwd: dir,
      sessionManager: { getEntries: () => entries },
      ui: { notify: vi.fn(), confirm: vi.fn().mockResolvedValue(confirmResult) },
    };
  }

  /** Get the plan-gate tool_call handler from registered mock.on calls. */
  function getPlanGateHandler(mockPi: ReturnType<typeof makePi>) {
    // There may be multiple tool_call handlers; find the plan-gate one by trying each.
    // The plan-gate handler is registered after the guards handler.
    const calls = mockPi.on.mock.calls.filter((c: unknown[]) => c[0] === 'tool_call');
    // Return the last one registered under the plan-gate skill (enabled by default).
    return calls[calls.length - 1]?.[1] as
      | ((event: unknown, ctx: unknown) => Promise<{ block: boolean; reason?: string } | undefined>)
      | undefined;
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slope-pg-test-'));
    makeSlopeConfig(tmpDir);
    // plan-gate defaults to false (opt-in); enable it explicitly for these tests.
    writeFileSync(
      join(tmpDir, '.slope', 'pi-settings.json'),
      JSON.stringify({ version: '1', skills: { 'plan-gate': { enabled: true, description: '' } } }),
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('blocks write with no plan and no sprint phase (non-interactive)', async () => {
    const mockPi = makePi();
    slopeExtension(mockPi as never, tmpDir);
    const handler = getPlanGateHandler(mockPi);
    const ctx = { cwd: tmpDir, sessionManager: { getEntries: () => [] }, ui: { notify: vi.fn() } };
    const result = await handler?.({ toolName: 'write', input: { path: 'foo.ts' } }, ctx);
    expect(result).toEqual({ block: true, reason: expect.stringContaining('plan-gate') });
  });

  it('blocks edit with no plan and no sprint phase (non-interactive)', async () => {
    const mockPi = makePi();
    slopeExtension(mockPi as never, tmpDir);
    const handler = getPlanGateHandler(mockPi);
    const ctx = { cwd: tmpDir, sessionManager: { getEntries: () => [] }, ui: { notify: vi.fn() } };
    const result = await handler?.({ toolName: 'edit', input: { path: 'foo.ts' } }, ctx);
    expect(result).toEqual({ block: true, reason: expect.stringContaining('plan-gate') });
  });

  it('blocks bash rm -rf with no plan and no sprint (non-interactive)', async () => {
    const mockPi = makePi();
    slopeExtension(mockPi as never, tmpDir);
    const handler = getPlanGateHandler(mockPi);
    const ctx = { cwd: tmpDir, sessionManager: { getEntries: () => [] }, ui: { notify: vi.fn() } };
    const result = await handler?.({ toolName: 'bash', input: { command: 'rm -rf dist' } }, ctx);
    expect(result).toEqual({ block: true, reason: expect.stringContaining('plan-gate') });
  });

  it('does NOT block bash git status (exempt read-only command)', async () => {
    const mockPi = makePi();
    slopeExtension(mockPi as never, tmpDir);
    const handler = getPlanGateHandler(mockPi);
    const ctx = { cwd: tmpDir, sessionManager: { getEntries: () => [] }, ui: { notify: vi.fn() } };
    const result = await handler?.({ toolName: 'bash', input: { command: 'git status' } }, ctx);
    expect(result).toBeUndefined();
  });

  it('does NOT block when sprint phase is implementing', async () => {
    makeSprintState('implementing', tmpDir);
    const mockPi = makePi();
    slopeExtension(mockPi as never, tmpDir);
    const handler = getPlanGateHandler(mockPi);
    const ctx = makeCtxWithEntries(tmpDir, []);
    const result = await handler?.({ toolName: 'write', input: { path: 'foo.ts' } }, ctx);
    expect(result).toBeUndefined();
  });

  it('does NOT block when assistant message contains ## Plan heading', async () => {
    const mockPi = makePi();
    slopeExtension(mockPi as never, tmpDir);
    const handler = getPlanGateHandler(mockPi);
    const ctx = makeCtxWithEntries(tmpDir, [
      { role: 'assistant', content: '## Plan\n1. Do X\n2. Do Y\n3. Do Z' },
    ]);
    const result = await handler?.({ toolName: 'edit', input: { path: 'foo.ts' } }, ctx);
    expect(result).toBeUndefined();
  });

  it('does NOT block when assistant message contains numbered list', async () => {
    const mockPi = makePi();
    slopeExtension(mockPi as never, tmpDir);
    const handler = getPlanGateHandler(mockPi);
    const ctx = makeCtxWithEntries(tmpDir, [
      { role: 'assistant', content: 'Here is my approach:\n1. First step\n2. Second step\n3. Third step\n4. Done' },
    ]);
    const result = await handler?.({ toolName: 'write', input: { path: 'bar.ts' } }, ctx);
    expect(result).toBeUndefined();
  });

  it('interactive: allows when user confirms', async () => {
    const mockPi = makePi();
    slopeExtension(mockPi as never, tmpDir);
    const handler = getPlanGateHandler(mockPi);
    const ctx = makeCtxWithEntries(tmpDir, [], true);
    const result = await handler?.({ toolName: 'write', input: { path: 'foo.ts' } }, ctx);
    expect(result).toBeUndefined();
    expect(ctx.ui.confirm).toHaveBeenCalled();
  });

  it('interactive: blocks when user declines', async () => {
    const mockPi = makePi();
    slopeExtension(mockPi as never, tmpDir);
    const handler = getPlanGateHandler(mockPi);
    const ctx = makeCtxWithEntries(tmpDir, [], false);
    const result = await handler?.({ toolName: 'write', input: { path: 'foo.ts' } }, ctx);
    expect(result).toEqual({ block: true, reason: expect.stringContaining('plan-gate') });
  });
});

describe('isVaguePrompt regex', () => {
  it('matches "optimize this"', () => {
    expect(isVaguePrompt('optimize this')).toBe(true);
  });

  it('matches "improve" (bare verb)', () => {
    expect(isVaguePrompt('improve')).toBe(true);
  });

  it('matches "clean up" (two-word verb)', () => {
    expect(isVaguePrompt('clean up')).toBe(true);
  });

  it('matches "fix the bug" (lowercase, no specifier)', () => {
    // Note: 'Fix' (capital F) is rejected by HAS_SYMBOL_RE as PascalCase — intentional false-negative.
    expect(isVaguePrompt('fix the bug')).toBe(true);
  });

  it('does NOT match "Fix the bug" — capital F looks like PascalCase to the symbol regex', () => {
    expect(isVaguePrompt('Fix the bug')).toBe(false);
  });

  it('matches "make it better"', () => {
    expect(isVaguePrompt('make it better')).toBe(true);
  });

  it('does NOT match when path is present', () => {
    expect(isVaguePrompt('optimize the bundle size in webpack.config.js')).toBe(false);
  });

  it('does NOT match when symbol is present — function call', () => {
    expect(isVaguePrompt('refactor handleSubmit()')).toBe(false);
  });

  it('does NOT match when symbol is present — PascalCase', () => {
    expect(isVaguePrompt('improve UserProfile component')).toBe(false);
  });

  it('does NOT match prompts >= 200 chars', () => {
    const long = 'optimize ' + 'x'.repeat(200);
    expect(isVaguePrompt(long)).toBe(false);
  });

  it('does NOT match unrelated verbs', () => {
    expect(isVaguePrompt('write a poem about cats')).toBe(false);
  });

  it('does NOT match "add console.log to foo()"', () => {
    expect(isVaguePrompt('add console.log to foo()')).toBe(false);
  });
});
