# @slope-dev/mcp-tools

Code-mode MCP server for [SLOPE](https://github.com/srbryers/slope) — the Sprint Lifecycle & Operational Performance Engine.

Instead of 10 individual tools, this server exposes **two tools** following the [code-mode MCP pattern](https://blog.cloudflare.com/code-mode-mcp/):

| Tool | Description |
|------|-------------|
| `search` | Discover SLOPE API functions, types, constants, and filesystem helpers |
| `execute` | Run JavaScript in a sandboxed `node:vm` with the full SLOPE API pre-injected |

## Quick Start

```bash
npm install -g @slope-dev/mcp-tools
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "slope": {
      "command": "npx",
      "args": ["@slope-dev/mcp-tools"]
    }
  }
}
```

### Claude Code

Add to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "slope": {
      "command": "npx",
      "args": ["@slope-dev/mcp-tools"]
    }
  }
}
```

Or run `slope init --claude-code` to install automatically.

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "slope": {
      "command": "npx",
      "args": ["@slope-dev/mcp-tools"]
    }
  }
}
```

## Usage

### 1. Discover the API

```
search({})                          → full registry (all functions, helpers, constants)
search({ query: "handicap" })       → handicap-related functions
search({ module: "fs" })            → filesystem helpers (loadScorecards, readFile, etc.)
search({ module: "types" })         → TypeScript type definitions
search({ module: "constants" })     → PAR_THRESHOLDS, SLOPE_FACTORS, etc.
```

### 2. Execute code

The `execute` tool runs JavaScript in a sandboxed environment with all SLOPE core functions, constants, and filesystem helpers available as top-level names:

```js
// Compute handicap from project scorecards
execute({ code: `
  const cards = loadScorecards();
  return computeHandicapCard(cards);
` })

// Build a new scorecard
execute({ code: `
  return buildScorecard({
    sprint_number: 4,
    theme: "Code Mode MCP",
    par: 4,
    slope: 3,
    date: "2026-02-21",
    shots: [
      { ticket_key: "S4-1", title: "Move config to core", club: "long_iron", result: "in_the_hole", hazards: [] },
      { ticket_key: "S4-2", title: "Build search tool", club: "short_iron", result: "green", hazards: [] },
    ],
  });
` })

// Get a pre-round briefing
execute({ code: `
  return formatBriefing({
    scorecards: loadScorecards(),
    commonIssues: loadCommonIssues(),
  });
` })
```

### Available in the sandbox

- **All `@slope-dev/core` exports** — `computeHandicapCard`, `buildScorecard`, `computeDispersion`, `recommendClub`, `formatBriefing`, etc.
- **Constants** — `PAR_THRESHOLDS`, `SLOPE_FACTORS`, `SCORE_LABELS`, etc.
- **Filesystem helpers** (scoped to project root):
  - `loadConfig()` — load `.slope/config.json`
  - `loadScorecards()` — load all sprint scorecards
  - `loadCommonIssues()` — load common issues file
  - `loadSessions()` — load sessions file
  - `saveScorecard(card)` — write scorecard to `{scorecardDir}/sprint-{N}.json`
  - `readFile(path)` — read any file (scoped to project root)
  - `writeFile(path, content)` — write a file (scoped to project root)
  - `listFiles(dir?, pattern?)` — list files with optional glob

### Security

- Code runs in `node:vm` — no access to `require`, `process`, `import`, `eval`, `fetch`
- All filesystem operations are scoped to the project root (path escape is blocked)
- 30-second execution timeout

## License

MIT
