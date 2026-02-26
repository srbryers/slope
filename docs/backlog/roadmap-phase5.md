# SLOPE Roadmap — Phase 5: Smart Onboarding + Recommendation Engine

**Phase 5 (S30-S33):** Repo-aware onboarding, vision tracking, and the recommendation engine that closes the loop between where you're going and how you're performing.

**Prerequisite:** v1.7.0 (CaddyStack MVP gaps — PostgreSQL store, GitHub client, event ingestion, standup aggregation)

**Parallel tracks:**
- Foundation: S30 (standalone, first)
- Generation: S31 (depends on S30)
- Remote: S32 (depends on S30, parallel with S31)
- Recommendation: S33 (depends on S31 + S32)

**Critical path:** S30 → S31 → S33 (3 sprints)
**Parallel:** S32 runs alongside S31

```
S30 ──→ S31 ──→ S33
  └───→ S32 ──┘
```

**Research doc:** [smart-onboarding-research.md](smart-onboarding-research.md)

---

## Sprint 30 — The Surveyor

**Par:** 4 | **Slope:** 3 (`elevated: new subsystem, 4 analyzers, vision document concept, new CLI command`) | **Type:** architecture + feature

**Theme:** Teach SLOPE to understand the repo it's installed in. Four local analyzers scan tech stack, structure, git history, and testing setup. The results are cached as a `RepoProfile` in `.slope/repo-profile.json`. A new vision document captures the user's intent. Together they form the two sides of every future recommendation: what IS vs what SHOULD BE.

### Tickets

#### S30-1: Analyzer types + pipeline runner
- **Club:** short_iron | **Complexity:** standard
- Define `RepoProfile` and all sub-profile interfaces in `src/core/analyzers/types.ts`
- Build pipeline runner in `src/core/analyzers/index.ts`:
  - Accepts list of analyzer names to run (default: all)
  - Runs analyzers in parallel where possible
  - Merges results into `RepoProfile`
  - Records `analyzedAt` timestamp and which analyzers ran
- Cache: writes `RepoProfile` to `.slope/repo-profile.json`
- Export from `src/core/index.ts`
- Tests: pipeline runs all analyzers, partial runs, cache read/write

#### S30-2: Stack + structure analyzers
- **Club:** short_iron | **Complexity:** standard
- **Stack analyzer** (`src/core/analyzers/stack.ts`):
  - Detect from manifest files: `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `Gemfile`, `pom.xml`
  - Parse manifest dependencies to infer frameworks (React, Express, Django, Rails, etc.)
  - Detect package manager from lock files (`pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`)
  - Count file extensions for language distribution
  - Detect runtime from `.nvmrc`, `engines`, `.python-version`, etc.
- **Structure analyzer** (`src/core/analyzers/structure.ts`):
  - Count total, source, and test files
  - Measure max directory depth
  - Detect monorepo patterns (`packages/`, `apps/`, multiple `package.json` files)
  - Identify module boundaries (top-level dirs with distinct purposes)
  - Flag large files (>1000 lines) as complexity hotspots
- Tests: detection for Node/Python/Go/Rust stacks, monorepo vs flat detection, large file flagging

#### S30-3: Git history + testing analyzers
- **Club:** short_iron | **Complexity:** standard
- **Git history analyzer** (`src/core/analyzers/git.ts`):
  - Count commits in last 90 days, compute commits/week
  - Count unique authors from `git shortlog`
  - Infer sprint cadence from commit frequency (daily → weekly, weekly → biweekly, etc.)
  - Identify active branches
  - Find last tag/release for release cadence
  - Works locally via `git` CLI — no GitHub token needed
- **Testing analyzer** (`src/core/analyzers/testing.ts`):
  - Detect test framework from config files (`vitest.config`, `jest.config`, `pytest.ini`, etc.)
  - Find test directories and count test files
  - Check for coverage configuration
  - Check for test script in package manifest
- Tests: cadence inference from different commit patterns, test framework detection across ecosystems

#### S30-4: Vision document + `slope analyze` CLI command
- **Club:** short_iron | **Complexity:** standard
- **Vision document** (`.slope/vision.json`):
  - Created during `slope init --interactive` (extend existing interview)
  - Fields: `purpose`, `audience`, `priorities` (ordered list), `techDirection`, `nonGoals`, `createdAt`, `updatedAt`
  - Stored as JSON for machine readability (SLOPE references it programmatically)
  - `slope vision` CLI command: view current vision
  - `slope vision edit` or `slope init --interactive`: revise vision at any time
  - Add `visionPath` field to `SlopeConfig` (default: `.slope/vision.json`)
- **`slope analyze` CLI command:**
  - Runs the analyzer pipeline, writes `.slope/repo-profile.json`
  - Prints summary to terminal (stack, structure, team, velocity, testing)
  - `--json` flag for machine-readable output
  - Designed to run in post-hole routine (sprint completion) and on demand
- Update `slope init --smart` to run analyzers + interview + generators in one flow
- Tests: vision CRUD, analyze CLI output, `--smart` init flow

### Execution Order

```
S30-1 → S30-2 ─┐
                ├→ S30-4
