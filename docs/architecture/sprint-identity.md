# Canonical Sprint Identity

SLOPE 2.0 treats a sprint ID as a canonical string. This preserves authored
identities that JavaScript numbers cannot represent, such as `"458.10"` alongside
`"458.1"`.

## Public Contract

- Store, scorecard, claim, event, workflow, dependency, label, and API identity is
  the canonical string key.
- New scorecards write `sprint_number` as a string.
- Legacy numeric inputs are accepted only at documented read boundaries and are
  normalized to strings immediately.
- A trailing-zero ID must be quoted in YAML or JSON. Once `458.10` has been parsed
  as a number, it is indistinguishable from `458.1` and cannot be recovered.

```json
{
  "sprint_number": "458.10"
}
```

Use the helpers in `src/core/sprint-id.ts` rather than numeric conversion:

| Need | Helper |
|------|--------|
| Validate and canonicalize input | `sprintIdKey` |
| Parse base and exact insert digits | `parseSprintId` |
| Compare sprint order | `compareSprintIdKeys` |
| Test identity equality | `sprintIdsEqual` |
| Find the latest identity | `latestSprintIdKey` |
| Enter a numeric-only legacy boundary | `sprintIdToNumber` |

`sprintIdToNumber` returns `null` unless conversion round-trips exactly. In
particular, `"458.10"` must never be sent through a numeric-only boundary.

## Roadmap Compatibility Bridge

The roadmap object retains the Phase 60 dual representation as a compatibility
bridge:

- `RoadmapSprint.id` is a numeric mirror.
- `RoadmapSprint.id_key`, when present, is the authoritative canonical key.
- `RoadmapPhase.sprints` contains numeric mirrors.
- `RoadmapPhase.sprint_keys`, when present, is the authoritative membership.

These mirror fields keep existing roadmap consumers and generated compatibility
projections readable during the 2.0 transition. They are not safe identity keys:
`458.1` and `458.10` have the same numeric mirror.

Roadmap consumers must use:

- `roadmapSprintKey` for one sprint's identity.
- `roadmapSprintKeyFromId` or `findRoadmapSprint` for lookup.
- `phase.sprint_keys ?? phase.sprints`, mapped through
  `roadmapSprintKeyFromId`, for phase membership.
- `compareRoadmapSprintIds` for ordering.
- `formatRoadmapSprintLabel` for display.

Do not key a map, set, dependency, path, or equality check directly with
`RoadmapSprint.id` or `RoadmapPhase.sprints`.

## Retirement Boundary

`id_key` and `sprint_keys` remain supported for the 2.0 roadmap compatibility
model. They can be retired only with a separate roadmap schema migration that
replaces `id` and `sprints` with string fields and updates generated projection
consumers. Their presence does not make them a second identity system: the
canonical string returned by the roadmap helpers is the sole identity.
