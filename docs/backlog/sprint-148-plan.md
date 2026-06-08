# Sprint 148 Plan - Human Operating Surface Simplification

## Purpose

Plan a higher-level SLOPE operating surface so humans interact with a small,
memorable set of outcome-oriented commands while agents and skills orchestrate
the deeper CLI/MCP execution framework.

This sprint treats the noisy roadmap output as one symptom of a broader product
boundary issue: SLOPE exposes too much implementation plumbing to the human
operator. The goal is a design and migration plan for the surface model before
implementation begins.

## Framing

SLOPE has at least three audiences:

- Human operators who need orientation, decisions, and confidence.
- Agent workflows and skills that need precise execution primitives.
- Internal framework code that supports hooks, guards, workflows, and MCP tools.

The current CLI mixes all three. That makes SLOPE powerful but hard to remember.
The planning sprint should define which concepts belong in the human cockpit,
which belong in skill-orchestrated agent workflows, and which should remain
available only as advanced/internal plumbing.

## Tickets

| Ticket | Title | Club | Verification |
| --- | --- | --- | --- |
| S148-1 | Define human, agent, and internal command audiences with promotion/demotion rules | short_iron | Command taxonomy doc covers every top-level command category |
| S148-2 | Design the small human command cockpit and default help surface | short_iron | Proposed default help has 5-8 memorable commands and an escape hatch |
| S148-3 | Design skill-first agent workflows that hide CLI plumbing behind outcome commands | long_iron | Skill/command contract maps agent outcomes to existing CLI/MCP primitives |
| S148-4 | Design bounded roadmap planning views as one case study of the new surface model | short_iron | Roadmap plan/status default output spec is bounded and full output is explicit |

## Scope

### S148-1: Command Audience Taxonomy

Classify each top-level SLOPE command as one of:

- `human`: intended for regular operator use.
- `agent`: intended for skills, hooks, MCP, workflows, and automated routines.
- `advanced`: available to humans, but hidden from the default surface.
- `internal`: implementation plumbing that should not be taught as a user command.

Define rules for moving a command between audiences. For example, a command can
be human-facing only if its default output is bounded, decision-oriented, and
safe to run without extra context.

### S148-2: Human Command Cockpit

Design the small default surface. Candidate commands to evaluate:

- `slope now` or equivalent current-state cockpit.
- `slope briefing`
- `slope card`
- `slope sprint begin`
- `slope review`
- `slope doctor`
- `slope help --all` or `slope commands --all` as the escape hatch.

The deliverable is not the final names alone. It should specify the job each
command does, the default output budget, and where the existing command list
moves when hidden from default help.

### S148-3: Skill-First Agent Workflows

Design how agent skills become the primary abstraction over CLI/MCP plumbing.
The plan should identify common human asks, the skill that should handle each,
and the lower-level commands/tools the skill may use internally.

Examples:

- "Do the release cycle" maps to release skill discipline, PR CI, GitHub release,
  publish workflow watch, npm registry verification, and retro capture.
- "Review the open PR" maps to review skill discipline, PR diff inspection,
  targeted validation, and findings-first output.
- "Plan the next sprint" maps to roadmap/issue/scorecard context, bounded
  upcoming work, claims, and a sprint plan artifact.

### S148-4: Roadmap Planning View Case Study

Use roadmap output as the concrete test case for the new surface model.

Design a bounded default view that shows:

- Current sprint and phase.
- Next ready sprint and why it is ready.
- The next 1-3 upcoming sprints.
- Blocking dependencies and stale reality checks.
- One recommended next action.

Move full-roadmap output behind an explicit full-output flag or subcommand.
Define acceptance tests that prevent default roadmap/status output from growing
back into a full roadmap dump.

## Non-Goals

- Do not implement the CLI rename or help restructuring in this sprint.
- Do not remove existing commands.
- Do not solve every roadmap validation or stale-state issue.
- Do not make roadmap display the center of the sprint; it is a case study for
  the higher-level surface model.

## Deliverables

- A command audience taxonomy and migration proposal.
- A proposed default human command cockpit.
- A skill-to-command orchestration map for common agent outcomes.
- A bounded roadmap planning view specification.
- Follow-up implementation tickets sized for later sprints.

## Done Criteria

- The plan can answer: "What should a human remember?" and "What should only an
  agent/skill need to know?"
- The roadmap case study produces a clear default output contract.
- Follow-up tickets are small enough to implement without re-litigating the
  surface model.
- `slope roadmap validate`, `slope map --check`, and scorecard validation pass.
