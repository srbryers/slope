// SLOPE Template Generator
// Generates platform-specific templates with metaphor-aware vocabulary.
// When metaphor=golf, output matches the existing static templates in templates/.

import type { MetaphorDefinition } from '../core/index.js';

const titleCase = (s: string) => s.replace(/\b\w/g, c => c.toUpperCase());

// --- Derived routine names from vocabulary ---

function routineNames(m: MetaphorDefinition) {
  const sprint = titleCase(m.vocabulary.sprint);    // "Hole", "Level", "Set"
  const ticket = titleCase(m.vocabulary.ticket);     // "Shot", "Quest", "Point"
  const briefing = titleCase(m.vocabulary.briefing); // "Pre-Round Briefing", "Quest Log"
  const review = titleCase(m.vocabulary.review);     // "19th Hole", "Save Point"
  const scorecard = titleCase(m.vocabulary.scorecard);
  const handicapCard = titleCase(m.vocabulary.handicapCard);
  const onTarget = titleCase(m.vocabulary.onTarget);
  return { sprint, ticket, briefing, review, scorecard, handicapCard, onTarget };
}

// --- Project context file (CLAUDE.md / AGENTS.md) ---

export function generateProjectContext(m: MetaphorDefinition): string {
  const r = routineNames(m);
  return `# SLOPE Project

This project uses the SLOPE framework for sprint tracking.

## Commands
- \`slope card\` — view ${r.handicapCard.toLowerCase()}
- \`slope validate\` — validate ${r.scorecard.toLowerCase()}s
- \`slope review\` — generate sprint review
- \`slope briefing\` — ${r.briefing.toLowerCase()}

## MCP Tools
A SLOPE MCP server is configured in \`.mcp.json\`. Two tools:
- \`search\` — discover API functions, types, constants
- \`execute\` — run JS with full SLOPE API in sandbox

## Sprint Workflow
- **Pre-${r.sprint}:** \`slope briefing\` for handicap, hazards, gotchas
- **Per-${r.ticket}:** classify each ticket with approach + result + hazards
- **Post-${r.sprint}:** \`slope validate\` ${r.scorecard.toLowerCase()}, \`slope review\`, update common-issues

See .claude/rules/ for detailed checklists.

## ${r.scorecard}s
Stored in docs/retros/sprint-N.json. See .slope/config.json for configuration.
`;
}

// --- Sprint checklist rule ---