S30-1 → S30-3 ─┘
```

S30-1 (types + pipeline) must land first. S30-2 and S30-3 are parallel (different analyzers). S30-4 (vision + CLI) needs the analyzers working.

---

## Sprint 31 — The Course Designer

**Par:** 4 | **Slope:** 2 (`moderate: generators consume analyzer output, template logic, complexity estimation`) | **Type:** feature

**Theme:** Turn the `RepoProfile` into actionable SLOPE artifacts. Instead of generic templates, SLOPE generates config, roadmaps, sprint plans, and common issues seeded from what it actually found in the repo. The complexity estimator calibrates par and slope from real signals.

### Tickets

#### S31-1: Complexity estimator
- **Club:** short_iron | **Complexity:** standard
- `src/core/analyzers/complexity.ts`:
  - Estimate par from file count + module count + contributor count
  - Estimate slope from risk factors: monorepo (+1), no CI (+1), large dep tree (+1), no tests (+1), single contributor (+1)
  - Identify risk areas: modules with high file count + low test coverage
  - Bus factor analysis: modules where 80%+ commits from one author
  - Returns `ComplexityProfile` with `estimatedPar`, `estimatedSlope`, `slopeFactors`, `riskAreas`, `busFactor`
- Tests: par/slope estimation across different repo sizes, risk area detection, bus factor computation

#### S31-2: Config + first sprint generators
- **Club:** short_iron | **Complexity:** standard
- **Config generator** (`src/core/generators/config.ts`):
  - Sets `projectName` from package manifest or README title
  - Sets `sprintCadence` from git history analyzer
  - Sets `techStack` from stack analyzer
  - Sets team from git contributors (top active last 90 days)
  - Merges with user interview input (vision, metaphor, priorities override inferred values)
- **First sprint plan generator** (`src/core/generators/first-sprint.ts`):
  - Picks top 3-5 items from: TODO/FIXME comments grouped by module, or GitHub issues if available
  - Sets par/slope from complexity estimator
  - Generates club selections based on estimated scope per item
  - Includes setup tasks if missing: "add CI", "configure test coverage", "create CONTRIBUTING.md"
- Tests: config generation from sample profiles, sprint plan from TODO clusters, setup task detection

#### S31-3: Common issues seed + backlog analyzer (local)
- **Club:** short_iron | **Complexity:** standard
- **Backlog analyzer (local)** (`src/core/analyzers/backlog.ts`):
  - Scan source files for TODO/FIXME/HACK/XXX comments with file and line number
  - Parse CHANGELOG for unreleased section
  - Group TODOs by module/directory for pattern detection
  - No GitHub token required — local only
- **Common issues seed generator** (`src/core/generators/common-issues.ts`):
  - Extract warnings from README ("Known issues", "Caveats", "Limitations" sections)
  - Convert HACK/FIXME clusters into common issue entries
  - Seed `.slope/common-issues.json` with real patterns instead of placeholder
  - Tag seeded entries with `"source": "analyzer"` to distinguish from manual/telemetry entries
- Tests: TODO extraction across file types, README section parsing, seeded vs manual entry distinction

#### S31-4: `slope init --smart` integration
- **Club:** short_iron | **Complexity:** standard
- Wire everything together in the init command:
  1. Run analyzers → build `RepoProfile`
  2. Print summary ("Stack: TypeScript, 104 source files, 3 contributors...")
  3. Ask user for monorepo treatment (if detected)
  4. Run interview for subjective inputs (vision, priorities, metaphor)
  5. Run generators → produce config, first sprint plan, common issues
  6. Write all artifacts
  7. Cache `RepoProfile`
- Also wire `slope analyze` into post-hole routine documentation
- Tests: end-to-end `--smart` flow with sample repos, monorepo prompt, re-analyze after changes

### Execution Order

```
S31-1 → S31-2 ─┐
                ├→ S31-4
