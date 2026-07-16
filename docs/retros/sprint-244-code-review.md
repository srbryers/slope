# Sprint 244 — Code Correctness Review

- **Reviewer / lane:** code-implementation-correctness-reviewer (correctness)
- **Branch:** feat/S244-session-wrap-standup
- **Diff:** `git diff main...feat/S244-session-wrap-standup -- src/ templates/ tests/`
- **Verdict:** **APPROVE with minor findings** — no blocking correctness bug. All 64 tests in the four target files pass. Findings below are latent/defense-in-depth and advisory-metric quality issues.

## Test run

`pnpm vitest run tests/core/standup.test.ts tests/cli/transcript.test.ts tests/cli/commands/session-end.test.ts tests/cli/interactive-init.test.ts` → **4 files, 64 tests, all pass.**

## Findings

### F1 — Shell injection via `git log --since=${JSON.stringify(...)}` (LOW, latent/defense-in-depth)

- **File:** `src/cli/commands/standup.ts:47-50` (`gatherStandupContext`)
- **Failing input:** `sessionStartedAt = '2026-01-01T00:00:00Z$(touch PWNED)'`
- **Behavior:** `execSync` runs the command string through `/bin/sh -c`. `JSON.stringify` escapes for JSON, not for the shell, so `$(...)`, backticks, `;`, `&&`, and `|` inside the value are interpreted by the shell. I confirmed this in the scratchpad: the probe created a `PWNED` file and `git` still returned normally.
- **Why it is only LOW today:** `started_at` is not user-controlled — it is always written by `registerSession()` as `nowISO()` (`new Date().toISOString()`, `src/store/index.ts:405`), which cannot contain shell metacharacters. So there is no reachable exploit through the normal CLI/store path.
- **Required fix (cheap, recommended):** switch to `execFileSync('git', ['log', '--oneline', `--since=${sessionStartedAt}`], { cwd, stdio: [...] })` so the timestamp is passed as an argv element, never re-parsed by a shell. Same treatment for the `git rev-parse` call for consistency. This removes the latent injection and is functionally identical for the benign ISO input.

### F2 — Commit count uses committer date on current HEAD, not "this session's commits" (LOW, advisory-metric accuracy)

- **File:** `src/cli/commands/standup.ts:44-56`
- **Behavior:** `git log --since=<started_at>` with no ref defaults to HEAD and filters by **committer date**. Consequences:
  - After a rebase/amend, commits authored long before the session get a fresh committer date and are counted as "this session." Confirmed in scratchpad: a 2020-authored commit amended with `--reset-author` shows as 1 commit `--since="1 hour ago"`.
  - Counts every commit reachable from the current branch in the window regardless of who/which session made it (e.g. commits merged in from `main`), and a mid-session `git checkout` to another branch changes the count.
- **Assessment:** acceptable for an advisory standup line, but the label "N commits this session" (standup.ts + wrap-session.md) overstates precision. **Recommend** softening the wording (e.g. "N commits since session start") or restricting to `HEAD` ahead of the session's base if precision matters. Not blocking.

### F3 — Stale exported `SLOPE_SESSION_ID` defeats the single-active fallback (LOW, UX)

- **File:** `src/cli/commands/session.ts:176-192`
- **Behavior:** precedence is `--session-id` → `SLOPE_SESSION_ID` → single-active. If `SLOPE_SESSION_ID` is exported but points at an already-ended/non-existent session, `sessionId` is truthy, the single-active branch is skipped, `removeSession` returns `false`, and the command exits 1 with `Session "..." not found`.
- **Why it matters:** the new `templates/.../wrap-session.md` step 4 instructs agents to run bare `slope session end` and relies on the single-active default. In managed harnesses `SLOPE_SESSION_ID` is commonly exported (see `template-generator.ts:418`, `hook.ts:22`, `init.ts:839`). A stale value there makes the documented wrap flow fail even when exactly one *different* session is active.
- **Recommend:** when the env id is not among the active sessions, fall back to the single-active default (or emit a clear "env SLOPE_SESSION_ID=X is not active, falling back" message) rather than a hard `not found` exit. Design call — flag for the author, not blocking.

### F4 — `parseStandup` silently drops `context` on round-trip (INFO)

- **File:** `src/core/standup.ts:216-232`
- **Behavior:** `parseStandup` does not copy the new `context` field, so a stored standup event re-parsed via aggregate/ingest loses `context`. Harmless in practice: the aggregate path renders via `formatTeamStandup`, which never displays `context`; the generate path formats the in-memory report directly. Also means old standup events without `context` parse fine (no validation error) — the round-trip is lossy but safe. No fix required; note if `context` is ever surfaced in aggregate/ingest output later.

## Things checked and cleared

- **Env leakage between tests:** only `tests/cli/commands/session-end.test.ts` references `SLOPE_SESSION_ID`; it saves/restores in before/after each. No other test in the suite sets it — no cross-test leakage.
- **`computeStats` / gather transcript duration:** min/max scan with `Number.isFinite` guard and strict `latest > earliest` correctly yields `0` for single-turn and all-invalid-timestamp cases; the unordered+invalid test (`Duration: 75m`, never negative) passes.
- **`formatStandup` partial contexts:** sprint-only, branch-without-commits (`sessionStartedAt` undefined → `commitsNote=''`), and `durationMin: 0` all render without stray fragments; context block omitted entirely when absent (test-covered).
- **`gatherStandupContext` when `inferSprintContext` throws:** wrapped in try/catch, sprint inference is advisory; git and transcript probes are independently guarded. Non-git dirs and disabled transcripts degrade cleanly to a partial/empty context.
- **Multi-active error message:** prints `role` and `branch` (both valid `SlopeSession` fields); `branch` falls back to `'no branch'`.
