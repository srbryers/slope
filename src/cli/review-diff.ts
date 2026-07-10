import { spawn } from 'node:child_process';

export const DEFAULT_REVIEW_DIFF_BYTES = 256 * 1024;
export const MAX_REVIEW_DIFF_BYTES = 4 * 1024 * 1024;

const GH_STDOUT_LIMIT = 32 * 1024 * 1024;
const GH_STDERR_LIMIT = 16 * 1024;
const GH_TIMEOUT_MS = 45_000;
const FILES_PAGE_SIZE = 20;
const GITHUB_FILES_LIMIT = 3_000;

export interface BoundedProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdoutOverflow: boolean;
  stderrOverflow: boolean;
  spawnCode?: string;
}

export interface BoundedProcessOptions {
  cwd?: string;
  timeoutMs?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
}

export type ReviewGhRunner = (
  args: string[],
  options?: BoundedProcessOptions,
) => Promise<BoundedProcessResult>;

export type ReviewDiffErrorKind =
  | 'gh-missing'
  | 'auth'
  | 'lookup'
  | 'timeout'
  | 'buffer'
  | 'provider'
  | 'malformed-response';

export class ReviewDiffError extends Error {
  constructor(
    public readonly kind: ReviewDiffErrorKind,
    public readonly stage: string,
    message: string,
    public readonly exitCode: number | null = null,
    public readonly stderr = '',
  ) {
    super(message);
    this.name = 'ReviewDiffError';
  }
}

export interface ReviewDiffScope {
  include: string[];
  exclude: string[];
  maxDiffBytes: number;
}

export type ProviderPatchState = 'complete' | 'partial' | 'omitted';

export interface ReviewDiffFile {
  filename: string;
  previousFilename?: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  expectedChangedLines: number;
  providerChangedLines: number;
  providerPatchState: ProviderPatchState;
  includedPatch: string;
  localTruncated: boolean;
}

export interface ReviewPatchCoverage {
  complete: string[];
  providerPartial: string[];
  providerOmitted: string[];
  localTruncated: string[];
}

export interface ReviewDiffResult {
  prNum: number;
  repository: string;
  allFiles: string[];
  files: ReviewDiffFile[];
  includedDiffBytes: number;
  includedDiffLines: number;
  coverage: ReviewPatchCoverage;
  providerFileListTruncated: boolean;
}

interface GitHubPullFile {
  filename: string;
  previous_filename?: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

function appendBounded(
  chunks: Buffer[],
  chunk: Buffer,
  retained: { bytes: number },
  maxBytes: number,
): boolean {
  const available = Math.max(0, maxBytes - retained.bytes);
  if (available > 0) {
    const kept = chunk.subarray(0, available);
    chunks.push(kept);
    retained.bytes += kept.length;
  }
  return chunk.length > available;
}

/** Spawn without a shell, drain both pipes, and retain only bounded output. */
export function runBoundedProcess(
  command: string,
  args: string[],
  options: BoundedProcessOptions = {},
): Promise<BoundedProcessResult> {
  const maxStdoutBytes = options.maxStdoutBytes ?? GH_STDOUT_LIMIT;
  const maxStderrBytes = options.maxStderrBytes ?? GH_STDERR_LIMIT;
  const timeoutMs = options.timeoutMs ?? GH_TIMEOUT_MS;

  return new Promise(resolve => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const stdoutRetained = { bytes: 0 };
    const stderrRetained = { bytes: 0 };
    let stdoutOverflow = false;
    let stderrOverflow = false;
    let timedOut = false;
    let spawnCode: string | undefined;
    let settled = false;

    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    child.stdout.on('data', (value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      stdoutOverflow = appendBounded(stdout, chunk, stdoutRetained, maxStdoutBytes) || stdoutOverflow;
    });
    child.stderr.on('data', (value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      stderrOverflow = appendBounded(stderr, chunk, stderrRetained, maxStderrBytes) || stderrOverflow;
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      spawnCode = error.code;
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.on('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode,
        signal,
        timedOut,
        stdoutOverflow,
        stderrOverflow,
        spawnCode,
      });
    });
  });
}

