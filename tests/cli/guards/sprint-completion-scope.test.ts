import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { sprintCompletionGuard } from '../../../src/cli/guards/sprint-completion.js';
import { loadSprintState, loadSprintStateResult, sprintStatePath } from '../../../src/cli/sprint-state.js';
import type { HookInput } from '../../../src/core/index.js';
import {
  PRELUDE_DRAFT,
  SPRINT_STATE,
  activeState,
  addWorktree,
  cleanupFixtures,
  commitAll,
  completeState,
  git,
  initRepo,
  nullGateActiveState,
  tempDir,
  writeConfig,
  writeFile,
  writeScorecard,
  writeState,
} from '../../helpers/sprint-evidence-fixtures.js';

function prCreate(command: string, cwd: string, extra: Record<string, unknown> = {}): HookInput {
  return {
    session_id: 'scope-test',
    cwd,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command, ...extra },
  };
}

const PR = 'gh pr create --title "x" --body "y"';

afterEach(cleanupFixtures);

/**
 * Prelude's #748 layout: the primary checkout sits on an old branch whose
 * tracked sprint-state is corrupt, and a linked worktree carries the repaired,
 * valid file on the branch actually being PR'd.
 */
function repairedWorktreeBesideCorruptPrimary(): { primary: string; wt: string; badPath: string; goodPath: string } {
  const primary = initRepo();
  writeConfig(primary);
  writeScorecard(primary, '64.6');
  writeState(primary, completeState('64.6'));
  const repaired = commitAll(primary, 'repaired evidence');
  const badPath = writeState(primary, nullGateActiveState());
  commitAll(primary, 'old branch carries bad evidence');
  const wt = addWorktree(primary, 'feat/pr-copy', repaired);
  return { primary, wt, badPath, goodPath: join(wt, SPRINT_STATE) };
}

