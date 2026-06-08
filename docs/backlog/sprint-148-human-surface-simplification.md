# Sprint 148 Design - Human Operating Surface Simplification

## Decision

SLOPE should present two different surfaces:

- A small human cockpit for orientation, decisions, and confidence.
- A larger agent/internal surface for skills, hooks, MCP tools, guards, and automation.

The current CLI is powerful, but it teaches every layer at once. The default
human experience should not ask people to remember the full execution framework.
Humans should remember a handful of outcome-oriented commands and natural
language requests; agents and skills should orchestrate the lower-level CLI and
MCP primitives.

## S148 Ticket Outcomes

| Ticket | Outcome |
| --- | --- |
| S148-1 | Command audiences are defined as `human`, `agent`, `advanced`, and `internal`; every current top-level registry command is classified below. |
| S148-2 | The proposed human cockpit is seven remembered entries: `now`, `start`, `briefing`, `review`, `doctor`, `card`, and `help --all`. |
| S148-3 | Common human asks are mapped to skill-first workflows that may use many CLI/MCP primitives without exposing that plumbing. |
| S148-4 | Roadmap output is specified as a bounded planning/status view by default, with full-roadmap output moved behind explicit full/history flags. |

## Audience Rules

`human` commands are taught in the default help surface. Their default output
must be bounded, decision-oriented, and safe to run without extra context. A
human command can write state only when the action is explicit and the output
names what changed.

`agent` commands are stable execution primitives for skills, hooks, MCP tools,
and automated routines. Humans may run them, but they should not need to
remember them during normal operation.

`advanced` commands are useful for maintainers and power users, but they stay
out of the default help surface. They belong in `slope help --all`, docs, or
task-specific guidance.

`internal` commands are framework plumbing. They may stay callable for scripts
and recovery, but SLOPE should not market them as user-facing commands.

Promotion rule: a command can move toward `human` only when its default output
fits a compact output budget, names the next decision, and has an obvious
escape hatch for full detail.

Demotion rule: a command should move away from `human` when it mostly performs
state bookkeeping, requires prior SLOPE protocol knowledge, exists for guards
or hooks, or returns unbounded implementation detail by default.

## Proposed Human Cockpit

The default help surface should show the following commands and one escape
hatch. Names are proposals; the important part is the job contract.

| Command | Job | Output budget | Backing primitives |
| --- | --- | --- | --- |
| `slope now` | Show current work state and one recommended next action. | 25-40 lines | `status`, `roadmap status`, `agent status`, PR/check state, claims |
| `slope start` | Begin or resume a sprint with briefing, claim guidance, and gate context. | 40-60 lines | `briefing`, `sprint start`, `claim`, `prep`, `resume` |
| `slope briefing` | Prepare for focused work with hazards, performance, and relevant lessons. | 40-60 lines | existing briefing filters, scorecards, common issues, roadmap context |
| `slope review` | Finish or inspect work with findings, validation, retro, and PR closeout cues. | 40-60 lines | review lifecycle, PR helpers, validation, retro |
| `slope doctor` | Check project/SLOPE health and repair safe local drift. | 30-50 lines | store health, map/docs checks, hook checks, config checks |
| `slope card` | Show performance and recurring execution patterns. | 30-50 lines | scorecards, handicap, dispersion |
| `slope help --all` | Escape hatch to the full command reference. | Explicit full output | command registry |

Default `slope help` should teach the cockpit and say that agents/skills use the
rest. Full registry output should require `--all`, `commands --all`, or a
similarly explicit command.

## Command Audience Taxonomy

Some commands are subcommand-sensitive. For example, `version` can show a
human-readable version, but `version bump` is release automation. The audience
below classifies the command's primary role in the future surface.