export function generateSprintChecklist(m: MetaphorDefinition): string {
  const r = routineNames(m);
  const clubs = m.clubs;
  const results = m.shotResults;

  return `# Sprint Checklists (SLOPE Routine Hierarchy)

The SLOPE framework organizes sprint work into a hierarchy of routines${m.id === 'golf' ? ", mirroring golf's structured approach to each shot, hole, and round" : `, using ${m.name.toLowerCase()} terminology`}.

## Pre-Tournament Routine (Course Strategy)

Before starting a new phase or project:

1. **Define the vision** — What does the end state look like? Document in a vision doc
2. **Build the roadmap** — Create \`docs/backlog/roadmap.json\` with sprints, dependencies, and phases
3. **Run \`slope roadmap validate\`** — Check for structural issues, dependency cycles, numbering gaps
4. **Run \`slope roadmap review\`** — Automated architect review: scope balance, critical path, bottlenecks
5. **Identify the critical path** — Run \`slope roadmap show\` to see the dependency graph and parallel tracks
6. **Plan parallel tracks** — If sprints can run concurrently, plan for multi-agent execution

## Pre-${r.sprint} Routine (Sprint Start)

Before writing any code in a new sprint:

1. **Run \`slope briefing\`** — Single command that outputs handicap snapshot, hazard index, nutrition alerts, filtered gotchas, and session continuity
   - Use \`--categories=testing,api\` or \`--keywords=migration\` to filter for the sprint's work area
2. **Verify previous ${r.scorecard.toLowerCase()} exists** — If the last sprint's ${r.scorecard.toLowerCase()} wasn't created, create it now
3. **Branch hygiene check** — \`git branch -a\` to confirm no stale branches remain
4. **Gap analysis** (if touching API or schema) — Read relevant docs and compare against implementation before writing code
5. **Set ${r.onTarget.toLowerCase()} and slope** — ${r.onTarget} from ticket count (1-2=3, 3-4=4, 5+=5), slope from complexity factors

## Pre-${r.ticket} Routine (Per-Ticket, Before Code)

Before starting each ticket:

1. **Select your approach** — Declare complexity: ${clubs.driver} (risky/new), ${clubs.long_iron} (multi-package), ${clubs.short_iron} (standard), ${clubs.wedge} (small), ${clubs.putter} (trivial)
2. **Check the codebase** — Review relevant codebase sections for files you'll modify
3. **Scan for hazards** — Check known hazards from recent ${r.scorecard.toLowerCase()}s and common issues for known gotchas
4. **Commit the approach selection** — Note it in your sprint tracking before writing code

## Post-${r.ticket} Routine (Per-Ticket, After Completion)

After completing each ticket:

1. **Score the ${r.ticket.toLowerCase()}** — Determine result: ${results.fairway} (clean start), ${results.green} (landed correctly), ${results.in_the_hole} (perfect), or miss direction (over/under/wrong approach/drift)
2. **Record hazards** — Note any gotchas encountered
3. **Check for penalties** — Tests break? Reverts needed? Each penalty adds to the score
4. **Update sprint tracking** — Mark ticket status
5. **Push** — The last push is the recovery point

## Post-${r.sprint} Routine (Sprint Completion)

After all tickets are complete:

1. **Score the sprint** — Audit commits, compute final score vs ${r.onTarget.toLowerCase()}
2. **Build the SLOPE ${r.scorecard.toLowerCase()}** — Create ${r.scorecard.toLowerCase()} JSON in your retros directory. Run \`slope validate\` to confirm no errors
3. **Distill learnings** — Update common-issues with new recurring patterns
4. **Create PR and merge** — All artifacts travel with the PR
5. **Review** — Run \`slope review\` to generate the sprint review markdown

## Post-Phase Routine (Per-Phase)

At the end of each development phase:

1. **Compute ${r.handicapCard.toLowerCase()}** — Run \`slope card\` to see trending stats
2. **Review miss patterns** — Identify systemic issues from the ${r.handicapCard.toLowerCase()}
3. **Training program** — Based on trends, identify areas for focused practice sprints
`;
}

// --- Commit discipline rule ---

export function generateCommitDiscipline(m: MetaphorDefinition): string {
  const r = routineNames(m);

  return `# Commit Discipline

**Commit early, commit often.** Lost context from uncommitted work is the #1 risk.
The last push is the recovery point — everything since the last push is lost on crash or context loss.

## Commit triggers:

Commit immediately after ANY of these:
1. **Each new file** — route, migration, config, component, test. Don't batch file creations.
2. **Each endpoint or feature** — one feature implemented = one commit.
3. **Each migration** — commit each separately.
4. **Each doc update** — spec change, README edit.
5. **Each bug fix** — no matter how small.
6. **Before switching context** — moving to a different area? Commit first.
7. **Before risky operations** — large refactor, dependency upgrade.
8. **Time check** — if ~15 minutes have passed since the last commit, commit what works.
9. **Session end** — never leave uncommitted changes. Use a \`wip:\` prefix if incomplete.

## Push triggers:

Push immediately after ANY of these:
1. **After each completed ticket (Post-${r.ticket} Routine)** — all commits pushed before merging. Score the ${r.ticket.toLowerCase()}.
2. **Every 30 minutes** — never go longer without a push.
3. **Before context compaction** — if context is running low, push first.
4. **Before switching tickets** — push current branch before starting a new one.
5. **Session end** — never leave unpushed commits.

## Commit message format:

\`\`\`
<type>(<ticket>): <short summary in imperative mood>

<optional body explaining why, not what>
\`\`\`

Types: \`feat\`, \`fix\`, \`refactor\`, \`docs\`, \`test\`, \`chore\`, \`wip\`
`;
}

