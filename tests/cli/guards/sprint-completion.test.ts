import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { sprintCompletionGuard } from '../../../src/cli/guards/sprint-completion.js';
import { recordPrCloseoutSettled, recordPrReviewComplete } from '../../../src/cli/pr-review-state.js';
import { saveSprintState, createSprintState, loadSprintState } from '../../../src/cli/sprint-state.js';
import type { HookInput } from '../../../src/core/index.js';

let tmpDir: string;
const cleanupDirs: string[] = [];

function makePreToolUse(command: string): HookInput {
  return {
    session_id: 'test-session',
    cwd: tmpDir,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
  };
}

function makeStop(): HookInput {
  return {
    session_id: 'test-session',
    cwd: tmpDir,
    hook_event_name: 'Stop',
  };
}

function makePostToolUse(command: string, exitCode: number | string): HookInput {
  return {
    session_id: 'test-session',
    cwd: tmpDir,
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    tool_response: { exit_code: exitCode },
  };
}

function writeConfig(): void {
  writeConfigAt(tmpDir);
}

function writeConfigAt(cwd: string): void {
  mkdirSync(join(cwd, '.slope'), { recursive: true });
  writeFileSync(join(cwd, '.slope', 'config.json'), JSON.stringify({
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
    minSprint: 1,
    roadmapPath: 'docs/backlog/roadmap.json',
  }));
}

function writeScorecard(sprint: number): void {
  writeScorecardAt(tmpDir, sprint);
}

function writeScorecardAt(cwd: string, sprint: number): void {
  const dir = join(cwd, 'docs', 'retros');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `sprint-${sprint}.json`), JSON.stringify({ sprint_number: sprint, score: 4, par: 4 }));
}

function writeRoadmap(sprints: Array<{ id: number; status?: string }>): void {
  writeRoadmapAt(tmpDir, sprints);
}

function writeRoadmapAt(cwd: string, sprints: Array<{ id: number; status?: string }>): void {
  const dir = join(cwd, 'docs', 'backlog');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'roadmap.json'), JSON.stringify({
    name: 'Test',
    phases: [{ name: 'P1', sprints: sprints.map(s => s.id) }],
    sprints: sprints.map(s => ({
      id: s.id, theme: `S${s.id}`, par: 4, slope: 2, type: 'feature',
      tickets: [{ key: `S${s.id}-1`, title: 'T1', club: 'short_iron', complexity: 'standard' }],
      status: s.status ?? 'planned',
    })),
  }));
}

function satisfyReviewGates(state: ReturnType<typeof createSprintState>): void {
  state.review_gates.code_review = {
    provenance: 'independent_review',
    evidence: ['agent:code-reviewer-output'],
    reviewer: 'code-reviewer',
  };
  state.review_gates.architect_review = {
    provenance: 'independent_review',
    evidence: ['agent:architect-reviewer-output'],
    reviewer: 'architect-reviewer',
  };
}

