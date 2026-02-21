# Sprint 3 — Publish MCP + Cursor DX

**Par:** 4 | **Slope:** 2 (`external_dep`, `new_area`) | **Type:** feature + docs
**Theme:** Publish @slope-dev/mcp-tools, wire SLOPE into Cursor by default, and polish docs.

---

## Pre-Round Briefing

Sprint 2 delivered provider-agnostic init (--cursor, --generic), auto-card, and next-sprint detection. The new `@slope-dev/mcp-tools` package is in the repo and builds; it has not been published to npm yet. This sprint gets the MCP server published, makes `slope init --cursor` optionally add SLOPE as an MCP server in Cursor, adds tests for mcp-tools, and brings README/docs in line with the three-package layout.

**Hazard watch:**
- npm publish requires OTP; ticket S3-1 documents the steps and does any prep (version, files), but actual `npm publish` is manual.
- Writing `.cursor/mcp.json` from the CLI must merge with existing config if present, not overwrite.

---

## Tickets

### S3-1: Publish @slope-dev/mcp-tools and @slope-dev/cli to npm

- **Club:** putter | **Complexity:** small
- **Scope:** version checks, publish checklist in docs.
- **Description:**
  - Ensure [packages/mcp-tools/package.json](packages/mcp-tools/package.json) has correct `files`, `repository`, and no private deps. Bump to 0.1.0 if not already.
  - Ensure [packages/cli/package.json](packages/cli/package.json) is at 0.4.0 and depends on `@slope-dev/core@^0.3.3`.
  - Add a short **Publishing** section to the root [README](README.md) or to [docs/backlog/README.md](docs/backlog/README.md): list order (core first if needed), then `pnpm --filter @slope-dev/mcp-tools build && npm publish -w packages/mcp-tools --access public`, then CLI; note that 2FA/OTP is required (`npm publish --otp=<code>`).
- **Acceptance:** Version and metadata are correct; maintainer can run publish steps from the doc without guessing.

### S3-2: slope init --cursor adds optional MCP config for @slope-dev/mcp-tools

- **Club:** short_iron | **Complexity:** medium
- **Scope:** [packages/cli/src/commands/init.ts](packages/cli/src/commands/init.ts), new flag or prompt.
- **Description:**
  - When `slope init --cursor` runs, optionally add or merge into `.cursor/mcp.json` an entry for the `slope` MCP server that runs `npx @slope-dev/mcp-tools` (or `mcp-slope-tools` from bin).
  - If `.cursor/mcp.json` already exists, parse it, add or update the `slope` server entry, and write back. If it does not exist, create it with only the slope server.
  - Use a flag (e.g. `--mcp`) to gate this so existing behavior stays default: `slope init --cursor --mcp` adds MCP config.
- **Acceptance:** `slope init --cursor --mcp` creates or updates `.cursor/mcp.json` with a valid slope MCP entry; running without `--mcp` does not touch MCP config.

### S3-3: Unit tests for @slope-dev/mcp-tools

- **Club:** wedge | **Complexity:** small
- **Scope:** [packages/mcp-tools/](packages/mcp-tools/).
- **Description:**
  - Add a test script and a small unit test suite (e.g. vitest or node test runner) that:
    - Builds or uses `createSlopeToolsServer()` and verifies the server lists 10 tools.
    - Optionally calls one or two tools (e.g. `compute_handicap` with empty scorecards, `build_scorecard` with minimal input) and asserts on non-throwing and expected shape of the result content.
  - No need to test every tool; cover the factory and at least one read-only tool.
- **Acceptance:** `pnpm --filter @slope-dev/mcp-tools test` (or equivalent) passes; new contributors can run tests before publishing.

### S3-4: README and docs refresh for three packages + MCP

- **Club:** putter | **Complexity:** small
- **Scope:** [README.md](README.md), optionally [docs/framework.md](docs/framework.md).
- **Description:**
  - In README, add `@slope-dev/mcp-tools` to the Packages table with one-line description.
  - In README, add a short **Cursor MCP** section: how to install and add `slope` to `.cursor/mcp.json` (or point to `slope init --cursor --mcp` once S3-2 is done).
  - Ensure CLI table includes `tournament`, `auto-card`, `next` if not already.
  - Optionally add a single "Recent" or "Backlog" pointer to [docs/backlog/](docs/backlog/) so future sprint plans are discoverable.
- **Acceptance:** README accurately describes all three packages and how to use SLOPE in Cursor via MCP; CLI table is complete.

---

## Scorecard Shape (projected)

- **Par:** 4, **Slope:** 2
- **Projected score:** 4 (par)
- **Yardage book:** Cursor MCP config lives under `.cursor/mcp.json`; merge-on-write when adding slope server.

---

## Execution Order

- S3-1 and S3-4 can run in parallel (publish checklist + README).
- S3-2 depends only on current CLI; can run in parallel with S3-3.
- S3-3 is independent.
- After sprint: file scorecard as [docs/retros/sprint-3.json](docs/retros/sprint-3.json).