describe('#748 sprint evidence belongs to the checkout the command runs in', () => {
  it('uses the linked worktree\'s repaired local evidence, not the primary checkout\'s corrupt file', async () => {
    const { primary, wt } = repairedWorktreeBesideCorruptPrimary();
    expect(loadSprintStateResult(primary).status).toBe('corrupt');

    const result = await sprintCompletionGuard(prCreate(PR, wt), wt);

    expect(result).toEqual({});
  });

  it('applies the same repaired file when the session cwd is the primary and the command cds into the worktree', async () => {
    const { primary, wt } = repairedWorktreeBesideCorruptPrimary();

    const result = await sprintCompletionGuard(prCreate(`cd "${wt}" && ${PR}`, primary), primary);

    expect(result).toEqual({});
  });

  it('reproduces Prelude: the repair-commit shape (phase complete, gates all false) beside a draft primary is judged on its own gates, not as corrupt', async () => {
    // cf00ad4 rewrote the draft as valid evidence: boolean gates, all false, phase complete.
    const preludeRepair = {
      sprint: '64.6',
      phase: 'complete',
      gates: { tests: false, code_review: false, architect_review: false, scorecard: false, review_md: false },
      started_at: '2026-10-04T00:00:00.000Z',
      updated_at: '2026-10-04T00:00:00.000Z',
      repair: { commit: 'cf00ad4', note: 'draft rewritten as valid evidence' },
    };
    const primary = initRepo();
    writeConfig(primary);
    const base = commitAll(primary, 'base');
    writeState(primary, PRELUDE_DRAFT);
    commitAll(primary, 'old branch still carries the 2026-09-30 draft');
    const wt = addWorktree(primary, 'feat/paywall-copy', base);
    const wtState = writeState(wt, preludeRepair);
    commitAll(wt, 'cf00ad4-style repair');

    const result = await sprintCompletionGuard(prCreate(PR, wt), wt);

    // The corrupt-primary defect is gone: it is the worktree's file that is read.
    expect(result.blockReason).not.toContain('corrupt');
    expect(result.blockReason).toContain(`Sprint evidence file: ${wtState}`);
    expect(result.blockReason).not.toContain(join(primary, SPRINT_STATE));
    // What remains is the guard's ordinary verdict on a sprint whose gates are all
    // false: genuine missing evidence, deliberately still enforced. Reported
    // separately from #748 in the PR.
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('Sprint 64.6 has incomplete gates');
  });

  it('still blocks when the worktree\'s own evidence is incomplete, even if the primary looks finished', async () => {
    const primary = initRepo();
    writeConfig(primary);
    writeScorecard(primary, '64.6');
    writeState(primary, completeState('64.6'));
    const finished = commitAll(primary, 'primary is finished');
    const wt = addWorktree(primary, 'feat/active-work', finished);
    const wtState = writeState(wt, activeState('70'));
    commitAll(wt, 'active sprint on this branch');

    const result = await sprintCompletionGuard(prCreate(PR, wt), wt);

    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('incomplete gates');
    expect(result.blockReason).toContain(wtState);
    expect(result.blockReason).not.toContain(join(primary, SPRINT_STATE));
  });

  describe('no local sprint-state in a linked worktree', () => {
    it('ignores a tracked file on the primary\'s other branch: no evidence for this branch means none', async () => {
      const primary = initRepo();
      writeConfig(primary);
      const withoutState = commitAll(primary, 'config only');
      writeState(primary, nullGateActiveState());
      commitAll(primary, 'primary branch tracks its own (bad) evidence');
      const wt = addWorktree(primary, 'feat/no-state', withoutState);

      const result = await sprintCompletionGuard(prCreate(PR, wt), wt);

      expect(result).toEqual({});
    });

    it('does not fall back to the primary when this branch tracks the file but it is deleted from the working tree', async () => {
      const primary = initRepo();
      writeConfig(primary);
      writeState(primary, completeState('64.6'));
      const base = commitAll(primary, 'branch tracks its evidence');
      // The primary moves on to ignored, shared state that is still in progress.
      git(primary, ['rm', '-r', '--cached', '-q', '.slope']);
      writeFile(primary, '.gitignore', '.slope/\n');
      git(primary, ['add', '.gitignore']);
      git(primary, ['commit', '-q', '-m', 'untrack .slope']);
      expect(git(primary, ['ls-files', '.slope'])).toBe('');
      const sharedPath = writeState(primary, activeState('70'));
      const wt = addWorktree(primary, 'feat/deleted-evidence', base);
      rmSync(join(wt, SPRINT_STATE));

      expect(sprintStatePath(wt)).toBe(join(wt, SPRINT_STATE));
      const result = await sprintCompletionGuard(prCreate(PR, wt), wt);

      // No decision and no context: the primary's file is never consulted.
      expect(result).toEqual({});
      expect(sharedPath).not.toBe(sprintStatePath(wt));
    });

    it('still enforces shared (ignored) operational state held by the primary', async () => {
      const primary = initRepo();
      writeFile(primary, '.gitignore', '.slope/\n');
      git(primary, ['add', '.gitignore']);
      git(primary, ['commit', '-q', '-m', 'ignore .slope']);
      writeConfig(primary);
      const sharedPath = writeState(primary, activeState('70'));
      const wt = addWorktree(primary, 'feat/shared-state');
      writeConfig(wt);

      const result = await sprintCompletionGuard(prCreate(PR, wt), wt);

      expect(result.decision).toBe('deny');
      expect(result.blockReason).toContain('incomplete gates');
      expect(result.blockReason).toContain(sharedPath);
    });
  });

  describe('repositories that do not use SLOPE', () => {
    it('does nothing when the command cds into an unrelated repository', async () => {
      const slopeProject = initRepo();
      writeConfig(slopeProject);
      writeState(slopeProject, nullGateActiveState());
      commitAll(slopeProject, 'bad evidence in the session repo');
      const unrelated = initRepo('slope-unrelated-');

      const viaCd = await sprintCompletionGuard(prCreate(`cd "${unrelated}" && ${PR}`, slopeProject), slopeProject);
      const viaWorkdir = await sprintCompletionGuard(prCreate(PR, slopeProject, { workdir: unrelated }), slopeProject);

      expect(viaCd).toEqual({});
      expect(viaWorkdir).toEqual({});
    });
  });

  describe('explicit --repo', () => {
    function sessionRepo(remote: string): string {
      const root = initRepo();
      writeConfig(root);
      writeState(root, nullGateActiveState());
      commitAll(root, 'bad evidence in the session repo');
      git(root, ['remote', 'add', 'origin', remote]);
      return root;
    }

    it('does not read the session repo\'s file for a PR aimed at another repository, and says so', async () => {
      const root = sessionRepo('https://github.com/acme/app.git');

      for (const command of [
        'gh pr create --repo other/thing --title x',
        'gh pr create -R other/thing --title x',
        'gh pr create --repo=other/thing --title x',
        'gh pr create -Rother/thing --title x',
        'GH_REPO=other/thing gh pr create --title x',
        'gh -R other/thing pr create --title x',
      ]) {
        const result = await sprintCompletionGuard(prCreate(command, root), root);
        expect(result.decision, command).toBeUndefined();
        expect(result.context, command).toContain('not enforced');
        expect(result.context, command).toContain('other/thing');
        expect(result.context, command).toContain(root);
      }
    });

    it('reads --repo between `pr` and `create`, and -R=value, as the target repository', async () => {
      const root = sessionRepo('https://github.com/acme/app.git');

      for (const command of [
        'gh pr --repo other/thing create --title x',
        'gh pr -R other/thing create --title x',
        'gh pr create -R=other/thing --title x',
      ]) {
        const result = await sprintCompletionGuard(prCreate(command, root), root);
        expect(result.decision, command).toBeUndefined();
        expect(result.context, command).toContain('not enforced');
        expect(result.context, command).toContain('targets other/thing,');
      }
      for (const command of [
        'gh pr --repo acme/app create --title x',
        'gh pr -R acme/app create --title x',
        'gh pr create -R=acme/app --title x',
        'gh pr create -R=ACME/app --title x',
      ]) {
        const result = await sprintCompletionGuard(prCreate(command, root), root);
        expect(result.decision, command).toBe('deny');
      }
    });

    it('judges every gh pr create in the invocation, not only the first', async () => {
      const bad = sessionRepo('https://github.com/acme/app.git');
      const clean = initRepo('slope-clean-');
      writeConfig(clean);
      writeScorecard(clean, '64.6');
      writeState(clean, completeState('64.6'));
      commitAll(clean, 'clean evidence');

      const cases = [
        // the first is aimed elsewhere; the second runs against the bad evidence
        [`gh pr create -R other/thing --title a && gh pr create --title b`, bad],
        [`gh pr create --repo other/thing --title a; gh pr create --repo acme/app --title b`, bad],
        // the first is fine; a later cd lands on the bad checkout
        [`cd "${clean}" && gh pr create --title a && cd "${bad}" && gh pr create --title b`, clean],
      ] as const;
      for (const [command, session] of cases) {
        const result = await sprintCompletionGuard(prCreate(command, session), session);
        expect(result.decision, command).toBe('deny');
        expect(result.blockReason, command).toContain(join(bad, SPRINT_STATE));
      }
    });

    it('does not mistake a flag value for --repo', async () => {
      const root = sessionRepo('https://github.com/acme/app.git');

      const result = await sprintCompletionGuard(prCreate('gh pr create --title "-R other/thing" --body -R', root), root);

      expect(result.decision).toBe('deny');
    });

    it('enforces when --repo names a remote of the checkout, in any remote spelling', async () => {
      for (const [remote, selector] of [
        ['https://github.com/acme/app.git', 'acme/app'],
        ['git@github.com:acme/app.git', 'ACME/App'],
        ['ssh://git@github.com/acme/app', 'github.com/acme/app'],
        ['https://github.com/acme/app', 'https://github.com/acme/app.git'],
      ]) {
        const root = sessionRepo(remote);
        const result = await sprintCompletionGuard(prCreate(`gh pr create --repo ${selector} --title x`, root), root);
        expect(result.decision, `${remote} vs ${selector}`).toBe('deny');
      }
    });

    it('applies the target checkout\'s own evidence when the command cds into a matching checkout', async () => {
      const session = sessionRepo('https://github.com/acme/app.git');
      const target = initRepo('slope-target-');
      writeConfig(target);
      const targetState = writeState(target, activeState('70'));
      commitAll(target, 'target evidence');
      git(target, ['remote', 'add', 'origin', 'git@github.com:other/thing.git']);

      const result = await sprintCompletionGuard(
        prCreate(`cd "${target}" && gh pr create --repo other/thing --title x`, session),
        session,
      );

      expect(result.decision).toBe('deny');
      expect(result.blockReason).toContain(targetState);
      expect(result.blockReason).not.toContain(join(session, SPRINT_STATE));
    });

    it('does not enforce when the working directory is not a git checkout at all', async () => {
      const bare = tempDir('slope-nogit-');

      const result = await sprintCompletionGuard(prCreate('gh pr create --repo other/thing --title x', bare), bare);

      expect(result.decision).toBeUndefined();
      expect(result.context).toContain('not enforced');
    });
  });
});

