import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock execSync before importing the extension
const mockExecSync = vi.fn();
vi.mock('node:child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

// Import after mocks are set up
const { default: slopeExtension } = await import('../../packages/pi-extension/src/index.js');

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
      expect(mockPi.registerCommand).not.toHaveBeenCalled();
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

    it('before_agent_start injects briefing message on first turn', async () => {
      slopeExtension(mockPi as never, tmpDir);
      const handler = mockPi.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'before_agent_start',
      )?.[1] as (_event: unknown, ctx: unknown) => Promise<{ message: { content: string } } | undefined>;

      const result = await handler({}, makeCtx(tmpDir));
      expect(result?.message.content).toContain('SLOPE Session Briefing');

      // Second call should return nothing (dedup)
      const result2 = await handler({}, makeCtx(tmpDir));
      expect(result2).toBeUndefined();
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
  });
});
