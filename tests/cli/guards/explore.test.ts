import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HookInput } from '../../../src/core/index.js';

// Mock child_process before importing the guard
let mockExecSyncReturn: string | Error = '0\n';

vi.mock('node:child_process', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    execSync: (...args: unknown[]) => {
      const cmd = args[0] as string;
      if (cmd.includes('git rev-list')) {
        if (mockExecSyncReturn instanceof Error) throw mockExecSyncReturn;
        return mockExecSyncReturn;
      }
      return (orig.execSync as Function)(...args);
    },
  };
});

// Import after mock setup
const { exploreGuard } = await import('../../../src/cli/guards/explore.js');

const tmpDir = join(import.meta.dirname ?? __dirname, '.tmp-explore-test');

function makeInput(toolName: string): HookInput {
  return {
    session_id: 'test-session',
    cwd: tmpDir,
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
  };
}

function writeCodebaseMap(gitSha: string): void {
  const content = `---
generated_at: "2024-01-01T00:00:00Z"
git_sha: "${gitSha}"
sprint: 10
---

# Codebase Map

Some content here for token estimation.
`;
  writeFileSync(join(tmpDir, 'CODEBASE.md'), content);
}

beforeEach(() => {
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
    minSprint: 1,
  }));
  mockExecSyncReturn = '0\n';
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('explore guard — tiered staleness', () => {
  it('returns empty when no index files exist', async () => {
    const result = await exploreGuard(makeInput('Read'), tmpDir);
    expect(result).toEqual({});
  });

  it('returns context with token estimate for current map', async () => {
    writeFileSync(join(tmpDir, 'CODEBASE.md'), '# Map\nSome content');
    const result = await exploreGuard(makeInput('Read'), tmpDir);
    expect(result.context).toContain('CODEBASE.md');
    expect(result.context).toContain('k tokens');
  });

  it('returns warning context when map is in warn range (11-30 commits)', async () => {
    mockExecSyncReturn = '15\n';
    writeCodebaseMap('abc123');
    const result = await exploreGuard(makeInput('Read'), tmpDir);
    expect(result.context).toContain('15 commits stale');
  });

  it('blocks Edit when map is in block range (31+ commits)', async () => {
    mockExecSyncReturn = '35\n';
    writeCodebaseMap('abc123');
    const result = await exploreGuard(makeInput('Edit'), tmpDir);
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('35 commits stale');
    expect(result.blockReason).toContain('slope map');
  });

  it('blocks Write when map is in block range', async () => {
    mockExecSyncReturn = '50\n';
    writeCodebaseMap('abc123');
    const result = await exploreGuard(makeInput('Write'), tmpDir);
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('50 commits stale');
  });

  it('warns but does not block Read when map is in block range', async () => {
    mockExecSyncReturn = '40\n';
    writeCodebaseMap('abc123');
    const result = await exploreGuard(makeInput('Read'), tmpDir);
    expect(result.decision).toBeUndefined();
    expect(result.blockReason).toBeUndefined();
    expect(result.context).toContain('40 commits stale');
  });

  it('warns but does not block Grep when map is in block range', async () => {
    mockExecSyncReturn = '40\n';
    writeCodebaseMap('abc123');
    const result = await exploreGuard(makeInput('Grep'), tmpDir);
    expect(result.decision).toBeUndefined();
    expect(result.context).toContain('40 commits stale');
  });

  it('no warning when within tolerance (0-10 commits)', async () => {
    mockExecSyncReturn = '5\n';
    writeCodebaseMap('abc123');
    const result = await exploreGuard(makeInput('Read'), tmpDir);
    expect(result.context).toContain('k tokens');
    expect(result.context).toContain('L1');
    expect(result.context).not.toContain('stale');
  });

  it('respects custom thresholds from config', async () => {
    writeFileSync(
      join(tmpDir, '.slope', 'config.json'),
      JSON.stringify({
        scorecardDir: 'docs/retros',
        scorecardPattern: 'sprint-*.json',
        minSprint: 1,
        guidance: { mapStaleWarnAt: 5, mapStaleBlockAt: 10 },
      }),
    );
    mockExecSyncReturn = '7\n';
    writeCodebaseMap('abc123');
    const result = await exploreGuard(makeInput('Read'), tmpDir);
    expect(result.context).toContain('7 commits stale');
  });
});
