import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { HookInput } from '@slope-dev/core';

// Mock loadConfig before importing guards
const mockConfig = {
  scorecardDir: 'docs/retros',
  scorecardPattern: 'sprint-*.json',
  minSprint: 1,
  commonIssuesPath: '.slope/common-issues.json',
  sessionsPath: '.slope/sessions.json',
  registry: 'file' as const,
  claimsPath: '.slope/claims.json',
  roadmapPath: 'docs/backlog/roadmap.json',
  metaphor: 'golf',
  guidance: {} as Record<string, unknown>,
};

vi.mock('../src/config.js', () => ({
  loadConfig: () => mockConfig,
}));

import { exploreGuard } from '../src/guards/explore.js';
import { hazardGuard } from '../src/guards/hazard.js';
import { commitNudgeGuard } from '../src/guards/commit-nudge.js';
import { scopeDriftGuard } from '../src/guards/scope-drift.js';

let tmpDir: string;

function makeInput(overrides: Partial<HookInput> = {}): HookInput {
  return {
    session_id: 'test-session',
    cwd: tmpDir,
    hook_event_name: 'PreToolUse',
    tool_name: 'Read',
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-guard-'));
  mockConfig.guidance = {};
});

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
});

describe('exploreGuard', () => {
  it('returns empty when no index files exist', async () => {
    const result = await exploreGuard(makeInput(), tmpDir);
    expect(result).toEqual({});
  });

  it('suggests checking index when CODEBASE.md exists', async () => {
    writeFileSync(join(tmpDir, 'CODEBASE.md'), '# Codebase\n');

    const result = await exploreGuard(makeInput(), tmpDir);
    expect(result.context).toContain('CODEBASE.md');
    expect(result.context).toContain('check before deep exploration');
  });

  it('suggests checking index when .slope/index.json exists', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/index.json'), '{}');

    const result = await exploreGuard(makeInput(), tmpDir);
    expect(result.context).toContain('.slope/index.json');
  });

  it('lists multiple index files when several exist', async () => {
    writeFileSync(join(tmpDir, 'CODEBASE.md'), '# Index');
    mkdirSync(join(tmpDir, 'docs'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs/architecture.md'), '# Arch');

    const result = await exploreGuard(makeInput(), tmpDir);
    expect(result.context).toContain('CODEBASE.md');
    expect(result.context).toContain('docs/architecture.md');
  });

  it('uses custom indexPaths from config', async () => {
    mockConfig.guidance = { indexPaths: ['custom-index.md'] };
    writeFileSync(join(tmpDir, 'custom-index.md'), '# Custom');

    const result = await exploreGuard(makeInput(), tmpDir);
    expect(result.context).toContain('custom-index.md');
  });
});

describe('hazardGuard', () => {
  it('returns empty when no file path in input', async () => {
    const result = await hazardGuard(makeInput({ tool_input: {} }), tmpDir);
    expect(result).toEqual({});
  });

  it('returns empty when no common issues file', async () => {
    const result = await hazardGuard(
      makeInput({ tool_input: { file_path: join(tmpDir, 'src/foo.ts') } }),
      tmpDir,
    );
    expect(result).toEqual({});
  });

  it('warns when editing in area with known issues', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/common-issues.json'), JSON.stringify({
      recurring_patterns: [
        {
          id: 1,
          title: 'Migration conflict in core',
          category: 'database',
          sprints_hit: [5],
          gotcha_refs: [],
          description: 'core package has migration issues',
          prevention: 'Always check schema before modifying core files',
        },
      ],
    }));

    const result = await hazardGuard(
      makeInput({ tool_input: { file_path: join(tmpDir, 'packages/core/src/store.ts') } }),
      tmpDir,
    );
    expect(result.context).toContain('hazard warning');
    expect(result.context).toContain('Migration conflict in core');
  });

  it('returns empty when area has no matching issues', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/common-issues.json'), JSON.stringify({
      recurring_patterns: [
        {
          id: 1,
          title: 'Mobile-only issue',
          category: 'mobile',
          sprints_hit: [3],
          gotcha_refs: [],
          description: 'Only affects mobile',
          prevention: 'Check mobile rendering',
        },
      ],
    }));

    const result = await hazardGuard(
      makeInput({ tool_input: { file_path: join(tmpDir, 'packages/cli/src/index.ts') } }),
      tmpDir,
    );
    expect(result).toEqual({});
  });

  it('does not include permissionDecision (non-blocking)', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/common-issues.json'), JSON.stringify({
      recurring_patterns: [
        {
          id: 1,
          title: 'Core issue',
          category: 'testing',
          sprints_hit: [8],
          gotcha_refs: [],
          description: 'Affects core package testing',
          prevention: 'Run tests after editing core',
        },
      ],
    }));

    const result = await hazardGuard(
      makeInput({ tool_input: { file_path: join(tmpDir, 'packages/core/src/foo.ts') } }),
      tmpDir,
    );
    expect(result.decision).toBeUndefined();
    expect(result.blockReason).toBeUndefined();
  });
});

describe('commitNudgeGuard', () => {
  it('returns empty in non-git directory', async () => {
    const result = await commitNudgeGuard(makeInput(), tmpDir);
    expect(result).toEqual({});
  });

  it('returns empty when no uncommitted changes', async () => {
    // Initialize a git repo with a commit
    const { execSync } = await import('node:child_process');
    execSync('git init && git add -A && git commit -m "init" --allow-empty', { cwd: tmpDir, stdio: 'ignore' });

    const result = await commitNudgeGuard(makeInput(), tmpDir);
    expect(result).toEqual({});
  });

  it('is non-blocking (no decision/blockReason)', async () => {
    const result = await commitNudgeGuard(makeInput(), tmpDir);
    expect(result.decision).toBeUndefined();
    expect(result.blockReason).toBeUndefined();
  });
});

describe('scopeDriftGuard', () => {
  it('returns empty when no file path in input', async () => {
    const result = await scopeDriftGuard(makeInput({ tool_input: {} }), tmpDir);
    expect(result).toEqual({});
  });

  it('returns empty when no currentSprint in config', async () => {
    const result = await scopeDriftGuard(
      makeInput({ tool_input: { file_path: join(tmpDir, 'src/foo.ts') } }),
      tmpDir,
    );
    expect(result).toEqual({});
  });

  it('returns empty when scopeDrift is disabled', async () => {
    mockConfig.guidance = { scopeDrift: false };
    const result = await scopeDriftGuard(
      makeInput({ tool_input: { file_path: join(tmpDir, 'src/foo.ts') } }),
      tmpDir,
    );
    expect(result).toEqual({});
  });

  it('is non-blocking (no decision/blockReason)', async () => {
    const result = await scopeDriftGuard(makeInput({ tool_input: {} }), tmpDir);
    expect(result.decision).toBeUndefined();
    expect(result.blockReason).toBeUndefined();
  });
});
