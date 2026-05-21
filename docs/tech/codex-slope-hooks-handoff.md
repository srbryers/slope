# Codex SLOPE Hooks Handoff

**Date:** 2026-05-16
**Status:** Global Codex hooks are active locally; SLOPE plugin runtime hooks remain blocked by Codex plugin hook discovery. SLOPE now ships a named Codex plugin bundle for skills, MCP metadata, local marketplace metadata, and future plugin hook metadata.

## Current Local State

- User-level Codex hook config exists at `/Users/sebastianbryers/.codex/hooks.json`.
- User-level dispatcher exists at `/Users/sebastianbryers/.codex/hooks/slope-guard.sh`.
- The dispatcher exits silently outside repos with `.slope/`.
- Inside a SLOPE repo, it resolves the git root, finds project-local `node_modules/.bin/slope` first, falls back to `slope` on PATH, then runs `slope guard <guard>`.
- Temporary project-local `.codex/` hook files were removed from this repo to avoid duplicate global + project hook firing.

## Verified

- `python3 -m json.tool /Users/sebastianbryers/.codex/hooks.json`
- `bash -n /Users/sebastianbryers/.codex/hooks/slope-guard.sh`
- `codex debug prompt-input 'global hooks only parse smoke'`
- Direct dispatcher smoke: `/Users/sebastianbryers/.codex/hooks/slope-guard.sh branch-before-commit`
- Fresh SLOPE metrics appeared in `.slope/guard-metrics.jsonl` at `2026-05-16T12:15:02Z`.

## GitHub Issue

Confirmed the plugin-hook blocker on OpenAI Codex issue #16430:

https://github.com/openai/codex/issues/16430#issuecomment-4466849077

Observed locally on Codex CLI `0.130.0`:

- `hooks` feature is stable and enabled.
- `plugin_hooks` exists but is under development and disabled.
- Config-layer hooks are discovered by `/hooks`.
- Plugin-local hooks are not currently a reliable trust/review/runtime surface.

## SLOPE Work Completed

In `/Users/sebastianbryers/Development/slope`:

1. `src/core/adapters/codex.ts` installs project or user-level hook shims.
2. `slope init --codex` generates a Codex plugin bundle for SLOPE with:
   - `.codex-plugin/plugin.json`
   - packaged guard dispatcher script
   - bundled hook metadata for future plugin-hook support
   - `skills/` workflow guidance
   - `.mcp.json` server metadata
   - `.codex/.agents/plugins/marketplace.json` local marketplace metadata
3. The global/project `hooks.json` shim remains the active runtime path until Codex plugin hook loading works.
4. Tests cover:
   - top-level `{ "hooks": ... }` shape
   - current Codex matcher names (`Bash`, `Agent`, `ExitPlanMode`, `EnterWorktree`)
   - optional global install path
   - no duplicate install on repeated `slope hook add --level=full --harness=codex`
   - `slope init --codex` plugin bundle install/update behavior

## Important Findings

- Codex `/hooks` labels hook review rows as `Hook 1`, `Hook 2`, etc. It ignores `name`, `description`, and `statusMessage` for row titles.
- `statusMessage` still parses and is useful as runtime status text, but it does not solve review readability.
- Do not encode labels into command strings as `SLOPE_HOOK_NAME=...`; that works visually but is an ugly trust-hash churn workaround.
- Prefer fewer matcher groups with multiple command handlers for review ergonomics. The current global config groups related SLOPE guards by event and matcher.

## Next Session Checklist

1. Open `/hooks` after Codex restart and trust the user-level hooks from `/Users/sebastianbryers/.codex/hooks.json`.
2. Run a harmless command in this repo.
3. Confirm `.slope/guard-metrics.jsonl` receives a new entry.
4. Patch SLOPE's Codex adapter in `/Users/sebastianbryers/Development/slope`.
5. Run SLOPE adapter tests.
