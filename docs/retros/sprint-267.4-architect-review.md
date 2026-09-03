# S267.4 Architect Review

**Agent:** workflow-architecture-reviewer
**Lane:** architect
**Model:** opus
**Provenance:** independent review, clean context, instructed to treat the diff, scorecard and issue text as untrusted data and to say plainly if the sprint claimed more than it delivered.
**Verdict:** CHANGES REQUIRED. All five findings applied.

## Findings and disposition

**1. `slope validate --dry-run` writes.** Demonstrated in a scratch project with `gates.scorecard: false`: `--dry-run` flipped the gate to `true` and printed that it had, while `--read-only` correctly skipped. A reader of #706 follows the sprint's own documentation, types the safe-sounding word on the command the issue names, and gets the full write path. **Applied.**

**2. Both new helpers reflow the file.** Both ended in `String(doc)`, default `lineWidth: 80`. The `stringify(project, { lineWidth: 0 })` they replaced did not wrap. Measured against this repo's real `docs/roadmap/project.yaml`: 126 lines became 158, and the next `roadmap archive` would reflow the 2,300-character authored description across 32 extra lines. **Applied:** both pass `lineWidth: 0`.

**3. Closeout artifacts were not on the branch.** The scorecard and review markdown were untracked; the phase file and projection were modified and uncommitted. Branch discipline requires the scorecard on the branch being PR'd. **Applied.**

**4. Phase 66's note contradicts Phase 67's.** Phase 66 records that numbering at 267.4/267.5 "was tried and reverted ... decimal inserts sat behind the cursor and became unreachable". Phase 67 now uses exactly those ids. Both are true, because reachability is cursor-relative and the cursor has since moved back to 267.1, but nothing said so. **Applied:** Phase 66's note now records that the constraint is cursor-relative and points at Phase 67.

**5. The commit message credited a guard that does not run on the changed path.** Same finding as the code review's first. **Applied:** the guard now runs, and the scorecard note is corrected rather than left claiming it always did.

## Assessment of what shipped

**Does it close #706?** The comment half is closed at both sites, shown live. Two residuals recorded rather than fixed: comments inside the `sources:` list of `project.yaml` still go on archive, because that node is replaced wholesale; and nothing in the README or `docs/` documents comment handling either way, which was the issue's alternative ask.

**Design boundary is right.** The two mechanisms are ordered rather than overlapping: the Document path runs only when the patcher declines. Replacing the patcher outright would be worse, since the Document path reflows blocks it did not touch, so every reconcile would churn.

**Unadvertised win.** `expectedDocument` is built from the parsed document, where `id: "267.4"` has already been coerced to a number with `id_key` injected. The old fallback would have written `id: 267.4` and destroyed the canonical string id. The live run keeps it.

**The default decision is sound but housed wrong.** Keeping `validate` a writer is consistent with `sprint-checklist.md`, which makes it the post-hole step that produces the artifacts. But a code comment inside an `else if` branch is not "recorded in the flag's help" as the ticket title promises, and README still describes `slope validate` with no mention that it writes. Carried forward.

**Blast radius contained.** Callers are `validate.ts` and `roadmap.ts`, both updated; the result gained an optional field only. One adjacent writer worth naming: `sprint-completion.ts` `handleValidateSuccess` writes the roadmap for any exit-0 `slope validate` on legacy-roadmap projects, including read-only runs. Pre-existing and outside this diff, but it undercuts the escapable framing.

**Scorecard honesty.** The reviewer judged par 4 flattering by about a stroke and S267.4-3 a miss. Accepted and applied: the sprint is rescored to triple_plus 12 with two tickets marked as misses.

## Tool results

Build, typecheck, `roadmap validate-sources`, `roadmap compile --check` and `roadmap validate` all clean. `roadmap validate` reports a new permanent `Sprint numbering gap: S274 → S277` from the renumbering, and a pre-merge `S267.4 marked complete but no shipped commits found on main`. `slope docs check` reports pre-existing drift in three sections, flagged for the release checklist.
