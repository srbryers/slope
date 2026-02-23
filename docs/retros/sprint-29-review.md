
## Sprint 29 Review: Fix NPM Publishing Pipeline

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 5 |
| Slope | 1 |
| Score | 5 |
| Label | Par |
| Fairway % | 100% (6/6) |
| GIR % | 66.7% (4/6) |
| Putts | 2 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 6)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S29-1 | Wedge | In the Hole | — | Two vi.mock() paths in next-action.test.ts and guards.test.ts didn't match import paths after package consolidation. Changed '../src/store.js' → '../../src/cli/store.js' and '../src/config.js' → '../../src/cli/config.js'. 20 tests fixed, CI green. |
| S29-2 | Putter | In the Hole | — | Rewrote scripts/version-bump.mjs to bump single root package.json for @slope-dev/slope instead of looping over 5 old @srbryers/* packages. |
| S29-3 | Wedge | Green | wrong_token_type: User first created a classic publish token (requires OTP) instead of a granular access token. Required a second attempt with the correct token type. | Manual step — replaced classic NPM publish token (EOTP error) with granular access token scoped to @slope-dev/slope. Updated NPM_TOKEN GitHub Actions secret. Took two attempts due to initial token type confusion. |
| S29-4 | Putter | In the Hole | — | Deleted failed v1.5.0-npm release and stale v1.5.0 release (GitHub Packages era) with their tags via gh CLI. |
| S29-5 | Putter | In the Hole | — | Added pull_request trigger to .github/workflows/ci.yml. CI previously only ran on push to main. |
| S29-6 | Short Iron | Green | publish_retry: First publish attempt failed due to wrong token type from S29-3. Re-ran workflow after token was corrected — succeeded on second attempt. | Bumped version to 1.5.1, created GitHub Release v1.5.1, watched publish workflow succeed. Verified @slope-dev/slope@1.5.1 live on npm with provenance attestation. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| Wind | none | Sprint was reactive — fixing breakage from recent consolidation refactor, not greenfield work |
| Altitude | minor | NPM token types and OIDC/provenance are under-documented — required trial and error for correct token configuration |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| wrong_token_type | S29-3 | User first created a classic publish token (requires OTP) instead of a granular access token. Required a second attempt with the correct token type. |
| publish_retry | S29-6 | First publish attempt failed due to wrong token type from S29-3. Re-ran workflow after token was corrected — succeeded on second attempt. |

**Known hazards for future sprints:**
- NPM classic publish tokens require OTP in CI — always use Granular Access Tokens for GitHub Actions
- vi.mock() paths must exactly match the import paths used in the module under test — Vitest resolves them independently
- Creating a GitHub Release from a stale commit runs the workflow version at that commit, not HEAD

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| Hydration | healthy | Full build + test + typecheck verified locally before every commit and confirmed green on CI |
| Diet | healthy | Commit-per-ticket discipline maintained — 5 code commits plus version bump, all pushed promptly |
| Supplements | healthy | No new tests written — sprint fixed 20 existing broken tests. 1161 total tests passing. |
| Recovery | healthy | Added .env to .gitignore immediately after user placed NPM token in local .env — prevented credential leak |

### Course Management Notes

- 6 tickets, par 5, score 5 — clean par with 2 minor hazards (token type, publish retry) absorbed without penalties
- Slope 1 confirmed appropriate — all small fixes and config changes, no new infrastructure
- Sprint type: fix — reactive cleanup after consolidation refactor broke CI and publish pipeline
- @slope-dev/slope@1.5.1 published to npm with provenance attestation — pipeline verified end-to-end

### 19th Hole

- **How did it feel?** Fast, low-resistance sprint. All code fixes were surgical — 2-line mock path corrections, 13-line script rewrite, 2-line YAML addition. The only friction was external: NPM token types are confusing and the first token was the wrong type.
- **Advice for next player?** When publishing scoped packages to npm from GitHub Actions: use a Granular Access Token (not Classic Publish, not Classic Automation). Classic tokens require OTP even in CI. Granular tokens bypass OTP and can be scoped to specific packages. The --provenance flag requires id-token: write permission in the workflow.
- **What surprised you?** The consolidation from 5 packages to 1 only broke 2 test files (mock paths), not the source code itself. The publish workflow was already correctly updated but the release was created from a stale commit that ran the old workflow.
- **Excited about next?** The release pipeline is now fully automated: bump version → push → create GitHub Release → auto-publish to npm with provenance. Future releases are a 3-step process.

