# Sprint 84 Plan — Local Planner & Plan-Gate (Pi Extension v1.53.0)

**Par:** 4 (3 tickets)
**Slope:** 2 (new tier mechanism, runtime gate behavior, branch already in flight)
**Theme:** Extend `@slope-dev/pi-extension` with a local-only planner+executor harness on top of the existing complexity router.
**Branch:** `feat/model-router` (DO NOT branch — stay here per spec)
**Target version:** `packages/pi-extension/package.json` `1.52.0` → `1.53.0`

---

## Context

The local MLX stack runs two dual-resident models:

| Backend | Path | Port | Strength |
|---------|------|------|----------|
| `qwen3-coder` (Rapid-MLX, Qwen3-Coder-30B-A3B-Instruct-4bit) | `~/mlx_models/Qwen3-Coder-30B-A3B-Instruct-4bit` | 8091 | code, tool calls, fast decode (no `<think>`) |
| `qwen3-general` (mlx_lm.server, Qwen3.6-27B-8bit dense) | `~/mlx_models/Qwen3.6-27B-8bit` | 8092 | reasoning, planning, multimodal, supports `<think>` |

Source: `/Users/sebastianbryers/mlx-router.py` (lines 45–66 for the registry, lines 70+ for the keyword-based auto-router that already classifies coder vs general).

Pi (`@mariozechner/pi-coding-agent`) is the local coding agent. The current SLOPE pi-extension ships an `local↔cloud` complexity router with 3-turn hysteresis at `packages/pi-extension/src/index.ts:651-820` (`COMPLEX_KEYWORDS`, `SIMPLE_KEYWORDS`, `scoreComplexity`, `RouterState`, `registerModelRouter`, `doSwitch`).

**The bug we're fixing.** A vague prompt (`"optimize this"`) caused the local model to skip planning and start writing files immediately. Two failures compound: (1) the router only knows "local vs cloud", so it can't pick a planner-strength local model; (2) nothing forces a written plan before destructive tool calls.

This sprint adds three small handlers that, together, force a plan-then-execute discipline for vague work — entirely on local models, with cloud escalation still available via the existing complexity router.

---

## References

| What | Where |
|------|-------|
| Existing router source (state, scoring, doSwitch, /route command) | `packages/pi-extension/src/index.ts:651-820` |
| Existing `tool_call` handler (hazard guard, commit-discipline nudge) | `packages/pi-extension/src/index.ts:408-457` |
| Existing `before_agent_start` handler (briefing inject) | `packages/pi-extension/src/index.ts:544-645` |
| Pi extension API: `tool_call` (block via `{ block: true, reason }`) | `~/.nvm/versions/node/v22.22.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md:674-712` |
| Pi extension API: `before_agent_start` (inject message + chained `systemPrompt`) | `~/.nvm/versions/node/v22.22.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md:466-501` |
| MLX router model registry + auto-router | `/Users/sebastianbryers/mlx-router.py` |
| `getProjectState()` returns `'fresh' \| 'complete' \| 'active'` based on sprint-state.json `phase ∈ {planning, implementing, scoring}` | `packages/pi-extension/src/index.ts:68-89` |
| Existing test scaffold (vitest, root config, mocked execSync, mockPi) | `tests/packages/pi-extension.test.ts` |

---

## Tickets

### T1 (A): Multi-tier local router — add `local-planner`, generalize `local` → `local-coder`/`local-general`

**Club:** `long_iron`
**Files:**
- `packages/pi-extension/src/index.ts` (refactor lines 651–820)
- `tests/packages/pi-extension.test.ts` (new `describe('scoreComplexity tiers')` block — root vitest config, no per-package setup needed)

**Scope:**

