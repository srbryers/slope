# Sprint 71 Plan — The Intake Desk (Agent-Native Project Interview)

**Par:** 5 (5 tickets)
**Slope:** 2
**Theme:** Agent-native interview flow for fresh SLOPE projects

## Context

The current `slope init --interactive` is CLI-only, built on `@clack/prompts`. When Pi (or any harness) opens on a fresh SLOPE project, the agent gets an onboarding message but has no structured way to conduct the interview, validate answers, or transition the project to "active."

**Design decision:** Extract the interview logic into a UI-agnostic state machine in `src/core/interview-engine.ts`. Both human CLI (`@clack/prompts`) and agent tools (Pi `ctx.ui`, Claude slash commands) consume the same core. The CLI gets a `--agent` flag for JSON I/O. The Pi extension registers a `slope_interview` tool that drives the state machine directly.

## Philosophy

> The CLI is the universal API. The interview is a state machine that any harness can drive.

## Tickets

### T1: Interview state machine refactor
**Club:** long_iron
**Files:** `src/core/interview-engine.ts`, `src/core/interview-steps.ts`, `src/cli/interactive-init.ts`

- Extract step sequencing, validation, and answer collection into `InterviewStateMachine` class
- Public API: `nextQuestion()`, `submitAnswer(id, value)`, `getState()`, `isComplete()`, `getResult()`
- Keep `generateInterviewSteps()` as the question definition source
- `interactive-init.ts` refactored to use the state machine via a `@clack/prompts` adapter
- No behavior change for human CLI users

### T2: `slope interview` CLI command
**Club:** short_iron
**Files:** `src/cli/commands/interview.ts` (new), `src/cli/index.ts`

- `slope interview` — human mode, reuse existing `@clack/prompts` flow via state machine
- `slope interview --agent` — JSON I/O mode:
  - On start: emit `{"type":"question",...}` to stdout
  - Read `{"id":"...","value":"..."}` from stdin
  - On complete: emit `{"type":"complete","filesCreated":[...]}`
  - On error: emit `{"type":"error","errors":[...]}`
- Underlying logic: same state machine, different UI adapter

### T3: Pi extension `slope_interview` tool
**Club:** short_iron
**Files:** `packages/pi-extension/src/index.ts`

- Register `slope_interview` tool with parameters: `step` (optional, for resume)
- Tool imports the state machine directly (no shell-out to CLI)
- For each question: use `ctx.ui.input()`, `ctx.ui.select()`, `ctx.ui.confirm()` as appropriate
- On complete: call `initFromAnswers()` to write config, generate roadmap, create sprint state
- Return success message with files created and next steps

### T4: Auto-transition fresh → active
**Club:** wedge
**Files:** `src/core/interview.ts`, `packages/pi-extension/src/index.ts`

- After `initFromAnswers()` succeeds:
  - Write `.slope/config.json` with interview data
  - Generate `docs/backlog/roadmap.json` with starter sprint
  - Create `.slope/sprint-state.json` with `phase: "planning"`
  - Clear `.slope/.pi-onboarding.json` flag (or mark as complete)
- Pi extension: on next `before_agent_start`, detect `phase: planning` and show planning briefing instead of onboarding

### T5: Test coverage
**Club:** wedge
**Files:** `tests/core/interview-state-machine.test.ts`, `tests/cli/commands/interview.test.ts`, `tests/packages/pi-extension-interview.test.ts`

- Unit tests for state machine: sequencing, validation, completion
- CLI JSON mode tests: spawn process, feed answers, verify output
- Pi extension interview tool tests: mock `ctx.ui`, verify state transitions
- Integration test: full fresh → interview → active flow

## Success Criteria

- [ ] Human `slope init --interactive` still works identically
- [ ] `slope interview --agent` can be driven entirely via JSON
- [ ] Pi agent on fresh project walks user through interview using native dialogs
- [ ] After interview, `slope briefing --compact` shows real sprint data
- [ ] All new code has test coverage

## Hazard Watch

| Ticket | Hazard | Why |
|--------|--------|-----|
| T1 | bunker | `interactive-init.ts` refactor must preserve exact UX — any behavior change breaks human users |
| T1 | rough | `@clack/prompts` types (string/number/boolean) may not align with state machine `AnswerValue` union |
| T3 | rough | Pi extension has separate `tsconfig.json` — importing core types may require path mapping or build adjustments |
| T5 | water | JSON mode CLI tests spawn subprocesses — timing/stdout buffering flakiness in CI |

## Related

- S70 onboarding message (already shipped) — the message that triggers this flow
- S72 The Clubhouse Network — bumped from original S71
