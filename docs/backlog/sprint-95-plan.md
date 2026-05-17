# Sprint 95 Plan - Inserted Sprint Recovery

**Par:** 4 (4 tickets)
**Slope:** 2 (roadmap ID semantics, sprint inference, guard/status UX)
**Theme:** Make `slope next`, status, briefing, and guards respect inserted sub-sprints.
**GitHub issue:** #364
**Branch:** create `fix/s95-inserted-sprint-state` before implementation.

---

## Context

Issue #364 came from `fathoms-art`: a branch and commit history clearly referred to an inserted sprint `S43.5`, represented in `roadmap.json` as id `435`, but no active sprint state existed. SLOPE then fell back to scorecards and reported `S100`, because existing sprint inference is mostly:

1. explicit `config.currentSprint`
2. latest scorecard number + 1

That is too weak for repositories that insert sub-sprints between canonical sprint numbers. The next session can be steered toward the wrong sprint unless the user manually correlates branch name, commits, and roadmap entries.

---

## Tickets

### S95-1: Normalize and display inserted sprint identifiers like roadmap id 435 as S43.5

**Club:** short_iron
**Files:**
- `src/core/roadmap.ts`
- `src/core/loader.ts`
- focused tests near roadmap/loader helpers

**Scope:**

1. Add a single helper for sprint display labels so roadmap id `435` can be shown as `S43.5` without ad hoc formatting.
2. Keep numeric ids stable internally unless the implementation proves a richer type is needed.
3. Define ordering rules for canonical ids and inserted ids.
4. Cover edge cases explicitly: `43`, `435`, `95`, and ambiguous ids that should remain canonical.

**Acceptance:**
- Tests prove inserted sprint labels and ordering.
- Existing canonical sprint labels stay unchanged.

### S95-2: Teach next/status/briefing to prefer pending inserted roadmap sprints over scorecard+1 fallback

**Club:** short_iron
**Files:**
- `src/cli/commands/next.ts`
- `src/cli/commands/agent.ts`
- briefing/status code paths as needed
- command tests

**Scope:**

1. Load `docs/backlog/roadmap.json` before falling back to scorecard+1.
2. If a pending inserted sprint is the lowest ready roadmap candidate, surface it explicitly.
3. Make output explain when scorecard inference is being overridden by roadmap state.
4. Avoid mutating active sprint state from read-only commands.

**Acceptance:**
- `slope next` reports the pending inserted sprint instead of the next canonical scorecard number.
- `slope status` / agent status do not silently imply the wrong sprint when no active state exists.

### S95-3: Warn when branch/roadmap/commit context implies a sprint but no active sprint state exists

**Club:** short_iron
**Files:**
- `src/cli/guards/claim-required.ts`
- session/status helpers as needed
- guard tests

**Scope:**

1. Detect likely sprint context from branch names, recent commits, and pending roadmap entries.
2. When no active sprint state exists, warn with the inferred sprint and the command to start or resume it.
3. Keep implementation-write enforcement from S94 intact.
4. Do not block pure inspection/read-only work.

**Acceptance:**
- Guard output warns about the inferred inserted sprint instead of generic no-state guidance.
- Tests cover branch/commit hints and no false positive for unrelated branches.

### S95-4: Document and test starting, claiming, and scorecarding inserted sub-sprints

**Club:** wedge
**Files:**
- `docs/getting-started.md` or a focused guide
- `docs/backlog/sprint-95-plan.md`
- command tests for any accepted CLI input shape

**Scope:**

1. Document the supported representation for inserted sprints.
2. Decide whether users should type `--number=435`, `--number=43.5`, or both.
3. Ensure claim, sprint start, and scorecard commands have clear behavior for inserted sprints.
4. Add regression coverage for the chosen input/display shape.

**Acceptance:**
- Docs explain the inserted sprint workflow without relying on tribal knowledge.
- Tests prove the selected CLI input shape works end to end.

---

## Verification

Run before closing the sprint:

```bash
pnpm build
pnpm typecheck
pnpm test
slope validate
```

Manual scenario:

```bash
# In a fixture or temporary repo:
# - scorecards end at S99
# - roadmap has pending id 435 / S43.5
# - no active .slope/sprint-state.json
slope next
slope status
slope briefing
```

Expected: commands point at the inserted sprint context or warn explicitly before falling back to `S100`.
