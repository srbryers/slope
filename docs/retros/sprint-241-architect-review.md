# Sprint 241 — Architect Review

- **Reviewer:** workflow-architecture-reviewer (independent architect lane)
- **Scope:** `git diff main...feat/S241-surgical-roadmap-reconciliation -- src/ tests/` — issues #618, #615/#617
- **Verdict:** **approve-with-notes**

## Summary

The architecture is right: `src/core/roadmap-source-patch.ts` is a pure text function with no I/O, and `src/cli/roadmap-source-store.ts` keeps orchestration (locking, fresh reload, invariant enforcement, fallback, post-write federation validation). The layering matches the existing `roadmap-sources.ts` (core parse/compile) vs `roadmap-source-store.ts` (CLI store) split.

The core safety claim holds. I attacked the patcher with anchors/aliases (patching an anchor-defining `status: &st planned` line destroys the anchor, the alias fails to resolve, the invariant reparse throws — refusal, no write), column-0 comments inside the `sprints:` section (worst case: fallback or duplicate-key refusal), block scalars containing `status:`-shaped lines (indentation-anchored regexes cannot match them), duplicate ids (ambiguity refusal before any patch), and `458.1`/`458.10` float aliasing (consistent on both the parse and text sides). **No input I could construct produces an adjacent-sprint mutation or a silent write.** The belt-and-braces design — line-bounded edits plus a lossless EOL round-trip check plus an order-insensitive semantic reparse comparison against the expected document — means the two layers would both have to fail in complementary ways, and the reparse-throws case also refuses. Every failure mode I found is UX-grade (wrong error, missed fallback), not integrity-grade.

Identity matching is consistent with the rest of the codebase. Comparing `formatRoadmapSprintLabel(store.roadmap, item.id)` strings on both sides is equivalent to the `roadmapSprintOrderValue` equality used by archive planning (`planRoadmapSourceArchive`, `src/cli/roadmap-source-store.ts:426-432`) and the archive scorecard cross-check (`:357-360`), and to the private `roadmapIdsEqual` in `src/core/briefing.ts:217`. Because both sides go through the same formatter, float-representation drift cannot widen the match, and the legacy-encoded case (stored `235` ↔ requested `23.5`) resolves through the same `isEncodedInsertedSprintInRoadmap` heuristic used everywhere else. The genuinely ambiguous case (a `235` and a `23.5` both present) is refused, cross-file included, and the refusal is exercised in tests. Scorecard keys are written as `String(storedId)`, which matches both consumers: `validateRoadmapSourceStore` (`src/cli/roadmap-source-store.ts:318`) and the `changed` computation (`:191`) — the latter is itself a quiet fix, since the old code keyed on the caller-supplied `String(sprint)` and would mis-detect "changed" for legacy encoded ids.

No missed call sites remain that match **roadmap sources** by raw `item.id === sprint`; the two remaining `item.id === storedId` comparisons inside `completeRoadmapSourceSprint` are correct by construction (storedId came from the canonical match). See finding 6 for raw-equality sites against the *compiled* roadmap, which are out of this sprint's scope.

Both new test suites pass (36/36). The byte-for-byte expected-output test for styled bundles is exactly the right shape of regression test for #615/#617.

## Findings

### 1. MEDIUM — flow-style `scorecards:` section hard-fails with a misleading YAML error instead of falling back
`src/core/roadmap-source-patch.ts:131-137` (`upsertScorecardEntry` → `findTopLevelSection`), surfaced at `src/cli/roadmap-source-store.ts:219`.

`findTopLevelSection` only matches a key line with an **empty** value (`^scorecards:\s*(#.*)?$`). Given an authored flow-style section — `scorecards: { "6": docs/retros/sprint-6.json }` — the section is "not found" and the patcher **appends a duplicate top-level `scorecards:` key**. Verified empirically: the patched text fails the invariant reparse with `YAMLParseError: Map keys must be unique`, which propagates out of `completeRoadmapSourceSprint` as a raw `YAML parse error: Map keys must be unique` `RoadmapSourceError`. Nothing is written (safe), but:

- the declared contract — "explicit fallback (with warning) for flow-style documents" — is only implemented for flow-style **sprint entries**; flow-style scorecards make the document permanently unreconcilable through this path, and
- the user sees a parse error about a file that is on disk perfectly valid, with no hint to hand-edit or why.

**Required fix:** decline (return `null`) when the `scorecards:` key exists with a non-empty inline value, so the existing fallback engages. `findTopLevelSection` needs to distinguish "key absent" (append is safe) from "key present in a shape I can't patch" (decline).

### 2. LOW-MEDIUM — invariant reparse errors escape as raw parse failures rather than fallback or the crafted refusal
`src/cli/roadmap-source-store.ts:219` (`parseRoadmapSourceDocument(patchedText, ...)` outside any try/catch).

