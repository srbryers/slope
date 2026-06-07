import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => ({
  closeSync: vi.fn(),
  mkdirSync: vi.fn(),
  openSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    closeSync: fsMocks.closeSync,
    mkdirSync: fsMocks.mkdirSync,
    openSync: fsMocks.openSync,
    unlinkSync: fsMocks.unlinkSync,
  };
});

describe('withFileLockSync lock acquisition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.runIf(process.platform === 'win32')('retries transient Windows EPERM lock-open errors', async () => {
    const { withFileLockSync } = await import('../../src/cli/atomic-write.js');
    const filePath = 'C:\\tmp\\counter.json';
    const eperm = new Error(`EPERM: operation not permitted, open '${filePath}.lock'`) as NodeJS.ErrnoException;
    eperm.code = 'EPERM';
    eperm.path = `${filePath}.lock`;

    fsMocks.openSync
      .mockImplementationOnce(() => { throw eperm; })
      .mockReturnValueOnce(42);

    const result = withFileLockSync(filePath, () => 'locked', {
      retryMs: 0,
      timeoutMs: 100,
    });

    expect(result).toBe('locked');
    expect(fsMocks.openSync).toHaveBeenCalledTimes(2);
    expect(fsMocks.closeSync).toHaveBeenCalledWith(42);
    expect(fsMocks.unlinkSync).toHaveBeenCalledWith(`${filePath}.lock`);
  });
});
