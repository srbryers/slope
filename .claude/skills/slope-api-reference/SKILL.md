---
name: slope-api-reference
version: "1.0"
description: >
  SLOPE MCP tools reference — search, execute, context_search, sessions, claims, testing.
  Use when calling SLOPE MCP tools, writing execute() code, choosing between search modules,
  or debugging MCP tool errors. Use when user says "search for", "execute", "MCP", "context search",
  "claim", "session", "store status", or "testing session".
triggers:
  - "execute"
  - "search"
  - "mcp"
  - "context_search"
  - "api reference"
  - "store status"
  - "testing session"
context_files:
  - "CODEBASE.md"
---

# SLOPE API Reference

Reference for using SLOPE's 12 MCP tools effectively. Covers the context tier decision tree, tool categories, common patterns, and all known gotchas.

## File Map

| File | Purpose |
|------|---------|
| `SKILL.md` | This file — overview, context tiers, tool categories |
| `gotchas.md` | All 12 MCP gotchas with examples and workarounds |
| `references/mcp-tools.md` | All 12 tools with input schemas and output shapes |
| `references/execute-cookbook.md` | Common execute() patterns for scoring, analysis, roadmaps |
| `references/search-guide.md` | Module-by-module search guide with special cases |
| `scripts/execute-examples.js` | Composable JS snippets for execute() calls |

## Context Tier Decision Tree

Always use the lowest tier that answers your question:

```
Need to know which package owns a feature?
  → L0: Read CODEBASE.md headers (~2k tokens)

Need function signatures, CLI commands, guards?
  → L1: Read full CODEBASE.md (~5k tokens)
  → Or: search({ module: 'map' })

Need to find a specific implementation?
  → L1.5: context_search("query") or search({ module: 'map', query: '...' })

Need implementation detail, debugging, modifying code?
  → L2: Read tool on specific files (unbounded tokens)
```

## MCP Tool Categories

### Core Tools (always available)
| Tool | Purpose |
|------|---------|
| `search` | Discover API functions, filter by module/query |
| `execute` | Run JS in sandbox with full SLOPE API pre-injected |
| `context_search` | Semantic search (embeddings) with grep fallback |

### Store-Backed Tools (require .slope/slope.db)
| Tool | Purpose |
|------|---------|
| `session_status` | Current session info |
| `acquire_claim` | Claim a ticket/area for the sprint |
| `check_conflicts` | Detect overlapping claims |
| `store_status` | Store health check |

### Testing Tools (require .slope/slope.db)
| Tool | Purpose |
|------|---------|
| `testing_session_start` | Begin a manual testing session |
| `testing_session_finding` | Record a test finding |
| `testing_session_end` | End testing session with summary |
| `testing_session_status` | Current testing session state |
| `testing_plan_status` | Test plan completion status |

## When to Use Which Tool

| I need to... | Use |
|--------------|-----|
| Find a function signature | `search({ query: 'functionName' })` |
| Run scoring/analysis code | `execute({ code: "return computeHandicapCard(loadScorecards())" })` |
| Find where something is implemented | `context_search("feature description")` |
| Check what modules exist | `search({})` (no filter = all modules) |
| Get the full codebase map | `search({ module: 'map' })` |
| Check if store is healthy | `store_status({})` |
| Claim work for a sprint | `acquire_claim({ target: 'T1', sprint: 67 })` |

Read `gotchas.md` before writing execute() code. Read `references/mcp-tools.md` for full tool schemas.