export function sanitizeGhDiagnostic(input: string): string {
  return input
    .replace(/\b(?:github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]+)\b/g, '[REDACTED]')
    .replace(/(Authorization\s*:\s*(?:bearer|token)\s+)\S+/gi, '$1[REDACTED]')
    .replace(/\b((?:GH|GITHUB)_TOKEN\s*=\s*)\S+/gi, '$1[REDACTED]')
    .replace(/([?&](?:access_token|token)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^/@\s]+@/gi, '$1[REDACTED]@')
    .trim();
}

function classifyFailure(stage: string, result: BoundedProcessResult): ReviewDiffError {
  const sanitized = sanitizeGhDiagnostic(result.stderr);
  const diagnostic = result.stderrOverflow
    ? `${sanitized}${sanitized ? '\n' : ''}...[gh stderr truncated by bounded diagnostic capture]`
    : sanitized;
  if (result.spawnCode === 'ENOENT') {
    return new ReviewDiffError('gh-missing', stage, 'GitHub CLI (`gh`) is not installed or not on PATH.');
  }
  if (result.timedOut) {
    return new ReviewDiffError('timeout', stage, `GitHub command timed out during ${stage}.`, result.exitCode, diagnostic);
  }
  if (result.stdoutOverflow) {
    return new ReviewDiffError('buffer', stage, `GitHub response exceeded the bounded buffer during ${stage}.`, result.exitCode, diagnostic);
  }
  if (/authentication|auth login|not logged|HTTP 401|bad credentials/i.test(diagnostic)) {
    return new ReviewDiffError('auth', stage, 'GitHub authentication failed. Run `gh auth login` and retry.', result.exitCode, diagnostic);
  }
  if (stage === 'PR lookup' && /no pull requests found|could not resolve|not found|HTTP 404/i.test(diagnostic)) {
    return new ReviewDiffError('lookup', stage, 'The requested pull request could not be resolved.', result.exitCode, diagnostic);
  }
  return new ReviewDiffError('provider', stage, `GitHub command failed during ${stage}.`, result.exitCode, diagnostic);
}

async function runGhChecked(
  runner: ReviewGhRunner,
  args: string[],
  stage: string,
  cwd: string,
): Promise<string> {
  const result = await runner(args, {
    cwd,
    timeoutMs: GH_TIMEOUT_MS,
    maxStdoutBytes: GH_STDOUT_LIMIT,
    maxStderrBytes: GH_STDERR_LIMIT,
  });
  if (result.exitCode !== 0 || result.spawnCode || result.timedOut || result.stdoutOverflow) {
    throw classifyFailure(stage, result);
  }
  return result.stdout.trim();
}

function normalizeReviewPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function globToRegExp(rawPattern: string): RegExp {
  let pattern = normalizeReviewPath(rawPattern.trim());
  if (pattern.endsWith('/')) pattern += '**';
  const basenamePattern = !pattern.includes('/');
  let source = basenamePattern ? '(?:^|/)' : '^';

  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        i += 1;
        if (pattern[i + 1] === '/') {
          i += 1;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`${source}$`);
}

export function matchesReviewScope(
  filename: string,
  previousFilename: string | undefined,
  scope: Pick<ReviewDiffScope, 'include' | 'exclude'>,
): boolean {
  const candidates = [filename, previousFilename].filter((value): value is string => Boolean(value)).map(normalizeReviewPath);
  const included = scope.include.length === 0
    || scope.include.some(pattern => {
      const regex = globToRegExp(pattern);
      return candidates.some(candidate => regex.test(candidate));
    });
  if (!included) return false;
  return !scope.exclude.some(pattern => {
    const regex = globToRegExp(pattern);
    return candidates.some(candidate => regex.test(candidate));
  });
}

