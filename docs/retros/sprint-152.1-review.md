## Sprint 152.1 Review: Roadmap Interview Discoverability and Harness Routing

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 4 |
| Slope | 2 |
| Score | 4 |
| Label | Par |
| Fairway % | 100% (4/4) |
| GIR % | 100% (4/4) |
| Putts | 0 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 4)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S152.1-1 | Short Iron | In the Hole | - | Added `slope roadmap interview` as an alias that delegates to the existing interview command, including --agent JSON-mode coverage that writes the roadmap artifacts. |
| S152.1-2 | Wedge | In the Hole | - | Updated roadmap help, registry metadata, README, and getting-started docs so roadmap planning points at the interview, vision, and generate flows. |
| S152.1-3 | Short Iron | Green | - | Surfaced roadmap interview guidance through MCP init search descriptions, Pi onboarding/planning messages, Codex/OpenCode templates, generated adapter docs, and the generic adapter README. |
| S152.1-4 | Short Iron | In the Hole | - | Added regression coverage for roadmap help discovery, CLI alias execution, MCP init search discoverability, Pi tool guidance, OpenCode slash-command description, and generated harness docs. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| Wind | minor | The sprint was triggered by an agent-discoverability miss: roadmap tooling existed, but supported harnesses did not make the interview flow obvious from roadmap-planning language. |

### Hazards Discovered

**Known hazards for future sprints:**
- Roadmap planning language can drift away from the original `slope interview` and MCP init naming.
- Harness prompt templates can silently lag CLI capabilities unless regression tests assert generated guidance.
- Pi and OpenCode surfaces need explicit planning-language breadcrumbs because users may never inspect full CLI help.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | When an existing command is the right answer, add an alias and discovery breadcrumbs at the user phrase boundary instead of duplicating the workflow. | `slope roadmap interview` now routes to `slope interview`, while docs and harness prompts explain the existing vision/generate path. |
| Lessons | Discovery bugs need harness-level assertions, not just CLI help assertions. | Coverage now spans CLI help/registry, MCP init search, Pi onboarding, OpenCode command text, Codex templates, and generic adapter output. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | `pnpm vitest run tests/cli/commands/interview.test.ts` passed: 5 tests. |
| testing | healthy | `pnpm vitest run tests/cli/commands/help.test.ts tests/cli/registry.test.ts` passed: 13 tests. |
| testing | healthy | `pnpm vitest run tests/cli/template-generator.test.ts tests/mcp/init-api.test.ts tests/packages/pi-extension.test.ts tests/packages/opencode-plugin.test.ts tests/core/adapters/generic.test.ts` passed: 107 tests. |
| testing | healthy | `pnpm vitest run tests/cli/commands/interview.test.ts tests/cli/commands/help.test.ts tests/cli/registry.test.ts tests/cli/roadmap.test.ts tests/cli/template-generator.test.ts tests/mcp/init-api.test.ts tests/packages/pi-extension.test.ts tests/packages/opencode-plugin.test.ts tests/core/adapters/generic.test.ts` passed: 156 tests. |
| testing | healthy | `pnpm test` passed: 235 files, 3670 tests, 25 skipped. |
| testing | healthy | `pnpm build` passed. |
| docs | healthy | `node dist/cli/index.js help roadmap` showed the new `slope roadmap interview` alias and planning breadcrumbs. |
| docs | healthy | `node dist/cli/index.js validate docs/retros/sprint-152.1.json` passed with no errors or warnings. |
| docs | healthy | `node dist/cli/index.js roadmap validate --path=docs/backlog/roadmap.json` passed with existing historical ticket-count warnings and the expected branch-not-on-main warning for S152.1 until merge. |

### Course Management Notes

- The issue was a supported-surface discoverability bug, not a missing interview engine.
- The alias deliberately delegates to the existing interview command so behavior stays single-sourced.
- Regression coverage is spread across execution, help metadata, MCP search, Pi, OpenCode, Codex template, and generic adapter output.

### 19th Hole

- **How did it feel?** A satisfying discoverability fix: the system already had the interview, but the doors into it were too easy for agents to miss.
- **Advice for next player?** When a user asks for a high-level workflow, search command aliases, help metadata, MCP descriptions, and harness templates together; agents learn from all of those surfaces.
- **What surprised you?** The fix was less about new capability and more about vocabulary. Adding `roadmap interview` made the existing flow line up with how people naturally ask for it.
- **Excited about next?** S153 can now start after a cleaner planning surface, with the roadmap interview no longer hiding behind setup/init language.