1. Replace `type ModelTier = 'local' | 'cloud'` with `type ModelTier = 'local-coder' | 'local-general' | 'local-planner' | 'cloud'`. Default tier becomes `'local-coder'` to preserve existing behavior.
2. Refactor `scoreComplexity()` to return `{ tier: ModelTier; score: number; signal: string }` instead of a bare number. Keep the existing 0–5 score for cloud escalation; add tier-selection logic on top.
3. New planner signals (additive to existing `COMPLEX_KEYWORDS`/`SIMPLE_KEYWORDS`):
   - **Vague verbs** at start of prompt: `optimize`, `improve`, `make better`, `refactor`, `clean up`, `tidy`, `architect`
   - **Ambiguous nouns** without specifier: `the code`, `this`, `everything`, `all of it`
   - **Short + no code identifiers**: `prompt.length < 200` AND no file path (`.ts/.js/.py/...`) AND no symbol-shaped token (`/[a-z][A-Za-z0-9_]*\(\)/`, `/[A-Z][A-Za-z]+/` PascalCase)
   - When ≥2 planner signals fire and prompt has no concrete targets → tier `'local-planner'`
4. `doSwitch()` model selection updates:
   - `local-coder` → `registry.find('mlx-local', 'Qwen3-Coder-Next')` → fallback `ollama qwen3-coder:30b`
   - `local-general` → `registry.find('mlx-local', 'Qwen3.6-27B')`
   - `local-planner` → same model as `local-general` (Qwen3.6-27B with `<think>` enabled), but doSwitch also stages a planner system-prompt prefix into RouterState (consumed by T3)
   - `cloud` → unchanged
5. Status line icons: `local-coder` 🛠, `local-general` 🧠, `local-planner` 📋, `cloud` ☁
6. `/route` command: extend to accept `local-coder | local-general | local-planner | cloud | status`. Keep bare `/route local` as an alias for `local-coder` (back-compat).
7. Preserve hysteresis: 3-turn minimum between switches. Adopt this rule unchanged from the current implementation (lines 740–752).

**Tests (T1, vitest in `tests/packages/pi-extension.test.ts`):**
- `scoreComplexity('refactor everything')` → tier `'local-planner'`, signal mentions vague verb + ambiguous noun
- `scoreComplexity('fix typo in foo.ts:42')` → tier `'local-coder'` (file path overrides vague verb)
- `scoreComplexity('explain why redux is faster than zustand for our checkout flow')` → tier `'cloud'` (existing complex-keyword behavior preserved)
- `scoreComplexity('add console.log to handleClick()')` → tier `'local-coder'` (symbol token wins)
- `scoreComplexity('make it better')` → tier `'local-planner'` (3 signals: vague verb + ambiguous noun + short)
- Hysteresis: two back-to-back high-score prompts only switch once

**Acceptance:**
- `pnpm typecheck` clean (in `packages/pi-extension`)
- `pnpm test tests/packages/pi-extension.test.ts` passes (existing + new cases)
- `/route local-planner` works manually (smoke check)
- All existing pi-extension tests still pass (no regressions in onboarding/briefing/guards)

**🛑 STOP — wait for user approval before T2.**

---

### T2 (B): Plan-gate `tool_call` hook — block destructive tools without a plan or active sprint

**Club:** `short_iron`
**Files:**
- `packages/pi-extension/src/index.ts` (extend the existing `tool_call` handler at line 408, OR add a new handler — see decision note below)
- `tests/packages/pi-extension.test.ts`

**Decision note:** The existing `tool_call` handler at line 408 is gated by `isSkillEnabled(settings, 'guards')`. The plan-gate is a **separate skill** (`plan-gate`) so users can opt out independently. Register a new `pi.on('tool_call')` block guarded by `isSkillEnabled(settings, 'plan-gate')`. Pi runs handlers in load order (per `extensions.md:686`), and we don't need to mutate inputs from the existing handler, so a parallel handler is cleaner than weaving into the existing one.

**Scope:**

