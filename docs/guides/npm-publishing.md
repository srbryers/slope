# npm Publishing

SLOPE publishes `@slope-dev/slope` from the `Publish to npm` GitHub Actions workflow when a GitHub release is published.

## Trusted Publishing Setup

The workflow uses npm trusted publishing with GitHub Actions OIDC. The npm package settings must have a trusted publisher configured:

- Provider: GitHub Actions
- GitHub owner: `srbryers`
- Repository: `slope`
- Workflow filename: `publish.yml`
- Allowed action: `npm publish`

The workflow file must keep:

- `permissions.id-token: write`
- `actions/setup-node` using Node `24`
- npm CLI `11.5.1` or newer before `npm publish`
- no `NODE_AUTH_TOKEN`/`NPM_TOKEN` publish step fallback

npm trusted publishing automatically generates provenance; do not pass a long-lived npm token unless deliberately reverting to token-based publishing.

Reference: https://docs.npmjs.com/trusted-publishers/

## Recovering a Failed Publish

If a GitHub release exists but npm is behind:

1. Confirm the npm version:
   ```sh
   npm view @slope-dev/slope version --registry https://registry.npmjs.org
   ```
2. Confirm the trusted publisher settings above on npmjs.com.
3. Re-run the failed `Publish to npm` workflow for the release tag.
4. Verify npm now reports the release version:
   ```sh
   npm view @slope-dev/slope version --registry https://registry.npmjs.org
   ```

For the `v1.55.12` incident, npm reported `1.55.11` after the GitHub release was published. After trusted publishing is configured, re-run the `v1.55.12` publish workflow and verify npm reports `1.55.12`.

## Token Fallback

Token-based publishing is not the default path. If trusted publishing must be disabled, replace the publish step with a scoped npm automation/granular token that has publish access to `@slope-dev/slope`, store it as `NPM_TOKEN`, and verify the token before publishing:

```sh
npm whoami --registry https://registry.npmjs.org
npm access ls-collaborators @slope-dev/slope
```
