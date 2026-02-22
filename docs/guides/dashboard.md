# SLOPE Dashboard

Live local performance dashboard served by `slope dashboard`. Data refreshes on each request, with sprint drill-down on click and miss-pattern heatmap visualization.

## Quick Start

```bash
slope dashboard
```

Opens `http://localhost:3000` in your browser with all SLOPE charts.

## CLI Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--port=N` | 3000 | HTTP server port |
| `--no-open` | (auto-open) | Don't open browser automatically |
| `--refresh=N` | 30 | Auto-refresh interval in seconds (0 = disable) |
| `--metaphor=ID` | config/golf | Metaphor for display labels |
| `--help` | — | Show usage |

## Configuration

Add to `.slope/config.json`:

```json
{
  "dashboard": {
    "port": 8080,
    "autoOpen": false,
    "refreshInterval": 60
  }
}
```

Priority: CLI flags > config file > defaults.

## API Routes

| Route | Response | Description |
|-------|----------|-------------|
| `GET /` | HTML | Full dashboard page |
| `GET /api/data` | JSON | `ReportData` object |
| `GET /api/sprint/:n` | JSON | Single scorecard |
| `GET /api/sprint/:n?html=1` | HTML | Rendered sprint detail |

## Dashboard Sections

1. **Summary Cards** — Handicap, fairway %, GIR %, scorecard count
2. **Performance Trend** — Handicap differential line chart over sprints
3. **Sprint Timeline** — Par vs actual bar chart (click to drill down)
4. **Dispersion** — Shot scatter by miss direction
5. **Miss Pattern Heatmap** — 2D grid: sprints x directions, intensity-colored
6. **Approach Performance** — Per-club success/miss rate bars
7. **Area Hazard Frequency** — Hazard rates by area with top hazard types
8. **Nutrition Trends** — Development health stacked bars
9. **Sprint History** — Table with click-to-drill-down

## Sprint Drill-Down

Click any sprint row in the history table or any bar in the timeline chart to expand inline detail:
- Shot records (ticket, club, result, hazards, notes)
- Conditions and special plays
- Nutrition entries
- 19th Hole reflections

Click the same sprint again to close.

## Architecture

- Node built-in `http` module only — zero external dependencies
- Data loaded fresh on every request from scorecard JSON files
- Composes existing chart renderers from `report.ts` — no duplication
- Auto-refresh via `<meta http-equiv="refresh">` tag
- Inline `<script>` for drill-down (no external JS)

## Troubleshooting

**Port in use:** Use `--port=8080` or another available port.

**Browser doesn't open:** Use `--no-open` and navigate manually, or check that `xdg-open` (Linux) / `open` (macOS) is available.

**No data:** Ensure scorecards exist in the configured `scorecardDir` (default: `docs/retros/`).
