---
name: slope-retro
description: Run SLOPE post-merge retros from Codex and persist durable learnings. Trigger after a pull request merges, when the user asks for a retro, or when sprint closeout should save lessons into memory.
---

# SLOPE Post-Merge Retro

Use this after the PR is merged, or when the user asks to preserve lessons from a completed sprint or PR.

## Prepare

1. Confirm the sprint number from `slope sprint status`, the roadmap, the scorecard, or the user.
2. Capture the merged PR number when available.
3. Identify a short summary, durable learnings, hazards, and follow-ups. Do not include secrets or private tokens.

## Run

1. Preview when details are uncertain:
   `slope retro post-merge --sprint=<N> --pr=<PR> --summary="<summary>" --learning="<learning>" --dry-run`
2. Persist the retro:
   `slope retro post-merge --sprint=<N> --pr=<PR> --summary="<summary>" --learning="<learning>" --hazard="<hazard>" --follow-up="<follow-up>"`
3. Repeat `--learning`, `--hazard`, and `--follow-up` as needed.
4. Use `--learning=project:8:<text>` or another `category[:weight]:text` prefix when the memory category matters.

## Verify

1. Check command output for the saved `.slope/retros/post-merge/sprint-N[-pr-M].json` path.
2. Confirm memory persistence with `slope memory search "<distinct learning text>"`.
3. If the command reports skipped memories, treat them as duplicate-safe persistence unless the user expected a new learning.

## Report

Tell the user the retro path, memory rows added/skipped, and any follow-up work captured. If a follow-up should become roadmap work, add or triage it before ending the phase.
