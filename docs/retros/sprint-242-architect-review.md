# Sprint 242 Architect Review — Closeout Integrity

- **Reviewer:** workflow-architecture-reviewer (independent architect lane)
- **Sprint:** S242 — Closeout Integrity (#616, #611)
- **Branch:** `feat/S242-closeout-integrity`
- **Diff reviewed:** `git diff main...feat/S242-closeout-integrity -- src/ tests/` (8 files, +221/−17)
- **Verdict:** **approve-with-notes**

## Summary assessment

Both fixes are architecturally sound and correctly scoped. The marker approach is the
right mechanism for distinguishing generated from authored reviews: it is content-borne
(travels with the file through git, worktrees, and renames), inert in rendered markdown,
and fails safe — an unmarked file is treated as potentially authored and preserved. The
statusCommand change is display-only (no state mutation), and I verified the derived
status string has no programmatic consumers outside `statusCommand` itself: guards
(`sprint-completion`, `post-push`, `next-action`), the workflow engine
(`isActiveSprintState`, `workflow-resync`), and `slope pr status` (`pr-closeout.ts`) all
read `state.phase` or file existence directly, never the printed `ready_for_pr` string.
All 114 tests in the four touched suites pass.

The notes below are real gaps, but none is a merge blocker for the two issues being
fixed. Findings 1 and 2 should be addressed before release; the rest are follow-ups.

## Consumer / interaction audit (what I checked)

| Consumer | Coupling | Verdict |
|----------|----------|---------|
| `src/cli/sprint-state.ts:388` `isActiveSprintState` | `phase !== 'complete' && !isSprintComplete` | Unaffected — semantics of phase `complete` unchanged; only the display string changed |
| `src/cli/guards/sprint-completion.ts:347,613` | Reads `state.phase` directly; `handleStop` already treats `complete` as a warn-eligible terminal phase; `handlePrMerge` already skips `complete` | Correct interaction |
| `src/cli/guards/next-action.ts:67` | `phase !== 'complete'` → between-sprints detection | Correct — closed-out sprint falls through to roadmap/store logic |
| `src/cli/guards/post-push.ts:47,74` | Only branches on `implementing`/`scoring` | Unaffected |
| `src/cli/pr-closeout.ts:102,129` (`slope pr status`) | Checks review-markdown *existence* only | Unaffected; the refusal path keeps the file, so the closeout blocker check still passes |
| `src/cli/guards/review-stale.ts:28` | Suggests `slope review` only when the review file is *missing* | No conflict with the new refusal path |
| `src/cli/workflow-resync.ts:284`, `src/cli/commands/sprint.ts:1223` | `phase === 'complete'` short-circuits | Unaffected |
| `grep ready_for_pr` across `src/`, `packages/`, `slope-loop/`, `.claude/` | Only `sprint.ts`, tests, and two historical retro docs | No external string-matchers |
| Phase writers | `retro.ts:529` (post-merge retro) is the only production writer of phase `complete`; `slope sprint phase complete` is a manual escape hatch | The #611 premise ("complete means merged") holds |
| Moved test (`sprint-gate.test.ts:89`) | Old test used phase `complete` for a pre-PR waiver scenario — that was encoding the exact ambiguity #611 fixes | Move to `scoring` is correct, and the comment documents why |

## Findings

### 1. `--force` is undocumented in the CLI registry (severity: medium)

`src/cli/registry.ts:212-247` — the `review` command entry lists only `--metaphor` and
`<path>`. The new `--force` flag (and, pre-existing, `--stdout`, `--output`, `--sprint`,
`--plain`) is absent. The registry drives `slope help review` and the `slope docs
generate` manifest, so the only documentation of `--force` is the runtime refusal
message. An agent that hits the refusal in a context where stderr is truncated has no
discoverable path to the flag. The release checklist's `slope docs check` will *not*
catch this because the drift is an omission from the registry itself.

**Required fix:** register `--force` (desc: "Overwrite a review that lacks the slope
generation marker") in the `review` entry. Adding the other missing flags is optional
scope but cheap while you are there.

### 2. `reviewRequiredSections` is consumed without shape validation (severity: medium)

`src/core/config.ts:120-121` spreads raw user JSON over defaults with no validation, and
`src/cli/commands/review.ts:146-148` immediately calls `.filter(...)` and
`section.toLowerCase()` on it. A config containing `"reviewRequiredSections": "## Foo"`
(string instead of array) or `["## Foo", 3]` throws an uncaught `TypeError` and kills
`slope review` with a raw stack — during closeout, the worst time. This is a
user-authored config field whose entire purpose is to be hand-edited.

**Required fix:** coerce defensively at the point of use, e.g.
`const requiredSections = Array.isArray(config.reviewRequiredSections) ? config.reviewRequiredSections.filter(s => typeof s === 'string') : [];`
(or validate in `loadConfig`, which would benefit every field, but that is larger scope).

### 3. `repairMojibake` can corrupt legitimate content — including content about this very bug (severity: low, but ironic)

`src/cli/commands/review.ts:72-83` — the sequences `â€”`, `â€™`, etc. are valid UTF-8
strings that appear legitimately in exactly one common case: text *quoting* mojibake.
Sprint 242's own scorecard notes or hazard descriptions ("review emitted `â€”` instead of
em dashes, see #616") will be silently "repaired" in the written review, destroying the
quotation. The blast radius is small (repair runs only on freshly generated content,
never on kept/authored files — verified at line 119), and the tradeoff is probably right,
but it is not zero-risk and nothing in the output signals a repair happened.

**Suggested fix (non-blocking):** log a one-line stderr notice when
`repairMojibake` actually changed the content ("repaired N mojibake sequence(s)"), so a
deliberate quotation being mangled is at least visible. Also note the table is
incomplete (`â€¦` ellipsis, `Ã©`-family accented characters are common cp1252 casualties)
— fine to extend lazily as cases appear.

Separate architectural question, flagged not blocking: this is symptom repair. The root
cause — *what* decoded UTF-8 as cp1252 upstream (`writeFileSync(..., 'utf8')` cannot) —
is not identified in the diff. If the corruption source is an external agent/editor
writing the scorecard JSON, repair-on-write is a reasonable containment; if it is inside
slope, this will resurface elsewhere (briefing output, scorecard JSON round-trips).
Recommend a follow-up ticket to trace the actual encoding fault from #616.

### 4. Gate-on-kept-file: gate closes on an unvalidated file with default config (severity: low)

`src/cli/commands/review.ts:125-131,143-153` — on refusal, `reviewOnDisk = existing` and,
with no `reviewRequiredSections` configured (the default), the gate closes on *any*
existing marker-less file: an empty file, a stale copy from a previous sprint left at
`sprint-N-review.md`, or an unrelated document. Two mitigating facts: (a) the previous
code closed the gate unconditionally, so this is not a weakening — with config set it is
strictly stronger; (b) issue #616's authored review was compliant, and preserving it is
the point. But the gate's semantic has quietly shifted from "slope produced a review" to
"a file exists at the review path", and only opt-in config narrows it. The sprint-number
scoping (`sprintState.sprint === card.sprint_number`) protects against cross-sprint gate
leaks, not against wrong *content*.

**Suggested fix (non-blocking):** document in the refusal message that the kept file
satisfied the gate ("review_md gate closed against the kept file"), so the state change
is visible rather than implicit. Consider shipping a default `reviewRequiredSections`
suggestion in `slope init` templates.

### 5. Gate check haystack is inconsistent across output modes (severity: low)

`src/cli/commands/review.ts:114` initializes `reviewOnDisk` to the *unrepaired* raw
review; in `--stdout` mode (`outputPath === null`) that is what the required-sections
check validates and no file exists at all, yet the gate can still close — pre-existing
behavior, but the variable name now lies. Also `console.log(review)` at line 111 prints
the unrepaired text while the file gets the repaired text, so terminal output and disk
can differ. Cosmetic, but rename the variable (`reviewContentForGate`) and consider
applying `repairMojibake` once to `review` before both uses.

### 6. `status: complete` with pending gates reads contradictory (severity: low)

`src/cli/commands/sprint.ts:1015-1023` — nothing enforces that gates are complete when
phase becomes `complete` (`retro.ts:529` sets it unconditionally; `slope sprint phase
complete` is manual). In that state the output is `status: complete (phase: complete)`
followed by `Remaining: <gates>` — "complete" as a status while gates remain is
self-contradictory for an agent parsing the headline, and the closed-out "Next" line is
suppressed (correctly). Low priority because post-merge retro after honest gate
completion is the normal path, but consider a distinct label for this corner
(`complete_with_pending_gates`) or a warning line.

### 7. Gate left "open" is not the same as gate reopened (severity: informational)

`src/cli/commands/review.ts:149-152` — when required sections are missing the code skips
`updateGate(..., true)` but never sets the gate false. If `review_md` was already closed
(earlier compliant run) and the review is then regenerated without the sections, the
gate stays closed while stderr claims it was "left open". Arguably correct (don't revoke
recorded progress), but the message overstates. Reword to "review_md gate not closed by
this run" or actively reopen — pick one deliberately.

## Behavioral compatibility verdict on the historical-review question

Regenerating a pre-S242 (marker-less) review now requires `--force`, and the refusal
message names the flag, the keep option, and the `--stdout`/`--output` escape hatches —
this is acceptable and adequately self-documenting at runtime (finding 1 covers the
static-docs gap). The refusal exits 0, which I judged correct: the gate-relevant
artifact exists and the command's contract ("ensure a review") is satisfied; a non-zero
exit would break closeout automation for the common preserved-file case.

## Required fixes before merge/release

1. Finding 1 — register `--force` in `src/cli/registry.ts` review entry.
2. Finding 2 — guard `reviewRequiredSections` against non-array/non-string config values.

Findings 3-7 are follow-ups; recommend recording 3 (root-cause trace) as a backlog item.
