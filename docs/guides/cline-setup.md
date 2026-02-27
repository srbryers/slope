# SLOPE + Cline Setup Guide

SLOPE integrates with [Cline](https://cline.bot) (v3.36+) via its per-event hook system for guard enforcement and context injection.

## Quick Start

```bash
slope init --cline
```

This installs:
- `.clinerules/` — SLOPE rules (sprint checklist, commit discipline, review loop, codebase context)
- `.clinerules/hooks/` — Created during `slope hook add --level=full --harness=cline`

## Installing Guard Hooks

```bash
slope hook add --level=full --harness=cline
```

This creates per-event scripts in `.clinerules/hooks/`:
- `PreToolUse` — runs before each tool call (can block)
- `PostToolUse` — runs after each tool call (context injection)
- `TaskCancel` — runs when user cancels a task
- `PreCompact` — runs before conversation history truncation
- `slope-guard.sh` — dispatcher script called by event scripts

Each event script reads JSON from stdin, routes to matching SLOPE guards, and returns `{ cancel, contextModification, errorMessage }` on stdout.

## MCP Server Setup

Cline's MCP configuration lives in VS Code's extension storage (not in the workspace). Add the SLOPE MCP server through Cline's settings UI or edit the config file directly:

**Via Cline UI:** Settings > MCP Servers > Add Server
- Name: `slope`
- Command: `npx`
- Args: `@slope-dev/slope/mcp`

**Manual config** (in `cline_mcp_settings.json` in VS Code extension storage):
```json
{
  "mcpServers": {
    "slope": {
      "command": "npx",
      "args": ["@slope-dev/slope/mcp"],
      "alwaysAllow": [],
      "disabled": false
    }
  }
}
```

## How Hooks Work

Cline uses a git-style hook model: one executable script per event in `.clinerules/hooks/`. When Cline triggers a tool call:

1. Cline sends JSON on stdin with tool name, parameters, and metadata
2. The event script runs all matching SLOPE guards
3. If any guard returns `cancel: true`, Cline blocks the tool call
4. `contextModification` text is injected into the agent's context
5. `errorMessage` is shown to the user when blocked

Hooks are **fail-open**: if a script errors without returning valid JSON, execution proceeds.

## Platform Notes

- **macOS/Linux only** — Cline's hook execution is disabled on Windows in the current source
- Hook scripts must be executable (`chmod +x`)
- `slope init --cline` and `slope hook add` handle permissions automatically

## Supported Guard Features

| Feature | Supported |
|---------|-----------|
| PreToolUse (block/allow) | Yes |
| PostToolUse (context) | Yes |
| Stop (TaskCancel) | Yes |
| PreCompact | Yes |
| Context injection | Yes (50KB max) |
| Ask decision | No (maps to allow) |
| Tool name filtering | Yes (in-script) |
