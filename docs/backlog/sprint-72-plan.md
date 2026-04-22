# Sprint 72 Plan — The Clubhouse Network (Multi-Repo Aggregation)

**Par:** 4 (4 tickets)
**Slope:** 3
**Theme:** Cross-repo scorecard collection, org-level handicap, slope org CLI

## Context

Scorecard loading and handicap computation are source-agnostic — `loadScorecards(config, cwd)` accepts any cwd, and `computeHandicapCard(scorecards)` works on any array. No org config or multi-repo loader exists. Sprint numbers are repo-local (S50 in repo-A != S50 in repo-B).

**Design decision:** Use a simple `repos` array in a new `.slope/org.json` config. Each entry is a path to a repo root. Scorecards are tagged with repo name on load. Sprint IDs namespaced as `repo:S50` for display.

## Tickets

### T1: Cross-repo scorecard collection
**Club:** long_iron
**Files:** `src/core/org.ts` (new), `src/core/index.ts`

- Define `OrgConfig` interface: `{ repos: Array<{ name: string; path: string }> }`
- `loadOrgConfig(cwd)` reads `.slope/org.json`
- `loadOrgScorecards(orgConfig)` iterates repos, calls `loadScorecards` per repo, tags each scorecard with `_repo` metadata
- Returns `OrgScorecard[]` (extends GolfScorecard with `_repo: string`)

### T2: Org-level handicap card
**Club:** short_iron
**Files:** `src/core/org.ts`, `src/core/handicap.ts`

- `computeOrgHandicap(orgScorecards)` — aggregate handicap across all repos
- Per-repo breakdown: `{ repo: string, handicap: HandicapCard, sprint_count: number }`
- Overall org card: combined handicap from all scorecards

### T3: `slope org status` — show all repos
**Club:** short_iron
**Files:** `src/cli/commands/org.ts` (new), `src/cli/index.ts`

- `slope org status` — table of repos with name, handicap, latest sprint, active sessions
- `slope org status --json` for machine-readable
- `slope org init` — create `.slope/org.json` template with repo paths

### T4: Cross-repo common-issues — promote shared patterns
**Club:** wedge
**Files:** `src/core/org.ts`

- `mergeCommonIssues(orgConfig)` — load common-issues.json from each repo
- Find patterns with matching title+category across 2+ repos → mark as "org-wide"
- `slope org issues` — show org-wide recurring patterns
