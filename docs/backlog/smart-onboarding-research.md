# Smart Onboarding — Research Doc

**Date:** 2026-02-25
**Status:** Research / RFC
**Author:** srbryers + Claude

## Problem

When someone installs SLOPE on a new repo today, the experience is:

```
slope init
```

This creates the same generic templates whether it's a 3-file CLI tool or a 500-file monorepo with CI pipelines, 12 contributors, and 200 open issues. SLOPE doesn't look at what's actually in the repo. The scorecard example is a placeholder. The roadmap is a stub. The config uses defaults.

For SLOPE to become a **recommendation engine** — not just a workflow methodology — it needs to understand the repo it's being installed into.

## Goals

1. **Zero-friction onboarding** — one command or one MCP conversation gets you from nothing to a fully-contextualized SLOPE setup
2. **Repo-aware configuration** — tech stack, team size, complexity, and cadence inferred from what's already there
3. **Actionable first sprint** — not a placeholder, but a real roadmap based on actual backlog items
4. **LLM-native** — works equally well from CLI (`slope init --smart`) and from an LLM talking to the MCP server

## What Exists Today

| Capability | Status | Gap |
|-----------|--------|-----|
| `slope init` | Creates static templates | No repo analysis |
| `slope init --interactive` | Collects user input | Doesn't use `techStack`, `vision`, `priorities` fields |
| `slope map` | Counts files, reads comments | No architecture analysis |
| `slope auto-card` | Reads git commits | Only for scoring, not onboarding |
| GitHub client | Can fetch commits, tree, files | Not integrated into init |
| `initFromInterview` | Creates config from input | Doesn't scan repo |
| MCP `search`/`execute` | Full API access for LLMs | No "analyze this repo" capability |
| `slope flows` | Maps workflows to code | Manual creation only |
| `slope briefing` | Surfaces sprint context | Only useful after sprints exist |

## Proposed Architecture

### Two Onboarding Paths

**Path A: CLI-driven (`slope init --smart`)**
- Runs all analyzers locally
- Produces config, roadmap, and first sprint plan
- Interactive prompts only for things that can't be inferred (vision, priorities)

**Path B: LLM-driven (MCP conversation)**
- LLM calls `search({ module: 'onboard' })` or a new `analyze()` MCP tool
- Gets structured repo analysis back
- Uses it to have a guided conversation with the user
- Calls `execute()` to write config/roadmap/plan

Both paths use the same underlying analyzer pipeline.

### Vision Document

A new SLOPE artifact: `.slope/vision.md` (or `.slope/vision.json`). Created during the initial interview, it captures:

- **Project purpose** — what the user says they're building
- **Target audience** — who it's for
- **Key priorities** — what matters most (speed, reliability, UX, etc.)
- **Tech direction** — intended stack, architecture, deployment
- **Non-goals** — what's explicitly out of scope

SLOPE references this document during sprint planning and review. If the `RepoProfile` diverges from the vision (e.g., new languages appearing, scope expanding into unplanned areas, test coverage declining when reliability was a priority), SLOPE surfaces it as a strategic observation — not a blocker, but a prompt to either update the vision or course-correct.

The user can revise their vision at any time via `slope init --interactive` or conversationally through the MCP tools.

### Analyzer Pipeline

A series of independent analyzers that each extract one dimension of context from the repo. Each returns a structured result. The pipeline runs them all and merges results into a `RepoProfile`.

