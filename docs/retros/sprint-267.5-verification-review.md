# S267.5 Verification Review

**Agent:** verification-reviewer
**Lane:** verification (third pass, after code and architect)
**Model:** opus
**Provenance:** independent review, clean context, instructed to prove each claimed fix by execution rather than reading, and to hunt for defects the fix commit introduced.
**Target:** fix commit `c81a5b2`
**Verdict:** APPROVED WITH FIXES. All applied.

## All seven prior fixes: verified by execution

| Fix | Result |
|---|---|
| compile warns on an unregistered source | all four commands print it, including when the projection is unchanged |
| dry run agrees with compile | marker-stripped and 1.64.1-shaped projections both predict correctly; pristine says "already current" then "unchanged" |
| case-insensitive comparison | differently-cased registration loads with zero warnings; a genuine orphan still reported in the same run |
| warning path form | prints `phases/x.yaml`; pasting it into `sources:` verbatim cleared the warning |
| directory named `*.yaml` | no warning |
| upgrade doc claims | trailing-zero limit holds; one sentence false and one section stale, see below |
| mismatch message | names the upgrade doc, exit 1, file exists |

## New defects found, all applied

**1. A symlinked unregistered yaml stopped being reported.** `Dirent.isFile()` is false for a symlink, so the `withFileTypes` change made for the directory fix silently narrowed the scan. The name-only version it replaced caught both. Now checks `isFile() || isSymbolicLink()`.

**2. The mismatch message named a bare `docs/upgrading.md`.** That resolves only inside this repository, and the audience is a consumer repo with a pinned CI. Now a full URL.

**3. A falsifiable sentence in the upgrade note.** "A binary older than this key cannot read it" is false: the reviewer transcribed v1.64.1's `stripRoadmapProjectionMarker` and ran it over a format-2 projection. It strips the whole header including the unknown key and parses all 178 sprints. It reads the file fine; it cannot act on the key.

**4. The #700 section of the note was stale**, still describing `validate-sources` as the only command that warns, after the same commit made `compile` warn in all three modes.

**5. Warning volume was uncapped on the routine command.** 120 stray files produced 244 lines from `compile`. Now capped at five with a pointer to `validate-sources`.

**6. Two of three behavioural fixes had no test.** All three added tests called `validateRoadmapSourceStore` directly; none drove the CLI, so deleting the compile warning loop or reverting the dry-run prediction left the suite green. This is why the symlink regression slipped through. Two CLI-driving tests added, each confirmed to fail with its fix reverted.

**Residual R3, also applied.** The scan visited only directories that already held a registered source, so #700's own scenario stayed silent: a freshly authored sprint in `backlog/` in a project whose backlog holds nothing registered. Widened to the three directories a source kind can legally live in, with a test.

## Residuals recorded, not fixed

**A second write path still predicts semantically.** `completeRoadmapSourceSprint`, used by `slope validate` and `roadmap complete`, decides "unchanged" via `roadmapProjectionMatches`. Completing a sprint against a marker-less projection reports unchanged and leaves the marker missing, so `slope validate` will not repair it. Same defect class as the dry-run fix, at a site this sprint did not touch. Worth its own ticket.

**The dry run cannot predict a content-loss refusal.** Present on main, not a regression.

**The unregistered warning does not reach `slope validate`**, which reads only `validation.valid`. Given #700, possibly worth adding.

## Observations carried forward

`comparablePath` folds case on darwin unconditionally, and macOS volumes can be case-sensitive, so a genuinely distinct name there would go unreported. That costs a missed warning rather than a false one, which is the right direction; the comment now says so. The two write outcomes have different prefixes, so a script matching `would write` under-reports. `tests/repo-roadmap-sources.test.ts` asserts on errors but never warnings.

`roadmapProjectionWriteBytes` has no side effects: hashing every fixture file before and after a dry run showed no change. The compile warning loop cannot print twice, runs after the validation-error throw and before the `--check` branch, and prints nothing in a clean repo.

## Test suite

Targeted roadmap suites 129 passing before these fixes, 77 in the primary file after. Full suite 4554 passing with the same 5 pre-existing worktree and session identity failures present on clean main. Typecheck clean.