// --- Review loop rule ---

export function generateReviewLoop(): string {
  return `# Sprint Plan Review Loop

After creating a sprint plan, run a structured review to catch issues before implementation.

## Review Tier Selection

| Tier | Rounds | When to use |
|------|--------|-------------|
| **Skip** | 0 | Research, infra, or docs-only sprints |
| **Light** | 1 | 1-2 tickets, familiar patterns, single-package |
| **Standard** | 2 | 3-4 tickets, multi-package, or schema/API changes |
| **Deep** | 3 | 5+ tickets, new infrastructure, architectural changes |

## Review Process

### Round 1 — Deep Review

Check the plan against the codebase:
- Does the plan duplicate existing infrastructure?
- Are dependencies correct and ordering optimal?
- Does the approach match codebase patterns?
- Are there scope gaps or underscoped complexity?
- Does it introduce unnecessary complexity?

### Round 2 — Delta Review (Standard+)

Review **only what changed** since Round 1:
- Were Round 1 findings addressed correctly?
- Did revisions introduce new issues?

### Round 3 — Final Sign-off (Deep only)

Delta review of Round 2 changes. Expected outcome: approval with minor notes.

## Tool Priority

1. **Search** to check function signatures, type definitions, patterns
2. **Find** to verify file existence and related files
3. **Read** only when search can't answer (complex multi-line logic)
`;
}

// --- Codebase context rule ---

export function generateCodebaseContextRule(): string {
  return `# Codebase Context — Map vs Explore

SLOPE maintains a codebase map at \`CODEBASE.md\` (~5k tokens) with auto-generated sections covering packages, API surface, CLI commands, guards, MCP tools, tests, sprint history, and known gotchas.

## When to use the map (default)

- Starting a new sprint — read the map first
- Understanding feature areas and file locations
- Finding which package owns a feature
- Looking up CLI commands, guards, or MCP tools
- Checking recent sprint history and known gotchas

**Access methods:**
- \`Read CODEBASE.md\` — full map in one read
- \`search({ module: 'map' })\` — full map via MCP
- \`search({ module: 'map', query: 'guards' })\` — specific section via MCP

## When to explore beyond the map

- The map doesn't cover a new package or feature you need detail on
- You need implementation-level detail (function signatures, complex logic)
- The map metadata shows it's stale (explore guard will warn you)
- You're debugging a specific issue that requires reading source code

## Keeping the map current

- Run \`slope map\` after adding new files, commands, or guards
- Run \`slope map --check\` to verify staleness before a sprint
- The map auto-updates only auto-generated sections; manual content is preserved
`;
}

export function generateCursorCodebaseContextRule(): string {
  return `---
description: When to use the SLOPE codebase map vs exploring the codebase directly
globs:
alwaysApply: true
---

# Codebase Context — Map vs Explore

SLOPE maintains a codebase map at \`CODEBASE.md\` (~5k tokens) with auto-generated sections covering packages, API surface, CLI commands, guards, MCP tools, tests, sprint history, and known gotchas.

## When to use the map (default)

- Starting a new sprint — read the map first
- Understanding feature areas and file locations
- Finding which package owns a feature
- Looking up CLI commands, guards, or MCP tools

**Access methods:**
- Read \`CODEBASE.md\` — full map in one read
- \`search({ module: 'map' })\` — full map via MCP
- \`search({ module: 'map', query: 'guards' })\` — specific section via MCP

## When to explore beyond the map

- The map doesn't cover a new package or feature
- You need implementation-level detail (function signatures, complex logic)
- The map metadata shows it's stale
- You're debugging a specific issue

## Keeping the map current

- Run \`slope map\` after adding new files, commands, or guards
- Run \`slope map --check\` to verify staleness before a sprint
`;
}

// --- OpenCode AGENTS.md ---

