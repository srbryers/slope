# SLOPE + Continue Setup Guide

[Continue](https://continue.dev) does not have a tool-level hook system, so SLOPE guard integration is limited to manual/GenericAdapter usage. However, Continue's MCP support and rules system provide read-only access to SLOPE data.

## MCP Server Setup

Continue supports MCP servers in Agent mode. Add the SLOPE MCP server to your Continue config:

**`~/.continue/config.yaml`:**
```yaml
mcpServers:
  - name: slope
    command: npx
    args: ["@slope-dev/slope/mcp"]
```

**Or as a standalone file** (`.continue/mcpServers/slope.yaml` in your workspace):
```yaml
name: slope
command: npx
args: ["@slope-dev/slope/mcp"]
```

This gives Continue's Agent mode access to SLOPE's search and execute tools for querying scorecards, handicap cards, and codebase maps.

## Rules Setup

Continue's rules system provides static instructions to the agent. Add SLOPE-aware rules:

**`.continuerules`** (workspace root):
```
Use SLOPE for sprint tracking. Run `slope briefing` before starting work.
Commit early, commit often. Push after completing each ticket.
```

**Or as structured rules** (`.continue/rules/slope.md`):
```markdown
---
name: SLOPE Sprint Discipline
alwaysApply: true
---

- Run `slope briefing` before starting any sprint work
- Commit after each file creation, feature, or bug fix
- Push after completing each ticket
- Run `slope validate` on scorecards before merging
```

## Limitations

Continue does **not** support:
- Tool-level hooks (PreToolUse, PostToolUse, etc.)
- Blocking tool execution
- Dynamic context injection from guards
- Automated guard enforcement

These limitations are inherent to Continue's architecture — there is no hook or middleware system for tool calls.

## GenericAdapter for Manual Integration

For projects that need guard enforcement, use SLOPE's GenericAdapter:

```bash
# Run a guard manually
echo '{"tool_name":"write_file","file_path":"src/index.ts"}' | slope guard hazard

# Install generic guard hooks
slope hook add --level=full --harness=generic
```

The GenericAdapter outputs JSON that can be consumed by external scripts or CI pipelines.

## Why No `--continue` Init Flag

Continue's configuration (`~/.continue/config.yaml`) is global — it lives in the user's home directory, not in the workspace. The `slope init` command is workspace-scoped and cannot reliably resolve or write to user-specific global paths. Configure Continue manually per the instructions above.