S31-1 → S31-3 ─┘
```

S31-1 (complexity) first — generators need par/slope estimates. S31-2 and S31-3 are parallel. S31-4 wires it all together.

---

## Sprint 32 — The Scout

**Par:** 4 | **Slope:** 2 (`moderate: GitHub API integration, remote analysis, optional token`) | **Type:** feature + integration

**Theme:** Extend analyzers to use the GitHub client (from v1.7.0) for remote repo analysis. CI pipeline detection, README/CONTRIBUTING extraction, issue backlog analysis, and roadmap generation from milestones. All optional — graceful degradation without a GitHub token.

### Tickets

#### S32-1: CI + docs analyzers
- **Club:** short_iron | **Complexity:** standard
- **CI analyzer** (`src/core/analyzers/ci.ts`):
  - Detect CI system from config files (`.github/workflows/`, `.circleci/`, `.gitlab-ci.yml`, `Jenkinsfile`)
  - Parse workflow YAML: extract triggers, stages (test/build/deploy), environment usage
  - Works locally (reads files) but enhanced with GitHub API for workflow run history
- **Docs analyzer** (`src/core/analyzers/docs.ts`):
  - Check for README.md → extract first paragraph as project summary
  - Check for CONTRIBUTING.md → extract conventions and guidelines
  - Check for ADR directory, API docs, CHANGELOG
  - Local file reads; GitHub API used for remote repos without local clone
- Tests: CI detection for GH Actions/CircleCI/GitLab, README parsing, CONTRIBUTING extraction

#### S32-2: GitHub backlog analyzer
- **Club:** short_iron | **Complexity:** standard
- **Backlog analyzer (remote)** — extends the local backlog analyzer from S31-3:
  - Fetch open issues from GitHub API, group by labels and milestones
  - Identify high-priority items (labels: `priority:high`, `bug`, `security`)
  - Count issues per milestone for progress tracking
  - Merge with local TODO/FIXME data for a unified backlog view
- Requires GitHub token — skips gracefully without one, uses local-only backlog
- Token asked during `slope init` (optional), stored in config or read from `GITHUB_TOKEN` env
- Tests: issue fetching with mocked API, label grouping, milestone progress, graceful degradation

#### S32-3: Roadmap generator from GitHub milestones
- **Club:** short_iron | **Complexity:** standard
- **Roadmap generator** (`src/core/generators/roadmap.ts`):
  - If milestones exist → map milestones to phases, issues within milestones to sprint tickets
  - If labels but no milestones → group issues by label into logical phases
  - If no issues → fall back to TODO clusters from local backlog analyzer
  - Each sprint gets par/slope from complexity estimator
  - Dependencies inferred from issue references (`#123`, `depends on #456`, `blocked by #789`)
  - Outputs `docs/backlog/roadmap.json` in SLOPE's existing roadmap format
- Tests: milestone→phase mapping, label-based grouping, dependency inference, fallback chain

#### S32-4: MCP `analyze` tool
- **Club:** short_iron | **Complexity:** standard
- Register `analyze` tool in MCP server:
  - Input: optional `path` (default cwd), optional `analyzers` list, optional `remote` (owner/repo)
  - Output: full `RepoProfile` as structured JSON
  - LLM calls this to understand a repo before guiding onboarding conversation
- Register `search({ module: 'onboard' })` in MCP:
  - Returns available onboarding functions: `analyze`, `generateConfig`, `generateRoadmap`, `generateFirstSprint`
  - Each with input/output schemas for LLM consumption
- Tests: MCP tool registration, analyze with/without remote, search module discovery

### Execution Order

```
S32-1 ─┐
       ├→ S32-3
S32-2 ─┘
S32-4 (independent — wires existing analyzers into MCP)
```

S32-1 (CI + docs) and S32-2 (GitHub backlog) are parallel. S32-3 (roadmap generator) needs both. S32-4 (MCP) is independent — it exposes whatever analyzers exist.

---

## Sprint 33 — The Caddy's Notebook

**Par:** 4 | **Slope:** 3 (`elevated: cross-system integration, drift detection logic, recommendation algorithms`) | **Type:** feature + intelligence

