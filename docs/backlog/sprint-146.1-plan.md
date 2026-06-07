# Sprint 146.1 Plan - Roadmap Hygiene Patch Release

**Theme:** Cut v1.58.1 after S146 and repair release-bump staging.
**Par:** 4
**Slope:** 2

## Context

S146 cleaned stale roadmap state and fixed decimal sprint shipped-artifact detection. npm still reports `@slope-dev/slope@1.58.0`, so the shipped S146 fixes need a patch release. During release prep, the CLI version-bump automation was found to stage only `package.json` even though `scripts/version-bump.mjs` also updates the bundled Codex plugin manifest. The inserted release sprint also exposed that `roadmap validate` accepts `status: "active"` while `roadmap status` can still select later planned work.

## Tickets

| Ticket | Club | Scope |
| --- | --- | --- |
| S146.1-1 | Short Iron | Fix `slope version bump` staging for the bundled plugin manifest (#524). |
| S146.1-2 | Short Iron | Make `roadmap status` select active inserted sprints before later planned work (#525). |
| S146.1-3 | Wedge | Bump `package.json` and `templates/codex/plugins/slope/.codex-plugin/plugin.json` to `1.58.1`. |
| S146.1-4 | Wedge | Validate local and CI release readiness, create the GitHub Release, and verify npm publishes `1.58.1`. |

## Hazards

- Use `node dist/cli/index.js` after building so validation exercises branch source.
- Treat npm latest verification as post-GitHub-Release work, not a local pre-merge gate.
- Keep release changes narrow: staging fix, version bump, release artifacts.
- Check active decimal sprint behavior with `node dist/cli/index.js roadmap status`.

## Validation

- `corepack pnpm vitest run tests/cli/version.test.ts`
- `corepack pnpm build`
- `corepack pnpm typecheck`
- `corepack pnpm test`
- `node dist/cli/index.js validate --sprint=146.1`
- `node dist/cli/index.js roadmap validate`
- `node dist/cli/index.js docs check`
- GitHub PR checks after pushing the release bump
- Publish workflow after GitHub Release