The invariant has three outcomes today: pass → write; semantic mismatch → crafted refusal; **parse throw → unclassified error**. The third is reachable (finding 1; also a column-0 comment between an entry's `- id:` line and its `status:` line makes `patchStatusLine` insert a duplicate `status:` key — same duplicate-key throw). A patch whose output does not even parse is proof the patcher was wrong, not proof the document is dangerous — the semantically-derived full rewrite remains safe. Recommend: catch parse errors from the reparse, set `reformatted = true`, and take the fallback path; reserve the hard refusal for a *parseable* result whose semantics drifted (that is the #618 shield and should stay a refusal).

### 3. LOW — `upsertScorecardEntry` drops trailing comments and normalizes spacing even when the value is unchanged
`src/core/roadmap-source-patch.ts:141-147`.

Replacing an existing key rebuilds the line as `indent + quote + key + quote + ': ' + path`, discarding any trailing comment (verified: `"7": docs/retros/sprint-7.json   # verified by hand` → comment gone) — inconsistent with `patchStatusLine`, which carefully preserves `match[3]`. Consequence: a fully idempotent re-reconcile (status already byte-identical, confirmed by probe) can still churn the scorecard line. Recommend preserving a trailing comment like `patchStatusLine` does, and skipping the rewrite when the parsed value already equals the target. Related edge, same class: a pathological quoted status such as `status: "planned #ish"` is patched to `status: complete #ish"` — semantically correct after reparse (the junk becomes a comment) so the invariant passes, but garbage is written to the targeted line. Anchoring the value regex on quote-awareness would close both.

### 4. LOW — no short-circuit when `changed` is false
`src/cli/roadmap-source-store.ts:183-192` computes `changed`, uses it only for dry-run, then unconditionally locks, patches, writes, revalidates, and recompiles, returning `changed: true`. Pre-existing shape, but this sprint's whole point is eliminating no-op churn — returning early (`projection: 'unchanged', changed: false`) when the fresh match is already complete with the correct scorecard link would finish the story and neutralize finding 3's churn in the common `slope validate` re-run path.

### 5. LOW — duplicated document construction and a `version` asymmetry
`src/cli/roadmap-source-store.ts:220-233` (invariant `expected`) and `:245-258` (fallback `nextText`) are near-identical 12-line object builds; extract one helper. They also disagree on `version`: the invariant uses `freshOwner.document.version` while the fallback hardcodes `1` (inherited from legacy). Equivalent today because the parser constrains version, but the asymmetry is exactly the kind of drift a shared helper prevents.

### 6. INFO — raw `s.id === sprint` matching survives against the *compiled* roadmap (out of scope, recommend follow-up)
No source-level raw matching remains, but the same decimal/encoded identity hazard class exists at e.g. `src/cli/sprint-resume.ts:262`, `src/cli/commands/sprint.ts:1123`, `src/cli/commands/retro.ts:351`, `src/cli/commands/now.ts:105`, `src/cli/commands/review-state.ts:269`, `src/cli/commands/auto-card.ts:173`, `src/cli/commands/agent.ts:352` — all `roadmap.sprints.find(s => s.id === n)` against the compiled projection, which retains encoded ids like `235`. `roadmapIdsEqual` is currently private to `src/core/briefing.ts:217`. Recommend a follow-up sprint that promotes it to `src/core/roadmap.ts` exports and migrates these sites, so the codebase has one identity idiom instead of three (raw `===`, order-value equality, label-string equality).

### 7. INFO — import/export hygiene and release-tier implication
`src/cli/roadmap-source-store.ts:22` imports the patcher directly from `'../core/roadmap-source-patch.js'` while every sibling core import goes through `'../core/index.js'`; pick one (if the barrel export exists for the CLI, use it). Separately: the barrel export of `patchRoadmapSourceSprintText` + the new `reformatted` result field are **new public core API** — per `.claude/rules/release-policy.md` that pushes the next release toward **minor**, even though the commits are `fix:`-typed. Flag this when running `slope version recommend`.

## Required Fixes

1. Finding 1 (before merge): make the patcher decline flow-style/non-empty `scorecards:` sections so the fallback engages; add a regression test with `scorecards: { ... }` asserting `reformatted: true` rather than a thrown parse error.

Findings 2-5 are recommended but non-blocking; 6-7 are follow-up/process notes.

## What Was Verified

- 36/36 tests pass across `tests/core/roadmap-source-patch.test.ts` and `tests/cli/roadmap-sources.test.ts`.
- Empirical probes (temporary test file, removed after use): flow-style scorecards duplicate-key failure; trailing-comment loss on scorecard replacement; byte-identical idempotent status re-patch; quoted-`#` status edge; correct insertion when `scorecards:` is followed by another top-level section.
- Consistency audit of every scorecard-map consumer and every sprint-identity comparison touching roadmap sources.