| Command | Current category | Audience | Surface decision |
| --- | --- | --- | --- |
| `init` | lifecycle | human | Keep visible for setup and onboarding. |
| `interview` | lifecycle | advanced | Keep available for project setup, but not default daily use. |
| `help` | lifecycle | human | Make default help small; move full list behind `--all`. |
| `quickstart` | lifecycle | human | Keep visible for onboarding. |
| `doctor` | lifecycle | human | Keep visible as health and repair entry point. |
| `version` | lifecycle | advanced | Show version can stay simple; bump/release paths move behind skills. |
| `session` | lifecycle | agent | Session bookkeeping should be skill/agent managed. |
| `claim` | lifecycle | agent | Required discipline primitive, but not human memory load. |
| `release` | lifecycle | agent | Claim release primitive; not the product release command. |
| `status` | lifecycle | human | Keep as backing primitive, but teach `now` as the main entry. |
| `next` | lifecycle | advanced | Useful recovery utility, hidden from default help. |
| `resume` | lifecycle | agent | Skill-driven continuity primitive. |
| `sprint` | lifecycle | agent | Lifecycle state primitive behind `start`, `review`, and skills. |
| `ticket` | lifecycle | agent | Per-ticket bookkeeping belongs in skills. |
| `card` | scoring | human | Keep visible for performance insight. |
| `validate` | scoring | agent | Skills run validation and summarize results. |
| `review` | scoring | human | Keep visible, but subcommands remain skill/agent primitives. |
| `auto-card` | scoring | agent | Closeout automation primitive. |
| `classify` | scoring | agent | Scoring primitive for agents and retros. |
| `tournament` | scoring | advanced | Power-user historical analysis. |
| `briefing` | analysis | human | Keep visible, but bound roadmap/critical-path output. |
| `plan` | analysis | agent | Pre-shot advisor used by skills; avoid conflict with human planning wording. |
| `report` | analysis | advanced | Rich report generation, not daily cockpit. |
| `dashboard` | analysis | advanced | Useful local UI, but not default CLI memory. |
| `standup` | analysis | agent | Skill/team reporting primitive. |
| `analyze` | analysis | advanced | Maintainer/repo profiling utility. |
| `org` | analysis | advanced | Multi-repo aggregation for maintainers. |
| `memory` | analysis | advanced | Durable memory management, usually skill-mediated. |
| `hook` | tooling | internal | Hook installation and management should be setup/doctor mediated. |
| `guard` | tooling | internal | Guard runner/manager is framework plumbing. |
| `extract` | tooling | internal | Event ingestion plumbing. |
| `distill` | tooling | agent | Skills can promote durable lessons after retros. |
| `map` | tooling | agent | Agents use map generation/checks; humans see summaries. |
| `workflow` | tooling | internal | Workflow definition plumbing. |
| `flows` | tooling | advanced | Product-flow authoring for maintainers. |
| `inspirations` | tooling | advanced | Research/backlog support. |
| `skills` | tooling | advanced | Skill registry maintenance. |
| `issue` | tooling | agent | Issue scout/triage primitive behind backlog skills. |
| `metaphor` | tooling | advanced | Customization, not core operation. |
| `plugin` | tooling | advanced | Plugin maintenance. |
| `store` | tooling | internal | Storage diagnostics and backup plumbing. |
| `escalate` | tooling | agent | Severity routing primitive. |
| `transcript` | tooling | internal | Debug/recovery plumbing. |
| `roadmap` | planning | human | Default must be bounded; full/history views are advanced. |
| `retro` | planning | agent | Post-merge retro and backfill are skill-driven. |
| `vision` | planning | human | Keep visible as product direction context. |
| `initiative` | planning | advanced | Multi-sprint orchestration for maintainers/agents. |
| `loop` | tooling | advanced | Autonomous execution is powerful but not default help. |
| `worktree` | tooling | agent | Skills/guards should manage worktree mechanics. |
| `index-cmd` | tooling | internal | Embedding index maintenance. |
| `context` | tooling | agent | Semantic retrieval primitive for agents. |
| `prep` | tooling | agent | Ticket preparation primitive for agents. |
| `enrich` | tooling | agent | Backlog enrichment primitive. |
| `stats` | tooling | internal | Export plumbing for dashboards/web. |
| `docs` | tooling | agent | Documentation checks/generation run by skills and CI. |
| `agent` | tooling | agent | Machine-readable front door for agents. |
| `commit-ready` | tooling | agent | Pre-commit checklist primitive. |
| `gate` | tooling | agent | Initiative gate primitive. |
| `pr` | tooling | agent | PR closeout/review helpers behind GitHub/SLOPE skills. |

## Skill-First Workflow Contract

Human asks should map to skills or high-level commands. Skills may call many
CLI commands, MCP tools, GitHub tools, and shell commands internally, but the
human-facing response should be a decision, a result, and any blocker.

| Human ask | Front door | Hidden primitives | Durable outputs |
| --- | --- | --- | --- |
| "What should we do next?" | `slope now` or a planning skill | `roadmap status`, `status`, GitHub issue/PR checks, `briefing` snippets | One recommended next action and blockers |
| "Plan the next sprint" | SLOPE sprint workflow skill | roadmap review, issue triage, claims, `prep`, scorecard history | Sprint plan artifact, roadmap entries, issue links |
| "Execute this sprint" | SLOPE sprint workflow skill | `briefing`, `claim`, `validate`, `review`, `auto-card`, PR helpers | Commits, PR, scorecard, review notes |
| "Review the open PR" | GitHub review skill plus SLOPE discipline | PR metadata/diff/comments, CI checks, targeted tests, review findings | Findings-first review or approval notes |
| "Do the release cycle" | Release skill | `version bump`, PR CI, GitHub release, npm verification, post-merge retro | Release PR/tag, npm verification, retro memory |
| "Triage open issues" | Backlog/roadmap skill | GitHub issue search, roadmap review, `issue triage`, sprint sizing | Issues grouped into sprints or closed as stale |
| "Run the retro" | Retro skill | `retro post-merge`, `auto-card`, `distill`, memory write | Durable retro JSON, common-issue updates, learning summary |
| "Is SLOPE healthy?" | `slope doctor` | map/docs/store/hook/guard checks | Health summary and safe repairs |

Contract requirements:

