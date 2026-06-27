## Sprint 219 Review: Independent Review Provenance

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 4 |
| Slope | 3 |
| Score | 4 |
| Label | Par |
| Fairway % | 100% (4/4) |
| GIR % | 100% (4/4) |
| Putts | 0 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 4)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S219-1 | Long Iron | In the Hole | - | Sprint state now stores review_gates separately from raw gate booleans and normalizes legacy state to pending review provenance. |
| S219-2 | Long Iron | In the Hole | - | Review gates now require independent reviewer evidence, PR review evidence, self-review rationale, or manual override rationale before they can complete. |
| S219-3 | Short Iron | In the Hole | - | Review recommendation and PR guard paths now derive purpose-built reviewer agent specs with lane, focus, scope, and evidence requirements. |
| S219-4 | Short Iron | In the Hole | - | Sprint status, session briefing, help metadata, and agent status now show review provenance explicitly and keep boolean-only review gates pending. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| Wind | minor | The sprint touched core lifecycle state, CLI gates, guard prompts, review recommendation output, and agent-facing status, so evidence had to stay explicit across several surfaces. |

### Hazards Discovered

**Known hazards for future sprints:**
- Review gates need both structured provenance and user-visible labels, or self-review can still appear equivalent to independent review.
- Derived status surfaces should use the same pending-gate helper as completion logic.
- Purpose-built reviewer-agent guidance is only useful if it states the expected evidence fields up front.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Review gate booleans are not enough to prove independent review. | Review completion now has typed provenance and validation for independent_review, pr_review, self_review, and manual_override. |
| Lessons | Legacy sprint-state files need safe normalization instead of silent trust. | Missing, partial, or invalid review_gates load as pending unless they contain valid evidence. |
| Lessons | Reviewer-agent prompts need artifact-scoped evidence requirements, not generic review language. | Review guidance now asks for purpose-built reviewer agents and evidence that includes agent identity, lane, verdict, required fixes, and fix handling. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| Hydration | healthy | `./node_modules/.bin/tsc.cmd --noEmit` passed. |
| Diet | healthy | Focused review-gate and reviewer-agent suites passed during the sprint: sprint-state, sprint-gate, agent status, session briefing, review findings, PR review guard, and PR finalize coverage. |
| Recovery | healthy | `./node_modules/.bin/vitest.cmd run tests/cli` passed: 128 files, 1475 tests. |
| Stretching | healthy | S219-4 status/help coverage verifies self_review is visibly weaker than independent_review and that boolean-only review gates remain pending. |

### Course Management Notes

- GitHub issues #561 and #562 are addressed by commits 1970399, f481748, ff57cc2, and 6c6bcbe.
- The sprint intentionally leaves unrelated dirty hook and slope-loop files untouched.
- Closeout review gates are recorded as self_review/manual_override unless an actual independent reviewer or PR review evidence is available.

### 19th Hole

- **How did it feel?** The sprint was wider than the first issue title suggested because provenance needed to be enforced, rendered, and recommended consistently.
- **Advice for next player?** Treat review evidence as a first-class contract. If no independent reviewer actually ran, record self_review or manual_override explicitly instead of implying stronger evidence.
- **What surprised you?** Agent status and session briefing were easy to miss because they consumed raw gate booleans outside the main sprint status path.
- **Excited about next?** S220 can build on clearer review evidence while it repairs audit trail and retro parsing gaps.
