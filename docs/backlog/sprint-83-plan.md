# Sprint 83 Plan — The Bridge (Native Pi Adapter)

**Par:** 3 (3 tickets)
**Slope:** 2
**Theme:** Full HarnessAdapter for pi.dev + init scaffolding + skills distribution

## Context

We have `packages/pi-extension/` (tools, events, commands) but no `HarnessAdapter`
for Pi. Claude Code, Cursor, Windsurf, Cline, OB1, and Codex all have adapters that:
- Detect the platform (`detect()`)
- Format guard output for the platform's hook protocol
- Generate hooks config
- Install guards via `slope init --<platform>`

Pi needs the same treatment so `slope init --pi` just works.

## Tickets

### T1: Pi HarnessAdapter
**Club:** short_iron
**Files:** `src/core/adapters/pi.ts`, `src/core/harness.ts`, `tests/core/adapters/pi.test.ts`

- Implement HarnessAdapter: id='pi', detect via `.pi/` directory
- Format guard output for Pi's JSON event protocol
- supportedEvents: PreToolUse, PostToolUse, Stop (no PreCompact)
- Add to ADAPTER_PRIORITY
- Register in init.ts, guard.ts, harness test imports

### T2: `slope init --pi` scaffolding
**Club:** short_iron
**Files:** `src/cli/commands/init.ts`

- Copy `packages/pi-extension/src/index.ts` to `.pi/extensions/slope/index.ts`
- Copy SLOPE skills to `.pi/skills/` (Agent Skills spec path)
- Generate `.pi/SYSTEM.md` with SLOPE project context (equivalent to AGENTS.md)
- Print setup instructions

### T3: Pi adapter tests + verify existing adapters
**Club:** wedge
**Files:** `tests/core/adapters/pi.test.ts`

- Detection tests (with/without .pi/)
- Format output tests (PreToolUse deny/context, PostToolUse block/context, Stop)
- installGuards creates .pi/extensions/slope/
- Run full adapter suite to verify no regressions
