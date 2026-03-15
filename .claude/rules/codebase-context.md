# Codebase Context — Map vs Explore

SLOPE maintains a codebase map at `CODEBASE.md` (~5k tokens) with auto-generated sections covering packages, API surface, CLI commands, guards, MCP tools, tests, sprint history, and known gotchas.

## Context Tiers

| Tier | Source | Tokens | When to use |
|------|--------|--------|-------------|
| L0 | CODEBASE.md headers | ~2k | Starting a sprint, finding which package owns a feature |
| L1 | Full CODEBASE.md with signatures | ~5k | Looking up function signatures, CLI commands, guards |
| L1.5 | `context_search` / `search({ module: 'map', query })` | ~3k | Targeted code questions, finding implementations |
| L2 | Full file reads via `Read` | unbounded | Implementation detail, debugging, modifying code |

Prefer the lowest tier that answers your question. The explore guard will remind you of this progression.

## When to use the map (default) — L0/L1

- Starting a new sprint — read the map first
- Understanding feature areas and file locations
- Finding which package owns a feature
- Looking up CLI commands, guards, or MCP tools
- Checking recent sprint history and known gotchas

**Access methods:**
- `Read CODEBASE.md` — full map in one read (L1)
- `search({ module: 'map' })` — full map via MCP (L1)
- `search({ module: 'map', query: 'guards' })` — specific section via MCP (L1.5)
- `context_search("query")` — semantic code search (L1.5)

## When to explore beyond the map — L2

- The map doesn't cover a new package or feature you need detail on
- You need implementation-level detail (function signatures, complex logic)
- The map metadata shows it's stale (explore guard will warn you)
- You're debugging a specific issue that requires reading source code

## Keeping the map current

- Run `slope map` after adding new files, commands, or guards
- Run `slope map --check` to verify staleness before a sprint
- The map auto-updates only auto-generated sections; manual content is preserved