```
┌─────────────┐
│  Analyzers  │
├─────────────┤
│ stack       │ → languages, frameworks, package manager, runtime
│ structure   │ → file count, depth, module boundaries, monorepo detection
│ git-history │ → contributors, commit cadence, active branches, recent velocity
│ testing     │ → test framework, coverage config, test file patterns
│ ci          │ → CI system (GH Actions, CircleCI, etc.), pipeline config
│ docs        │ → README, CONTRIBUTING, API docs, ADRs
│ backlog     │ → GitHub issues, TODO/FIXME comments, CHANGELOG
│ deps        │ → dependency count, outdated deps, security advisories
│ team        │ → git authors, commit distribution, bus factor
│ complexity  │ → file size distribution, deeply nested dirs, large files
└─────────────┘
         │
         ▼
┌─────────────────┐
│   RepoProfile   │  ← merged result from all analyzers
├─────────────────┤
│ stack            │ { languages, frameworks, packageManager, runtime }
│ structure        │ { fileCount, testCount, depth, isMonorepo, modules }
│ team             │ { contributors, activeLast90d, topContributors }
│ velocity         │ { commitsPerWeek, avgPRCycle, deployFrequency }
│ quality          │ { hasTests, testFramework, hasCi, hasLinting, hasCoverage }
│ backlog          │ { openIssues, labels, milestones, todoCount }
│ complexity       │ { estimatedPar, estimatedSlope, riskAreas }
│ docs             │ { hasReadme, readmeSummary, hasContributing, hasAdr }
└─────────────────┘
         │
         ▼
┌─────────────────┐
│   Generators    │  ← produce SLOPE artifacts from RepoProfile
├─────────────────┤
│ config          │ → .slope/config.json (stack-aware, team-aware)
│ roadmap         │ → docs/backlog/roadmap.json (from issues/milestones)
│ first-sprint    │ → docs/backlog/sprint-1-plan.md (from top issues)
│ scorecard-tmpl  │ → docs/retros/sprint-1.json (complexity-calibrated par/slope)
│ flows           │ → .slope/flows.json (from entry points, routes, handlers)
│ roles           │ → .slope/roles/ (from git author analysis)
│ briefing-seed   │ → .slope/common-issues.json (from README/CONTRIBUTING warnings)
└─────────────────┘
```

### Analyzer Details

#### 1. Stack Analyzer

**Inputs:** file extensions, config files, package manifests
**Logic:**
- Scan root for: `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `Gemfile`, `pom.xml`, `build.gradle`
- Parse manifest for dependencies → infer frameworks (React, Express, Django, Rails, etc.)
- Detect package manager: `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `package-lock.json` → npm, etc.
- Count file extensions → primary/secondary languages
- Detect runtime: Node version from `.nvmrc`/`engines`, Python from `.python-version`, etc.

**Output:**
```typescript
interface StackProfile {
  primaryLanguage: string;       // 'typescript', 'python', 'go', etc.
  languages: Record<string, number>; // language → file count
  frameworks: string[];          // ['react', 'express', 'vitest']
  packageManager?: string;       // 'pnpm', 'npm', 'yarn', 'cargo', 'pip'
  runtime?: string;              // 'node-22', 'python-3.12', 'go-1.22'
  buildTool?: string;            // 'tsc', 'vite', 'webpack', 'esbuild'
}
```

#### 2. Structure Analyzer

**Inputs:** directory tree (local `fs` or GitHub `getTree`)
**Logic:**
- Count total files, source files, test files
- Measure max directory depth
- Detect monorepo patterns: `packages/`, `apps/`, `libs/`, or multiple `package.json` files
- Identify module boundaries: top-level dirs with distinct purposes
- Flag large files (>1000 lines) as complexity hotspots

**Output:**
```typescript
interface StructureProfile {
  totalFiles: number;
  sourceFiles: number;
  testFiles: number;
  maxDepth: number;
  isMonorepo: boolean;
  modules: Array<{ name: string; path: string; fileCount: number }>;
  largeFiles: Array<{ path: string; lines: number }>;
}
```

#### 3. Git History Analyzer

**Inputs:** `git log`, `git shortlog`, or GitHub API
**Logic:**
- Count commits in last 90 days → velocity
- Count unique authors → team size
- Parse commit frequency → infer sprint cadence (daily commits = weekly sprints, weekly = biweekly, etc.)
- Identify active branches → current work streams
- Find last tag/release → release cadence

**Output:**
```typescript
interface GitProfile {
  totalCommits: number;
  commitsLast90d: number;
  commitsPerWeek: number;
  contributors: Array<{ name: string; email: string; commits: number }>;
  activeBranches: string[];
  lastRelease?: { tag: string; date: string };
  inferredCadence: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'sporadic';
}
```

#### 4. Testing Analyzer

