# MCP Tools — Full Reference

All 12 SLOPE MCP tools with input schemas, output shapes, and requirements.

## Core Tools

### search

Discover SLOPE API functions and documentation. Filter by module and/or query.

**Input:**
```typescript
{
  module?: string    // Filter by module: 'core', 'fs', 'constants', 'store',
                     // 'flows', 'inspirations', 'init', 'testing', 'map',
                     // 'types', 'metaphor'
  query?: string     // Free-text search within module results
}
```

**Output:** Markdown-formatted list of matching functions with signatures.

**Special cases:**
- `search({})` — Returns all modules and functions (full registry)
- `search({ module: 'map' })` — Returns full CODEBASE.md content
- `search({ module: 'map', query: 'guards' })` — Returns matching CODEBASE.md section
- `search({ module: 'types' })` — Returns all TypeScript type definitions
- `search({ module: 'metaphor' })` — Returns metaphor schema and built-ins
- `search({ module: 'init' })` — Returns interview steps for init workflow
- `search({ module: 'flows' })` — Returns flow definitions with staleness checking

**Store required:** No

### execute

Run JavaScript in a sandboxed `node:vm` context with all SLOPE core exports pre-injected.

**Input:**
```typescript
{
  code: string       // JavaScript code to execute. Must end with a return statement.
}
```

**Output:**
```typescript
{
  result: any        // JSON-serialized return value
  logs: string[]     // Captured console.log() output
}
```

**Available in sandbox:**
- All exports from `src/core/index.ts` (scoring, handicap, builder, validation, etc.)
- File helpers: `loadConfig()`, `loadScorecards()`, `readFile(path)`, `writeFile(path, content)`, `listFiles(dir)`
- Standard globals: JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Map, Set, Promise

**Constraints:** 30-second timeout, no require/import, relative paths only, return values must be JSON-serializable.

**Store required:** No

### context_search

Semantic search using embeddings (with grep fallback).

**Input:**
```typescript
{
  query: string      // Natural language search query
}
```

**Output:** Ranked list of matching code snippets with file paths and relevance scores.

**Notes:** Falls back to fixed-string grep when embeddings are unavailable. Not regex — use plain keywords.

**Store required:** No (embeddings optional)

## Store-Backed Tools

All store-backed tools require `.slope/slope.db` to exist.

### session_status

Get current session information.

**Input:** `{}` (no parameters)

**Output:**
```typescript
{
  sessionId: string
  startedAt: string
  claims: SprintClaim[]
  events: SlopeEvent[]
}
```

### acquire_claim

Claim a ticket or area for the current sprint.

**Input:**
```typescript
{
  target: string     // Ticket ID or area name (e.g., "T1", "src/core/scoring")
  sprint?: number    // Sprint number (auto-detected if omitted)
}
```

**Output:**
```typescript
{
  claim: SprintClaim
  conflicts: SprintConflict[]    // Any overlapping claims from other sessions
}
```

### check_conflicts

Detect overlapping claims across sessions.

**Input:**
```typescript
{
  claims?: SprintClaim[]   // Claims to check (defaults to current session claims)
}
```

**Output:**
```typescript
{
  conflicts: SprintConflict[]
}
```

### store_status

Health check for the SQLite store.

**Input:** `{}` (no parameters)

**Output:**
```typescript
{
  healthy: boolean
  tables: string[]
  counts: Record<string, number>    // Row counts per table
  issues: string[]                  // Any detected problems
}
```

## Testing Tools

All testing tools require `.slope/slope.db` and enforce single-session constraint.

### testing_session_start

Begin a manual testing session.

**Input:**
```typescript
{
  sprint?: number    // Sprint number (auto-detected if omitted)
  plan?: string      // Test plan reference
}
```

**Output:**
```typescript
{
  sessionId: string
  startedAt: string
}
```

### testing_session_finding

Record a finding during the active testing session.

**Input:**
```typescript
{
  area: string       // Module or area tested
  type: string       // Finding type: "pass", "fail", "skip", "note"
  description: string
  severity?: string  // "low", "medium", "high", "critical"
}
```

**Output:**
```typescript
{
  findingId: string
  recorded: true
}
```

### testing_session_end

End the active testing session with a summary.

**Input:**
```typescript
{
  summary: string    // Overall testing summary
}
```

**Output:**
```typescript
{
  sessionId: string
  duration: number
  findings: TestingFinding[]
  summary: string
}
```

### testing_session_status

Get the current testing session state.

**Input:** `{}` (no parameters)

**Output:**
```typescript
{
  active: boolean
  sessionId?: string
  findings: TestingFinding[]
}
```

### testing_plan_status

Get test plan completion status.

**Input:** `{}` (no parameters)

**Output:**
```typescript
{
  plan: TestPlan
  completed: string[]
  remaining: string[]
  coverage: number
}
```
