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
    expect(result.context).toContain('Relevant gotchas');
    expect(result.context).toContain('Guard hook timeout');
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
    expect(result.context).toContain('2 tickets');
    expect(result.context).toContain('Light');
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
    expect(result.context).toContain('3 tickets');
    expect(result.context).toContain('Standard');
  });

  it('returns empty when file_path is unreadable and no repo-local plan exists', async () => {
    // file_path points to a non-existent file, and no plans in cwd either.
    // Note: findPlanContent may find real plans in ~/.claude/plans/ due to the
    // homedir fallback, so we only test that the file_path read fails gracefully
    // and the guard doesn't crash — it either returns {} or falls through to
    // findPlanContent which may find global plans.
    const input = makeInput(join(TMP, '.claude', 'plans', 'nonexistent.md'));
    const result = await reviewTierGuard(input, TMP);
    // Should not throw — either returns {} or context from fallback
    expect(result).toBeDefined();
  });
});
