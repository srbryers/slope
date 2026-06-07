# Sprint 143.97 Plan - Git Analyzer Cadence Fixture Stability

## Objective

Close #516 by making the git analyzer daily-cadence regression deterministic under Windows full-suite load before the release sprint closes.

## Tickets

| Ticket | Title | Club | Complexity |
| --- | --- | --- | --- |
| S143.97-1 | Replace slow daily-cadence git fixture setup with a deterministic fast history builder (#516) | short_iron | standard |
| S143.97-2 | Rerun focused analyzer and release-gate full-suite validation (#516) | wedge | small |

## Hazards

- Focused analyzer reruns can pass while the full suite times out under Windows process and filesystem load.
- Do not weaken cadence coverage; preserve the 65-commit recent-history signal that exercises the daily threshold.
- Prefer making the fixture cheaper and deterministic over merely increasing the timeout.

## Acceptance Criteria

- The daily-cadence analyzer test no longer depends on 65 slow `git commit` subprocesses.
- `tests/core/analyzers/git.test.ts` passes focused with lower runtime.
- Full-suite release validation passes after the fixture hardening.
