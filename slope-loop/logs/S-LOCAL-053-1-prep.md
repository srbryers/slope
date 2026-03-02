# Execution Plan: S-LOCAL-053-1
## Harden: continuous.sh
Club: short_iron | Est. tokens: 19962

## Files to Modify
- docs/tutorial-first-sprint.md (relevance: 0.57)
  ```
  | `hazard_penalties`    | number | Hazards that added to score      |
  | `miss_directions`     | object | `{ long, short, left, right }`   |
  
  ### Condition Types
  
  | Type         | Meaning                            |
  |--------------|------------------------------------|
  | `wind`       | External service issues            |
  | `rain`       | Team/process disruptions           |
  | `firm`       | Tight deadlines                    |
  ...
  ```
- docs/backlog/roadmap.md (relevance: 0.56)
  ```
  - **Explore guard** (`slope guard explore`): fires before explore/search tool calls
    - Checks for codebase index presence (`.slope/index.json`, `CODEBASE.md`, or configurable paths)
    - When index exists: injects hint ("Codebase index available at X — check it before deep exploration")
    - When no index: passes through silently
    - Configurable index paths in `.slope/config.json` under `"guidance.indexPaths"`
  - **Hazard warning** (`slope guard hazard`): fires before file write/edit tool calls
    - Extracts target file path from tool input
    - Looks up the file's area in common issues and recent events (from S10/S11)
    - When hazards exist: injects context ("Known issue in this area: <description>. Last seen in S10.")
    - Respects recency window (configurable, default last 5 sprints)
  ...
  ```
- templates/cursor/rules/slope-commit-discipline.mdc (relevance: 0.56)
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
- docs/getting-started.md (relevance: 0.56)
  ```
  slope session start                     # Start a tracked session
  slope claim --target=S5-1              # Claim a ticket
  slope status                            # View sprint status and conflicts
  slope release --target=<ticket>          # Release a claim when done
  slope session end                       # End the session
  ```
  
  ### After a Sprint
  
  ```bash
  ...
  ```
- docs/guides/continue-setup.md (relevance: 0.55)
  ```
  # SLOPE + Continue Setup Guide
  
  [Continue](https://continue.dev) does not have a tool-level hook system, so SLOPE guard integration is limited to manual/GenericAdapter usage. However, Continue's MCP support and rules system provide read-only access to SLOPE data.
  
  ## MCP Server Setup
  
  Continue supports MCP servers in Agent mode. Add the SLOPE MCP server to your Continue config:
  
  **`~/.continue/config.yaml`:**
  ```yaml
  ...
  ```
- tests/cli/roadmap.test.ts (test file)
- tests/core/generators/roadmap.test.ts (test file)
- tests/core/roadmap.test.ts (test file)

## Similar Past Tickets
- LOCAL-049: "S-LOCAL-049-1: Harden continuous.sh and parallel.sh against known hazards" → green (sprint 52)
- LOCAL-050: "S-LOCAL-050-1: Harden continuous.sh and parallel.sh against known hazards" → green (sprint 53)
- LOCAL-051: "S-LOCAL-051-1: Harden continuous.sh and parallel.sh against known hazards" → green (sprint 54)

## Constraints
- pnpm test passes
- pnpm typecheck passes
- Review and harden continuous.sh
- Review and harden parallel.sh

## Verification
- pnpm test
- pnpm typecheck