describe('#744 planned drafts are "no sprint in progress"; real corruption still blocks', () => {
  it('allows gh pr create when the file is Prelude\'s planned draft (null gates, no timestamps)', async () => {
    const root = initRepo();
    writeConfig(root);
    writeState(root, PRELUDE_DRAFT);

    expect(loadSprintStateResult(root).status).toBe('draft');
    expect(await sprintCompletionGuard(prCreate(PR, root), root)).toEqual({});
  });

  it('treats a planned file with all-false (or mixed null/false) gates and no timestamps as a draft too: nothing has started', async () => {
    const root = initRepo();
    writeConfig(root);
    const noGates = { tests: false, code_review: false, architect_review: false, scorecard: false, review_md: false };

    for (const gates of [noGates, { ...noGates, tests: null, review_md: null }]) {
      writeState(root, { ...PRELUDE_DRAFT, gates });
      expect(loadSprintStateResult(root).status).toBe('draft');
      expect(await sprintCompletionGuard(prCreate(PR, root), root)).toEqual({});
    }
  });

  it('the strict and lenient loaders agree that a planned draft is no sprint', async () => {
    const root = initRepo();
    writeConfig(root);
    const allFalse = { tests: false, code_review: false, architect_review: false, scorecard: false, review_md: false };

    // A numeric sprint id with boolean gates is what the lenient loader used to accept as active.
    for (const draft of [
      PRELUDE_DRAFT,
      { ...PRELUDE_DRAFT, gates: allFalse },
      { ...PRELUDE_DRAFT, sprint: '12', gates: allFalse },
      { ...PRELUDE_DRAFT, sprint: 12, gates: { ...allFalse, tests: null } },
    ]) {
      const path = writeState(root, draft);
      const before = readFileSync(path, 'utf8');

      expect(loadSprintStateResult(root).status).toBe('draft');
      // loadSprintState is what the Stop and PostToolUse paths use.
      expect(loadSprintState(root)).toBeNull();

      // A passing test run must not mark a gate on, or rewrite, a draft.
      await sprintCompletionGuard({
        session_id: 's', cwd: root, hook_event_name: 'PostToolUse', tool_name: 'Bash',
        tool_input: { command: 'npx vitest' }, tool_response: { exit_code: 0 },
      }, root);
      expect(readFileSync(path, 'utf8')).toBe(before);
    }
  });

  it.each<[string, Record<string, unknown> | string]>([
    ['an active phase with a null gate', nullGateActiveState()],
    ['an active phase with every gate false but a null review gate', { ...activeState('74'), gates: { tests: false, code_review: null, architect_review: false, scorecard: false, review_md: false } }],
    ['a planned phase with a true gate', { ...PRELUDE_DRAFT, gates: { ...PRELUDE_DRAFT.gates, tests: true } }],
    ['a planned phase with a true gate among false ones', { ...PRELUDE_DRAFT, gates: { tests: true, code_review: false, architect_review: false, scorecard: false, review_md: false } }],
    ['a planned phase that has been started', { ...PRELUDE_DRAFT, started_at: '2026-09-30T00:00:00.000Z' }],
    ['a planned phase with updated_at set', { ...PRELUDE_DRAFT, updated_at: '2026-09-30T00:00:00.000Z' }],
    ['a planned phase carrying rollover lineage', { ...PRELUDE_DRAFT, rollover: { transition_id: '0123456789abcdef' } }],
    ['a planned phase carrying review evidence', { ...PRELUDE_DRAFT, review_gates: {} }],
    ['a planned phase with an object sprint', { ...PRELUDE_DRAFT, sprint: { id: 1 } }],
    ['scoring with no started_at', { ...activeState('72'), phase: 'scoring', started_at: null }],
    ['an implementing sprint missing gates', { ...activeState('73'), gates: undefined }],
    ['an unknown phase that is not "planned"', { ...PRELUDE_DRAFT, phase: 'drafting' }],
    ['malformed JSON', '{"sprint": 1, "gates": '],
  ])('still denies %s', async (_label, content) => {
    const root = initRepo();
    writeConfig(root);
    const path = writeState(root, content);

    const result = await sprintCompletionGuard(prCreate(PR, root), root);

    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('corrupt sprint evidence was preserved');
    expect(result.blockReason).toContain(path);
  });
});

