# Phase 62 Code Review — S260, S261, S262

**Reviewer:** self (sole implementer; no independent reviewer available this session)
**Scope:** `git diff main...chore/phase-62-issue-triage` — 26 files, +1879/−42
**Verdict:** APPROVED with two recorded limitations

Covers all three Phase 62 sprints. The branch carries one phase, so the review
is phase-wide rather than per-sprint.

## Correctness

**`command-parse.ts` fails conservatively.** Every construct the parser does not
model resolves to *no match* rather than a wrong match: a subshell wrapper
(`(cd x && gh pr merge 117 -d)`) leaves the trailing `)` attached to the token,
`$(...)` substitution keeps `$(gh` as one token, and an unterminated heredoc
swallows the remainder exactly as the shell would. Since the reported defect was
a false *positive* that blocked work and corrupted rewritten data, failing toward
"do not fire" is the correct direction for this class of guard.

**Byte-span splicing is sound.** `removeToken` cuts `[start, end)` plus the
preceding whitespace run from the *original* string, with a separate branch for a
flag at the start of a command or line. The previous non-global `String.replace`
rewrote the first match anywhere in the text, which is what edited prose instead
of commands. Verified by `removeToken` preserving a following pipeline verbatim.

**`git commit -m "$(cat <<'EOF' … EOF)"` still triggers `branch-before-commit`.**
The heredoc opener sits inside double quotes, so `readQuoted` consumes it as one
quoted token rather than a heredoc opener; `git commit` still matches on the
first two tokens. `extractCommitMessage` deliberately keeps its own raw-text
regex, since it *wants* the heredoc body.

**The S261 security regression is closed.** The first cut appended the default
candidates after the resolved ref, so an explicit unsafe ref was skipped by
`SAFE_REF_RE` and then silently fell through to scanning `main`. Now an explicit
ref is scanned alone via `scanRefs([ref], cwd)`. The pre-existing "refuses unsafe
refs" test caught this and still guards it.

**`validateRoadmap` does not mutate its argument.** It shallow-clones only when a
sprint lacks a `tickets` array; a test asserts the caller's object is unchanged.

## Recorded limitations

1. **`version-check` trunk matching is heuristic.** `/(^|[:/])(main|master)$/`
   over positional args matches `main`, `HEAD:main` and `refs/heads/main`, but
   also a branch literally named `feat/main`. This is strictly narrower than the
   previous `/(main|master)/` over the whole command text, so it is an
   improvement, not a new risk. Left as-is rather than parsing refspecs.

2. **`resolveTrunkRef` adds up to four `git` invocations per call.** It is
   consumed by the `post-hole-enforcement` guard, so it sits on a hook path.
   Marginal next to the 1000-commit `git log` that follows it, but if hook
   latency becomes a complaint this is the place to memoize.

## Test coverage

- `command-parse.test.ts` — 20 tests: separators, quoting, heredocs (quoted,
  unquoted, `<<-`, unterminated), herestrings, byte spans, flag matching,
  `--` terminator, splicing.
- `worktree-merge.test.ts` — 7 new tests reproducing every case from #683 and its
  follow-up comment, including the `cut -d= -f2-` mangling and the heredoc body.
- `version-check.test.ts` — new file, 8 tests.
- `worktree-self-remove.test.ts`, `branch-before-commit.test.ts` — 3 new each.
- `trunk-ref.test.ts` — 8 tests on real git fixtures (origin, deliberately stale
  clone, worktree off that clone).
- `issue-regressions.test.ts` — 15 tests pinning the reported symptom of #684,
  #685, #686, #688, #689, #690.

Full suite: **4320 passed, 0 failed** (PG suite skipped, no local instance).
`pnpm build` and `pnpm typecheck` clean.
