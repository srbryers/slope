import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const resolveStoreMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/cli/store.js', () => ({
  resolveStore: resolveStoreMock,
}));

describe('slope claim help is read-only (GH #410)', () => {
  let tmpDir: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slope-claim-help-'));
    resolveStoreMock.mockReset();
    resolveStoreMock.mockImplementation(() => {
      throw new Error('resolveStore should not run for help output');
    });
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as never);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('prints usage for --help before resolving storage or validating --target', async () => {
    const { claimCommand } = await import('../../../src/cli/commands/claim.js');

    await claimCommand(['--help']);

    const output = consoleLogSpy.mock.calls.map(call => String(call[0])).join('\n');
    expect(output).toContain('slope claim --target=<target>');
    expect(output).toContain('--scope=<scope>');
    expect(output).toContain('--actor=<name>');
    expect(output).toContain('--force');
    expect(output).toContain('--help, -h');
    expect(resolveStoreMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(existsSync(join(tmpDir, '.slope'))).toBe(false);
  });

  it('prints usage for -h before resolving storage or validating --target', async () => {
    const { claimCommand } = await import('../../../src/cli/commands/claim.js');

    await claimCommand(['-h']);

    const output = consoleLogSpy.mock.calls.map(call => String(call[0])).join('\n');
    expect(output).toContain('slope claim --target=<target>');
    expect(resolveStoreMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(existsSync(join(tmpDir, '.slope'))).toBe(false);
  });
});
