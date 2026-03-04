import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { reviewTierGuard } from '../../../src/cli/guards/review-tier.js';
import type { HookInput } from '../../../src/core/index.js';

const TMP = join(import.meta.dirname ?? __dirname, '..', '..', '..', '.test-tmp-review-tier');

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
    expect(result.context).toContain('0 tickets');
    expect(result.context).toContain('Skip');
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
    expect(result.context).toContain('2 tickets');
    expect(result.context).toContain('Light');
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
    expect(result.context).toContain('3 tickets');
    expect(result.context).toContain('Standard');
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
    expect(result.context).toContain('5 tickets');
    expect(result.context).toContain('Deep');
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
    expect(result.context).toContain('Recommended reviewers: architect +');
  });

  it('includes AskUserQuestion instruction', async () => {
    const planPath = writePlan([
      '# Sprint Plan',
      '### T1: Add feature to `packages/core/src/foo.ts`',
      'New feature.',
    ].join('\n'));
    const input = makeInput(planPath);
    const result = await reviewTierGuard(input, TMP);
    expect(result.context).toContain('AskUserQuestion');
    expect(result.context).toContain('Architect review only');
    expect(result.context).toContain('Custom reviewers');
    expect(result.context).toContain('Skip review');
  });

  it('includes relevant gotchas when common issues exist', async () => {
    writeCommonIssues([
      {
        title: 'Config type mismatch',
        description: 'SlopeConfig has nested guidance field',
        prevention: 'Always read type definition before using config',
        category: 'type-safety',
        sprints_hit: [39, 42],
      },
    ]);
    const planPath = writePlan([
      '# Sprint Plan',
      '### T1: Update config in `src/core/config.ts`',
      'Modify config handling.',
    ].join('\n'));
    const input = makeInput(planPath);
    const result = await reviewTierGuard(input, TMP);
    expect(result.context).toContain('Relevant gotchas');
    expect(result.context).toContain('Config type mismatch');
  });

  it('caps gotchas at 5 entries', async () => {
    const patterns = Array.from({ length: 10 }, (_, i) => ({
      title: `Issue ${i}`,
      description: `Description for core module issue ${i}`,
      prevention: `Prevention for core issue ${i}`,
      category: 'type-safety',
      sprints_hit: [40 + i],
    }));
    writeCommonIssues(patterns);
    const planPath = writePlan([
      '# Sprint Plan',
      '### T1: Update `src/core/something.ts`',
      'Changes to core.',
    ].join('\n'));
    const input = makeInput(planPath);
    const result = await reviewTierGuard(input, TMP);
    if (result.context) {
      const gotchaLines = result.context.split('\n').filter(l => l.trim().startsWith('- ['));
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
    expect(result.context).toBeDefined();
    expect(result.context).not.toContain('gotchas');
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
    expect(result.context).toContain('3 tickets');
  });
});
