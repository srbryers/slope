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

describe('Pi Extension', () => {
  let tmpDir: string;
  let mockPi: {
    registerTool: ReturnType<typeof vi.fn>;
    registerCommand: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    cwd: string;
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slope-pi-test-'));
    mockPi = {
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      on: vi.fn(),
      sendMessage: vi.fn(),
      cwd: tmpDir,
    };
    mockExecSync.mockReset();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('without .slope project', () => {
    it('registers only slope_init tool', () => {
      slopeExtension(mockPi);
      expect(mockPi.registerTool).toHaveBeenCalledTimes(1);
      expect(mockPi.registerTool.mock.calls[0][0].name).toBe('slope_init');
    });

    it('does not register event handlers', () => {
      slopeExtension(mockPi);
      expect(mockPi.on).not.toHaveBeenCalled();
    });
  });

  describe('with .slope project', () => {
    beforeEach(() => {
      mkdirSync(join(tmpDir, '.slope'), { recursive: true });
      writeFileSync(join(tmpDir, '.slope', 'config.json'), '{}');
      mockExecSync.mockReturnValue('mock output');
    });

    it('registers all SLOPE tools', () => {
      slopeExtension(mockPi);
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
      slopeExtension(mockPi);
      const events = mockPi.on.mock.calls.map((c: unknown[]) => c[0]);
      expect(events).toContain('tool_call');
      expect(events).toContain('tool_result');
      expect(events).toContain('session_start');
    });

    it('registers slash commands', () => {
      slopeExtension(mockPi);
      const commands = mockPi.registerCommand.mock.calls.map((c: unknown[]) => c[0]);
      expect(commands).toContain('slope');
      expect(commands).toContain('sprint');
    });

    it('briefing tool calls slope CLI with --compact', async () => {
      slopeExtension(mockPi);
      const briefingTool = mockPi.registerTool.mock.calls.find(
        (c: unknown[]) => (c[0] as { name: string }).name === 'slope_briefing',
      )?.[0] as { execute: (params: Record<string, unknown>) => Promise<string> };

      await briefingTool.execute({ compact: true });
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('slope briefing --compact'),
        expect.any(Object),
      );
    });

    it('briefing tool calls without --compact when not set', async () => {
      slopeExtension(mockPi);
      const briefingTool = mockPi.registerTool.mock.calls.find(
        (c: unknown[]) => (c[0] as { name: string }).name === 'slope_briefing',
      )?.[0] as { execute: (params: Record<string, unknown>) => Promise<string> };

      await briefingTool.execute({});
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('slope briefing'),
        expect.any(Object),
      );
      // Should NOT contain --compact
      const cmd = mockExecSync.mock.calls[0][0] as string;
      expect(cmd).not.toContain('--compact');
    });

    it('session_start event injects briefing', async () => {
      slopeExtension(mockPi);
      const sessionHandler = mockPi.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'session_start',
      )?.[1] as () => Promise<void>;

      await sessionHandler();
      expect(mockPi.sendMessage).toHaveBeenCalledWith(
        'system',
        expect.stringContaining('SLOPE Session Briefing'),
      );
    });

    it('tool handles errors gracefully', async () => {
      mockExecSync.mockImplementation(() => { throw new Error('slope not found'); });
      slopeExtension(mockPi);
      const cardTool = mockPi.registerTool.mock.calls.find(
        (c: unknown[]) => (c[0] as { name: string }).name === 'slope_card',
      )?.[0] as { execute: (params: Record<string, unknown>) => Promise<string> };

      const result = await cardTool.execute({});
      expect(result).toContain('Error');
    });
  });
});