export function generateAgentsMd(m: MetaphorDefinition): string {
  const r = routineNames(m);
  const clubs = m.clubs;
  const results = m.shotResults;

  return `# SLOPE Project

This project uses the SLOPE framework for sprint tracking.

## Commands
- \`slope card\` — view ${r.handicapCard.toLowerCase()}
- \`slope validate\` — validate ${r.scorecard.toLowerCase()}s
- \`slope review\` — generate sprint review
- \`slope briefing\` — ${r.briefing.toLowerCase()}

## MCP Tools
A SLOPE MCP server is configured in \`opencode.json\`. Two tools:
- \`search\` — discover API functions, types, constants
- \`execute\` — run JS with full SLOPE API in sandbox

## Sprint Workflow
- **Pre-${r.sprint}:** \`slope briefing\` for handicap, hazards, gotchas
- **Per-${r.ticket}:** classify each ticket with approach + result + hazards
- **Post-${r.sprint}:** \`slope validate\` ${r.scorecard.toLowerCase()}, \`slope review\`, update common-issues

## Approach Complexity
- ${clubs.driver}: risky/new territory
- ${clubs.long_iron}: multi-package changes
- ${clubs.short_iron}: standard work
- ${clubs.wedge}: small tasks
- ${clubs.putter}: trivial changes

## ${r.ticket} Results
- ${results.in_the_hole}: perfect execution
- ${results.green}: landed correctly
- ${results.fairway}: clean start, needs finishing
- Miss directions: over-scoped, under-scoped, wrong approach, drift

## Commit Discipline
- Commit after each file, feature, migration, or bug fix
- Push after each ticket and every 30 minutes
- Format: \`<type>(<ticket>): <summary>\` (feat/fix/refactor/docs/test/chore)

## Codebase Map

SLOPE maintains a codebase map at \`CODEBASE.md\` (~5k tokens). Read it before exploring.
- Run \`slope map\` to generate/update
- Run \`slope map --check\` to verify staleness
- Use \`search({ module: 'map' })\` via MCP for targeted queries

## ${r.scorecard}s
Stored in docs/retros/sprint-N.json. See .slope/config.json for configuration.
`;
}

// --- OpenCode plugin ---

export function generateOpenCodePlugin(): string {
  return `// SLOPE Plugin for OpenCode
// Auto-generated by \`slope init --opencode\`
// Logs session lifecycle events to SLOPE's SQLite store.

export default async ({ $ }) => {
  return {
    event: async ({ event }) => {
      switch (event.type) {
        case 'session.created':
          await $\`slope session start --ide=opencode --role=primary\`;
          await $\`slope briefing --compact\`;
          break;

        case 'session.idle':
        case 'session.deleted':
          if (process.env.SLOPE_SESSION_ID) {
            await $\`slope session end --session-id=\${process.env.SLOPE_SESSION_ID}\`;
          }
          break;

        case 'session.compacted':
          if (process.env.SLOPE_SESSION_ID) {
            await $\`slope session heartbeat --session-id=\${process.env.SLOPE_SESSION_ID}\`;
          }
          break;
      }
    },
  };
};
`;
}

// --- Cursor .mdc wrappers ---

