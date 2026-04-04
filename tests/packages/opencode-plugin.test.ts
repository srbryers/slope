import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock execSync before importing
const mockExecSync = vi.fn();
vi.mock('node:child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

const { default: slopePlugin } = await import('../../packages/opencode-plugin/src/index.js');

describe('OpenCode Plugin', () => {
  let tmpDir: string;
  let mockCtx: {
    project: { root: string };
    directory: string;
    on: ReturnType<typeof vi.fn>;
    registerCommand: ReturnType<typeof vi.fn>;
  };
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slope-opencode-test-'));
    mockCtx = {
      project: { root: tmpDir },
      directory: tmpDir,
      on: vi.fn(),
      registerCommand: vi.fn(),
    };
    mockExecSync.mockReset();
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    stderrSpy.mockRestore();
  });

  describe('without .slope project', () => {
    it('does not register anything', () => {
      slopePlugin(mockCtx);
      expect(mockCtx.on).not.toHaveBeenCalled();
      expect(mockCtx.registerCommand).not.toHaveBeenCalled();
    });
  });

  describe('with .slope project', () => {
    beforeEach(() => {
      mkdirSync(join(tmpDir, '.slope'), { recursive: true });
      writeFileSync(join(tmpDir, '.slope', 'config.json'), '{}');
      mockExecSync.mockReturnValue('mock output');
    });

    it('registers event handlers', () => {
      slopePlugin(mockCtx);
      const events = mockCtx.on.mock.calls.map((c: unknown[]) => c[0]);
      expect(events).toContain('tool.execute.before');
      expect(events).toContain('tool.execute.after');
      expect(events).toContain('session.created');
    });

    it('registers slash commands', () => {
      slopePlugin(mockCtx);
      const commands = mockCtx.registerCommand.mock.calls.map((c: unknown[]) => c[0]);
      expect(commands).toContain('slope');
      expect(commands).toContain('sprint');
      expect(commands).toContain('guard-check');
    });

    it('session.created injects briefing', async () => {
      slopePlugin(mockCtx);
      const sessionHandler = mockCtx.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'session.created',
      )?.[1] as () => Promise<void>;

      await sessionHandler();
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('SLOPE Session Briefing'),
      );
    });

    it('tool.execute.after fires post-push on git push', async () => {
      slopePlugin(mockCtx);
      const afterHandler = mockCtx.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'tool.execute.after',
      )?.[1] as (toolName: unknown, params: unknown) => Promise<void>;

      await afterHandler('bash', { command: 'git push origin main' });
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('SLOPE: Push complete'),
      );
    });

    it('tool.execute.after ignores non-push commands', async () => {
      slopePlugin(mockCtx);
      const afterHandler = mockCtx.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'tool.execute.after',
      )?.[1] as (toolName: unknown, params: unknown) => Promise<void>;

      await afterHandler('bash', { command: 'ls -la' });
      expect(stderrSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('SLOPE: Push complete'),
      );
    });

    it('tool.execute.before checks branch on git commit', async () => {
      mockExecSync.mockReturnValue('main');
      slopePlugin(mockCtx);
      const beforeHandler = mockCtx.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'tool.execute.before',
      )?.[1] as (toolName: unknown, params: unknown) => Promise<void>;

      await beforeHandler('bash', { command: 'git commit -m "test"' });
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('Committing on main/master'),
      );
    });

    it('/slope command runs slope CLI', async () => {
      slopePlugin(mockCtx);
      const slopeCmd = mockCtx.registerCommand.mock.calls.find(
        (c: unknown[]) => c[0] === 'slope',
      )?.[2] as (args: string) => Promise<string>;

      const result = await slopeCmd('card');
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('slope card'),
        expect.any(Object),
      );
    });

    it('/slope command defaults to briefing --compact', async () => {
      slopePlugin(mockCtx);
      const slopeCmd = mockCtx.registerCommand.mock.calls.find(
        (c: unknown[]) => c[0] === 'slope',
      )?.[2] as (args: string) => Promise<string>;

      await slopeCmd('');
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('slope briefing --compact'),
        expect.any(Object),
      );
    });

    it('handles errors gracefully', async () => {
      mockExecSync.mockImplementation(() => { throw new Error('slope not found'); });
      slopePlugin(mockCtx);
      const slopeCmd = mockCtx.registerCommand.mock.calls.find(
        (c: unknown[]) => c[0] === 'slope',
      )?.[2] as (args: string) => Promise<string>;

      const result = await slopeCmd('card');
      expect(result).toContain('Error');
    });
  });
});
