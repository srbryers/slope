# Execution Plan: S-LOCAL-048-1
## Fix rough hazards in distill.ts
Club: short_iron | Est. tokens: 6760

## Files to Modify
- docs/tutorial-first-sprint.md (relevance: 0.57)
  ```
        "result": "green",
        "hazards": [],
        "notes": "Redis session store worked first try"
      },
      {
        "ticket_key": "S5-4",
        "title": "Auth tests",
        "club": "wedge",
        "result": "green",
        "hazards": [
  ...
  ```
- docs/retros/sprint-4-review.md (relevance: 0.57)
  ```
  ## Sprint 4 Review: Code Mode MCP Refactor
  
  ### SLOPE Scorecard Summary
  
  | Metric | Value |
  |---|---|
  | Par | 4 |
  | Slope | 3 |
  | Score | 4 |
  | Label | par |
  ...
  ```
- templates/cursor/rules/slope-commit-discipline.mdc (relevance: 0.57)
  ```
  ---
  description: Commit and push discipline for SLOPE-managed sprints
  globs:
  alwaysApply: true
  ---
  
  # Commit Discipline
  
  **Commit early, commit often.** The last push is the recovery point.
  
  ...
  ```
- docs/backlog/sprint-26-plan.md (relevance: 0.57)
  ```
  # Sprint 26 — The Fairway Map: User Flow Tracking
  
  **Par:** 4 | **Slope:** 2 (`new subsystem across 3 packages, but follows established patterns`) | **Type:** feature
  
  **Theme:** Flow tracking — map user-facing workflows to code paths, queryable via MCP search.
  
  ## Tickets
  
  ### S26-1: Flow types + validation functions
  - **Club:** short_iron | **Complexity:** standard
  ...
  ```
- docs/retros/sprint-27-review.md (relevance: 0.57)
  ```
  
  ## Sprint 27 Review: The Clubhouse — Marketing Site & Design Tokens
  
  ### SLOPE Scorecard Summary
  
  | Metric | Value |
  |---|---|
  | Par | 4 |
  | Slope | 3 |
  | Score | 4 |
  ...
  ```

## Similar Past Tickets
- S21-4: "Thread reported_by in distill pipeline" → in_the_hole (sprint 21)
- S29-1: "Fix broken test mocks" → in_the_hole (sprint 29)
- S39-3: "--cline init flag, setup guides, installDefaultHooks fix" → green (sprint 39)

## Hazards
- Shell scripts need careful quoting for paths with spaces — run.sh uses double-quotes throughout for safety (S45)

## Constraints
- pnpm test passes
- pnpm typecheck passes
- Review and fix rough issues in distill.ts
- Review and fix rough issues in src/mcp/index.test.ts

## Verification
- pnpm test
- pnpm typecheck
