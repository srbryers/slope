# SLOPE Roadmap — Phase 4

**Phase 4 (S17-S20):** Plugin extensibility + PR signals + local dashboard + multi-developer support

**Dependencies:** All Phase 4 sprints build on the S7-S15 foundation (complete).

**Parallel tracks:**
- Extensibility: S17 (standalone)
- Signals: S18 (depends on S17 for plugin architecture)
- Visualization: S19 (standalone, benefits from S18 data)
- Multi-developer: S20 (depends on S19 for dashboard, S17 for plugin system)

**Critical path:** S17 → S18 → S20 (3 sprints)
**Parallel:** S19 runs alongside S18

---

## Sprint 17 — The Plugin System

**Par:** 4 | **Slope:** 2 (`moderate: new extension points, loader architecture, backward compat`) | **Type:** architecture + extensibility

**Theme:** Make SLOPE extensible beyond the built-in capabilities. Pluggable metaphor loaders for community-contributed metaphors, custom guard plugins for domain-specific guidance, and a formalized hook extensibility API.

**Why first:** Every subsequent Phase 4 sprint benefits from the plugin architecture. S18's PR signal parsers can be plugins. S19's dashboard can load visualization plugins. S20's multi-developer layer needs extensible configuration.

### Key Design Decisions
- Plugin discovery: `.slope/plugins/` directory vs npm packages vs both
- Plugin API: synchronous loaders vs async with lifecycle hooks
- Guard plugin contract: stdin/stdout (like current guards) vs JavaScript API
- Metaphor loading: JSON-only definitions vs JS/TS for computed terms

### Risk Assessment
- **Medium risk:** Backward compatibility — existing metaphors and guards must work unchanged
- **Low risk:** Scope creep — plugin system must ship with concrete use cases (metaphor loading, guard plugins), not just abstract framework

### Tickets

#### S17-1: Plugin discovery + loader framework
- **Club:** short_iron | **Complexity:** standard
- Plugin registry in `packages/core/src/plugins.ts`
- Discovery: scan `.slope/plugins/` for JSON and JS plugin manifests
- Plugin types: `metaphor`, `guard`, `signal-parser`, `formatter`
- Loader lifecycle: discover → validate → register → activate
- Tests: discovery, validation, registration, duplicate detection

#### S17-2: Pluggable metaphor loaders
- **Club:** short_iron | **Complexity:** standard
- JSON metaphor definitions loadable from `.slope/plugins/metaphors/`
- Validation: all required term maps present, no missing keys
- CLI: `slope init --metaphor=custom` loads from plugin directory
- Existing built-in metaphors remain hardcoded (no regression)
- Tests: custom metaphor loading, validation errors, fallback to built-in

#### S17-3: Custom guard plugins
- **Club:** short_iron | **Complexity:** standard
- Guard plugin interface: name, trigger (PreToolUse/PostToolUse), handler path
- `slope guard install <path>` registers a custom guard
- Custom guards follow the same stdin/stdout contract as built-in guards
- `slope guard list` shows both built-in and custom guards
- Tests: custom guard registration, execution, uninstall

#### S17-4: Hook extensibility API + documentation
- **Club:** wedge | **Complexity:** small
- Formalize the hook extension points for external tools
- Document plugin authoring guide: metaphors, guards, signal parsers
- `slope plugin validate <path>` checks a plugin manifest
- Tests: plugin validation, documentation accuracy

### Execution Order

```
S17-1 → S17-2
S17-1 → S17-3
S17-1 → S17-4
```

S17-1 (framework) first. S17-2, S17-3, S17-4 are parallel after it.

---

## Sprint 18 — PR Signals

**Par:** 4 | **Slope:** 2 (`moderate: GitHub API integration, new signal source, scoring adjustments`) | **Type:** feature + integration

**Theme:** PR-as-scorecard — extract scoring signals from PR metadata, review comments, and CI status. This completes the signal source matrix from the vision doc (git: shipped, CI: shipped, PR: this sprint, agent telemetry: partial).

**Dependencies:** S17 (plugin architecture for signal parser extensibility)

### Key Design Decisions
- GitHub vs GitLab vs Bitbucket: GitHub first, others via signal parser plugins (S17)
- Authentication: `gh` CLI token vs personal access token vs GitHub App
- Signal extraction granularity: per-PR vs per-commit vs per-review-round
- Privacy: what PR data to store locally (metadata only, not review text)