describe('#742 every denial names the file, the field and a repair', () => {
  it('names the absolute path, the null gate and a non-destructive repair for corrupt evidence', async () => {
    const root = initRepo();
    writeConfig(root);
    const path = writeState(root, nullGateActiveState());

    const result = await sprintCompletionGuard(prCreate(PR, root), root);

    expect(result.decision).toBe('deny');
    const reason = result.blockReason!;
    expect(isAbsolute(path)).toBe(true);
    expect(reason).toContain(`Sprint evidence file: ${path}`);
    expect(reason).toContain('`gates.tests` must be true or false (found null)');
    expect(reason).toContain(`Edit ${path} and set \`gates.tests\` to \`false\``);
    expect(reason).toContain('complete the gate with `slope sprint gate tests`');
    expect(reason).toContain('`slope doctor`');
    expect(reason).toContain(`mv "${path}" "${path}.bak"`);
    expect(reason).not.toContain('slope sprint reset');
  });

  it('names a JSON parse error as the bad field', async () => {
    const root = initRepo();
    writeConfig(root);
    const path = writeState(root, '{"sprint": 1, "gates": ');

    const result = await sprintCompletionGuard(prCreate(PR, root), root);

    expect(result.blockReason).toContain(`Sprint evidence file: ${path}`);
    expect(result.blockReason).toMatch(/Problem: `JSON` is not valid JSON: /);
    expect(result.blockReason).toContain(`Fix the JSON syntax error in ${path}`);
  });

  it('leaves the corrupt file exactly as it was', async () => {
    const root = initRepo();
    writeConfig(root);
    const path = writeState(root, nullGateActiveState());
    const before = readFileSync(path, 'utf8');

    await sprintCompletionGuard(prCreate(PR, root), root);

    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('names the evidence file and the pending gate fields when gates are incomplete', async () => {
    const root = initRepo();
    writeConfig(root);
    const path = writeState(root, activeState('70'));
    writeScorecard(root, '70');

    const result = await sprintCompletionGuard(prCreate(PR, root), root);

    expect(result.decision).toBe('deny');
    const reason = result.blockReason!;
    expect(reason).toContain(`Sprint evidence file: ${path}`);
    for (const gate of ['tests', 'code_review', 'architect_review', 'scorecard', 'review_md']) {
      expect(reason).toContain(`\`gates.${gate}\``);
    }
    // Only forms `slope sprint gate` accepts: a bare review-gate command returns usage.
    expect(reason).toContain('`slope sprint gate tests`');
    expect(reason).toContain('`slope validate`');
    expect(reason).toContain('`slope review --sprint=70`');
    for (const gate of ['code_review', 'architect_review']) {
      expect(reason).toContain(`\`slope sprint gate ${gate} --reviewer=<id> --evidence=<path-or-url>\``);
      expect(reason).toContain(`\`slope sprint gate ${gate} --pr-review=<url-or-id>\``);
      expect(reason).not.toContain(`\`slope sprint gate ${gate}\``);
    }
  });

  it('offers the full review-evidence form when a review gate is the null one', async () => {
    const root = initRepo();
    writeConfig(root);
    writeState(root, { ...activeState('74'), gates: { tests: false, code_review: null, architect_review: false, scorecard: false, review_md: false } });

    const result = await sprintCompletionGuard(prCreate(PR, root), root);

    expect(result.blockReason).toContain('`gates.code_review` must be true or false (found null)');
    expect(result.blockReason).toContain('`slope sprint gate code_review --reviewer=<id> --evidence=<path-or-url>`');
    expect(result.blockReason).not.toContain('`slope sprint gate code_review`');
  });

  it('names the evidence file and the expected scorecard path when the scorecard is missing', async () => {
    const root = initRepo();
    writeConfig(root);
    const state = completeState('70');
    const path = writeState(root, state);

    const result = await sprintCompletionGuard(prCreate(PR, root), root);

    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain(`Sprint evidence file: ${path}`);
    expect(result.blockReason).toContain(`Expected at: ${join(root, 'docs', 'retros', 'sprint-70.json')}`);
  });

  it('names the evidence file and the `sprint` field when branch and state disagree', async () => {
    const root = initRepo();
    writeConfig(root);
    git(root, ['checkout', '-q', '-b', 'feat/sprint-71-other']);
    const path = writeState(root, activeState('70'));

    const result = await sprintCompletionGuard(prCreate(PR, root), root);

    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('refusing automatic rebind');
    expect(result.blockReason).toContain(`Sprint evidence file: ${path}`);
    expect(result.blockReason).toContain('(`sprint`)');
  });

  it('names the evidence file and the `rollover` field when lineage is missing', async () => {
    const root = initRepo();
    writeConfig(root);
    const state = completeState('70');
    state.rollover = {
      transition_id: '0123456789abcdef',
      from_sprint: '69',
      audit_path: 'docs/retros/rollovers/missing.json',
      recorded_at: '2026-07-10T00:00:00.000Z',
      forced: false,
    };
    const path = writeState(root, state);
    writeScorecard(root, '70');

    const result = await sprintCompletionGuard(prCreate(PR, root), root);

    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain(`Sprint evidence file: ${path}`);
    expect(result.blockReason).toContain('(`rollover`)');
  });

});

describe('ordinary valid evidence is still enforced', () => {
  it('denies an active sprint with incomplete gates and allows a finished one', async () => {
    const root = initRepo();
    writeConfig(root);
    writeScorecard(root, '70');
    writeState(root, activeState('70'));

    expect((await sprintCompletionGuard(prCreate(PR, root), root)).decision).toBe('deny');

    writeState(root, completeState('70'));
    expect(await sprintCompletionGuard(prCreate(PR, root), root)).toEqual({});
  });

  it('keeps enforcing in a subdirectory of the checkout', async () => {
    const root = initRepo();
    writeConfig(root);
    writeScorecard(root, '70');
    writeState(root, activeState('70'));
    const sub = join(root, 'packages', 'app');
    writeFile(root, 'packages/app/index.ts', '');

    const result = await sprintCompletionGuard(prCreate(PR, sub), sub);

    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('incomplete gates');
  });

  it('does not touch commands that are not gh pr create', async () => {
    const root = initRepo();
    writeConfig(root);
    writeState(root, nullGateActiveState());

    expect(await sprintCompletionGuard(prCreate('gh pr view 1', root), root)).toEqual({});
  });
});
