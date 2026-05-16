# Codex Setup

SLOPE supports Codex through `hooks.json` shims plus `AGENTS.md` project guidance.

## Active Runtime Path

Use one of these hook locations:

- Project-local: `.codex/hooks.json` and `.codex/hooks/slope-guard.sh`
- User-level: `~/.codex/hooks.json` and `~/.codex/hooks/slope-guard.sh`

Project-local is the default:

```bash
slope hook add --level=full --harness=codex
```

User-level hooks are useful when you want one Codex hook config to cover every SLOPE repo:

```bash
slope hook add --level=full --harness=codex --scope=user
```

Do not keep both paths active for the same SLOPE guards unless you intentionally want duplicate hook firing.

## Trust Review

After installing or changing Codex hooks, restart Codex and run `/hooks`. Codex currently labels rows as `Hook 1`, `Hook 2`, etc. SLOPE still writes `statusMessage` because it is useful during runtime, but it does not change those review-row titles.

## Plugin Bundle

`slope init --codex` creates `.codex/plugins/slope/` with:

- `.codex-plugin/plugin.json`
- `hooks.json`
- `hooks/slope-guard.sh`

This bundle is metadata for future Codex `plugin_hooks` support. Keep using project or user `hooks.json` shims as the active runtime path until Codex plugin hook loading is reliable.

## Verification

```bash
python3 -m json.tool ~/.codex/hooks.json
bash -n ~/.codex/hooks/slope-guard.sh
codex debug prompt-input 'global hooks only parse smoke'
~/.codex/hooks/slope-guard.sh branch-before-commit
```

Then run a harmless command in a SLOPE repo and confirm `.slope/guard-metrics.jsonl` receives a fresh entry.