function initGitBranch(branch: string): void {
  execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir });
  writeFileSync(join(tmpDir, 'README.md'), 'initial\n');
  execFileSync('git', ['add', 'README.md'], { cwd: tmpDir });
  execFileSync('git', ['commit', '-m', 'chore: initial'], { cwd: tmpDir, stdio: 'ignore' });
  execFileSync('git', ['checkout', '-b', branch], { cwd: tmpDir, stdio: 'ignore' });
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-sprint-completion-'));
  mkdirSync(tmpDir, { recursive: true });
  writeConfig();
});

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('sprint-completion guard', () => {
  describe('no sprint state', () => {
    it('no-ops on PreToolUse when no sprint-state', async () => {
      const result = await sprintCompletionGuard(makePreToolUse('gh pr create --title "t"'), tmpDir);
      expect(result).toEqual({});
    });

    it('no-ops on Stop when no sprint-state', async () => {
      const result = await sprintCompletionGuard(makeStop(), tmpDir);
      expect(result).toEqual({});
    });

    it('no-ops on PostToolUse when no sprint-state', async () => {
      const result = await sprintCompletionGuard(makePostToolUse('bun test', 0), tmpDir);
      expect(result).toEqual({});
    });
  });

  describe('all gates complete', () => {
    beforeEach(() => {
      const state = createSprintState(22, 'implementing');
      state.gates.tests = true;
      state.gates.code_review = true;
      state.gates.architect_review = true;
      state.gates.scorecard = true;
      state.gates.review_md = true;
      satisfyReviewGates(state);
      saveSprintState(tmpDir, state);
      writeScorecard(22); // scorecard must exist too
    });

    it('allows gh pr create', async () => {
      const result = await sprintCompletionGuard(makePreToolUse('gh pr create --title "t"'), tmpDir);
      expect(result).toEqual({});
    });

    it('allows Stop', async () => {
      const result = await sprintCompletionGuard(makeStop(), tmpDir);
      expect(result).toEqual({});
    });
  });

  describe('phase = complete', () => {
    beforeEach(() => {
      const state = createSprintState(22, 'complete');
      saveSprintState(tmpDir, state);
    });

    it('allows gh pr create even with incomplete gates', async () => {
      const result = await sprintCompletionGuard(makePreToolUse('gh pr create --title "t"'), tmpDir);
      expect(result).toEqual({});
    });

    it('allows Stop', async () => {
      const result = await sprintCompletionGuard(makeStop(), tmpDir);
      expect(result).toEqual({});
    });
  });

  describe('incomplete gates', () => {
    beforeEach(() => {
      const state = createSprintState(22, 'implementing');
      state.gates.tests = true; // only tests done
      saveSprintState(tmpDir, state);
    });

    it('denies gh pr create with gate list', async () => {
      const result = await sprintCompletionGuard(makePreToolUse('gh pr create --title "feat"'), tmpDir);
      expect(result.decision).toBe('deny');
      expect(result.blockReason).toContain('Sprint 22');
      expect(result.blockReason).toContain('Code review');
      expect(result.blockReason).toContain('Architect review');
      expect(result.blockReason).toContain('Scorecard validated');
      expect(result.blockReason).toContain('Review markdown generated');
      // Tests should NOT be listed (already complete)
      expect(result.blockReason).not.toContain('Tests passing');
    });

    it('advises on Stop with gate list', async () => {
      const result = await sprintCompletionGuard(makeStop(), tmpDir);
      expect(result.context).toContain('Sprint 22');
      expect(result.context).toContain('Code review');
    });

    it('does not block non-PR Bash commands', async () => {
      const result = await sprintCompletionGuard(makePreToolUse('git push -u origin main'), tmpDir);
      expect(result).toEqual({});
    });

    it('does not block gh issue create when gh pr create appears only in quoted body text', async () => {
      const result = await sprintCompletionGuard(
        makePreToolUse('gh issue create --title "bug" --body "gh pr create is blocked by sprint-completion"'),
        tmpDir,
      );
      expect(result).toEqual({});
    });

    it('rebinds stale sprint-state to the branch sprint before PR gate checks (#503)', async () => {
      initGitBranch('feat/sprint-66-schedule-cms');
      saveSprintState(tmpDir, createSprintState(65, 'implementing'));
      writeScorecard(66);

      const result = await sprintCompletionGuard(makePreToolUse('gh pr create --title "S66"'), tmpDir);

      expect(result.decision).toBe('deny');
      expect(result.blockReason).toContain('Sprint 66');
      expect(result.blockReason).not.toContain('Sprint 65 has incomplete gates');
      expect(result.blockReason).toContain('rebound stale sprint-state from Sprint 65 to Sprint 66');

      const state = loadSprintState(tmpDir)!;
      expect(state.sprint).toBe(66);
      expect(state.phase).toBe('scoring');
    });

    it('uses the shell cd target as the sprint-state and scorecard cwd for gh pr create', async () => {
      const worktreeDir = join(tmpDir, 'linked-worktree');
      writeConfigAt(worktreeDir);

      const staleMainState = createSprintState(160, 'implementing');
      staleMainState.gates.tests = true;
      staleMainState.gates.code_review = true;
      staleMainState.gates.architect_review = true;
      staleMainState.gates.scorecard = true;
      staleMainState.gates.review_md = true;
      satisfyReviewGates(staleMainState);
      saveSprintState(tmpDir, staleMainState);

      const worktreeState = createSprintState(160, 'implementing');
      worktreeState.gates.tests = true;
      worktreeState.gates.code_review = true;
      worktreeState.gates.architect_review = true;
      worktreeState.gates.scorecard = true;
      worktreeState.gates.review_md = true;
      satisfyReviewGates(worktreeState);
      saveSprintState(worktreeDir, worktreeState);
      writeScorecardAt(worktreeDir, 160);

      const result = await sprintCompletionGuard(
        makePreToolUse(`cd "${worktreeDir}" && gh pr create --title "S160"`),
        tmpDir,
      );
      expect(result).toEqual({});
    });

    it('expands tilde shell cd targets before checking gh pr create state', async () => {
      const homeWorktreeDir = mkdtempSync(join(homedir(), '.slope-pr-worktree-'));
      cleanupDirs.push(homeWorktreeDir);
      const homeRelativePath = relative(homedir(), homeWorktreeDir);
      writeConfigAt(homeWorktreeDir);

      const incorrectlyResolvedDir = join(tmpDir, '~', homeRelativePath);
      writeConfigAt(incorrectlyResolvedDir);
      saveSprintState(incorrectlyResolvedDir, createSprintState(161, 'implementing'));

      const worktreeState = createSprintState(161, 'implementing');
      worktreeState.gates.tests = true;
      worktreeState.gates.code_review = true;
      worktreeState.gates.architect_review = true;
      worktreeState.gates.scorecard = true;
      worktreeState.gates.review_md = true;
      satisfyReviewGates(worktreeState);
      saveSprintState(homeWorktreeDir, worktreeState);
      writeScorecardAt(homeWorktreeDir, 161);

      const result = await sprintCompletionGuard(
        makePreToolUse(`cd ~/${homeRelativePath} && gh pr create --title "S161"`),
        tmpDir,
      );
      expect(result).toEqual({});
    });
  });

  describe('Stop only blocks during implementing/scoring phases', () => {
    it('does not block during planning phase', async () => {
      saveSprintState(tmpDir, createSprintState(22, 'planning'));
      const result = await sprintCompletionGuard(makeStop(), tmpDir);
      expect(result).toEqual({});
    });

    it('does not block during reviewing phase', async () => {
      saveSprintState(tmpDir, createSprintState(22, 'reviewing'));
      const result = await sprintCompletionGuard(makeStop(), tmpDir);
      expect(result).toEqual({});
    });

    it('advises during scoring phase', async () => {
      saveSprintState(tmpDir, createSprintState(22, 'scoring'));
      const result = await sprintCompletionGuard(makeStop(), tmpDir);
      expect(result.context).toContain('Sprint 22');
    });
  });

  describe('PostToolUse auto-detect test pass', () => {
    beforeEach(() => {
      saveSprintState(tmpDir, createSprintState(22, 'implementing'));
    });

    it('marks tests gate on jest exit 0', async () => {
      const result = await sprintCompletionGuard(makePostToolUse('npx jest', 0), tmpDir);
      expect(result.context).toContain('Tests passed');
      const state = loadSprintState(tmpDir)!;
      expect(state.gates.tests).toBe(true);
    });

    it('marks tests gate on bun test exit 0', async () => {
      const result = await sprintCompletionGuard(makePostToolUse('bun test', 0), tmpDir);
      expect(result.context).toContain('Tests passed');
    });

    it('marks tests gate on vitest exit 0', async () => {
      const result = await sprintCompletionGuard(makePostToolUse('npx vitest', 0), tmpDir);
      expect(result.context).toContain('Tests passed');
    });

    it('uses the shell cd target as the sprint-state cwd when marking tests complete', async () => {
      const worktreeDir = join(tmpDir, 'post-tool-worktree');
      writeConfigAt(worktreeDir);
      saveSprintState(worktreeDir, createSprintState(160, 'implementing'));

      const result = await sprintCompletionGuard(
        makePostToolUse(`cd "${worktreeDir}" && npx vitest`, 0),
        tmpDir,
      );

      expect(result.context).toContain('Tests passed');
      expect(loadSprintState(worktreeDir)!.gates.tests).toBe(true);
      expect(loadSprintState(tmpDir)!.gates.tests).toBe(false);
    });

    it('does not mark gate on test failure (exit 1)', async () => {
      const result = await sprintCompletionGuard(makePostToolUse('npx jest', 1), tmpDir);
      expect(result).toEqual({});
      const state = loadSprintState(tmpDir)!;
      expect(state.gates.tests).toBe(false);
    });

    it('does not mark gate for non-test commands', async () => {
      const result = await sprintCompletionGuard(makePostToolUse('npm run build', 0), tmpDir);
      expect(result).toEqual({});
      const state = loadSprintState(tmpDir)!;
      expect(state.gates.tests).toBe(false);
    });

    it('skips if tests gate already marked', async () => {
      const state = createSprintState(22, 'implementing');
      state.gates.tests = true;
      saveSprintState(tmpDir, state);

      const result = await sprintCompletionGuard(makePostToolUse('npx jest', 0), tmpDir);
      expect(result).toEqual({});
    });
  });

  describe('PostToolUse PR merge detection', () => {
    beforeEach(() => {
      saveSprintState(tmpDir, createSprintState(22, 'implementing'));
    });

    it('transitions phase to scoring on gh pr merge exit 0', async () => {
      const result = await sprintCompletionGuard(makePostToolUse('gh pr merge 117 --squash', 0), tmpDir);
      expect(result.context).toContain('scoring');
      expect(result.context).toContain('Scorecard validated');
      const state = loadSprintState(tmpDir)!;
      expect(state.phase).toBe('scoring');
    });

    it('does not transition on merge failure (exit 1)', async () => {
      const result = await sprintCompletionGuard(makePostToolUse('gh pr merge 117 --squash', 1), tmpDir);
      expect(result).toEqual({});
      const state = loadSprintState(tmpDir)!;
      expect(state.phase).toBe('implementing');
    });

    it('no-ops if already in scoring phase', async () => {
      const state = createSprintState(22, 'scoring');
      saveSprintState(tmpDir, state);
      const result = await sprintCompletionGuard(makePostToolUse('gh pr merge 117 --squash', 0), tmpDir);
      expect(result).toEqual({});
    });

    it('no-ops if already complete', async () => {
      const state = createSprintState(22, 'complete');
      saveSprintState(tmpDir, state);
      const result = await sprintCompletionGuard(makePostToolUse('gh pr merge 117 --squash', 0), tmpDir);
      expect(result).toEqual({});
    });
  });

  describe('scorecard existence check', () => {
    it('blocks PR when scorecard is missing even if gates are complete', async () => {
      const state = createSprintState(22, 'implementing');
      state.gates.tests = true;
      state.gates.code_review = true;
      state.gates.architect_review = true;
      state.gates.scorecard = true;
      state.gates.review_md = true;
      satisfyReviewGates(state);
      saveSprintState(tmpDir, state);
      // No scorecard file written

      const result = await sprintCompletionGuard(makePreToolUse('gh pr create --title "t"'), tmpDir);
      expect(result.decision).toBe('deny');
      expect(result.blockReason).toContain('scorecard not found');
      expect(result.blockReason).toContain('slope auto-card');
    });

    it('allows PR when scorecard exists and gates are complete', async () => {
      const state = createSprintState(22, 'implementing');
      state.gates.tests = true;
      state.gates.code_review = true;
      state.gates.architect_review = true;
      state.gates.scorecard = true;
      state.gates.review_md = true;
      satisfyReviewGates(state);
      saveSprintState(tmpDir, state);
      writeScorecard(22);

      const result = await sprintCompletionGuard(makePreToolUse('gh pr create --title "t"'), tmpDir);
      expect(result).toEqual({});
    });

    it('allows PR when a custom scorecard pattern has multiple wildcards', async () => {
      writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({
        scorecardDir: 'docs/retros',
        scorecardPattern: 'sprint-*-S*.json',
        minSprint: 1,
        roadmapPath: 'docs/backlog/roadmap.json',
      }));
      const state = createSprintState(22, 'implementing');
      state.gates.tests = true;
      state.gates.code_review = true;
      state.gates.architect_review = true;
      state.gates.scorecard = true;
      state.gates.review_md = true;
      satisfyReviewGates(state);
      saveSprintState(tmpDir, state);
      const dir = join(tmpDir, 'docs', 'retros');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'sprint-22-S22.json'), JSON.stringify({ sprint_number: 22, score: 4, par: 4 }));

      const result = await sprintCompletionGuard(makePreToolUse('gh pr create --title "t"'), tmpDir);
      expect(result).toEqual({});
    });

    it('advises on Stop when scorecard is missing during implementing phase', async () => {
      const state = createSprintState(22, 'implementing');
      state.gates.tests = true;
      state.gates.code_review = true;
      state.gates.architect_review = true;
      state.gates.scorecard = true;
      state.gates.review_md = true;
      satisfyReviewGates(state);
      saveSprintState(tmpDir, state);
      // No scorecard file

      const result = await sprintCompletionGuard(makeStop(), tmpDir);
      expect(result.context).toContain('scorecard not found');
    });

    it('shows both scorecard and gate errors when both are missing', async () => {
      saveSprintState(tmpDir, createSprintState(22, 'implementing'));

      const result = await sprintCompletionGuard(makePreToolUse('gh pr create --title "t"'), tmpDir);
      expect(result.decision).toBe('deny');
      expect(result.blockReason).toContain('scorecard not found');
      expect(result.blockReason).toContain('incomplete gates');
    });
  });

  describe('PostToolUse roadmap auto-update', () => {
    it('updates roadmap sprint status on slope validate exit 0', async () => {
      saveSprintState(tmpDir, createSprintState(22, 'implementing'));
      writeRoadmap([{ id: 22, status: 'planned' }]);

      const result = await sprintCompletionGuard(makePostToolUse('slope validate', 0), tmpDir);
      expect(result.context).toContain('Updated roadmap');
      expect(result.context).toContain('Sprint 22');

      const roadmap = JSON.parse(readFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), 'utf8'));
      expect(roadmap.sprints[0].status).toBe('complete');
    });

    it('uses the shell cd target as the cwd when slope validate updates roadmap', async () => {
      const worktreeDir = join(tmpDir, 'validate-worktree');
      writeConfigAt(worktreeDir);
      saveSprintState(worktreeDir, createSprintState(160, 'implementing'));
      writeRoadmapAt(worktreeDir, [{ id: 160, status: 'planned' }]);

      saveSprintState(tmpDir, createSprintState(22, 'implementing'));
      writeRoadmap([{ id: 22, status: 'planned' }]);

      const result = await sprintCompletionGuard(
        makePostToolUse(`cd "${worktreeDir}" && slope validate`, 0),
        tmpDir,
      );

      expect(result.context).toContain('Sprint 160');

      const worktreeRoadmap = JSON.parse(readFileSync(join(worktreeDir, 'docs', 'backlog', 'roadmap.json'), 'utf8'));
      const launcherRoadmap = JSON.parse(readFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), 'utf8'));
      expect(worktreeRoadmap.sprints[0].status).toBe('complete');
      expect(launcherRoadmap.sprints[0].status).toBe('planned');
    });

    it('does not update roadmap on slope validate failure', async () => {
      saveSprintState(tmpDir, createSprintState(22, 'implementing'));
      writeRoadmap([{ id: 22, status: 'planned' }]);

      const result = await sprintCompletionGuard(makePostToolUse('slope validate', 1), tmpDir);
      expect(result).toEqual({});

      const roadmap = JSON.parse(readFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), 'utf8'));
      expect(roadmap.sprints[0].status).toBe('planned');
    });

    it('no-ops when roadmap sprint is already complete', async () => {
      saveSprintState(tmpDir, createSprintState(22, 'implementing'));
      writeRoadmap([{ id: 22, status: 'complete' }]);

      const result = await sprintCompletionGuard(makePostToolUse('slope validate', 0), tmpDir);
      expect(result).toEqual({});
    });

    it('updates phase status when all sprints complete', async () => {
      saveSprintState(tmpDir, createSprintState(22, 'implementing'));
      writeRoadmap([
        { id: 21, status: 'complete' },
        { id: 22, status: 'planned' },
      ]);

      await sprintCompletionGuard(makePostToolUse('slope validate', 0), tmpDir);

      const roadmap = JSON.parse(readFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), 'utf8'));
      expect(roadmap.phases[0].status).toBe('complete');
    });

    it('no-ops when no roadmap exists', async () => {
      saveSprintState(tmpDir, createSprintState(22, 'implementing'));
      // No roadmap file

      const result = await sprintCompletionGuard(makePostToolUse('slope validate', 0), tmpDir);
      expect(result).toEqual({});
    });
  });

  describe('PostToolUse sprint retrospective review completion', () => {
    beforeEach(() => {
      saveSprintState(tmpDir, createSprintState(22, 'scoring'));
    });

    it('warns that sprint retrospective review is not PR implementation review', async () => {
      const result = await sprintCompletionGuard(makePostToolUse('slope review docs/retros/sprint-22.json', 0), tmpDir);

      expect(result.context).toContain('Review generated');
      expect(result.context).toContain('sprint retrospective review is not PR implementation review');
      expect(result.context).toContain('slope pr status --sprint=22');
      expect(result.context).toContain('slope pr review');
    });

    it('warns when PR implementation review is recorded but closeout settlement is still pending', async () => {
      recordPrReviewComplete(tmpDir, { pr: 42, sprint: 22, reviewType: 'both' });

      const result = await sprintCompletionGuard(makePostToolUse('slope review docs/retros/sprint-22.json', 0), tmpDir);

      expect(result.context).toContain('Review generated');
      expect(result.context).not.toContain('sprint retrospective review is not PR implementation review');
      expect(result.context).toContain('review/check settlement is still pending');
      expect(result.context).toContain('slope pr status --pr=42 --sprint=22');
    });

    it('does not warn when PR implementation review and closeout settlement are already recorded', async () => {
      recordPrReviewComplete(tmpDir, { pr: 42, sprint: 22, reviewType: 'both' });
      recordPrCloseoutSettled(tmpDir, { pr: 42, sprint: 22 });

      const result = await sprintCompletionGuard(makePostToolUse('slope review docs/retros/sprint-22.json', 0), tmpDir);

      expect(result.context).toContain('Review generated');
      expect(result.context).not.toContain('sprint retrospective review is not PR implementation review');
      expect(result.context).not.toContain('review/check settlement is still pending');
    });
  });
});
