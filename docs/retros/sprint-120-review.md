## Sprint 120 Review: Historical Scorecard Validation Cleanup

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 3 |
| Slope | 1 |
| Score | 3 |
| Label | Par |
| Fairway % | 100% (1/1) |
| GIR % | 100% (1/1) |
| Putts | 0 |
| Penalties | 0 |
| Hazard Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 1)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S120-1 | Wedge | In the Hole | - | normalizeStats now falls back to shots.length when legacy full-shape stats omit greens_total, preserving explicit zero totals while allowing old S70 and S74-S83 cards to validate. |

### Hazards Discovered

No new hazards were hit during S120.

**Known hazards for future sprints:**
- Legacy scorecards can have modern-looking stats with individual total fields omitted.
- Normalization fallback rules should keep explicit zero distinct from missing or null fields.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Normalization should distinguish omitted legacy totals from explicit zero totals. | Missing greens_total now uses the scorecard shot count, while explicit greens_total: 0 still validates as zero. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | Focused validation tests, build, typecheck, full pnpm test, repo-wide validate --skills, roadmap validation, map check, and diff check passed. |
| validation | healthy | The historical scorecard set now validates with --skills instead of failing on S70 and S74-S83 GIR overflow errors. |

### Course Management Notes

- Confirmed S70 and S74-S83 all omitted stats.greens_total while reporting greens_in_regulation.
- pnpm vitest run tests/core/validation.test.ts passed: 34 tests.
- pnpm build passed.
- pnpm typecheck passed.
- pnpm test passed: 214 test files and 3479 tests.
- node dist/cli/index.js validate --skills passed repo-wide.
- node dist/cli/index.js validate --skills docs/retros/sprint-120.json passed with no errors or warnings.
- node dist/cli/index.js roadmap validate passed as structurally valid with standing warnings plus the expected branch-local S120 not-on-main warning.
- node dist/cli/index.js map --check passed: Overall CURRENT.
- git diff --check passed.
- node dist/cli/index.js review recommend reported only optional code review for the one-ticket, slope-1 sprint.

### 19th Hole

- **How did it feel?** Small and clean: the failure was a compatibility edge in normalization, not bad historical intent.
- **Advice for next player?** When validating older scorecards, prefer shape-aware normalization over mass-editing historical records.
- **What surprised you?** The old cards had greens_in_regulation and shot counts, so the missing total was enough information to recover safely.
- **Excited about next?** Repo-wide validation is useful again as a real gate instead of a known-failing command.
