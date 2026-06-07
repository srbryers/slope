# Sprint 146.2 Plan - Decimal Post-Merge Retro Support

**Theme:** Fix decimal post-merge retro support and publish the patch.
**Par:** 3
**Slope:** 1

## Context

After v1.58.1 shipped, the required post-merge retro command failed for S146.1 because `slope retro post-merge` still required integer sprint ids. SLOPE already supports inserted decimal sprints in roadmap, scorecards, status, and validation, so the retro/memory path should accept the same ids.

## Tickets

| Ticket | Club | Scope |
| --- | --- | --- |
| S146.2-1 | Wedge | Accept decimal sprint ids in `retro post-merge` and durable retro memory (#529). |
| S146.2-2 | Wedge | Bump `package.json` and bundled plugin manifest to `1.58.2` for the retro fix. |

## Hazards

- Keep the fix scoped to post-merge retro decimal sprint ids; backfill integer-only behavior can remain unchanged.
- Verify the built CLI with `--sprint=146.1` because that is the observed failure path.
- Publish through the GitHub Release workflow after CI passes; do not run local npm publish.

## Validation

- `corepack pnpm vitest run tests/cli/commands/retro.test.ts tests/core/retro.test.ts`
- `corepack pnpm typecheck`
- `corepack pnpm build`
- `node dist/cli/index.js retro post-merge --sprint=146.1 --pr=527 --summary="dry run" --learning="Decimal sprint post-merge retros work" --dry-run --json`
- `node dist/cli/index.js validate --sprint=146.2`
- `node dist/cli/index.js roadmap validate`
- GitHub PR checks and the GitHub Release publish workflow
