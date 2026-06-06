# Sprint 143.7 Plan - Windows-Safe Map Staleness Checks

## Objective

Close #512 by removing Unix-only stderr redirection from the map staleness git path used by `slope map --check` and `slope commit-ready --json`.

## Tickets

| Ticket | Title | Club | Complexity |
| --- | --- | --- | --- |
| S143.7-1 | Replace Unix stderr redirection in map staleness git helper (#512) | wedge | small |
| S143.7-2 | Add map --check and commit-ready stderr regressions (#512) | wedge | small |

## Hazards

- Windows `cmd.exe` treats `2>/dev/null` as a filesystem path, which leaks `The system cannot find the path specified.` to stderr.
- `commit-ready --json` depends on `map --check` staleness code, so stdout JSON and stderr cleanliness both need verification.
- Keep the fix scoped to the map staleness path unless another command is proven to leak during this sprint.

## Acceptance Criteria

- `slope map --check` emits no unrelated Windows stderr when the map is current.
- `slope commit-ready --json` emits valid JSON on stdout and no unrelated stderr from the map staleness path.
- Regression coverage proves the helper no longer relies on Unix shell redirection.
