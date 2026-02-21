# @slope-dev/mcp-tools

MCP server exposing [SLOPE](https://github.com/srbryers/slope) advisory tools via the [Model Context Protocol](https://modelcontextprotocol.io/).

Add this server to Cursor, Claude Desktop, or any MCP-compatible agent to get sprint scoring, handicap analysis, and club recommendations as tools.

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

## Tools (10)

| Tool | Description |
|------|-------------|
| `recommend_club` | Data-driven complexity recommendation for a ticket |
| `classify_shot` | Classify shot result from execution trace |
| `generate_training_plan` | Training recommendations from handicap + dispersion |
| `compute_handicap` | Handicap card with rolling windows from scorecards |
| `compute_dispersion` | Shot dispersion analysis (miss patterns) |
| `build_scorecard` | Build scorecard from minimal input (auto-computes stats) |
| `format_briefing` | Pre-round briefing (hazards, gotchas, handicap) |
| `format_sprint_review` | Format scorecard as markdown review |
| `build_tournament_review` | Aggregate scorecards into tournament review |
| `format_tournament_review` | Format tournament review as markdown |

All tools are **read-only** — they compute analysis from scorecard data passed as input. No filesystem or database access required.

## License

MIT
