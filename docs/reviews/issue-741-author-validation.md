# Issue 741 author validation

Prepared from `3420c61ec3773b35635deaf750e946a00906023c` in the isolated
`fix/issue-741-now-completed` worktree. The source selector now treats exact
roadmap `status: complete` alongside ledger completions. `now`, agent status
and roadmap status share that rule; claim ordering and unknown-ledger behavior
are preserved. This is author evidence, not independent approval or adoption.

## Execution

Claude Code resolved to first-party `claude-opus-5-5` in session
`aa6402af-1e95-4c77-95b0-3b4c91931011`. Its reported $1.4355622 is an
API-equivalent list estimate, not a subscription invoice. Actual 46 turns
exceeded the requested 35-turn cap. Its noninteractive tool permissions denied
build/test/typecheck, so those checks were run locally afterward. There was no
second Claude invocation or usage-reset redemption.

## Recorded checks and limitations

Commands used `corepack pnpm@10` with cached, frozen dependencies. Vitest is
3.2.4. Build and final typecheck passed; the parent also reran build on the final
source after the optional ticket-status annotation, with success. Diff checks pass.

- An initial focused default-pool invocation stalled and was interrupted, with
  no reliable result.
- The stock focused file reported 21 passing assertions, then a worker
  `onTaskUpdate` RPC timeout at shutdown after 119.25 seconds. This is incomplete.
- The three new source-completion regressions passed cleanly in 14.94 seconds;
  the other 18 tests were skipped. The command used the fork pool, singleFork,
  one worker and the matching test-name filter.
- The stock full suite with the same single-fork pool stopped after 264.10
  seconds: 14 files and 842 tests passed, 33 tests skipped, one unhandled worker
  RPC error. This is incomplete.
- One diagnostic full run used a temporary local watchdog increase in ignored
  node_modules, from 60 to 600 seconds. It completed in 739.74 seconds: 273 files
  passed, one skipped; 4,597 tests passed, 34 skipped; no errors. This diagnostic
  does not establish a stock-harness pass. The watchdog was restored to 60 seconds;
  tracked dependencies, configuration and lockfiles were unchanged.

The full command was `corepack pnpm@10 exec vitest run --pool=forks
--poolOptions.forks.singleFork --maxWorkers=1 --minWorkers=1 --reporter=dot`.
The diagnostic bundle was Vitest's ignored `dist/chunks/index.B521nVV-.js`.
No test assertion or product threshold was changed. No further diagnostic retry
was made; the single adjusted run finished before its 15-minute cap.

## Draft publication boundary

The prepared fix may be reviewed through a draft PR and its normal CI. Required
stock full-suite CI and independent review remain pending; no merge, global
installation or Flora adoption is accepted here. Flora's d20e5a8 backport has
its own checks and failure history, which this newer-source result cannot replace.