1. New helper `hasRecentPlan(ctx): boolean`: scan the last N (default 5) assistant messages from `ctx.sessionManager.getEntries()` for any of:
   - A markdown heading matching `/^##+\s*(plan|approach|steps?)\b/im`
   - A numbered list with ≥3 items: `/^\s*1\.\s.+\n\s*2\.\s.+\n\s*3\.\s/m`
   - The literal token `[plan]` or `<plan>` (lightweight programmatic marker)
2. New helper `inSprintPhase(cwd): boolean`: read `.slope/sprint-state.json` and return `true` iff `phase ∈ {'planning','implementing','scoring'}`. Reuse the parsing pattern from `getProjectState()` at line 68; do not duplicate the read — extract a shared `readSprintPhase(cwd)` and have both call it.
3. `pi.on('tool_call', ...)`: if `toolName ∈ {'write', 'edit', 'bash'}` AND `!inSprintPhase(ctx.cwd)` AND `!hasRecentPlan(ctx)`:
   - **Interactive mode** (when `ctx.ui.confirm` is available): `const ok = await ctx.ui.confirm('No plan detected. Run /sprint start or write a plan before this action. Proceed anyway?'); if (!ok) return { block: true, reason: 'plan-gate: user declined' };`
   - **Non-interactive mode** (no `ctx.ui.confirm`, e.g. headless / scripted runs): return `{ block: true, reason: 'plan-gate: Run /sprint start or write a plan before this action.' }`
   - **Bash exemption list**: read-only commands (`git status`, `git log`, `git diff`, `ls`, `pwd`, `cat`, `grep`, `find`, `which`, `echo`) skip the gate. Match by leading-token against an allowlist; do not regex the full command (avoid evasion-shape problems but also avoid being too clever).
4. Add a new skill `plan-gate` to settings with `enabled: true` default. (Verify default-skills shape in `loadPiSettings` before touching it; if changing the default would force a settings migration, ship as `enabled: false` default and require opt-in.)

**Tests (T2):**
- Mock `ctx.sessionManager.getEntries()` returning entries with/without numbered plans → handler blocks/allows correctly
- Mock `.slope/sprint-state.json` with `phase: 'implementing'` → handler does NOT block even with no plan
- `bash` with `git status` → does NOT block (exempt)
- `bash` with `rm -rf foo` → blocks
- `write` to any path with no plan, not in sprint → blocks (non-interactive: returns `{ block: true }`)

**Acceptance:**
- `pnpm typecheck` clean
- New test cases pass; existing hazard-guard tests still pass
- Manually verify: with `plan-gate` skill enabled and no plan, an `edit` call surfaces the block reason in pi's UI

**🛑 STOP — wait for user approval before T3.**

---

### T3 (C): Vague-prompt detector — preamble injection + force-route to `local-planner`

**Club:** `short_iron`
**Files:**
- `packages/pi-extension/src/index.ts` (new `before_agent_start` handler, registered alongside existing one at line 544)
- `tests/packages/pi-extension.test.ts`

**Scope:**

1. New helper `isVaguePrompt(prompt: string): boolean`:
   ```ts
   const VAGUE_RE = /^(optimize|improve|make better|fix|refactor|clean up|tidy)\b/i;
   const HAS_PATH = /\.(ts|tsx|js|jsx|py|rs|go|md|json|yaml|yml|sh|sql|css|html)\b/i;
   const HAS_SYMBOL = /\b[a-z][A-Za-z0-9_]*\(\)|[A-Z][A-Za-z][A-Za-z0-9]+\b/;
   return prompt.length < 200
       && VAGUE_RE.test(prompt.trim())
       && !HAS_PATH.test(prompt)
       && !HAS_SYMBOL.test(prompt);
   ```
