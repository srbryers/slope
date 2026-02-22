# Sprint 7 — The Yardage Book

**Par:** 4 | **Slope:** 2 (`moderate: new subsystem, structured data format, CLI commands, MCP integration`) | **Type:** architecture + methodology

**Theme:** Strategic planning tools — course-level methodology. Structured roadmap format, `slope roadmap` CLI commands, architect review automation, MCP + briefing integration.

## Tickets

### S7-1: Structured roadmap format + schema
- **Club:** short_iron | **Complexity:** standard
- Create `packages/core/src/roadmap.ts` with types and pure compute functions:
  - `RoadmapDefinition`, `RoadmapSprint`, `RoadmapTicket` — typed schema
  - `parseRoadmap(json)` — validate JSON against schema
  - `validateRoadmap(roadmap)` — dependency cycles, ticket counts (3-4), sprint numbering continuity
  - `computeCriticalPath(roadmap)` — longest dependency chain
  - `findParallelOpportunities(roadmap)` — sprints with no mutual dependencies
- JSON is the source of truth; markdown is an output format
- Export types and functions from `packages/core/src/index.ts`
- Tests in `packages/core/tests/roadmap.test.ts`

### S7-2: `slope roadmap` CLI command
- **Club:** short_iron | **Complexity:** standard
- New file: `packages/cli/src/commands/roadmap.ts`
- Subcommands:
  - `slope roadmap validate` — schema + dependency graph checks
  - `slope roadmap review` — automated architect review (dependency correctness, scope balance, naming collision detection via grep, gap analysis against vision doc)
  - `slope roadmap status` — current progress (which sprint active, what's completed/blocked)
  - `slope roadmap show` — render summary (dependency graph, critical path, parallel tracks)
- Register in `packages/cli/src/index.ts`
- Tests in `packages/cli/tests/roadmap.test.ts`

### S7-3: MCP + briefing integration
- **Club:** short_iron | **Complexity:** standard
- Roadmap queryable via MCP `execute()` — agents can check sprint context
- `formatBriefing()` gains strategic context section when a roadmap file exists:
  - "Sprint N of M — on the <track> track"
  - "This sprint feeds into S12 via the events table"
  - Concise (3-5 lines), before existing hazard/common-issues sections
- Graceful degradation when no roadmap exists
- Tests: MCP roadmap queries, briefing with/without strategic context

### S7-4: Documentation + `slope init` integration
- **Club:** wedge | **Complexity:** small
- `slope init` offers to create a starter roadmap JSON alongside config
- Add `roadmapPath` field to `SlopeConfig` (default: `docs/backlog/roadmap.json`)
- Update sprint checklist rule with "Pre-Tournament Routine" section
- Tests: init creates roadmap file, config field

## Execution Order

```
S7-1 → S7-2 → S7-3 → S7-4
```

## Files to Create/Modify

**Create:**
- `packages/core/src/roadmap.ts` — types + compute functions
- `packages/core/tests/roadmap.test.ts` — core tests
- `packages/cli/src/commands/roadmap.ts` — CLI command
- `packages/cli/tests/roadmap.test.ts` — CLI tests

**Modify:**
- `packages/core/src/index.ts` — export roadmap functions/types
- `packages/core/src/config.ts` — add `roadmapPath` to SlopeConfig
- `packages/core/src/briefing.ts` — add strategic context section
- `packages/cli/src/index.ts` — register roadmap command
- `packages/cli/src/commands/init.ts` — roadmap creation option
