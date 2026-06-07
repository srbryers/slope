# Sprint 143.98 Plan - npm Bin Metadata Release Cleanliness

## Objective

Close #517 by normalizing package bin metadata so npm publish dry-run no longer auto-corrects CLI bin entries.

## Tickets

| Ticket | Title | Club | Complexity |
| --- | --- | --- | --- |
| S143.98-1 | Normalize npm package bin paths to avoid publish auto-correction (#517) | wedge | small |
| S143.98-2 | Rerun npm publish dry-run and release packaging checks (#517) | wedge | small |

## Hazards

- The fix is small, but package metadata warnings are release-surface defects and should not be hand-waved.
- Preserve CLI binary behavior for both `slope` and `mcp-slope-tools`.
- Confirm the warning is actually gone with `npm publish --dry-run --access public`.

## Acceptance Criteria

- `package.json` bin metadata no longer triggers npm auto-correction warnings.
- The built CLI still reports the bumped package version.
- Package dry-run and publish dry-run complete cleanly.
