# S232 Independent Agent-Workflow Review

- Reviewer: `s232_agent_guidance`
- Lane: contributor guidance, shipped harness templates, and dogfood operability
- Final verdict: APPROVED

## Review history

The first two rounds were rejected. The reviewer found the same historical
compatibility drift, contradictory canonical-roadmap documentation, focus before
sprint discovery, tracked/shipped sprint skills that bypassed bounded focus, and
the legacy issue-array alias.

The final guidance consistently discovers the sprint with `slope now`, loads
`slope roadmap focus --sprint=N`, and then runs briefing/start flows. Repository
instructions, generated templates, local Claude skills, the shipped Codex skill,
and Pi/Claude start commands now agree that YAML bundles are authoritative and
the JSON roadmap is generated compatibility output.

## Final validation

- 69 targeted tests passed
- Typecheck passed
- `slope roadmap validate-sources` passed
- `slope roadmap compile --check` passed
- Bounded S232 focus and diff check passed

No reviewer edits were made.
