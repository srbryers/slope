# Codebase Context — Map vs Explore

SLOPE maintains a codebase map at `CODEBASE.md` (~5k tokens) with auto-generated sections covering packages, API surface, CLI commands, guards, MCP tools, tests, sprint history, and known gotchas.

## When to use the map (default)

- Starting a new sprint — read the map first
- Understanding feature areas and file locations
- Finding which package owns a feature
- Looking up CLI commands, guards, or MCP tools
- Checking recent sprint history and known gotchas

**Access methods:**
- `Read CODEBASE.md` — full map in one read
- `search({ module: 'map' })` — full map via MCP
- `search({ module: 'map', query: 'guards' })` — specific section via MCP

## When to explore beyond the map

- The map doesn't cover a new package or feature you need detail on
- You need implementation-level detail (function signatures, complex logic)
- The map metadata shows it's stale (explore guard will warn you)
- You're debugging a specific issue that requires reading source code

## Keeping the map current

- Run `slope map` after adding new files, commands, or guards
- Run `slope map --check` to verify staleness before a sprint
- The map auto-updates only auto-generated sections; manual content is preserved
