## Sprint 114.5 Review: Skill-Aware Briefing & Gap Detection

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
| Hazard Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 4)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S114.5-1 | Short Iron | In the Hole | - | Added the skill briefing result model, buildSkillBriefing helper, full briefing Recommended Skills section, and compact-mode Skills summary. |
| S114.5-2 | Long Iron | Green | - | Scored registered skills deterministically from current roadmap text, briefing filters, recent hazard language, terminology overlap, and scorecard skill history. |
| S114.5-3 | Short Iron | Green | Rough: Built CLI smoke testing showed one-off filter words such as skills and roadmap were too noisy as skill gaps. | Restricted gap detection to repeated common-issue evidence and recent scorecard skill_gaps_found entries. |
| S114.5-4 | Short Iron | Green | Rough: Full-suite testing caught a decimal sprint begin label compatibility regression from prerequisite sprint id plumbing. | Added briefing regressions, decimal sprint lifecycle regressions, scorecard/review artifacts, and final built CLI smoke coverage. |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| Rough | S114.5-3 | Built CLI smoke testing showed one-off filter words such as skills and roadmap were too noisy as skill gaps. |
| Rough | S114.5-4 | Full-suite testing caught a decimal sprint begin label compatibility regression from prerequisite sprint id plumbing. |

**Known hazards for future sprints:**
- Briefing skill gaps should require repeated common-issue or scorecard skill_gaps_found evidence; filter words alone are too noisy.
- Decimal sprint CLI tests that execute dist need pnpm build before rerunning.
- Skill recommendation reasons should stay human-readable and tied to concrete briefing context.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Skill gaps need evidence, not just keyword presence. | Gap detection now uses repeated common issues and scorecard skill_gaps_found entries instead of one-off briefing filters. |
| Lessons | Built CLI smoke tests remain important when tests shell through dist. | Rebuilt before dist-backed tests and added final smoke checks for compact and full S114.5 briefing output. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | Validated targeted briefing and decimal sprint regressions, typecheck, build, built CLI smoke tests, and the full Vitest suite. |
| docs | healthy | Recorded S114.5 scorecard, review notes, and roadmap status. |

### Course Management Notes

- Added buildSkillBriefing and exported skill briefing types from src/core/briefing.ts.
- Wired slope briefing to load the local skill registry for full and compact output.
- Added regressions for recommendation ranking, repeated unmatched skill gaps, filter noise suppression, and rendered briefing sections.
- Preserved decimal sprint ids across lifecycle commands as prerequisite plumbing for S114.5.
- pnpm typecheck passed.
- pnpm build passed.
- pnpm test passed: 214 test files and 3467 tests.

### 19th Hole

- **How did it feel?** This was the right second layer: the registry now affects planning without making the agent launcher magical.
- **Advice for next player?** Keep recommendations explainable. If the reason cannot point to roadmap, filters, hazards, or history, do not rank it highly.
- **What surprised you?** The useful UX catch was not ranking itself; it was suppressing false gap warnings from generic filter terms.
- **Excited about next?** Briefing can now nudge agents toward the right local skill before the first edit.