**Inputs:** config files, test directories
**Logic:**
- Detect test framework: `vitest.config`, `jest.config`, `pytest.ini`, `.rspec`, `*_test.go`
- Find test directories: `tests/`, `__tests__/`, `test/`, `spec/`
- Count test files
- Check for coverage config: `coverage` in vitest/jest config, `.nycrc`, `coverage.py`
- Check for test scripts in package manifest

**Output:**
```typescript
interface TestProfile {
  framework?: string;            // 'vitest', 'jest', 'pytest', 'go-test'
  testFileCount: number;
  hasTestScript: boolean;
  hasCoverage: boolean;
  testDirs: string[];
}
```

#### 5. CI Analyzer

**Inputs:** `.github/workflows/`, `.circleci/`, `Jenkinsfile`, `.gitlab-ci.yml`
**Logic:**
- Detect CI system from config files
- Parse workflow triggers (push, PR, schedule)
- Identify test/build/deploy stages
- Check for environment secrets usage

**Output:**
```typescript
interface CIProfile {
  system?: string;               // 'github-actions', 'circleci', 'gitlab-ci', 'jenkins'
  workflows: Array<{ name: string; triggers: string[] }>;
  hasTestStage: boolean;
  hasBuildStage: boolean;
  hasDeployStage: boolean;
}
```

#### 6. Docs Analyzer

**Inputs:** README, CONTRIBUTING, docs directory
**Logic:**
- Check for README.md → extract first paragraph as project summary
- Check for CONTRIBUTING.md → extract conventions
- Check for ADR directory (`docs/adr/`, `docs/decisions/`)
- Check for API docs (`docs/api/`, OpenAPI spec)
- Check for CHANGELOG

**Output:**
```typescript
interface DocsProfile {
  hasReadme: boolean;
  readmeSummary?: string;        // first 2-3 sentences
  hasContributing: boolean;
  hasChangelog: boolean;
  hasAdr: boolean;
  hasApiDocs: boolean;
  conventions: string[];         // extracted from CONTRIBUTING
}
```

#### 7. Backlog Analyzer

**Inputs:** GitHub issues API, TODO/FIXME comments, CHANGELOG
**Logic:**
- If GitHub URL provided: fetch open issues, group by labels/milestones
- Scan source for TODO/FIXME/HACK/XXX comments → extract with file/line
- Parse CHANGELOG for unreleased section
- Identify high-priority items (labels: `priority:high`, `bug`, `security`)

**Output:**
```typescript
interface BacklogProfile {
  openIssues: number;
  issuesByLabel: Record<string, number>;
  milestones: Array<{ title: string; openCount: number; closedCount: number }>;
  todos: Array<{ file: string; line: number; text: string; type: 'TODO' | 'FIXME' | 'HACK' }>;
  suggestedFirstSprint: string[];  // top 3-5 issue titles/TODO items
}
```

#### 8. Complexity Estimator

**Inputs:** all other analyzer results
**Logic:**
- Estimate par from file count + module count + contributor count
- Estimate slope from: monorepo? (+1), CI complexity (+1), large dependency tree (+1), no tests (+1)
- Identify risk areas: modules with high file count + low test count
- Flag bus factor risk: modules where 80%+ commits from 1 author

**Output:**
```typescript
interface ComplexityProfile {
  estimatedPar: number;          // 3-5 based on repo size/complexity
  estimatedSlope: number;        // 1-5 based on risk factors
  slopeFactors: string[];        // explanations: "monorepo (+1)", "no CI (+1)"
  riskAreas: Array<{ module: string; reason: string }>;
  busFactor: Array<{ module: string; dominantAuthor: string; percentage: number }>;
}
```

### RepoProfile (Merged)

```typescript
interface RepoProfile {
  analyzedAt: string;
  repoUrl?: string;
  stack: StackProfile;
  structure: StructureProfile;
  git: GitProfile;
  testing: TestProfile;
  ci: CIProfile;
  docs: DocsProfile;
  backlog: BacklogProfile;
  complexity: ComplexityProfile;
}
```

### Generator Pipeline

Once the `RepoProfile` is built, generators produce SLOPE artifacts:

#### Config Generator
- Sets `metaphor` based on team preference (prompt) or default
- Sets `currentSprint` to 1 (or next if scorecards exist)
- Sets `sprintCadence` from `git.inferredCadence`
- Sets `team` from `git.contributors` (top active contributors)
- Sets `projectName` from package manifest or README title
- Adds `techStack` from stack analyzer

#### Roadmap Generator
- If GitHub issues exist with milestones → map milestones to phases, issues to sprint tickets
- If no milestones → group issues by label into logical phases
- If no issues → create roadmap from TODO/FIXME clusters grouped by module
- Each sprint gets `par` and `slope` from complexity estimator
- Dependencies inferred from issue references (`#123`, `depends on #456`)

#### First Sprint Plan Generator
- Pick top 3-5 items from backlog (highest priority issues, or most-mentioned TODOs)
- Set par/slope from complexity estimator
- Generate club selections based on estimated scope
- Include setup tasks: "configure CI", "set up test coverage", "create CONTRIBUTING.md" if missing

#### Flows Generator
- Scan for common entry point patterns:
  - Express/Koa/Fastify: route handler files → API flow
  - React/Next/Svelte: page components → user journey flow
  - CLI: command files → command flow
- Each detected pattern becomes a flow skeleton in `.slope/flows.json`
- Files are linked but steps need human review

#### Common Issues Seed
- Extract warnings from README ("Known issues", "Caveats", "Limitations")
- Extract HACK/FIXME comments as potential gotchas
- Seed `common-issues.json` with real patterns instead of placeholder

### MCP Integration

#### New MCP Tool: `analyze`

For LLM-driven onboarding, add an `analyze` tool to the MCP server:

```typescript
// MCP tool registration
{
  name: 'analyze',
  description: 'Analyze a repository and return a RepoProfile for smart onboarding',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Local repo path (default: cwd)' },
      remote: { type: 'string', description: 'GitHub owner/repo for remote analysis' },
      analyzers: {
        type: 'array',
        items: { enum: ['stack', 'structure', 'git', 'testing', 'ci', 'docs', 'backlog', 'complexity'] },
        description: 'Which analyzers to run (default: all)',
      },
    },
  },
}
```

This lets an LLM:
1. Call `analyze()` to understand the repo
2. Discuss findings with the user ("I see you're using React + Express with Vitest...")
3. Call `execute()` to generate config/roadmap with the user's input incorporated
4. Iterate on the setup conversationally

#### New MCP Module: `onboard`

```typescript
search({ module: 'onboard' })
// Returns: analyze, generateConfig, generateRoadmap, generateFlows
// Each with input/output schemas for LLM consumption
```

### CLI Flow

```
$ slope init --smart

Analyzing repository...

  Stack:       TypeScript (pnpm, Node 22, Vitest)
  Structure:   104 source files, 56 test files, 4 modules
  Team:        3 active contributors (last 90 days)
  Velocity:    12 commits/week → weekly sprints suggested
  CI:          GitHub Actions (build + test + deploy)
  Testing:     Vitest with coverage
  Backlog:     23 open issues, 3 milestones

  Estimated complexity: Par 4, Slope 3
  Risk areas: src/core/ (low test ratio), src/store-pg/ (single contributor)

Project name [slope]: _
Vision (optional): _
Metaphor [golf]: _

Generating SLOPE setup...

  Created .slope/config.json (stack-aware, team-detected)
  Created docs/backlog/roadmap.json (3 phases from GitHub milestones)
  Created docs/backlog/sprint-1-plan.md (5 tickets from top issues)
  Created docs/retros/sprint-1.json (calibrated par=4, slope=3)
  Created .slope/flows.json (2 flows detected: CLI commands, MCP tools)
  Created .slope/common-issues.json (seeded from 4 FIXME comments)

Ready. Run `slope briefing` to see your first sprint context.
```

## Implementation Approach

### Phase 1: Core Analyzers (MVP)

Build 4 analyzers that work locally without GitHub API:

1. **Stack** — detect from manifest files and extensions
2. **Structure** — walk the file tree
3. **Testing** — detect framework and count tests
4. **Git History** — parse `git log` output