**Theme:** Close the loop. The recommendation engine connects vision (what SHOULD BE) to repo profile (what IS) to scorecards (how you're PERFORMING) and surfaces actionable guidance. This isn't a new system — it's the connective tissue between existing systems.

**Why "The Caddy's Notebook":** A caddy keeps notes on every hole — wind conditions, club choices that worked, where the trouble is. Over rounds, those notes become a recommendation engine. SLOPE does the same: tracking vision, performance, and codebase evolution to recommend what to do next.

### Tickets

#### S33-1: Vision drift detection
- **Club:** long_iron | **Complexity:** moderate
- `src/core/drift.ts`:
  - Compare current `RepoProfile` against `.slope/vision.json`
  - Detect structural drift:
    - New languages appearing that weren't in `techDirection`
    - Module count growing beyond initial structure
    - Test coverage declining when reliability was a stated priority
    - New contributors changing team dynamics
  - Detect priority drift:
    - If "performance" is priority #1 but recent sprints have zero perf-related tickets
    - If "security" is listed but no security-tagged issues addressed in N sprints
  - Output: `DriftReport` with `observations[]`, each with `category`, `description`, `severity` (info/warning/action), `suggestion`
  - Not a blocker — observations, not enforcement
- `slope drift` CLI command: run drift detection, print report
- Integrate into `slope briefing`: if drift observations exist, show a "Strategic Notes" section
- Tests: structural drift detection, priority drift, no false positives on aligned repos

#### S33-2: Sprint recommendations from backlog + velocity
- **Club:** short_iron | **Complexity:** standard
- `src/core/recommend.ts`:
  - Input: `RepoProfile`, vision, recent scorecards (last 5), current backlog
  - Recommend next sprint contents:
    - Prioritize items aligned with vision priorities
    - Balance ticket complexity based on recent handicap (don't overload after a bad sprint)
    - Flag items that have been in backlog for N+ sprints without progress
    - Suggest "maintenance" tickets if drift report shows neglected areas (test coverage, docs)
  - Output: `SprintRecommendation` with suggested tickets, estimated par/slope, rationale
- `slope recommend` CLI command: print sprint recommendation
- Tests: recommendation from sample backlog + scorecards, velocity-aware sizing, maintenance ticket injection

#### S33-3: Roadmap validation against vision
- **Club:** short_iron | **Complexity:** standard
- Extend `slope roadmap review` to validate against vision document:
  - Check that all stated priorities have at least one sprint addressing them
  - Flag phases that don't map to any vision priority (potential scope creep)
  - Check timeline feasibility based on velocity from git history analyzer
  - Surface "vision items not covered by any sprint" as gaps
- Add "Vision Alignment" section to roadmap review output
- Tests: alignment check with covered/uncovered priorities, scope creep detection, velocity-based timeline check

#### S33-4: Post-sprint re-analysis + recommendation loop
- **Club:** short_iron | **Complexity:** standard
- Wire `slope analyze` into the post-hole routine:
  - After scoring a sprint, automatically re-run analyzers to update `RepoProfile`
  - Run drift detection against updated profile
  - Generate sprint recommendation for the next sprint
  - Surface all of this in the next `slope briefing`
- Update post-hole documentation in sprint checklist rule
- Add `slope next-sprint` as convenience command: runs analyze → drift → recommend in sequence
- Tests: end-to-end post-sprint flow, profile update triggers recommendation, briefing shows recommendations

### Execution Order

```
S33-1 → S33-3
S33-2 (independent)
S33-1 + S33-2 → S33-4
```

S33-1 (drift detection) is the foundation. S33-3 (roadmap validation) extends it. S33-2 (sprint recommendations) is independent. S33-4 (post-sprint loop) ties everything together.

---

## Summary

| Sprint | Theme | Par | Slope | Tickets | Key Deliverable | Depends On |
|--------|-------|-----|-------|---------|-----------------|------------|
| **S30** | The Surveyor | 4 | 3 | 4 | Repo analyzers (stack, structure, git, testing) + vision document + `slope analyze` | — |
| **S31** | The Course Designer | 4 | 2 | 4 | Generators (config, first sprint, common issues) + complexity estimator + `--smart` init | S30 |
| **S32** | The Scout | 4 | 2 | 4 | GitHub analyzers (CI, docs, backlog) + roadmap generator + MCP `analyze` tool | S30 |
| **S33** | The Caddy's Notebook | 4 | 3 | 4 | Drift detection + sprint recommendations + roadmap-vision validation + post-sprint loop | S31, S32 |

**Total:** 16 tickets across 4 sprints. Critical path: S30 → S31 → S33 (3 sprints).

### What Changes for Users

| Before Phase 5 | After Phase 5 |
|----------------|---------------|
| `slope init` creates generic templates | `slope init --smart` creates repo-aware config, calibrated sprint plan, seeded common issues |
| No vision tracking | `.slope/vision.json` captures intent, drift detection flags divergence |
| Manual roadmap creation | Roadmap auto-generated from GitHub milestones/issues or TODO clusters |
| Manual sprint planning | `slope recommend` suggests next sprint based on backlog + velocity + vision |
| Post-sprint is just scoring | Post-sprint re-analyzes repo, detects drift, recommends next sprint |
| `slope briefing` shows hazards + history | Briefing gains "Strategic Notes" (drift) and "Recommended Next Sprint" sections |
| MCP has no repo analysis | MCP `analyze` tool returns full `RepoProfile` for LLM-driven onboarding |

### The Recommendation Loop

After Phase 5, SLOPE's feedback loop is:

```
Vision (what SHOULD BE)
    ↓
Roadmap (how to get there)  ←─── roadmap-vision validation (S33-3)
    ↓
Sprint (current work)       ←─── sprint recommendations (S33-2)
    ↓
Scorecard (how it went)
    ↓
Re-analyze (what IS now)    ←─── post-sprint re-analysis (S33-4)
    ↓
Drift detection             ←─── vision drift (S33-1)
    ↓
Back to Vision (update or course-correct)
```

This is the recommendation engine. Not a separate system — just the loop that connects everything SLOPE already does.
