import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sprintCompletionGuard } from '../../../src/cli/guards/sprint-completion.js';
import type { HookInput } from '../../../src/core/index.js';

// #683, found by independent review of #692. This guard detects `gh pr merge`
// and `slope validate` in PostToolUse output and WRITES state as a result —
// sprint phase, roadmap status, gates. It matched the raw command text, so a
// heredoc BODY mentioning one of those commands mutated sprint state from
// document prose. Strictly worse than the worktree-merge case it shipped
// alongside: that one denies a command, this one silently rewrites state.

function makeInput(command: string, cwd: string): HookInput {
  return {
    session_id: 'test',
    cwd,
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    tool_response: { stdout: '', exit_code: 0 },
  };
}

function readPhase(cwd: string): string | undefined {
  const raw = readFileSync(join(cwd, '.slope', 'sprint-state.json'), 'utf8');
  return JSON.parse(raw).phase;
}

describe('sprintCompletionGuard command-text precision (#683)', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'slope-sc-'));
    mkdirSync(join(cwd, '.slope'), { recursive: true });
    // The fixture must satisfy isValidSprintStateEvidence, the strict shape
    // mutateSprintState requires: all five gate keys as booleans, and
    // started_at/updated_at (NOT started/updated). A fixture that fails it
    // makes every mutation a silent no-op, which would let the negative
    // tests below pass against a completely broken guard.
    writeFileSync(
      join(cwd, '.slope', 'sprint-state.json'),
      JSON.stringify({
        sprint: 300,
        phase: 'implementing',
        gates: {
          tests: false,
          code_review: false,
          architect_review: false,
          scorecard: false,
          review_md: false,
        },
        started_at: '2026-08-19T00:00:00.000Z',
        updated_at: '2026-08-19T00:00:00.000Z',
      }),
    );
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('does not advance the sprint phase from a heredoc body', async () => {
    const command = [
      "cat <<'ZEOF' > notes.md",
      'When the PR lands, run gh pr merge 12 --delete-branch to finish.',
      'ZEOF',
    ].join('\n');

    await sprintCompletionGuard(makeInput(command, cwd), cwd);
    expect(readPhase(cwd)).toBe('implementing');
  });

  it('does not advance the sprint phase from a quoted argument', async () => {
    const command = 'gh issue create --body "gh pr merge 12 fails in a worktree"';
    await sprintCompletionGuard(makeInput(command, cwd), cwd);
    expect(readPhase(cwd)).toBe('implementing');
  });

  it('does not fire slope validate detection from a heredoc body', async () => {
    const command = ["cat <<'EOF' > RELEASE.md", 'Step 2: run slope validate before tagging.', 'EOF'].join('\n');
    await sprintCompletionGuard(makeInput(command, cwd), cwd);
    expect(readPhase(cwd)).toBe('implementing');
  });

  it('still advances on a genuine gh pr merge', async () => {
    await sprintCompletionGuard(makeInput('gh pr merge 12 --squash', cwd), cwd);
    expect(readPhase(cwd)).toBe('scoring');
  });

  it('still advances on a genuine merge inside a compound command', async () => {
    await sprintCompletionGuard(makeInput('git fetch && gh pr merge 12 --squash', cwd), cwd);
    expect(readPhase(cwd)).toBe('scoring');
  });
});
