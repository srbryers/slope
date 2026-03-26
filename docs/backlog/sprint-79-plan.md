# Sprint 79 Plan — The Playbook (Workflow Plan Review Phase)

**Par:** 3 (3 tickets)
**Slope:** 1 (modifying YAML workflow definitions + test updates)
**Theme:** Add explicit plan review phase to workflow definitions so the review loop is enforced by the engine, not just by guards

## Problem

sprint-standard workflow goes: briefing → verify → per_ticket (implement). No plan review step exists. The review-tier/workflow-gate guards handle plan review via plan mode, but:
- If the agent doesn't enter plan mode, reviews are silently skipped
- The workflow engine doesn't enforce plan creation before implementation
- S78 demonstrated this: we jumped straight from verify to implementation

## Tickets

### T1: Add plan_review phase to sprint-standard.yaml
**Club:** short_iron
**Files:** `src/core/workflows/sprint-standard.yaml`, `tests/core/workflow-builtins.test.ts`

Add between `pre_hole` and `per_ticket`:
```yaml
- id: plan_review
  steps:
    - id: write_plan
      type: agent_work
      prompt: "Write the sprint plan as a file in docs/backlog/"
      rules:
        - "Use EnterPlanMode before writing"
        - "Include ticket list, clubs, approach, hazard watch"
      blocks_next: true
    - id: review_plan
      type: agent_input
      prompt: "Review the plan — tier determined by review-tier guard"
      required_fields:
        - review_tier
        - review_complete
    - id: revise_plan
      type: agent_work
      prompt: "Address review findings if any"
```

### T2: Add plan_review phase to sprint-autonomous.yaml
**Club:** wedge
**Files:** `src/core/workflows/sprint-autonomous.yaml`, `tests/core/workflow-builtins.test.ts`

Same structure but with `on_timeout: skip` so autonomous agents don't block on review input.

### T3: Document sprint-lightweight as explicitly review-free
**Club:** putter
**Files:** `src/core/workflows/sprint-lightweight.yaml`

Add a comment making it explicit that lightweight intentionally skips plan review. No code change, just documentation.
