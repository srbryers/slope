---
name: slope-setup
description: Set up SLOPE in a Codex-managed repository without requiring the user to know CLI details. Trigger when the user asks to install, initialize, update, or verify SLOPE for Codex.
---

# SLOPE Setup For Codex

Use this when the user wants SLOPE available from an agent harness.

## Install Or Update

1. Run `slope init --codex` from the repository root.
2. If the repo already has SLOPE, run `slope doctor --fix` after init.
3. Prefer one active Codex hook path:
   - project-local: `.codex/hooks.json`
   - user-level: `~/.codex/hooks.json`
4. Avoid enabling both paths for the same repo unless the user explicitly wants duplicate hook firing.

## Verify

1. Run `slope doctor`.
2. Run `slope hook list`.
3. Run `python3 -m json.tool .codex/hooks.json` for project-local hooks, or `python3 -m json.tool ~/.codex/hooks.json` for user-level hooks.
4. Run `bash -n .codex/hooks/slope-guard.sh` or `bash -n ~/.codex/hooks/slope-guard.sh`.
5. Restart Codex and review `/hooks` after hook changes.

## Explain

Tell the user that the Codex plugin bundle groups SLOPE skills, MCP metadata, and future plugin-hook metadata under a named SLOPE integration. Active guard enforcement still uses the stable Codex hooks.json shim while Codex `plugin_hooks` is under development.
