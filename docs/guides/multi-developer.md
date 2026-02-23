# Multi-Developer Setup

SLOPE supports multi-developer teams with per-player handicaps, shared hazard indices, and a team leaderboard.

## Quick Start

```bash
slope init --team
```

This adds a `team` section to `.slope/config.json`:

```json
{
  "team": {
    "players": {}
  }
}
```

## Player Identification

Add `"player": "name"` to each scorecard:

```json
{
  "sprint_number": 20,
  "player": "alice",
  "theme": "Multi-Developer",
  ...
}
```

Scorecards without a `player` field are attributed to `"default"`.

## Per-Player Handicaps

```bash
slope card                    # All scorecards (unchanged)
slope card --player=alice     # Alice's handicap card only
slope card --team             # Side-by-side comparison
```

The `--team` flag shows a comparison table:

```
Player          Cards  Handicap  Fairway%    GIR%  Penalties
────────────────────────────────────────────────────────────
alice               8      +0.5     85.0%   80.0%       0.5
bob                 6      +1.2     72.0%   68.0%       1.0
```

## Shared Hazard Index

When multiple developers report the same recurring pattern, SLOPE tracks all reporters and escalates severity:

- **1 reporter** → low severity
- **2 reporters** → medium severity
- **3+ reporters** → high severity

Patterns with multiple reporters show `[N reporters]` in briefings:

```
[testing] Flaky CI in deploy pipeline (last: S18) [3 reporters]
```

### Briefing Flags

```bash
slope briefing                      # Team-wide hazards (default)
slope briefing --player=alice       # Alice's scorecards + all hazards
slope briefing --personal           # Only hazards reported by you
```

### Merging Hazards

Use `mergeHazardIndices()` to combine patterns from multiple developers:

```typescript
import { mergeHazardIndices } from '@srbryers/core';

const merged = mergeHazardIndices(existingIssues, newPatterns, 'alice');
```

## Team Leaderboard

The leaderboard ranks players by handicap (lower = better):

```bash
slope dashboard    # Leaderboard section appears when >1 player
```

API endpoint:

```bash
curl localhost:3000/api/leaderboard
```

Returns ranked JSON:

```json
{
  "entries": [
    { "rank": 1, "player": "alice", "handicap": 0.5, "scorecardCount": 8, ... },
    { "rank": 2, "player": "bob", "handicap": 1.2, "scorecardCount": 6, ... }
  ],
  "generatedAt": "2026-02-22T..."
}
```

The leaderboard section is hidden on the dashboard when only one player exists.

## Scorecard Attribution Strategy

1. **Single developer** — omit `player` field, everything works as before
2. **Team** — add `player` to each scorecard, use `--team` for comparisons
3. **Mixed** — scorecards without `player` go to `"default"`, others to their player

## MCP Integration

All player and leaderboard functions are available via the SLOPE MCP server:

```javascript
// Extract all players
return extractPlayers(loadScorecards());

// Per-player handicap
return computePlayerHandicaps(loadScorecards());

// Build leaderboard
return buildLeaderboard(loadScorecards());

// Reporter severity
return computeReporterSeverity(['alice', 'bob', 'charlie']); // → 'high'
```
