---
name: slope-guard-warning
description: Respond to SLOPE guard warnings in Codex without bypassing sprint discipline. Trigger when a SLOPE guard warns, blocks, recommends a review, asks for a claim, or reports missing sprint context.
---

# SLOPE Guard Warnings

Treat guard output as operational context, not as generic text.

## Triage

1. Identify the guard name from the warning.
2. Run `slope guard docs <guard-name>` when behavior or configuration is unclear.
3. If the guard references sprint state, run `slope sprint status`.
4. If the guard references hazards, run `slope briefing --compact` or inspect the cited scorecard/common issue.

## Resolve

1. For missing sprint or claim warnings, start/claim the sprint or switch to the explicitly supported ad hoc mode.
2. For review warnings, run `slope review recommend` and complete the recommended review flow.
3. For hazard warnings, adjust the implementation or add a note to the scorecard explaining why the hazard did not apply.
4. Avoid disabling a guard unless the user explicitly asks for a configuration change.

## Verify

1. Re-run the original command when the guard is tied to a command path.
2. Use `slope guard metrics` when diagnosing whether a guard is silent, suppressed, or missing payload data.
3. Do not treat a silent guard as proof that no sprint workflow is required.
