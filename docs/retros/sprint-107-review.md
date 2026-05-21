## Sprint 107 Review: Codex Plugin Packaging

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 4 |
| Slope | 2 |
| Score | 4 |
| Label | Par |
| Fairway % | 100% (1/1) |
| GIR % | 100% (1/1) |
| Putts | 0 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 1)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S107-1 | Long Iron | Green | - | Upgraded the Codex bundle from a metadata stub into a named local plugin package with skills, MCP metadata, generated full guard hook metadata, local marketplace metadata, install/update behavior, version-bump alignment, docs, and init regression tests. |

### Hazards Discovered

Known hazards for future sprints:

- Codex plugin packaging needs marketplace metadata under .agents/plugins/marketplace.json; a loose plugin folder is not enough for stable marketplace discovery.
- Codex plugin_hooks is still under development and disabled in local codex-cli 0.130.0, so SLOPE guard enforcement must continue to use project or user hooks.json shims.
- Version bumps must update templates/codex/plugins/slope/.codex-plugin/plugin.json so the packaged plugin does not drift from @slope-dev/slope.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Codex plugin packaging has two separate surfaces: stable marketplace plugins and under-development plugin_hooks. | The SLOPE bundle now includes local marketplace metadata while keeping active guard enforcement on the stable hooks.json shim until plugin_hooks is enabled. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | Plugin JSON, hook JSON, MCP JSON, dispatcher shell syntax, typecheck, build, focused Codex tests, and full Vitest suite passed. |

### Course Management Notes

- Validation used python3 -m json.tool on plugin.json, hooks.json, and .mcp.json plus bash -n on the plugin dispatcher.
- Additional validation used pnpm run typecheck, pnpm run build, pnpm vitest run tests/cli/init-codex.test.ts tests/core/adapters/codex.test.ts tests/cli/commands/hook-codex.test.ts tests/cli/init-summary.test.ts, and pnpm test.
- Local Codex CLI check used codex features list and confirmed plugins is stable while plugin_hooks remains under development and disabled.

### 19th Hole

- **How did it feel?** A packaging sprint more than a runtime rewrite: most of the work was making the boundary explicit, updateable, and honest about Codex's current plugin-hook limits.
- **Advice for next player?** Keep active guard behavior on hooks.json until Codex reports plugin_hooks as stable; use marketplace metadata for plugin discovery and skills.
- **What surprised you?** The existing bundle already existed, but without marketplace metadata or generated full guard metadata it was closer to a placeholder than an installable plugin package.
- **Excited about next?** Once plugin_hooks stabilizes, the same bundle can become the active hook runtime without moving SLOPE guard logic out of the CLI.
