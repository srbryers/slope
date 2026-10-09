# Development and delivery

Read this guide before changing checks or planning a release.
It records current rules. It cannot waive checks or grant release approval.

## Sources and scope

- Verified on **2026-10-09**, against `origin/main` at `fadcad310b5cee0dc7ef3f097120031862d4c74d`.
- Source and integration branch: `main`. Feature work uses `feat/`, `fix/`, or `chore/` branches and PRs.
- [AGENTS.md](../AGENTS.md), [CLAUDE.md](../CLAUDE.md), and applicable ancestor instructions own agent policy.
- [Branch discipline](../.claude/rules/branch-discipline.md), [commit discipline](../.claude/rules/commit-discipline.md), and [sprint checklist](../.claude/rules/sprint-checklist.md) keep their existing gates.
- [Release policy](../.claude/rules/release-policy.md) and [npm publishing](../docs/guides/npm-publishing.md) own release rules.
- [Package scripts](../package.json) and the workflows below own executable checks.
- Prompt source: [shared template at e938d054825d4b20b7d3fb63a4629e97b97a4142](https://github.com/srbryers/ci/blob/e938d054825d4b20b7d3fb63a4629e97b97a4142/templates/CI-CD.md).
- Template PR [ci#1](https://github.com/srbryers/ci/pull/1) is **pending**, not merged or universally adopted.

Read `CODEBASE.md` before exploration. It is ignored by Git and absent in fresh worktrees.
If you use another checkout's map, record its SHA. Check each claim against current source.
Use file-editing tools that take literal text. Do not write prose through inline shell scripts.

## Checks by change

Run commands at the isolated repository root unless a row gives another workspace.
Use Node compatible with [package.json](../package.json); CI uses Node 22, publishing uses Node 24.
Use pinned **pnpm 10.32.1**, then `pnpm install --frozen-lockfile` when dependencies are missing.
Native `better-sqlite3` needs a matching binary or local build tools.
Keep the lockfile intact. Do not use `pnpm install --force` or approve all install scripts.

| Change | Focused development evidence | Stable candidate evidence |
| --- | --- | --- |
| Prose and process | Readback, local links, `git diff --check`; compare every command with its source | **Full build, test and typecheck before committing**, including docs, under CLAUDE.md |
| CLI, core, guards, MCP | Affected `pnpm exec vitest run tests/<affected>.test.ts`; inspect callers | Full checks and Linux CI; retain Windows results |
| Store or schema | Affected SQLite and PG tests; follow migration docs | Linux CI with PostgreSQL 16; backup and compatibility gates remain separate |
| Pi extension or shared dependencies | Check affected consumers and native loading | `pnpm build` includes the Pi extension; full suite and typecheck |
| Release or docs manifest | Release checklist; `slope docs check` requires a generated manifest | Release and sync jobs repeat full checks; their PG tests skip without the URL |
| Stats worker | Read its [package](../workers/slope-stats/package.json) and [config](../workers/slope-stats/wrangler.toml) | Root CI is not worker deployment evidence; worker delivery approval remains separate |

Required local sequence: `pnpm build`, `pnpm test`, `pnpm typecheck`.
`pnpm test` skips PostgreSQL tests when `SLOPE_TEST_PG_URL` is unset.
For PG work, `pnpm test:pg` requires PostgreSQL on localhost:5432 with its scripted test database credentials.
The [CLAUDE.md Docker example](../CLAUDE.md) uses PostgreSQL 16. Use only your own test server and a free port.
Focused checks help during edits. They do not replace the full pre-commit rule or stable CI.
No dedicated Markdown lint script is defined.
`slope docs check` checks the generated manifest, not arbitrary Markdown links.
Roadmap source edits have their own compile and check rules. Never hand-edit the generated JSON.

## Current automation

| Workflow | Trigger and runner | Checks or output |
| --- | --- | --- |
| [CI](../.github/workflows/ci.yml) | Push to `main`; PRs targeting any branch; Ubuntu and Windows latest, Node 22 | Frozen install, build, test, typecheck |
| [Publish](../.github/workflows/publish.yml) | Published GitHub release; manual dispatch with validated `refs/tags/vX.Y.Z`; Ubuntu, Node 24 | Full checks, npm 11.5.1+, public package publication through OIDC |
| [Docs sync](../.github/workflows/sync-docs.yml) | Published release or manual dispatch; Ubuntu, Node 22 | Full checks, manifest/stats generation and validation, optional KV write, slope-web PR |
| [Issue scout](../.github/workflows/slope-issue-scout.yml) | Daily 13:17 UTC or manual dispatch; Ubuntu, Node 22 | Build, dry-run candidates, approval digest, artifacts; optional issue creation and email |

- Linux CI always supplies `SLOPE_TEST_PG_URL` through a PostgreSQL 16 service with a health check.
- Windows has no PG service and is **continue-on-error**, tracked by [#725](https://github.com/srbryers/slope/issues/725).
- Windows success is separate platform evidence. A green overall run can still contain Windows failures.
- No workflow declares a concurrency group or automatic cancellation policy.
- No explicit dependency cache is configured in these workflow files; pnpm reads its version from package.json.
- Publish grants `contents: read` and `id-token: write`; sync grants `contents: read`.
- Scout grants `contents: read` and `issues: write`; `GH_TOKEN` uses the run's GitHub token.
- Live default workflow permissions are read-only; Actions cannot approve PR reviews.
- CI has no explicit permissions block and uses that default; npm trusted-publisher settings still need separate account verification.
- Sync secret names: `CLOUDFLARE_API_TOKEN`, `SLOPE_STATS_KV_NS_ID`, `SLOPE_WEB_PAT`.
- `SLOPE_WEB_PAT` needs repository read/write access for slope-web checkout, push and PR creation, as the workflow documents.
- Scout secret names: `RESEND_API_KEY`, `SLOPE_DIGEST_EMAIL_TO`, `SLOPE_DIGEST_EMAIL_FROM`.
- Publishing uses trusted publishing. Do not add `NODE_AUTH_TOKEN` or `NPM_TOKEN` as an unapproved fallback.
- No workflow names a protected environment. Live environments and rulesets were empty on the verification date.
- Live `main` protection returned **404: Branch not protected**. This does not remove manual PR or release gates.

## Review, merge and release

1. Use an isolated feature worktree. Keep shared checkouts and operational state untouched.
2. Run prescribed checks before committing. Follow the existing per-file commit and push rules.
3. Open a PR with the exact head, commands, results, failures and remaining gates.
4. Obtain independent review under the existing review and sprint rules. Do not self-approve.
5. Merge only the reviewed head after required evidence and Sebastian's applicable approval.
6. Treat package publication, docs sync, worker delivery and consumer adoption as separate outcomes.

Human gate owner: **Sebastian** under this task's approval rules.
Required-check names and release/environment gate owners are **unresolved** beyond the live settings above.
The [release checklist](../.claude/rules/release-policy.md) requires full checks, map/manifest freshness, merged features and a clean tree.
It also requires changelog review for slope-web content needs.
`slope version bump` creates and merges release work. Run it only with separate release approval.
After approved version work and passing main CI, the policy uses `gh release create vX.Y.Z --target main --generate-notes`.
Never publish directly from a local shell. A docs PR grants no release approval.

## Verify the delivered result

- **Package:** record release tag, resolved source SHA, publish run, npm version and provenance.
- Read-only registry check: `npm view @slope-dev/slope version --registry https://registry.npmjs.org`.
- **Consumer:** verify the affected CLI/MCP/Pi journey against the installed package, in an isolated consumer workspace.
- **Native:** record OS, architecture, Node ABI and SQLite extension loading; Linux evidence alone does not prove Windows behavior.
- **Docs:** sync creates a PR on slope-web `main` through `chore/docs-manifest-sync`; it does not deploy the site.
- Check generated manifest version and `gitSha`, then review any new feature/setup/breaking-change content manually.
- **Stats:** sync writes KV only when its token is configured. Compare the served stats with the generated artifact.
- **Worker:** manual `npm run deploy` belongs in `workers/slope-stats`, with worker-local dependencies, Wrangler, Cloudflare access and separate approval.
- Worker deployment, site browser verification and device acceptance are not proved by package publication or source tests.

## Failures, rollback and host cleanup

Keep failed and superseded run URLs, logs and cancellation history.
Find the cause of source, install, runner and access failures.
Batch known repairs before a stable push. Record the reason for a rerun. Get approval where needed.
Do not hide defects with skips, threshold changes, baseline/hash refreshes or manual cancellation.
Use the [failed-publish recovery](../docs/guides/npm-publishing.md) only with release approval. This rollout runs no retries.
There is no automatic npm rollback or unpublish workflow.
Consumer pin changes or a corrective release need their own approval.

[Store docs](../docs/store.md) and the [2.0 migration guide](../docs/guides/sprint-id-2-migration.md) own database recovery.
Back up before the new binary opens a store; opening applies migrations.
Never run 1.x against a store after 2.0 writes canonical values.
Downgrade requires stopping writers, reinstalling 1.64.1 and restoring the pre-2.0 backup or PG dump.
Restore loses records written after backup unless you save them first.
Worker/KV and hosted-site rollback steps are **unresolved**. Sebastian must confirm the saved builds and access.

For local servers, choose a free port and verify responses belong to this worktree and build.
Record the PID, source SHA and artifact identity. Stop only owned processes and remove only owned outputs.
Do not use global `pkill`, shared cleanup or CPU burners. Preserve receipts needed for review.
Update this guide in the same PR as future workflow or check changes; leave each source of policy intact.