### Risk Assessment
- **Medium risk:** API rate limits — need caching and graceful degradation
- **Low risk:** Platform lock-in — plugin architecture (S17) enables other providers

### Tickets

#### S18-1: PR metadata signal parser
- **Club:** short_iron | **Complexity:** standard
- New signal source module: `packages/core/src/signals/pr.ts`
- Extract from GitHub PRs: review cycles, change request count, time-to-merge, CI status, file count, comment density
- Uses `gh` CLI for data access (no direct API dependency)
- `slope auto-card --pr=<number>` adds PR signals to scorecard generation
- Tests: PR metadata parsing, signal extraction, graceful degradation without `gh`

#### S18-2: Review-based shot classification
- **Club:** short_iron | **Complexity:** standard
- Enhance `classifyShot()` with PR review signals:
  - 0 change requests + fast merge → boost toward `in_the_hole`
  - Multiple change request rounds → penalize toward miss
  - Large review comment density → signal complexity (adjust approach scoring)
- Signal weighting configurable in `.slope/config.json`
- Tests: classification with PR signals, weight configuration, backward compat without PR data

#### S18-3: CI status integration from PR
- **Club:** short_iron | **Complexity:** standard
- Extract CI check statuses from PR (GitHub Actions, third-party checks)
- Correlate CI failures with specific commits/tickets
- Distinguish first-run failures vs fixed-on-retry
- Feed into existing CI signal pipeline (S10)
- Tests: CI status extraction, correlation with commits, retry detection

#### S18-4: PR signal documentation + plugin template
- **Club:** wedge | **Complexity:** small
- Document PR signal configuration and usage
- Create a signal parser plugin template for other PR platforms (GitLab, Bitbucket)
- Add PR signals to `slope briefing` output
- Tests: briefing with PR context, plugin template validation

### Execution Order

```
S18-1 → S18-2
S18-1 → S18-3
S18-1 → S18-4
```

S18-1 (PR parser) first. S18-2, S18-3, S18-4 are parallel after it.

---

## Sprint 19 — The Dashboard

**Par:** 4 | **Slope:** 2 (`moderate: local web server, interactive visualizations, real-time data`) | **Type:** feature + visualization

**Theme:** Local HTML dashboard — `slope dashboard` starts a local web server for interactive exploration of scorecard data. Handicap trends, miss pattern heatmaps, sprint timeline, and area performance breakdowns. Builds on the static HTML reports from S13.

**Dependencies:** None hard. Benefits from S18 for richer data to visualize.

### Key Design Decisions
- Server: lightweight HTTP server (Node built-in `http` or `serve`) vs Express
- Rendering: server-side HTML generation vs client-side SPA (React/Preact)
- Data refresh: polling vs WebSocket vs manual refresh
- Bundling: self-contained (vendor deps inline) vs npm dependencies

### Risk Assessment
- **Medium risk:** Scope creep — dashboard can grow unbounded; strict MVP (4 views) required
- **Low risk:** Technology choice — Node built-in HTTP + static HTML with inline JS is the simplest path

### Tickets

#### S19-1: Dashboard server + data API
- **Club:** short_iron | **Complexity:** standard
- `slope dashboard` starts a local HTTP server on configurable port (default 3000)
- JSON API endpoints: `/api/scorecards`, `/api/handicap`, `/api/dispersion`, `/api/events`
- Reads from `.slope/` directory (scorecards, SQLite store)
- Auto-opens browser on start
- Tests: server startup, API responses, graceful shutdown

#### S19-2: Handicap trend + sprint timeline views
- **Club:** short_iron | **Complexity:** standard
- Interactive handicap trend chart (rolling windows over time)
- Sprint timeline: visual representation of all sprints with par vs actual
- Click-through to individual sprint details
- Metaphor-aware labels and terminology
- Tests: view rendering with sample data, metaphor term substitution

#### S19-3: Miss pattern heatmap + area performance
- **Club:** short_iron | **Complexity:** standard
- Miss pattern heatmap: which directions (long/short/left/right) occur most frequently
- Area performance: grouped by file area or package, showing per-area handicap
- Hazard frequency overlay: which areas generate the most hazards
- Tests: heatmap data computation, area grouping logic

#### S19-4: Dashboard configuration + documentation
- **Club:** wedge | **Complexity:** small
- Dashboard config in `.slope/config.json`: port, auto-open, default view
- Documentation: usage guide, screenshots, customization
- `slope dashboard --port=8080 --no-open` for CI/headless environments
- Tests: configuration loading, CLI flag handling

