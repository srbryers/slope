# Sprint 143.9 Plan - Node Exec Redirection Portability Audit

## Objective

Close #514 by auditing Node-executed command strings for Unix-only stderr redirection and replacing them with portable child-process handling.

## Tickets

| Ticket | Title | Club | Complexity |
| --- | --- | --- | --- |
| S143.9-1 | Audit Node execSync callers that embed Unix stderr redirection (#514) | short_iron | standard |
| S143.9-2 | Replace Windows-unsafe Node command redirection with portable helpers (#514) | short_iron | standard |
| S143.9-3 | Add regression coverage for a formerly noisy guard or command path (#514) | wedge | small |

## Hazards

- Generated POSIX shell snippets may legitimately contain `2>/dev/null`; do not rewrite those unless Node executes them on Windows.
- Broad mechanical rewrites can change command semantics. Prefer small portable helpers and targeted replacements.
- Some full-suite path noise may come from test fixtures, so verify the command path before changing production code.

## Acceptance Criteria

- Node `execSync`/`execFileSync` callers no longer rely on Unix-only stderr redirection where they execute under Windows.
- At least one formerly noisy guard or command path has regression coverage.
- The Windows full suite is materially quieter for `The system cannot find the path specified.` noise.
