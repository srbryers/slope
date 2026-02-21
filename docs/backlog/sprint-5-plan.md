# Sprint 5 — Universal Dev Tooling + Dogfood

**Par:** 4 | **Slope:** 1 (`minor: new template files`) | **Type:** infra + dx
**Theme:** Make `slope init --claude-code` install MCP config and CLAUDE.md (like Cursor), and dogfood SLOPE in its own repo.

## Tickets

### S5-1: Add `installClaudeCodeMcpConfig()` to CLI init
- **Club:** wedge | **Complexity:** small
- Added `installClaudeCodeMcpConfig(cwd)` — mirrors `installCursorMcpConfig` but writes `.mcp.json`
- Reuses `SLOPE_MCP_ENTRY` constant; same merge-without-clobber logic
- Wired into `case 'claude-code'` after `installClaudeCodeTemplates(cwd)`
- 3 new tests in `init-mcp.test.ts`

### S5-2: Add CLAUDE.md template to `slope init --claude-code`
- **Club:** putter | **Complexity:** trivial
- Created `templates/claude-code/CLAUDE.md` with commands, MCP tools, workflow, scorecards
- Added copy with `existsSync` guard in `installClaudeCodeTemplates()`
- 2 new tests (creates when missing, doesn't overwrite existing)

### S5-3: Dogfood — wire SLOPE into its own repo
- **Club:** short_iron | **Complexity:** small
- Created `.mcp.json` pointing to local build (`node packages/mcp-tools/dist/index.js`)
- Created hand-authored `CLAUDE.md` with monorepo structure, commands, conventions
- Verified `.mcp.json` not gitignored; smoke-tested MCP server

### S5-4: Update README + docs
- **Club:** putter | **Complexity:** trivial
- Updated README CLI table, Claude Code section (+2 outputs), packages table (+mcp-tools row)
- Added Claude Code section to mcp-tools README

## Execution Order

```
S5-1 → S5-2 → S5-3 → S5-4
```