### Execution Order

```
S19-1 → S19-2
S19-1 → S19-3
S19-1 → S19-4
```

S19-1 (server + API) first. S19-2, S19-3, S19-4 are parallel after it.

---

## Sprint 20 — The Foursome (Multi-Developer)

**Par:** 4 | **Slope:** 2 (`moderate: multi-user data model, merge strategy, shared state`) | **Type:** feature + collaboration

**Theme:** Multi-developer support — per-player handicaps, team leaderboard, and shared hazard indices. This extends SLOPE from single-developer (with multi-agent support from S14-S15) to multi-developer teams where different humans contribute scorecards to the same repository.

**Dependencies:** S17 (plugin system for extensible config), S19 (dashboard for team views)

### Key Design Decisions
- Player identification: git author email vs explicit config vs both
- Scorecard attribution: one scorecard per player per sprint vs shared scorecards
- Hazard sharing: automatic merge vs explicit sharing vs pull-based
- Privacy: individual handicaps visible to team or private by default

### Risk Assessment
- **High risk:** Merge conflicts — multiple developers committing scorecards to the same repo need a merge strategy
- **Medium risk:** Privacy expectations — individual performance data needs clear visibility controls

### Tickets

#### S20-1: Player identification + per-player handicaps
- **Club:** short_iron | **Complexity:** standard
- Player identification from git author email (auto-detected) or `.slope/config.json` explicit mapping
- Per-player handicap computation: filter scorecards by author, compute individual rolling windows
- `slope card --player=<email>` shows individual handicap card
- `slope card --team` shows all players' handicap cards side by side
- Tests: player detection, per-player filtering, team aggregation

#### S20-2: Shared hazard indices
- **Club:** short_iron | **Complexity:** standard
- Common issues tagged with player source (who reported it)
- Hazard indices merge across players: same hazard reported by multiple players increases severity
- `slope briefing` includes team-wide hazards, not just personal ones
- Configurable visibility: team-wide (default) or per-player filtered
- Tests: multi-player hazard merging, severity escalation, visibility filtering

#### S20-3: Team leaderboard + dashboard integration
- **Club:** short_iron | **Complexity:** standard
- Team leaderboard: ranked by handicap, improvement trend, hazard contribution
- Dashboard view (extends S19): team overview, per-player drill-down
- `slope tournament --team` for team-level tournament reviews
- Metaphor-aware leaderboard labels
- Tests: leaderboard ranking, dashboard data API, tournament team aggregation

#### S20-4: Multi-developer documentation + onboarding
- **Club:** wedge | **Complexity:** small
- Team setup guide: how to configure multi-developer SLOPE
- Onboarding flow: `slope init --team` configures shared settings
- Scorecard merge strategy documentation (git-based, no custom merge drivers needed)
- Tests: team init flow, documentation accuracy

### Execution Order

```
S20-1 → S20-2 ─┐
                ├→ S20-4
S20-1 → S20-3 ─┘
```

S20-1 (player identification) first. S20-2 (hazards) and S20-3 (leaderboard) parallel after it. S20-4 (docs) last.

---

## Summary

| Sprint | Theme | Par | Slope | Tickets | Key Deliverable | Depends On |
|--------|-------|-----|-------|---------|-----------------|------------|
| **S17** | The Plugin System | 4 | 2 | 4 | Pluggable metaphor loaders, custom guard plugins, hook extensibility | — |
| **S18** | PR Signals | 4 | 2 | 4 | PR-as-scorecard: scoring signals from PR metadata, review comments, CI status | S17 |
| **S19** | The Dashboard | 4 | 2 | 4 | Local HTML dashboard: handicap trends, miss pattern heatmap, sprint timeline | — (benefits from S18) |
| **S20** | The Foursome | 4 | 2 | 4 | Multi-developer: per-player handicaps, team leaderboard, shared hazard indices | S17, S19 |

**Total:** 16 tickets across 4 sprints. All sprints at 4 tickets.

### Vision Doc Coverage

| Vision Item | Sprint |
|-------------|--------|
| Plugin system | S17 |
| PR metadata signals | S18 |
| Local dashboard | S19 |
| Shared hazard indices | S20 |
| Multi-developer handicaps | S20 |
| Team leaderboard | S20 |