These give enough signal for a meaningful `RepoProfile` without requiring a GitHub token.

**New files:**
- `src/core/analyzers/stack.ts`
- `src/core/analyzers/structure.ts`
- `src/core/analyzers/testing.ts`
- `src/core/analyzers/git.ts`
- `src/core/analyzers/index.ts` (pipeline runner)
- `src/core/analyzers/types.ts` (all profile interfaces)

**Modified files:**
- `src/cli/commands/init.ts` — add `--smart` flag
- `src/core/index.ts` — export analyzer pipeline

### Phase 2: Generators

Build generators that turn `RepoProfile` into SLOPE artifacts:

- Config generator (stack-aware, team-aware)
- Complexity estimator (par/slope calibration)
- First sprint plan (from backlog or TODOs)
- Common issues seed (from FIXME/HACK comments)

### Phase 3: GitHub + Remote

Wire up the GitHub client for remote analysis:

- CI analyzer (parse workflow YAML)
- Docs analyzer (README summary, CONTRIBUTING extraction)
- Backlog analyzer (issues, milestones, labels)
- Roadmap generator (from milestones → phases)

### Phase 4: MCP + Flows

Add MCP `analyze` tool and flows generator:

- MCP `analyze` tool for LLM-driven onboarding
- Auto-flow detection from route/handler/page patterns
- `search({ module: 'onboard' })` discovery

## Design Decisions (Resolved)

### 1. Caching and Re-analysis

**Decision:** Yes, cache the `RepoProfile` in `.slope/repo-profile.json`. Update it automatically at the end of each ad hoc task or sprint — not just on demand. A standalone `slope analyze` command updates the profile without re-running init.

This means the profile is a living document that evolves with the repo. The post-hole routine (sprint completion) and any task completion hook should trigger a re-analysis to keep the profile current.

### 2. Infer vs Ask — Interview-First with Vision Tracking

**Decision:** Interview the user on first setup. Infer everything we can from the repo (stack, structure, git history), then ask about subjective things (vision, priorities, metaphor, team roles). The interview produces a **vision document** that SLOPE maintains and references.

Critical addition: **SLOPE should flag drift from the original vision.** If the user declared "we're building a REST API" and the codebase starts growing React components, SLOPE should surface that as a strategic observation — not a blocker, but a "hey, your codebase is evolving beyond your stated vision, want to update it?"

The user can re-initiate the interview or revise their vision at any time via `slope init --interactive` or through an LLM conversation.

### 3. GitHub Token

**Decision:** Optional. Ask for it during `slope init` (both CLI and interactive), degrade gracefully without it. Phase 1-2 analyzers work entirely locally. Phase 3 GitHub analyzers (backlog, docs, CI) simply skip if no token is available, and the profile notes which analyzers ran.

### 4. Monorepo Handling

**Decision:** Per-package analysis, leveraging multi-project (`project_id`). But this should be a question asked during init — "This looks like a monorepo. Would you like SLOPE to track each package separately?" The user decides whether to treat it as one project or many.

### 5. Re-analysis Standalone Command

**Decision:** Yes. `slope analyze` runs the analyzer pipeline and updates `.slope/repo-profile.json` without touching config, roadmap, or other artifacts. Intended to run:
- At the end of each sprint (post-hole routine)
- After significant codebase changes (new modules, major refactors)
- On demand for health checks
- Automatically via hooks if configured

### 6. LLM Summary

**Decision:** MCP `analyze` tool returns raw structured data. The calling LLM interprets it and generates natural-language summaries in context. No pre-baked summary field in the `RepoProfile` — this keeps the profile machine-readable and lets different LLMs frame the data for different audiences (developer vs manager vs new contributor).

## Non-Goals

- **IDE integration** — we won't read active editor state; that's the IDE extension's job
- **Code quality metrics** — we won't compute cyclomatic complexity or code smells; that's linter territory
- **Dependency auditing** — we'll count deps but won't run `npm audit`; that's the package manager's job
- **Auto-scoring** — the analyzers inform setup, they don't replace human sprint scoring
