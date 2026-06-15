---
name: slope-sprint
description: Use SLOPE from Codex to inspect, start, claim, or close a sprint in a repository with .slope state. Trigger when the user asks to set up SLOPE, register sprint work, check active sprint status, or close out sprint work.
---

# SLOPE Sprint Workflow

Use these commands from the repository root.

## Inspect

1. Run `slope sprint status`.
2. If no sprint is active, run `slope next` and `slope briefing --sprint=<next>`.
3. If a sprint is active, run `slope briefing --sprint=<active>` before editing.
4. If the user asks for a roadmap interview or planning input, run `slope roadmap interview` or `slope roadmap interview --agent`; MCP agents can also search `module: "init"`.

## Start Or Claim

1. Start a sprint with `slope sprint begin --sprint=<number> --ticket=<issue-or-ticket>`.
2. If the issue is only on GitHub and not in the local roadmap, the command may report a prep lookup miss after creating sprint state and a claim. Treat that as non-blocking if `slope sprint status` shows the claim.
3. Create a feature branch before code changes.

## Work

1. Commit after each meaningful feature, file group, migration, or bug fix.
2. Push after each ticket and at least every 30 minutes.
3. When guards produce warnings, address the warning or record why it is not applicable.

## Close

1. Run focused tests, then `pnpm run typecheck`, `pnpm run build`, and the relevant full test suite for the change.
2. Run `slope review recommend`.
3. Add or update `docs/retros/sprint-<number>.json` and `docs/retros/sprint-<number>-review.md`.
4. Run `slope validate docs/retros/sprint-<number>.json`.
5. Mark gates with `slope sprint gate <gate>` only after the evidence exists.
