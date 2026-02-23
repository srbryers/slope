import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { HookInput } from '../../src/core/index.js';

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

vi.mock('../../src/cli/config.js', () => ({
  loadConfig: () => mockConfig,
}));

import { exploreGuard } from '../../src/cli/guards/explore.js';
import { hazardGuard } from '../../src/cli/guards/hazard.js';
import { commitNudgeGuard } from '../../src/cli/guards/commit-nudge.js';
import { scopeDriftGuard } from '../../src/cli/guards/scope-drift.js';
import { compactionGuard } from '../../src/cli/guards/compaction.js';
import { stopCheckGuard } from '../../src/cli/guards/stop-check.js';
import { subagentGateGuard } from '../../src/cli/guards/subagent-gate.js';
import { pushNudgeGuard } from '../../src/cli/guards/push-nudge.js';
import { workflowGateGuard } from '../../src/cli/guards/workflow-gate.js';

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

  it('suggests checking map when CODEBASE.md exists', async () => {
    writeFileSync(join(tmpDir, 'CODEBASE.md'), '# Codebase\n');

    const result = await exploreGuard(makeInput(), tmpDir);
    expect(result.context).toContain('CODEBASE.md');
    expect(result.context).toContain("search({ module: 'map' })");
  });

  it('suggests checking index when .slope/index.json exists', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/index.json'), '{}');

    const result = await exploreGuard(makeInput(), tmpDir);
    expect(result.context).toContain('.slope/index.json');
  });

  it('prefers CODEBASE.md map path when it exists alongside other indexes', async () => {
    writeFileSync(join(tmpDir, 'CODEBASE.md'), '# Index');
    mkdirSync(join(tmpDir, 'docs'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs/architecture.md'), '# Arch');

    const result = await exploreGuard(makeInput(), tmpDir);
    expect(result.context).toContain('CODEBASE.md');
    expect(result.context).toContain("search({ module: 'map' })");
  });

  it('falls back to listing index files when no CODEBASE.md', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/index.json'), '{}');
    mkdirSync(join(tmpDir, 'docs'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs/architecture.md'), '# Arch');

    const result = await exploreGuard(makeInput(), tmpDir);
    expect(result.context).toContain('.slope/index.json');
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
    execSync('git init && git config user.email "test@test.com" && git config user.name "Test" && git add -A && git commit -m "init" --allow-empty', { cwd: tmpDir, stdio: 'ignore' });

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

describe('compactionGuard', () => {
  it('returns empty when no session_id', async () => {
    const result = await compactionGuard(makeInput({ session_id: '' }), tmpDir);
    expect(result).toEqual({});
  });

  it('handles missing git repo gracefully', async () => {
    const result = await compactionGuard(makeInput({ session_id: 'test-123' }), tmpDir);
    // Always returns {} (side-effects only guard)
    expect(result).toEqual({});
  });

  it('creates handoffs directory when session_id present', async () => {
    await compactionGuard(makeInput({ session_id: 'test-abcd1234' }), tmpDir);
    expect(existsSync(join(tmpDir, '.slope/handoffs'))).toBe(true);
  });

  it('writes handoff file with session prefix', async () => {
    await compactionGuard(makeInput({ session_id: 'test-abcd1234-rest' }), tmpDir);
    const handoffPath = join(tmpDir, '.slope/handoffs', 'test-abc.json');
    expect(existsSync(handoffPath)).toBe(true);
    const data = JSON.parse(readFileSync(handoffPath, 'utf8'));
    expect(data.session_id).toBe('test-abcd1234-rest');
    expect(data.timestamp).toBeDefined();
  });

  it('uses custom handoffsDir from config', async () => {
    mockConfig.guidance = { handoffsDir: '.custom-handoffs' };
    await compactionGuard(makeInput({ session_id: 'test-abcd1234' }), tmpDir);
    expect(existsSync(join(tmpDir, '.custom-handoffs'))).toBe(true);
  });
});

describe('stopCheckGuard', () => {
  it('returns empty in non-git directory', async () => {
    const result = await stopCheckGuard(makeInput(), tmpDir);
    expect(result).toEqual({});
  });

  it('returns empty when everything is committed and pushed', async () => {
    const { execSync } = await import('node:child_process');
    execSync('git init && git config user.email "test@test.com" && git config user.name "Test" && git commit -m "init" --allow-empty', { cwd: tmpDir, stdio: 'ignore' });

    const result = await stopCheckGuard(makeInput(), tmpDir);
    expect(result).toEqual({});
  });

  it('blocks when uncommitted changes exist', async () => {
    const { execSync } = await import('node:child_process');
    execSync('git init && git config user.email "test@test.com" && git config user.name "Test" && git commit -m "init" --allow-empty', { cwd: tmpDir, stdio: 'ignore' });
    writeFileSync(join(tmpDir, 'dirty.txt'), 'uncommitted');

    const result = await stopCheckGuard(makeInput(), tmpDir);
    expect(result.blockReason).toContain('uncommitted');
    expect(result.blockReason).toContain('SLOPE');
  });

  it('mentions commit and push in block reason', async () => {
    const { execSync } = await import('node:child_process');
    execSync('git init && git config user.email "test@test.com" && git config user.name "Test" && git commit -m "init" --allow-empty', { cwd: tmpDir, stdio: 'ignore' });
    writeFileSync(join(tmpDir, 'dirty.txt'), 'uncommitted');

    const result = await stopCheckGuard(makeInput(), tmpDir);
    expect(result.blockReason).toContain('Commit and push');
  });
});

describe('subagentGateGuard', () => {
  it('passes through non-Task tool types', async () => {
    const result = await subagentGateGuard(
      makeInput({ tool_input: { subagent_type: 'Bash', command: 'ls' } }),
      tmpDir,
    );
    expect(result).toEqual({});
  });

  it('passes through resumed agents', async () => {
    const result = await subagentGateGuard(
      makeInput({ tool_input: { subagent_type: 'Explore', model: 'sonnet', resume: 'agent-123' } }),
      tmpDir,
    );
    expect(result).toEqual({});
  });

  it('denies non-haiku Explore agent', async () => {
    const result = await subagentGateGuard(
      makeInput({ tool_input: { subagent_type: 'Explore', model: 'sonnet', max_turns: 5 } }),
      tmpDir,
    );
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('subagent-gate');
    expect(result.blockReason).toContain('sonnet');
  });

  it('denies missing max_turns', async () => {
    const result = await subagentGateGuard(
      makeInput({ tool_input: { subagent_type: 'Explore', model: 'haiku' } }),
      tmpDir,
    );
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('max_turns');
  });

  it('denies exceeded max_turns', async () => {
    const result = await subagentGateGuard(
      makeInput({ tool_input: { subagent_type: 'Explore', model: 'haiku', max_turns: 50 } }),
      tmpDir,
    );
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('max_turns');
  });

  it('allows correct Explore agent', async () => {
    const result = await subagentGateGuard(
      makeInput({ tool_input: { subagent_type: 'Explore', model: 'haiku', max_turns: 8 } }),
      tmpDir,
    );
    expect(result).toEqual({});
  });

  it('allows correct Plan agent', async () => {
    const result = await subagentGateGuard(
      makeInput({ tool_input: { subagent_type: 'Plan', model: 'haiku', max_turns: 12 } }),
      tmpDir,
    );
    expect(result).toEqual({});
  });

  it('respects custom config thresholds', async () => {
    mockConfig.guidance = {
      subagentExploreTurns: 5,
      subagentPlanTurns: 8,
      subagentAllowModels: ['haiku', 'sonnet'],
    };

    // sonnet allowed with custom config
    const result1 = await subagentGateGuard(
      makeInput({ tool_input: { subagent_type: 'Explore', model: 'sonnet', max_turns: 4 } }),
      tmpDir,
    );
    expect(result1).toEqual({});

    // exceeds custom Explore limit
    const result2 = await subagentGateGuard(
      makeInput({ tool_input: { subagent_type: 'Explore', model: 'haiku', max_turns: 6 } }),
      tmpDir,
    );
    expect(result2.decision).toBe('deny');
  });
});

describe('pushNudgeGuard', () => {
  it('passes through non-git-commit commands', async () => {
    const result = await pushNudgeGuard(
      makeInput({ tool_input: { command: 'npm test' } }),
      tmpDir,
    );
    expect(result).toEqual({});
  });

  it('passes through empty command', async () => {
    const result = await pushNudgeGuard(
      makeInput({ tool_input: {} }),
      tmpDir,
    );
    expect(result).toEqual({});
  });

  it('handles non-git dir gracefully', async () => {
    const result = await pushNudgeGuard(
      makeInput({ tool_input: { command: 'git commit -m "test"' } }),
      tmpDir,
    );
    // Should not throw, may return empty or context
    expect(result.decision).toBeUndefined();
    expect(result.blockReason).toBeUndefined();
  });

  it('is non-blocking (context only, no decision/blockReason)', async () => {
    const { execSync } = await import('node:child_process');
    execSync('git init && git config user.email "test@test.com" && git config user.name "Test" && git commit -m "init" --allow-empty', { cwd: tmpDir, stdio: 'ignore' });

    const result = await pushNudgeGuard(
      makeInput({ tool_input: { command: 'git commit -m "test"' } }),
      tmpDir,
    );
    expect(result.decision).toBeUndefined();
    expect(result.blockReason).toBeUndefined();
  });
});

describe('workflowGateGuard', () => {
  it('passes through when no review-state.json', async () => {
    const result = await workflowGateGuard(makeInput(), tmpDir);
    expect(result).toEqual({});
  });

  it('passes through when rounds complete', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/review-state.json'), JSON.stringify({
      rounds_required: 2,
      rounds_completed: 2,
    }));

    const result = await workflowGateGuard(makeInput(), tmpDir);
    expect(result).toEqual({});
  });

  it('denies when rounds incomplete', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/review-state.json'), JSON.stringify({
      rounds_required: 3,
      rounds_completed: 1,
    }));

    const result = await workflowGateGuard(makeInput(), tmpDir);
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('workflow-gate');
    expect(result.blockReason).toContain('1/3');
  });

  it('handles malformed JSON', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/review-state.json'), 'not json');

    const result = await workflowGateGuard(makeInput(), tmpDir);
    expect(result).toEqual({});
  });

  it('includes plan_file in deny message', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/review-state.json'), JSON.stringify({
      rounds_required: 2,
      rounds_completed: 0,
      plan_file: 'docs/backlog/sprint-22-plan.md',
    }));

    const result = await workflowGateGuard(makeInput(), tmpDir);
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('sprint-22-plan.md');
  });

  it('passes through when state has invalid types', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/review-state.json'), JSON.stringify({
      rounds_required: 'two',
      rounds_completed: 'one',
    }));

    const result = await workflowGateGuard(makeInput(), tmpDir);
    expect(result).toEqual({});
  });
});
