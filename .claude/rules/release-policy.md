# Release Policy

## Version Tier Definitions

| Tier | Criteria | Examples |
|------|----------|---------|
| **Patch** (x.y.Z) | Only `fix:` and `docs:` commits. No new commands, guards, MCP tools, API exports, or config changes | Bug fix in guard logic, typo in README |
| **Minor** (x.Y.0) | Any `feat:` commits. New commands, guards, MCP tools, metaphors, core API exports. Backward-compatible config additions | S65's inspiration registry, new guards |
| **Major** (X.0.0) | Breaking changes (`!` suffix). Removed commands/exports. Config breaking changes. Store schema migration required | Removing a CLI command, changing scorecard schema |

Use `slope version recommend` to analyze unreleased commits and get a tier recommendation.

## Release Process (3 steps)

```
# 1. Bump version (creates branch, PR, merges)
slope version bump --minor          # or --patch / --major / explicit version

# 2. Wait for CI to pass on main

# 3. Create GitHub release (triggers npm publish + slope-web sync)
gh release create v1.28.0 --target main --generate-notes
```

**Never `npm publish` directly** — use `gh release create` which triggers trusted publishing via GitHub Actions.

## Pre-Release Checklist

1. `pnpm build && pnpm test && pnpm typecheck` — all pass
2. `slope map` — CODEBASE.md regenerated if files/commands changed
3. `slope docs generate` — manifest updated, commit if changed
4. `slope docs check` — no drift between local manifest and current state
5. All feature PRs merged to main
6. Working directory clean
7. Changelog reviewed for slope-web content needs (see below)

## slope-web Content Rules

**Auto-synced (no action needed)** — the `sync-docs.yml` workflow handles:
- CLI commands list, guards table, MCP tools, metaphors, changelog

**Manual review needed when:**
- New feature area introduced (e.g., "Inspiration Tracking" — may need a docs page section)
- README significantly rewritten (check slope-web Getting Started alignment)
- Breaking changes (review slope-web for outdated references)
- New init flags or setup flow changes (check Installation section)

## Guard Interaction

The existing `version-check` guard blocks pushes to main without a version bump. `slope version bump` works through branches (not direct main pushes) so it's compatible.