function countChangedPatchLines(patch: string): number {
  let count = 0;
  for (const line of patch.split('\n')) {
    // GitHub's per-file REST patch begins at a hunk header and does not
    // contain unified-diff file headers, so even `+++content` is an authored
    // addition and must count toward metadata coverage.
    if (line.startsWith('+') || line.startsWith('-')) {
      count += 1;
    }
  }
  return count;
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function utf8Prefix(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  if (utf8Bytes(value) <= maxBytes) return value;
  let end = Math.min(value.length, maxBytes);
  while (end > 0 && utf8Bytes(value.slice(0, end)) > maxBytes) end -= 1;
  return value.slice(0, end);
}

function allocatePatchBudgets(sizes: number[], budget: number): number[] {
  const allocations = new Array<number>(sizes.length).fill(0);
  let remainingBudget = budget;
  let remaining = sizes.map((_, index) => index).filter(index => sizes[index] > 0);

  while (remaining.length > 0 && remainingBudget > 0) {
    const share = Math.floor(remainingBudget / remaining.length);
    if (share === 0) {
      for (let i = 0; i < Math.min(remainingBudget, remaining.length); i += 1) allocations[remaining[i]] += 1;
      break;
    }
    const completed = remaining.filter(index => sizes[index] <= share);
    if (completed.length === 0) {
      for (const index of remaining) allocations[index] = share;
      remainingBudget -= share * remaining.length;
      for (let i = 0; i < remainingBudget; i += 1) allocations[remaining[i % remaining.length]] += 1;
      break;
    }
    for (const index of completed) {
      allocations[index] = sizes[index];
      remainingBudget -= sizes[index];
    }
    const completedSet = new Set(completed);
    remaining = remaining.filter(index => !completedSet.has(index));
  }
  return allocations;
}

function parsePullFiles(raw: string, stage: string): GitHubPullFile[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ReviewDiffError('malformed-response', stage, `GitHub returned malformed JSON during ${stage}.`);
  }
  if (!Array.isArray(value)) {
    throw new ReviewDiffError('malformed-response', stage, `GitHub returned an unexpected response during ${stage}.`);
  }
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new ReviewDiffError('malformed-response', stage, `GitHub returned an invalid file record at index ${index}.`);
    }
    const record = item as Record<string, unknown>;
    if (typeof record.filename !== 'string' || typeof record.status !== 'string') {
      throw new ReviewDiffError('malformed-response', stage, `GitHub returned an invalid file record at index ${index}.`);
    }
    return {
      filename: normalizeReviewPath(record.filename),
      previous_filename: typeof record.previous_filename === 'string' ? normalizeReviewPath(record.previous_filename) : undefined,
      status: record.status,
      additions: typeof record.additions === 'number' ? record.additions : 0,
      deletions: typeof record.deletions === 'number' ? record.deletions : 0,
      changes: typeof record.changes === 'number' ? record.changes : 0,
      patch: typeof record.patch === 'string' ? record.patch : undefined,
    };
  });
}

