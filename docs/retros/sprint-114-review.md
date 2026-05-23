## Sprint 114 Review: Skill Registry MVP

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 5 |
| Slope | 3 |
| Score | 5 |
| Label | Par |
| Fairway % | 100% (4/4) |
| GIR % | 100% (4/4) |
| Putts | 0 |
| Penalties | 0 |
| Hazard Penalties | 0.5 |

### Shot-by-Shot (Tickets Delivered: 4)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S114-1 | Short Iron | In the Hole | - | Added the core skill registry schema, config defaults, persistence helpers, and exported API surface for repo-local skill metadata. |
| S114-2 | Long Iron | Green | - | Implemented deterministic skill root scanning, YAML frontmatter parsing, agents/openai.yaml metadata capture, duplicate provider-root merging, and registry validation. |
| S114-3 | Short Iron | Green | Rough: Self-review found that absolute --root and --output paths were being joined under cwd instead of preserved. | Added slope skills scan/list/validate, CLI dispatch, command registry metadata, smoke coverage, and absolute path regression coverage. |
| S114-4 | Short Iron | Green | Rough: Self-review found malformed skill registry files could be loaded far enough to crash list/reference checks. | Added scorecard skill fields, builder support, structural validation, validate --skills reference checks, malformed registry rejection, and CLI regression coverage. |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| Rough | S114-3 | Self-review found that absolute --root and --output paths were being joined under cwd instead of preserved. |
| Rough | S114-4 | Self-review found malformed skill registry files could be loaded far enough to crash list/reference checks. |

**Known hazards for future sprints:**
- Any CLI path flag that accepts user filesystem input should preserve absolute paths and resolve relative paths against cwd in tests.
- Registry loaders should reject malformed top-level shapes before downstream code maps over arrays.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | CLI path handling needs explicit absolute-path regression coverage. | Added absolute --root/--output coverage for slope skills scan and resolved explicit validate paths against cwd. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | Validated targeted skill/scorecard tests, typecheck, build, built CLI smoke tests, and the full Vitest suite. |

### Course Management Notes

- Added src/core/skills.ts with scan, load/save, validation, duplicate merge, frontmatter parsing, and agents/openai.yaml metadata capture.
- Added slope skills scan/list/validate and command registry metadata.
- Added scorecard skill fields and validate --skills reference checking.
- slope skills scan --root=.agents/skills, slope skills list, slope skills validate, and slope validate --skills smoke tests passed on the built CLI.
- pnpm build passed.
- Full pnpm test passed: 214 test files and 3456 tests.

### 19th Hole

- **How did it feel?** This was a satisfying first layer: SLOPE can now see skills as metadata without pretending to run them.
- **Advice for next player?** Keep S114.5 deterministic. Use this registry as input to briefing recommendations before attempting smarter gap detection.
- **What surprised you?** The useful review catches were plain path and malformed-file resilience, not the YAML parsing itself.
- **Excited about next?** Briefing can now recommend skills from a real registry instead of relying on tribal memory.
