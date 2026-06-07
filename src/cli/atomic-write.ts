import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const DEFAULT_LOCK_RETRY_MS = 10;
const DEFAULT_STALE_LOCK_MS = 60000;
const WINDOWS_TRANSIENT_LOCK_ERRORS = new Set(['EPERM', 'EACCES']);

export interface FileLockOptions {
  timeoutMs?: number;
  retryMs?: number;
  staleMs?: number;
}

export function createAtomicTempPath(filePath: string): string {
  const unique = `${process.pid}.${Date.now()}.${randomBytes(6).toString('hex')}`;
  return join(dirname(filePath), `.${basename(filePath)}.${unique}.tmp`);
}

export function atomicWriteFileSync(filePath: string, contents: string): void {
  mkdirSync(dirname(filePath), { recursive: true });

  const tmpPath = createAtomicTempPath(filePath);
  try {
    writeFileSync(tmpPath, contents);
    renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // Preserve the original write/rename failure.
    }
    throw error;
  }
}

function sleepSync(ms: number): void {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, ms);
}

function unlinkIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function removeStaleLock(lockPath: string, staleMs: number): void {
  try {
    const stat = statSync(lockPath);
    if (Date.now() - stat.mtimeMs > staleMs) {
      unlinkIfPresent(lockPath);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function isRetryableLockOpenError(error: NodeJS.ErrnoException): boolean {
  if (error.code === 'EEXIST') return true;
  return process.platform === 'win32' && WINDOWS_TRANSIENT_LOCK_ERRORS.has(error.code ?? '');
}

export function withFileLockSync<T>(
  filePath: string,
  callback: () => T,
  options: FileLockOptions = {},
): T {
  mkdirSync(dirname(filePath), { recursive: true });

  const lockPath = `${filePath}.lock`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const retryMs = options.retryMs ?? DEFAULT_LOCK_RETRY_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_LOCK_MS;
  const deadline = Date.now() + timeoutMs;
  let fd: number | null = null;
  let lastAcquisitionError: NodeJS.ErrnoException | null = null;

  while (fd === null) {
    try {
      fd = openSync(lockPath, 'wx');
    } catch (error) {
      const lockError = error as NodeJS.ErrnoException;
      if (!isRetryableLockOpenError(lockError)) throw error;

      lastAcquisitionError = lockError;
      removeStaleLock(lockPath, staleMs);
      if (Date.now() >= deadline) {
        const detail = lastAcquisitionError.code ? ` Last error: ${lastAcquisitionError.code}.` : '';
        throw new Error(`Timed out waiting for file lock: ${lockPath}.${detail}`);
      }
      sleepSync(retryMs);
    }
  }

  try {
    return callback();
  } finally {
    try {
      closeSync(fd);
    } finally {
      unlinkIfPresent(lockPath);
    }
  }
}