export async function collectReviewDiff(
  cwd: string,
  requestedPr: number | undefined,
  scope: ReviewDiffScope,
  runner: ReviewGhRunner = (args, options) => runBoundedProcess('gh', args, options),
): Promise<ReviewDiffResult> {
  const prArgs = ['pr', 'view'];
  if (requestedPr != null) prArgs.push(String(requestedPr));
  prArgs.push('--json', 'number', '--jq', '.number');
  const prRaw = await runGhChecked(runner, prArgs, 'PR lookup', cwd);
  const prNum = Number(prRaw);
  if (!Number.isInteger(prNum) || prNum <= 0) {
    throw new ReviewDiffError('malformed-response', 'PR lookup', 'GitHub returned an invalid pull request number.');
  }

  const repository = await runGhChecked(
    runner,
    ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
    'repository lookup',
    cwd,
  );
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    throw new ReviewDiffError('malformed-response', 'repository lookup', 'GitHub returned an invalid repository name.');
  }

  const allFiles: string[] = [];
  const selected: Array<GitHubPullFile & { providerPatchState: ProviderPatchState; providerChangedLines: number }> = [];
  let reachedProviderLimit = false;

  for (let page = 1; allFiles.length < GITHUB_FILES_LIMIT; page += 1) {
    const stage = `PR file metadata page ${page}`;
    const raw = await runGhChecked(runner, [
      'api', '--method', 'GET',
      `repos/${repository}/pulls/${prNum}/files`,
      '-f', `per_page=${FILES_PAGE_SIZE}`,
      '-f', `page=${page}`,
    ], stage, cwd);
    const records = parsePullFiles(raw, stage);
    for (const record of records) {
      allFiles.push(record.filename);
      if (!matchesReviewScope(record.filename, record.previous_filename, scope)) continue;
      const expectedChangedLines = record.additions + record.deletions;
      const providerChangedLines = record.patch ? countChangedPatchLines(record.patch) : 0;
      const providerPatchState: ProviderPatchState = record.patch == null
        ? 'omitted'
        : providerChangedLines < expectedChangedLines ? 'partial' : 'complete';
      selected.push({ ...record, providerPatchState, providerChangedLines });
    }
    if (records.length < FILES_PAGE_SIZE) break;
    if (allFiles.length >= GITHUB_FILES_LIMIT) reachedProviderLimit = true;
  }

  const sizes = selected.map(record => utf8Bytes(record.patch ?? ''));
  const patchCount = sizes.filter(size => size > 0).length;
  // Joining per-file patches adds a newline separator. Reserve those bytes so
  // --max-diff-bytes remains a true upper bound rather than an approximation.
  const patchBudget = Math.max(0, scope.maxDiffBytes - Math.max(0, patchCount - 1));
  const allocations = allocatePatchBudgets(sizes, patchBudget);
  const files: ReviewDiffFile[] = selected.map((record, index) => {
    const patch = record.patch ?? '';
    const includedPatch = utf8Prefix(patch, allocations[index]);
    return {
      filename: record.filename,
      previousFilename: record.previous_filename,
      status: record.status,
      additions: record.additions,
      deletions: record.deletions,
      changes: record.changes,
      expectedChangedLines: record.additions + record.deletions,
      providerChangedLines: record.providerChangedLines,
      providerPatchState: record.providerPatchState,
      includedPatch,
      localTruncated: utf8Bytes(includedPatch) < utf8Bytes(patch),
    };
  });

  const coverage: ReviewPatchCoverage = {
    complete: files.filter(file => file.providerPatchState === 'complete' && !file.localTruncated).map(file => file.filename),
    providerPartial: files.filter(file => file.providerPatchState === 'partial').map(file => file.filename),
    providerOmitted: files.filter(file => file.providerPatchState === 'omitted').map(file => file.filename),
    localTruncated: files.filter(file => file.localTruncated).map(file => file.filename),
  };
  const combinedPatch = files.map(file => file.includedPatch).filter(Boolean).join('\n');

  return {
    prNum,
    repository,
    allFiles,
    files,
    includedDiffBytes: utf8Bytes(combinedPatch),
    includedDiffLines: combinedPatch ? combinedPatch.split('\n').length : 0,
    coverage,
    providerFileListTruncated: reachedProviderLimit,
  };
}

export function formatReviewDiffError(error: ReviewDiffError): string {
  const details = [`Review diff failed (${error.kind}) during ${error.stage}: ${error.message}`];
  details.push(`gh exit code: ${error.exitCode == null ? 'unavailable' : error.exitCode}`);
  if (error.stderr) details.push(`gh stderr: ${error.stderr}`);
  return details.join('\n');
}
