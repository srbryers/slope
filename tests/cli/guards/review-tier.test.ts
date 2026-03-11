import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { reviewTierGuard } from '../../../src/cli/guards/review-tier.js';
import { workflowGateGuard } from '../../../src/cli/guards/workflow-gate.js';
import type { HookInput } from '../../../src/core/index.js';

const TMP = join(import.meta.dirname ?? __dirname, '..', '..', '..', '.test-tmp-review-tier');

// Mock homedir so findPlanContent's global fallback doesn't find real user plans
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => TMP };
});

function makeInput(filePath: string): HookInput {
  return {
    session_id: 'test-session',
    cwd: TMP,
    hook_event_name: 'PostToolUse',
    tool_name: 'Write',
    tool_input: { file_path: filePath },
    tool_response: {},
  };
}

function writePlan(content: string, filename = 'test-plan.md'): string {
  const plansDir = join(TMP, '.claude', 'plans');
  mkdirSync(plansDir, { recursive: true });
  const planPath = join(plansDir, filename);
  writeFileSync(planPath, content);
  return planPath;
}

function writeCommonIssues(patterns: Array<{
  title: string;
  description: string;
  prevention: string;
  category: string;
  sprints_hit: number[];
}>): void {
  const slopeDir = join(TMP, '.slope');
  mkdirSync(slopeDir, { recursive: true });
  writeFileSync(join(slopeDir, 'config.json'), JSON.stringify({
    scorecardDir: 'docs/retros',
    commonIssuesPath: '.slope/common-issues.json',
  }));
  writeFileSync(join(slopeDir, 'common-issues.json'), JSON.stringify({
    recurring_patterns: patterns,
  }));
}

function writeReviewState(state: { rounds_required: number; rounds_completed: number }): void {
  const slopeDir = join(TMP, '.slope');
  mkdirSync(slopeDir, { recursive: true });
  writeFileSync(join(slopeDir, 'review-state.json'), JSON.stringify(state));
}

