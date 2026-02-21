# SLOPE Backlog

Sprint plans and backlog items for the SLOPE framework (core, CLI, MCP tools).

| Sprint | Plan | Theme |
|--------|------|--------|
| 3 | [sprint-3-plan.md](sprint-3-plan.md) | Publish MCP + Cursor DX |

After each sprint, file the scorecard in [../retros/](../retros/) as `sprint-N.json`.

---

## Publishing

Publish order (from repo root, with 2FA/OTP available):

1. **Core** (if needed): `pnpm --filter @slope-dev/core build && npm publish -w packages/core --access public`
2. **MCP tools:** `pnpm --filter @slope-dev/mcp-tools build && npm publish -w packages/mcp-tools --access public`
3. **CLI:** `pnpm --filter @slope-dev/cli build && npm publish -w packages/cli --access public`

If npm prompts for a one-time password: `npm publish -w packages/<name> --access public --otp=<code>`

For the CLI, ensure `packages/cli/package.json` uses a concrete range for `@slope-dev/core` (e.g. `^0.3.3`) before publishing, or use `pnpm publish` which resolves workspace deps.
