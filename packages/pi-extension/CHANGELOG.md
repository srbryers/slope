# Changelog — @slope-dev/pi-extension

## 1.53.0

### Multi-tier local router (S84-T1)

`ModelTier` expanded from `'local' | 'cloud'` to four tiers:

| Tier | Model | When |
|------|-------|------|
| `local-coder` | Qwen3-Coder-Next (port 8091) | Default; code with identifiers/paths |
| `local-general` | Qwen3.6-27B (port 8092) | General reasoning, no code targets |
| `local-planner` | Qwen3.6-27B + `<think>` | Vague prompts detected by T3 |
| `cloud` | claude-sonnet / gemini-pro | High-complexity tasks (score ≥ 3) |

`scoreComplexity()` now returns `{ tier, score, signal }` instead of a bare number.
Persisted `RouterState` with old `'local'` tier auto-normalises to `'local-coder'`.
`/route` extended: `local-coder | local-general | local-planner | cloud | status`; bare `local` kept as back-compat alias.

### Plan-gate tool_call hook (S84-T2)

New `plan-gate` skill (`enabled: true` by default). Blocks `write`, `edit`, and `bash`
(excluding read-only commands: `git status/log/diff`, `ls`, `grep`, `find`, `cat`, etc.)
when no sprint phase is active (`planning | implementing | scoring`) and no recent assistant
message contains a structured plan (`## Plan` heading, 3-item numbered list, or `[plan]` marker).

Interactive sessions get `ctx.ui.confirm`; non-interactive sessions receive a hard block.

### Vague-prompt detector (S84-T3)

New `before_agent_start` handler (under `plan-gate` skill). Detects short prompts (< 200 chars)
starting with vague action verbs (`optimize`, `improve`, `refactor`, `clean up`, `tidy`, `fix`, …)
that contain no file paths or code symbols. On detection:

1. Injects a `## Plan` preamble into the chained system prompt requiring a written plan before any tool calls.
2. Force-routes to `local-planner` tier when `model-router` skill is also active.

Registers before the model-router's `before_agent_start` so the forced tier sticks.

`isVaguePrompt(prompt)` and `scoreComplexity(prompt)` are now exported for external testing.
