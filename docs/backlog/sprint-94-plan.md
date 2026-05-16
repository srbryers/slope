# Sprint 94 Plan - Guard Enforcement Hardening

**Par:** 4 (4 tickets)
**Slope:** 2 (guard dispatcher/runtime behavior, Codex hook coverage, doctor diagnostics, config semantics)
**Theme:** Turn the #368 patch into a provable guard-enforcement contract.
**Branch:** create `hardening/s94-guard-enforcement` before implementation.

---

## Context

S93 restored Codex hook loading and v1.55.5 fixed the immediate #368 failure:

- `claim-required` now runs in `adhoc` sessions for implementation writes with no active sprint.
- The no-sprint implementation path returns `permissionDecision: "ask"` with sprint/claim guidance.
- Most other sprint-workflow guards still suppress in `adhoc`, but now write `decision: "suppressed"` metrics.
- Published package `@slope-dev/slope@1.55.5` verifies the global dispatcher path.

This is enough for the emergency patch, but not enough for a mature workflow-control guard. S94 hardens the full path agents actually hit: matcher install, CLI dispatcher, metrics, doctor diagnostics, and configurable strictness.

---

## Tickets

### S94-1: Dispatcher-level regression tests for adhoc claim-required and suppressed workflow guards

**Club:** short_iron
**Files:**
- `src/cli/commands/guard.ts`
- `tests/cli/commands/guard.test.ts`
- `tests/cli/guards/claim-required.test.ts`

**Scope:**

1. Add tests that exercise the real `guardCommand()` path with hook-style JSON input, not only helper functions.
2. Verify `claim-required` in `session_mode: "adhoc"` + no sprint + implementation path emits `permissionDecision: "ask"`.
3. Verify a suppressed sprint-workflow guard records `decision: "suppressed"` with `reason: "adhoc-session"`.
4. Cover batch execution if the active hook install groups multiple write guards into one invocation.
5. Keep tests isolated from the developer's real `.slope/` state and global Codex config.

**Acceptance:**
- Focused tests prove the CLI dispatcher output shape and metrics JSONL.
- `pnpm vitest run tests/cli/commands/guard.test.ts tests/cli/guards/claim-required.test.ts`
- `pnpm typecheck`

### S94-2: Codex matcher coverage for claim-required under apply_patch/Edit/Write installs

**Club:** wedge
**Files:**
- `src/core/adapters/codex.ts`
- `tests/core/adapters/codex.test.ts`
- `tests/cli/commands/hook-codex.test.ts`

**Scope:**

1. Assert `claim-required` is installed under the Codex write matcher group.
2. Assert that group includes `apply_patch`, `Edit`, and `Write`.
3. Verify full/recommended hook install keeps `claim-required` in Codex project and user scopes.
4. Add a regression around grouped write guards so future matcher edits cannot drop workflow enforcement silently.

**Acceptance:**
- `pnpm vitest run tests/core/adapters/codex.test.ts tests/cli/commands/hook-codex.test.ts`
- Generated `~/.codex/hooks.json` equivalent contains `claim-required` under `apply_patch|Edit|Write`.

### S94-3: Doctor diagnostics for stale hook runtime resolution and local binary precedence

**Club:** short_iron
**Files:**
- `src/cli/commands/doctor.ts`
- `src/core/adapters/codex.ts`
- `tests/cli/commands/doctor.test.ts`

**Scope:**

1. Teach doctor to explain the actual Codex dispatcher resolution order: project `node_modules/.bin/slope`, SLOPE dev repo `dist/cli/index.js`, then global `slope`.
2. Warn when a user-level Codex dispatcher will resolve a project-local `@slope-dev/slope` version older than the global/current package.
3. Warn when the current repo is the SLOPE dev checkout and `dist/cli/index.js` is stale relative to source or package version.
4. Keep diagnostics advisory by default, with clear next steps:
   - update project dependency
   - run `pnpm build` in the SLOPE dev repo
   - reinstall hooks if dispatcher shape is stale
5. Avoid network calls in doctor; use local package files and command resolution only.

**Acceptance:**
- Doctor tests cover stale project-local package and stale SLOPE dev `dist`.
- `slope doctor` output makes it obvious why a hook can appear installed but execute old guard behavior.

### S94-4: Configurable implementation-write strictness and non-implementing phase behavior

**Club:** short_iron
**Files:**
- `src/core/config.ts`
- `src/core/guard.ts`
- `src/cli/guards/claim-required.ts`
- `tests/cli/guards/claim-required.test.ts`
- docs touched only if config is exposed publicly

**Scope:**

1. Add an explicit config knob for no-sprint implementation writes, e.g. `guidance.requireSprintForImplementationWrites`.
2. Supported behavior should be clear and testable:
   - `ask` default: current v1.55.5 behavior
   - `deny`: strict teams/repos block implementation edits until sprint/claim state exists
   - `off`: preserve true adhoc mode for repos that intentionally do not use sprint workflow
3. Decide and encode behavior for active sprint phases that are not `implementing`.
4. Preserve the existing active-implementing/no-claim advisory path unless strict mode intentionally upgrades it.
5. Document migration/default behavior so existing users are not surprised.

**Acceptance:**
- Tests cover default, strict, and off modes.
- Tests cover no sprint, planning/reviewing/scoring phases, and implementing phase.
- Strict mode produces a block/deny output with actionable recovery commands.

---

## Verification

Run before closing the sprint:

```bash
pnpm build
pnpm typecheck
pnpm test
slope validate
```

Manual hook smoke:

```bash
slope version
npm view @slope-dev/slope version
CODEX_PROJECT_DIR="$(pwd)" ~/.codex/hooks/slope-guard.sh claim-required <<'JSON'
{"session_id":"manual-s94","cwd":"/tmp/unused","hook_event_name":"PreToolUse","tool_name":"apply_patch","tool_input":{"file_path":"src/manual-smoke.ts"}}
JSON
tail -n 5 .slope/guard-metrics.jsonl
```

If testing inside this SLOPE checkout, run `pnpm build` first because the user-level Codex dispatcher intentionally prefers local `dist/cli/index.js` for SLOPE's own development repo.