export function generateCursorSprintChecklist(m: MetaphorDefinition): string {
  const r = routineNames(m);
  const clubs = m.clubs;
  const results = m.shotResults;

  return `---
description: SLOPE sprint lifecycle checklist — routines for pre-sprint, per-ticket, and post-sprint
globs:
alwaysApply: true
---

# Sprint Checklists (SLOPE Routine Hierarchy)

The SLOPE framework organizes sprint work into a hierarchy of routines${m.id === 'golf' ? ", mirroring golf's structured approach to each shot, hole, and round" : `, using ${m.name.toLowerCase()} terminology`}.

## Pre-Tournament Routine (Course Strategy)

Before starting a new phase or project:

1. **Build the roadmap** — Create \`docs/backlog/roadmap.json\` with sprints, dependencies, and phases
2. **Run \`slope roadmap validate\`** — Check for dependency cycles, numbering gaps
3. **Run \`slope roadmap review\`** — Scope balance, critical path, bottlenecks
4. **Run \`slope roadmap show\`** — Dependency graph and parallel tracks

## Pre-${r.sprint} Routine (Sprint Start)

Before writing any code in a new sprint:

1. **Run \`slope briefing\`** — Outputs handicap snapshot, hazard index, nutrition alerts, filtered gotchas, and session continuity
   - Use \`--categories=testing,api\` or \`--keywords=migration\` to filter for the sprint's work area
2. **Verify previous ${r.scorecard.toLowerCase()} exists** — If the last sprint's ${r.scorecard.toLowerCase()} wasn't created, create it now
3. **Branch hygiene check** — \`git branch -a\` to confirm no stale branches remain
4. **Set ${r.onTarget.toLowerCase()} and slope** — ${r.onTarget} from ticket count (1-2=3, 3-4=4, 5+=5), slope from complexity factors

## Pre-${r.ticket} Routine (Per-Ticket, Before Code)

1. **Select your approach** — ${clubs.driver} (risky/new), ${clubs.long_iron} (multi-package), ${clubs.short_iron} (standard), ${clubs.wedge} (small), ${clubs.putter} (trivial)
2. **Check the codebase** — Review relevant codebase sections for files you'll modify
3. **Scan for hazards** — Check known hazards from recent ${r.scorecard.toLowerCase()}s and common issues

## Post-${r.ticket} Routine (Per-Ticket, After Completion)

1. **Score the ${r.ticket.toLowerCase()}** — ${results.in_the_hole} (perfect), ${results.green} (landed), ${results.fairway} (clean start), or miss direction
2. **Record hazards** — Note any gotchas encountered
3. **Check for penalties** — Tests break? Reverts needed?
4. **Push** — The last push is the recovery point

## Post-${r.sprint} Routine (Sprint Completion)

1. **Build the SLOPE ${r.scorecard.toLowerCase()}** — Create ${r.scorecard.toLowerCase()} JSON. Run \`slope validate\`
2. **Distill learnings** — Update common-issues with new recurring patterns
3. **Review** — Run \`slope review\` to generate the sprint review markdown
4. **Compute ${r.handicapCard.toLowerCase()}** — Run \`slope card\` to see trending stats
`;
}

export function generateCursorCommitDiscipline(m: MetaphorDefinition): string {
  const r = routineNames(m);

  return `---
description: Commit and push discipline for SLOPE-managed sprints
globs:
alwaysApply: true
---

# Commit Discipline

**Commit early, commit often.** The last push is the recovery point.

## Commit triggers:

Commit immediately after ANY of these:
1. Each new file — route, migration, config, component, test
2. Each endpoint or feature implemented
3. Each migration — commit separately
4. Each bug fix — no matter how small
5. Before switching context to a different area
6. Before risky operations — large refactor, dependency upgrade
7. Time check — if ~15 minutes since last commit, commit what works
8. Session end — never leave uncommitted changes (use \`wip:\` prefix if incomplete)

## Push triggers:

Push immediately after ANY of these:
1. After each completed ticket (Post-${r.ticket} Routine)
2. Every 30 minutes
3. Before switching tickets
4. Session end — never leave unpushed commits

## Commit message format:

\`\`\`
<type>(<ticket>): <short summary in imperative mood>
\`\`\`

Types: \`feat\`, \`fix\`, \`refactor\`, \`docs\`, \`test\`, \`chore\`, \`wip\`
`;
}

export function generateCursorReviewLoop(): string {
  return `---
description: Sprint plan review tiers for catching issues before implementation
globs:
alwaysApply: false
---

# Sprint Plan Review Loop

After creating a sprint plan, run a structured review.

## Review Tier Selection

| Tier | Rounds | When to use |
|------|--------|-------------|
| **Skip** | 0 | Research, infra, or docs-only sprints |
| **Light** | 1 | 1-2 tickets, familiar patterns, single-package |
| **Standard** | 2 | 3-4 tickets, multi-package, or schema/API changes |
| **Deep** | 3 | 5+ tickets, new infrastructure, architectural changes |

## Round 1 — Deep Review

- Does the plan duplicate existing infrastructure?
- Are dependencies correct and ordering optimal?
- Does the approach match codebase patterns?
- Are there scope gaps or underscoped complexity?

## Round 2 — Delta Review (Standard+)

Review **only what changed** since Round 1.

## Round 3 — Final Sign-off (Deep only)

Delta review of Round 2 changes. Expected outcome: approval with minor notes.
`;
}

