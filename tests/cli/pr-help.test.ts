import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execSync: execSyncMock,
  };
});

describe('slope pr review help is read-only (GH #405)', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    execSyncMock.mockReset();
    execSyncMock.mockImplementation(() => {
      throw new Error('execSync should not run for help output');
    });
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints review help for --help without resolving PR state', async () => {
    const { prCommand } = await import('../../src/cli/commands/pr.js');

    await prCommand(['review', '--help']);

    const output = consoleLogSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(output).toContain('slope pr review');
    expect(output).toContain('--pr=N');
    expect(output).toContain('--sprint=N');
    expect(output).toContain('--type=architect|code|both');
    expect(output).toContain('--path=GLOB');
    expect(output).toContain('--exclude-path=GLOB');
    expect(output).toContain('--max-diff-bytes=N');
    expect(output).toContain('--json');
    expect(execSyncMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('prints review help for -h without resolving PR state', async () => {
    const { prCommand } = await import('../../src/cli/commands/pr.js');

    await prCommand(['review', '-h']);

    const output = consoleLogSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(output).toContain('slope pr review');
    expect(output).toContain('--help, -h');
    expect(execSyncMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
