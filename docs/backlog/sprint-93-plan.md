# Sprint 93 Plan - Codex Hook Recovery

**Par:** 4 (4 tickets)
**Slope:** 2 (external Codex hook behavior, install-path assumptions, diagnostics)
**Theme:** Make SLOPE's Codex hooks install into the hook sources Codex actually loads, then make failures visible.
**Branch:** create `fix/codex-hook-recovery` before continuing implementation.

---

## Context

Source handoff: `docs/tech/codex-slope-hooks-handoff.md`, copied from `/Users/sebastianbryers/Development/fathoms/docs/tech/codex-slope-hooks-handoff.md`.

The handoff and local investigation found concrete Codex hook drift:

- Codex docs now require `hooks.json` to contain a top-level `"hooks"` object.
- SLOPE's `CodexAdapter.generateHooksConfig()` wrote `PreToolUse`, `PostToolUse`, and `Stop` at the JSON root, so project hooks installed by `slope hook add --harness=codex` were not in the documented shape.
- User-level hooks in `/Users/sebastianbryers/.codex/hooks.json` are verified locally and are the current active runtime path.
- Codex plugin hook discovery remains blocked: plugin hooks are under development and not a reliable trust/review/runtime surface yet.
- Current Codex matcher support is narrower than full Claude parity. The verified local config uses grouped `Bash`, `Agent`, `ExitPlanMode`, and `EnterWorktree` matchers, while current docs also call out `apply_patch` aliases and MCP tool names.
- Project-local Codex hooks only load from trusted `.codex/` project layers and may need review via `/hooks`.
- Codex `/hooks` displays rows as `Hook 1`, `Hook 2`, etc. It parses `statusMessage`, but does not use names/descriptions/status messages as review-row titles.

Primary reference: OpenAI Codex hooks docs, checked against local `codex-cli 0.130.0`.

---

## Tickets

### S93-1: Fix Codex guard hooks.json shape and idempotent install

**Club:** wedge
**Files:**
- `src/core/adapters/codex.ts`
- `tests/core/adapters/codex.test.ts`

**Scope:**

1. Generate `{ "hooks": { ... } }`, not event keys at the file root.
2. Preserve non-SLOPE hook groups when merging.
3. Replace existing SLOPE-managed entries for the same dispatcher path on reinstall so repeated `slope hook add` does not duplicate hooks.
4. Include `statusMessage` for hook browser clarity.
5. Update write matcher aliases to include `apply_patch`.
6. Keep matcher groups coarse enough for `/hooks` review ergonomics.

**Acceptance:**
- `pnpm vitest run tests/core/adapters/codex.test.ts`
- `pnpm typecheck`

Status: initial patch landed in this session; keep this ticket open until full typecheck and review pass.

### S93-2: Add optional user-level Codex hook shim install path

**Club:** short_iron
**Files:**
- `src/core/adapters/codex.ts`
- `src/cli/commands/hook.ts`
- `tests/core/adapters/codex.test.ts`

**Scope:**

1. Add a deliberate option for Codex installs to target the user config layer, e.g. `slope hook add --level=full --harness=codex --scope=user`.
2. Write the dispatcher to `~/.codex/hooks/slope-guard.sh`.
3. Register grouped SLOPE guards in `~/.codex/hooks.json`.
4. Keep project-local `.codex/hooks.json` as the default behavior unless `--scope=user` is explicitly requested.
5. Dispatcher behavior must match the verified shim from the handoff: exit outside repos with `.slope/`, resolve git root, prefer project `node_modules/.bin/slope`, fall back to `slope` on PATH, then run `slope guard <guard>`.
6. Avoid duplicate global + project firing guidance in output: explain that users should choose one active runtime path.

**Acceptance:**
- `pnpm vitest run tests/core/adapters/codex.test.ts`
- Unit coverage for optional user-level install path.
- Re-running the user-level install does not duplicate hook entries.

### S93-3: Generate SLOPE Codex plugin bundle for future `plugin_hooks` support

**Club:** short_iron
**Files:**
- `src/cli/commands/init.ts`
- `src/cli/template-generator.ts`
- `templates/codex/` or generated `.codex-plugin/`
- `tests/cli/init-codex.test.ts`

**Scope:**

1. Generate a Codex plugin bundle for SLOPE with `.codex-plugin/plugin.json`.
2. Include the packaged guard dispatcher script.
3. Include bundled hook metadata for future `plugin_hooks` support.
4. Keep generated plugin hooks advisory/inactive by default until Codex plugin hook loading is reliable.
5. Document that global/project `hooks.json` remains the active runtime path.

**Acceptance:**
- `slope init --codex` creates or updates the plugin bundle without overwriting user-managed files.
- Tests assert plugin manifest shape and dispatcher presence.

### S93-4: Add diagnostics and docs for Codex hook trust, runtime path, and coverage limits

**Club:** short_iron
**Files:**
- `src/cli/commands/doctor.ts`
- `src/cli/commands/guard.ts`
- `tests/cli/commands/doctor.test.ts`
- `docs/guides/codex-setup.md` or existing setup docs

**Scope:**

1. Detect Codex hooks files missing the top-level `"hooks"` key.
2. Check `.codex/hooks/slope-guard.sh` and session scripts are executable and have a shebang.
3. Surface guidance to run `/hooks` in Codex when project-local hooks may need trust review.
4. Detect and explain the duplicate-hook risk when both `~/.codex/hooks.json` and `<repo>/.codex/hooks.json` contain SLOPE guard entries.
5. Document that `statusMessage` helps runtime status text but does not improve `/hooks` row titles.
6. Keep diagnostics advisory unless the user runs `slope doctor --fix`.

**Acceptance:**
- Doctor tests cover malformed Codex hook shape and non-executable hook scripts.
- `slope doctor --fix` repairs the shape where it can preserve existing hooks safely.
- Docs describe the active global/project shim path and the blocked plugin hook path.

---

## Verification

Run before closing the sprint:

```bash
pnpm build
pnpm typecheck
pnpm test
slope validate
```

Record Codex-specific manual verification in the scorecard:

```bash
python3 -m json.tool ~/.codex/hooks.json
bash -n ~/.codex/hooks/slope-guard.sh
codex debug prompt-input 'global hooks only parse smoke'
~/.codex/hooks/slope-guard.sh branch-before-commit
```

Then open `/hooks` after Codex restart, trust the user-level hooks, run a harmless command in this repo, and confirm `.slope/guard-metrics.jsonl` receives a fresh entry.