2. New `pi.on('before_agent_start', ...)` handler (gated by `isSkillEnabled(settings, 'plan-gate')` — same skill as T2, since these are co-dependent features):
   - If `isVaguePrompt(event.prompt)`:
     - **Force-route to `local-planner`** by calling the same `doSwitch('local-planner', ...)` helper from T1. (Cross-handler call: extract `doSwitch` from `registerModelRouter`'s closure into a module-level function with state passed explicitly, so both handlers can call it. RouterState is already module-level-shaped — a small refactor.)
     - **Inject planning preamble** into the system prompt:
       ```
       systemPrompt: event.systemPrompt + '\n\nBefore any tool calls, produce a written plan addressing what to change, where, and the order of work. Format: a numbered list of steps under a "## Plan" heading. Do not call write/edit/bash before the plan is written.'
       ```
   - Otherwise: no-op (yield to existing handlers).
3. Order matters: this handler should run BEFORE the existing router handler at line 721 so the force-routed tier sticks. Document the registration order in a single-line comment at the call site.

**Tests (T3, regex-focused as user spec):**
- `isVaguePrompt('optimize this')` → true
- `isVaguePrompt('optimize the bundle size in webpack.config.js')` → false (path)
- `isVaguePrompt('refactor handleSubmit()')` → false (symbol)
- `isVaguePrompt('clean up')` → true
- `isVaguePrompt('improve the quarterly fundraising strategy and run a board meeting tomorrow morning at 9am')` → false (length)
- `isVaguePrompt('write a poem about cats')` → false (verb not in list)
- `isVaguePrompt('Fix the bug')` → true (case-insensitive, no specifier)

**Acceptance:**
- `pnpm typecheck` clean
- All new + existing tests pass
- Manual smoke: `pi` session, type `optimize this` → status line flips to 📋 `local-planner`, and the response leads with a `## Plan` heading before any tool call

---

## Post-T3 (always, no STOP)

1. Bump `packages/pi-extension/package.json` `1.52.0` → `1.53.0`
2. Create `packages/pi-extension/CHANGELOG.md` (does not exist yet — confirm before writing) with a single 1.53.0 entry covering T1/T2/T3
3. Run `pnpm build && pnpm test && pnpm typecheck` from repo root — all green
4. `slope validate` on the scorecard once written
5. Commit each ticket separately with conventional-commit format (`feat(pi-extension):` / `feat(pi-extension):` / `feat(pi-extension):`)
6. Push after each ticket per commit-discipline rules

---

## Hazard Watch (from S39–S68 patterns)

| Hazard | Risk this sprint | Mitigation |
|--------|------------------|------------|
| API shape assumptions (#1 across S39/S42/S44/S65) | Pi's `event.systemPrompt`, `ctx.sessionManager.getEntries()`, `ctx.ui.confirm` shapes guessed | Read `extensions.md:466-501` and the relevant `isXEventType` types BEFORE consuming each. LSP-hover the actual event type. Don't guess. |
| Threshold consistency across consumers (S48) | `scoreComplexity` is now consumed by both `registerModelRouter` AND the new vague-prompt handler | Single source of truth: tier-decision logic lives in `scoreComplexity`'s return shape. Both handlers consume the same `{tier,score,signal}` object. |
| Review-discovered hazards (S43–S49) | All three tickets ship without code review | Mid-sprint self-review after T1 (long_iron) — diff against main before pushing. |
| Compaction drops gates (S60) | Plan-gate is advisory in interactive mode; compaction could lose the planning context | Plan-gate writes its decision to `.slope/sprint-state.json` (or a dedicated `plan-gate.json`) — but only if the user later wants enforcement persistence. NOT in scope for this sprint. Documented as a known limitation. |

---

## Out of scope (explicit)

- No changes to `mlx-router.py`. The Python router already does coder/general routing on its own; the pi-extension just maps tier names to model registrations. If `qwen3-general` isn't reachable, `doSwitch` notifies and stays on the previous tier (existing behavior).
- No new MCP tools. No changes to `slope` CLI commands.
- No backward-compat shim for the old `'local'` tier name on persisted RouterState — on session_start, if loaded state has `currentTier === 'local'`, normalize to `'local-coder'` and proceed (one-line migration).
