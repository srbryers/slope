# Sprint 4 — Code Mode MCP Refactor

**Par:** 4 | **Slope:** 3 (`cross_package`, `new_area`, `external_dep`) | **Type:** infra + feature
**Theme:** Replace 10 individual MCP tools with `search()` + `execute()` code-mode pattern backed by `node:vm` sandbox.

## Tickets

### S4-1: Move config.ts and loader.ts from CLI to core
- **Club:** long_iron | **Complexity:** medium
- Copied `config.ts` and `loader.ts` from CLI to core (imports only `node:fs`, `node:path`)
- Added re-exports to `packages/core/src/index.ts`
- Replaced CLI files with re-exports from `@srbryers/core`
- Bumped core to v0.4.0

### S4-2: Build the function registry and search() tool
- **Club:** short_iron | **Complexity:** medium
- Created `registry.ts` with `SLOPE_REGISTRY` (~33 entries) and `SLOPE_TYPES` constant
- Added `search` MCP tool with query and module filtering

### S4-3: Build the execute() tool and node:vm sandbox
- **Club:** driver | **Complexity:** large
- Created `sandbox.ts` with `runInSandbox()` using `node:vm`
- All core exports + constants + fs helpers injected as top-level names
- Path-scoped filesystem access (rejects escapes beyond cwd)
- 30s timeout, console capture, async IIFE wrapper
- Added `execute` MCP tool

### S4-4: Remove old tools, update tests and docs, bump to v0.2.0
- **Club:** short_iron | **Complexity:** medium
- Removed 10 individual tool registrations
- Server exposes exactly 2 tools: `search` and `execute`
- Rewrote tests (server, registry, sandbox)
- Rewrote README with code-mode usage pattern
- Bumped mcp-tools to v0.2.0

## Execution Order

```
S4-1 → S4-2 → S4-3 → S4-4
```