// --- Cursor .cursorrules (project root context file) ---

export function generateCursorrules(m: MetaphorDefinition, harness: 'cursor' | 'windsurf' = 'cursor'): string {
  const r = routineNames(m);
  const clubs = m.clubs;
  const results = m.shotResults;
  const mcpPath = harness === 'windsurf' ? '.windsurf/mcp.json' : '.cursor/mcp.json';
  const rulesPath = harness === 'windsurf' ? '.windsurf/rules/' : '.cursor/rules/';

  return `# SLOPE Project

This project uses the SLOPE framework for sprint tracking.

## Commands
- \`slope card\` — view ${r.handicapCard.toLowerCase()}
- \`slope validate\` — validate ${r.scorecard.toLowerCase()}s
- \`slope review\` — generate sprint review
- \`slope briefing\` — ${r.briefing.toLowerCase()}

## MCP Tools
A SLOPE MCP server is configured in \`${mcpPath}\`. Two tools:
- \`search\` — discover API functions, types, constants
- \`execute\` — run JS with full SLOPE API in sandbox

## Sprint Workflow
- **Pre-${r.sprint}:** \`slope briefing\` for handicap, hazards, gotchas
- **Per-${r.ticket}:** classify each ticket with approach + result + hazards
- **Post-${r.sprint}:** \`slope validate\` ${r.scorecard.toLowerCase()}, \`slope review\`, update common-issues

## Approach Complexity
- ${clubs.driver}: risky/new territory
- ${clubs.long_iron}: multi-package changes
- ${clubs.short_iron}: standard work
- ${clubs.wedge}: small tasks
- ${clubs.putter}: trivial changes

## ${r.ticket} Results
- ${results.in_the_hole}: perfect execution
- ${results.green}: landed correctly
- ${results.fairway}: clean start, needs finishing
- Miss directions: over-scoped, under-scoped, wrong approach, drift

## ${r.scorecard}s
Stored in docs/retros/sprint-N.json. See .slope/config.json for configuration.
See ${rulesPath} for detailed checklists.
`;
}

// --- Generic checklist ---

export function generateGenericChecklist(m: MetaphorDefinition): string {
  const r = routineNames(m);
  const clubs = m.clubs;

  return `# SLOPE Sprint Checklist

## Pre-Tournament (Course Strategy)
1. Build roadmap in \`docs/backlog/roadmap.json\`
2. Run \`slope roadmap validate\` — check dependencies and structure
3. Run \`slope roadmap review\` — scope balance, critical path, bottlenecks
4. Run \`slope roadmap show\` — view dependency graph

## Pre-${r.sprint} (Sprint Start)
1. Run \`slope briefing\` — handicap, hazards, gotchas, session continuity
2. Verify previous ${r.scorecard.toLowerCase()} exists
3. Set ${r.onTarget.toLowerCase()} (1-2 tickets=3, 3-4=4, 5+=5) and slope factors

## Per-Ticket
- **Before:** Select approach (${clubs.driver}/${clubs.long_iron}/${clubs.short_iron}/${clubs.wedge}/${clubs.putter}), scan hazards
- **After:** Score ${r.ticket.toLowerCase()}, record hazards, check penalties, commit + push

## Post-${r.sprint} (Sprint End)
1. Build ${r.scorecard.toLowerCase()} JSON, run \`slope validate\`
2. Update common-issues with new patterns
3. Run \`slope review\` for markdown output
4. Run \`slope card\` for ${r.handicapCard.toLowerCase()} trends

## Commit Discipline
- Commit after each file, feature, migration, or bug fix
- Push after each ticket and every 30 minutes
- Format: \`<type>(<ticket>): <summary>\` (feat/fix/refactor/docs/test/chore)
`;
}