describe('reviewTierGuard', () => {
  beforeEach(() => {
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TMP)) {
      rmSync(TMP, { recursive: true, force: true });
    }
  });

  it('returns empty for non-plan file writes', async () => {
    const input = makeInput(join(TMP, 'src', 'foo.ts'));
    const result = await reviewTierGuard(input, TMP);
    expect(result).toEqual({});
  });

  it('returns empty when file_path is missing', async () => {
    const input: HookInput = {
      session_id: 'test',
      cwd: TMP,
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: {},
      tool_response: {},
    };
    const result = await reviewTierGuard(input, TMP);
    expect(result).toEqual({});
  });

  it('suggests Skip for plan with 0 tickets', async () => {
    const planPath = writePlan('# Research Spike\n\nJust exploring ideas.');
    const input = makeInput(planPath);
    const result = await reviewTierGuard(input, TMP);
    expect(result.blockReason).toContain('0 tickets');
    expect(result.blockReason).toContain('Skip');
  });

  it('suggests Light for plan with 2 tickets, single package', async () => {
    const planPath = writePlan([
      '# Sprint Plan',
      '### T1: Add helper to `packages/core/src/util.ts`',
      'Small utility function.',
      '### T2: Fix bug in `packages/core/src/config.ts`',
      'Simple fix.',
    ].join('\n'));
    const input = makeInput(planPath);
    const result = await reviewTierGuard(input, TMP);
    expect(result.blockReason).toContain('2 tickets');
    expect(result.blockReason).toContain('Light');
  });

  it('suggests Standard for plan with 3 tickets, multi-package', async () => {
    const planPath = writePlan([
      '# Sprint Plan',
      '### T1: Add helper to `packages/core/src/util.ts`',
      'Stuff.',
      '### T2: Update CLI in `packages/cli/src/cmd.ts`',
      'More stuff.',
      '### T3: Fix store in `packages/store-sqlite/src/store.ts`',
      'Even more.',
    ].join('\n'));
    const input = makeInput(planPath);
    const result = await reviewTierGuard(input, TMP);
    expect(result.blockReason).toContain('3 tickets');
    expect(result.blockReason).toContain('Standard');
  });

  it('suggests Deep for plan with 5+ tickets', async () => {
    const planPath = writePlan([
      '# Sprint Plan',
      '### T1: First task',
      '### T2: Second task',
      '### T3: Third task',
      '### T4: Fourth task',
      '### T5: Fifth task',
    ].join('\n'));
    const input = makeInput(planPath);
    const result = await reviewTierGuard(input, TMP);
    expect(result.blockReason).toContain('5 tickets');
    expect(result.blockReason).toContain('Deep');
  });

  it('includes specialist reviewers in context', async () => {
    const planPath = writePlan([
      '# Sprint Plan',
      '### T1: Add database migration `packages/store-sqlite/src/migration.ts`',
      'Schema changes for new table.',
      '### T2: Update backend API `packages/core/src/api.ts`',
      'New endpoint.',
      '### T3: Fix frontend component `packages/cli/src/dashboard.ts`',
      'UI fix.',
    ].join('\n'));
    const input = makeInput(planPath);
    const result = await reviewTierGuard(input, TMP);
    expect(result.blockReason).toContain('Recommended reviewers: architect +');
  });

  it('includes AskUserQuestion instruction', async () => {
    const planPath = writePlan([
      '# Sprint Plan',
      '### T1: Add feature to `packages/core/src/foo.ts`',
      'New feature.',
    ].join('\n'));
    const input = makeInput(planPath);
    const result = await reviewTierGuard(input, TMP);
    expect(result.blockReason).toContain('AskUserQuestion');
    expect(result.blockReason).toContain('Architect review only');
    expect(result.blockReason).toContain('Custom reviewers');
    expect(result.blockReason).toContain('Skip review');
  });

  it('includes relevant gotchas when common issues exist', async () => {
    writeCommonIssues([
      {
        title: 'Guard hook timeout',
        description: 'Guards in cli/guards often timeout when loading large files',
        prevention: 'Always cap file reads in guards to avoid timeout',
        category: 'type-safety',
        sprints_hit: [39, 42],
      },
    ]);
    const planPath = writePlan([
      '# Sprint Plan',
      '### T1: Update guard in `src/cli/guards/hazard.ts`',
      'Modify guard handling.',
    ].join('\n'));
    const input = makeInput(planPath);
    const result = await reviewTierGuard(input, TMP);
    expect(result.blockReason).toContain('Relevant gotchas');
    expect(result.blockReason).toContain('Guard hook timeout');
  });

  it('caps gotchas at 5 entries', async () => {
    const patterns = Array.from({ length: 10 }, (_, i) => ({
      title: `Guards issue ${i}`,
      description: `Description for guards module issue ${i}`,
      prevention: `Prevention for guards issue ${i}`,
      category: 'type-safety',
      sprints_hit: [40 + i],
    }));
    writeCommonIssues(patterns);
    const planPath = writePlan([
      '# Sprint Plan',
      '### T1: Update `src/cli/guards/something.ts`',
      'Changes to guards.',
    ].join('\n'));
    const input = makeInput(planPath);
    const result = await reviewTierGuard(input, TMP);
    if (result.blockReason) {
      const gotchaLines = result.blockReason.split('\n').filter(l => l.trim().startsWith('- ['));
      expect(gotchaLines.length).toBeLessThanOrEqual(5);
    }
  });

  it('handles missing common issues file gracefully', async () => {
    const planPath = writePlan([
      '# Sprint Plan',
      '### T1: Add feature to `packages/core/src/foo.ts`',
      'Work.',
    ].join('\n'));
    const input = makeInput(planPath);
    const result = await reviewTierGuard(input, TMP);
    expect(result.blockReason).toBeDefined();
    expect(result.blockReason).not.toContain('gotchas');
  });

  it('returns empty when review-state already meets tier', async () => {
    writeReviewState({ rounds_required: 3, rounds_completed: 0 });
    const planPath = writePlan([
      '# Sprint Plan',
      '### T1: Task one in `packages/core/src/a.ts`',
      '### T2: Task two in `packages/cli/src/b.ts`',
    ].join('\n'));
    const input = makeInput(planPath);
    const result = await reviewTierGuard(input, TMP);
    // Light (1 round) needed, but state has 3 rounds → passthrough
    expect(result).toEqual({});
  });

  it('matches S\\d+-\\d+: ticket patterns', async () => {
    const planPath = writePlan([
      '# Sprint 50 Plan',
      '### S50-1: First ticket',
      '### S50-2: Second ticket',
      '### S50-3: Third ticket',
    ].join('\n'));
    const input = makeInput(planPath);
    const result = await reviewTierGuard(input, TMP);
    expect(result.blockReason).toContain('3 tickets');
  });

  it('reads plan from tool_input.file_path outside cwd (global plans dir)', async () => {
    // Simulate Claude Code writing to ~/.claude/plans/ by using a separate tmp dir
    const globalDir = join(TMP, '.global-home', '.claude', 'plans');
    mkdirSync(globalDir, { recursive: true });
    const globalPlanPath = join(globalDir, 'sprint-99-plan.md');
    writeFileSync(globalPlanPath, [
      '# Sprint 99 Plan',
      '### T1: Add feature to `src/utils/foo.ts`',
      '### T2: Fix bug in `src/utils/bar.ts`',
    ].join('\n'));

    // file_path points to global dir, not {cwd}/.claude/plans/
    const input = makeInput(globalPlanPath);
    const result = await reviewTierGuard(input, TMP);
    expect(result.blockReason).toContain('2 tickets');
    expect(result.blockReason).toContain('Light');
  });

  it('falls back to findPlanContent when tool_input.file_path is unreadable', async () => {
    // Write plan in cwd (repo-local) so findPlanContent can find it
    writePlan([
      '# Sprint Plan',
      '### T1: Task one',
      '### T2: Task two',
      '### T3: Task three',
    ].join('\n'));

    // Point file_path to a non-existent file — should fall back to findPlanContent
    const input = makeInput(join(TMP, '.claude', 'plans', 'does-not-exist.md'));
    const result = await reviewTierGuard(input, TMP);
    expect(result.blockReason).toContain('3 tickets');
    expect(result.blockReason).toContain('Standard');
  });

  it('returns empty when file_path is unreadable and no plan exists anywhere', async () => {
    // file_path points to a non-existent file, and homedir is mocked to TMP
    // which has no plans either — should return empty.
    const input = makeInput(join(TMP, '.claude', 'plans', 'nonexistent.md'));
    const result = await reviewTierGuard(input, TMP);
    expect(result).toEqual({});
  });

  it('writes review-state.json when plan is detected', async () => {
    const planPath = writePlan([
      '# Sprint 60 Plan',
      '### S60-1: First ticket',
      '### S60-2: Second ticket',
      '### S60-3: Third ticket',
    ].join('\n'));
    const input = makeInput(planPath);
    await reviewTierGuard(input, TMP);

    const statePath = join(TMP, '.slope', 'review-state.json');
    expect(existsSync(statePath)).toBe(true);
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    expect(state.rounds_required).toBe(2); // Standard tier
    expect(state.rounds_completed).toBe(0);
    expect(state.tier).toBe('standard');
    expect(state.started_at).toBeDefined();
  });

  it('does not overwrite review-state.json when re-fired with same tier', async () => {
    const planPath = writePlan([
      '# Sprint Plan',
      '### T1: Task one',
      '### T2: Task two',
      '### T3: Task three',
    ].join('\n'));
    const input = makeInput(planPath);

    // First fire — creates state
    await reviewTierGuard(input, TMP);
    const statePath = join(TMP, '.slope', 'review-state.json');
    const firstState = JSON.parse(readFileSync(statePath, 'utf8'));

    // Second fire — same plan, same tier → early return, no overwrite
    const result = await reviewTierGuard(input, TMP);
    expect(result).toEqual({});
    const secondState = JSON.parse(readFileSync(statePath, 'utf8'));
    expect(secondState.started_at).toBe(firstState.started_at);
  });

  it('does not write review-state.json for Skip tier (0 rounds)', async () => {
    const planPath = writePlan('# Research Spike\n\nJust exploring ideas.');
    const input = makeInput(planPath);
    await reviewTierGuard(input, TMP);

    const statePath = join(TMP, '.slope', 'review-state.json');
    // Skip tier writes 0 rounds — file is still created but gate won't block
    if (existsSync(statePath)) {
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      expect(state.rounds_required).toBe(0);
    }
  });
});

describe('workflowGateGuard', () => {
  beforeEach(() => {
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TMP)) {
      rmSync(TMP, { recursive: true, force: true });
    }
  });

  function makeGateInput(): HookInput {
    return {
      session_id: 'test-session',
      cwd: TMP,
      hook_event_name: 'PreToolUse',
      tool_name: 'ExitPlanMode',
      tool_input: {},
      tool_response: {},
    };
  }

  it('allows ExitPlanMode when no review-state exists', async () => {
    const result = await workflowGateGuard(makeGateInput(), TMP);
    expect(result).toEqual({});
  });

  it('blocks ExitPlanMode when rounds_completed < rounds_required', async () => {
    writeReviewState({ rounds_required: 3, rounds_completed: 0 });
    const result = await workflowGateGuard(makeGateInput(), TMP);
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('0/3');
    expect(result.blockReason).toContain('slope review start --tier=');
    expect(result.blockReason).toContain('slope review round');
    expect(result.blockReason).toContain('slope review start --tier=skip');
  });

  it('allows ExitPlanMode when rounds are complete', async () => {
    writeReviewState({ rounds_required: 2, rounds_completed: 2 });
    const result = await workflowGateGuard(makeGateInput(), TMP);
    expect(result).toEqual({});
  });
});
