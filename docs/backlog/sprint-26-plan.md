# Sprint 26 — The Fairway Map: User Flow Tracking

**Par:** 4 | **Slope:** 2 (`new subsystem across 3 packages, but follows established patterns`) | **Type:** feature

**Theme:** Flow tracking — map user-facing workflows to code paths, queryable via MCP search.

## Tickets

### S26-1: Flow types + validation functions
- **Club:** short_iron | **Complexity:** standard
- Create `packages/core/src/flows.ts` with types and pure functions:
  - `FlowStep`, `FlowDefinition`, `FlowsFile` — typed schema
  - `parseFlows(json)` — parse + validate JSON
  - `validateFlows(flows, cwd)` — check file paths resolve, detect orphaned paths
  - `checkFlowStaleness(flow, currentSha, cwd)` — diff files between verified SHA and current
  - `loadFlows(flowsPath)` — read + parse, return null if missing
- Export types and functions from `packages/core/src/index.ts`
- Add `flowsPath` to `SlopeConfig` interface with default `.slope/flows.json`
- Tests in `packages/core/tests/flows.test.ts`

### S26-2: `slope flows` CLI command
- **Club:** short_iron | **Complexity:** standard
- Create `packages/cli/src/commands/flows.ts` with subcommands:
  - `slope flows init` — create `.slope/flows.json` with example template
  - `slope flows list` — table of flows with staleness indicators
  - `slope flows check` — validate all flows (file existence, staleness per SHA); exit 1 if any stale
- Register in `packages/cli/src/index.ts`
- Tests in `packages/cli/tests/flows.test.ts`

### S26-3: MCP search integration
- **Club:** short_iron | **Complexity:** standard
- Add `'flows'` to Zod module enum in `packages/mcp-tools/src/index.ts`
- Add `handleFlowsQuery(query?)` — reads `.slope/flows.json`, filters by id/title/tags, returns formatted definitions with staleness
- Wire into search dispatch
- Add `'flows'` to registry module type in `packages/mcp-tools/src/registry.ts`
- Add registry entries for flow functions
- Add flow type definitions to `SLOPE_TYPES`
- Tests in `packages/mcp-tools/tests/flows.test.ts`

### S26-4: CODEBASE.md flows section + stale-flows guard
- **Club:** wedge | **Complexity:** small
- Add `generateFlowsSummary()` to `packages/cli/src/commands/map.ts`
- Add `<!-- AUTO-GENERATED: START/END flows -->` markers to template
- Add `flows` count to YAML frontmatter metadata
- Add `'stale-flows'` guard to `GuardName` type union and `GUARD_DEFINITIONS` in `packages/core/src/guard.ts`

### S26-5: Docs + sprint plan artifact
- **Club:** putter | **Complexity:** trivial
- Save sprint plan to `docs/backlog/sprint-26-plan.md`
- Update `docs/backlog/README.md` with Sprint 26 row
- Update `CLAUDE.md` with Flows section

## Execution Order

```
S26-1 → S26-2 → S26-3 → S26-4 → S26-5
         ↘ S26-4 (guard part can parallel with S26-3)
```