- Skills own claim/release hygiene for the files they touch.
- Skills run the narrowest useful validation and summarize failures in human
  language.
- Skills raise SLOPE issues when the framework itself gets in the way.
- Skills write durable artifacts for sprint plans, scorecards, retros, or
  memory before declaring work complete.
- CLI commands remain stable machine APIs even when hidden from human help.

## Roadmap View Case Study

Current `slope roadmap status --sprint=148` prints every completed phase before
the active sprint and then prints a very long critical path. That is accurate
information, but it is not a good default planning surface.

Default roadmap status should answer five questions:

1. Where are we now?
2. What is blocked or stale?
3. What is the next ready sprint?
4. What are the next one to three upcoming sprints?
5. What should happen next?

Proposed default output:

```text
# Roadmap Status

Current: S148 Human Operating Surface Simplification
Phase: Phase 47 - Human Operating Surface Simplification

Reality checks:
- S147 status validation is blocked by #539.

Active sprint:
- S148-1 command taxonomy
- S148-2 human cockpit
- S148-3 skill workflow contract
- S148-4 roadmap bounded-view case study

Next ready:
- S149 Roadmap Signal Repair and Bounded Planning View

Upcoming:
- S150 Command Audience Metadata and Help Surface
- S151 Skill-First Human Cockpit Implementation

Recommended next action:
- Fix #539 before enforcing clean roadmap validation on this lane.
```

Output rules:

- Default output should target 25-45 lines.
- Default output must not print completed historical phases.
- Default output must not print the whole critical path unless requested.
- Default output shows at most three upcoming sprints by default.
- Full output must remain available through `--full`, `show --full`, or a
  clearly named history/detail command.
- JSON output should be available for agents.

Acceptance tests:

- `slope roadmap status` on a roadmap with many completed phases omits old
  completed phases by default.
- `slope roadmap status --full` or equivalent still exposes the whole roadmap.
- Default status contains current sprint, phase, blockers, next ready sprint,
  no more than three upcoming sprints, and one recommended action.
- Default line count stays under a fixed budget.
- Regression fixtures include S148-like long-history roadmap data.

## S149 Implementation Note

S149 turns the roadmap case study into the active command contract:

- `slope roadmap status` defaults to a compact planning view centered on the
  current sprint, phase progress, roadmap reality checks, blockers,
  next-ready work, up to three upcoming sprints, and one recommended action.
- `slope roadmap status --full` preserves the historical phase-by-phase view
  for agents, maintainers, and audits that need the complete roadmap.
- The default command is covered by a long-history regression fixture so
  completed historical phases and the full critical path stay out of the
  human-facing status surface.

## S150 Implementation Note

S150 turns the audience taxonomy into executable CLI metadata and help behavior:

- Every top-level registry command now has an `audience` of `human`, `agent`,
  `advanced`, or `internal`.
- `slope help`, `slope --help`, and bare `slope` default to a bounded human
  command surface instead of the full implementation registry.
- `slope help --all` is the explicit escape hatch for the full registry and
  prints audience labels so humans can see which commands are primarily for
  skills, agents, maintainers, or internal plumbing.
- Regression tests keep audience metadata complete and keep default help from
  reintroducing agent/internal commands into the human surface.

## Implementation Backlog

### S149 - Roadmap Signal Repair and Bounded Planning View

Purpose: make roadmap planning trustworthy and compact.

Tickets:

- `S149-1`: Fix #539 so issue-fix keys like `S147-533` do not mark roadmap
  sprint 147 as shipped.
- `S149-2`: Add bounded default output for `slope roadmap status`.
- `S149-3`: Add full/history flags and line-budget regression tests.
- `S149-4`: Update roadmap/help docs for the new planning/status contract.

### S150 - Command Audience Metadata and Default Help

Purpose: encode the surface model in the command registry and make default help
teach the cockpit instead of the whole implementation framework.

Tickets:

- `S150-1`: Add `audience` metadata to command registry entries.
- `S150-2`: Make `slope help` show the human cockpit by default.
- `S150-3`: Add `slope help --all` or equivalent full registry escape hatch.
- `S150-4`: Add tests that all registry commands have an audience and that
  default help remains bounded.

### S151 - Skill-First Human Cockpit Implementation

Purpose: implement or alias the high-level cockpit entries and route common
human asks through skills/agent-friendly primitives.

Tickets:

- `S151-1`: Implement `slope now` as a compact current-state view.
- `S151-2`: Implement `slope start` or a `sprint begin` alias that coordinates
  briefing, sprint state, and claim guidance.
- `S151-3`: Update repo skills so release, PR review, issue triage, retro, and
  sprint execution explicitly hide CLI plumbing from humans.
- `S151-4`: Add end-to-end tests or transcript fixtures for the cockpit flows.

## Non-Goals Reaffirmed

- Do not remove existing commands in this phase.
- Do not rename every command at once.
- Do not make roadmap display the whole project. Roadmap is only the first
  case study for a broader surface model.
- Do not force humans to learn claim/session/gate/store/hook commands in order
  to collaborate with SLOPE.
