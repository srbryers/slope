# Sprint 241 Code Review — Implementation Correctness

**Reviewer:** code-implementation-correctness-reviewer (independent correctness lane)
**Branch:** `feat/S241-surgical-roadmap-reconciliation` vs `main`
**Scope:** `src/core/roadmap-source-patch.ts`, `src/cli/roadmap-source-store.ts` (+ CLI wiring, tests)
**Verdict:** **approve-with-notes**

## Summary

The surgical patcher plus semantic invariant is a sound design and I could not
break its core safety promise: in every adversarial input I probed, the file on
disk was either patched correctly or left byte-for-byte untouched. The
`stableJson(reparsed) !== stableJson(expected)` check uses the same parser as
every other consumer, so any semantic damage the patcher could do is caught
before the write — I found **no silent-corruption path**. The #618 identity
matching via `formatRoadmapSprintLabel` against the compiled roadmap is
coherent: `compileRoadmapSources` includes every source's sprints (archives
too), so the encoded-id heuristic evaluates identically for the target number
and each stored id, and label collisions are refused as ambiguous rather than
guessed.

What I did find is a family of **fail-hard-instead-of-fallback regressions**:
document shapes that reconciled fine on `main` (via full rewrite) now abort
with confusing errors. All are safe (no bytes written) but they are behavior
regressions and the errors are misleading.

Both test files pass (36/36) and `pnpm typecheck` is clean. Probes were run
against the real functions and deleted afterwards.

## Findings

### F1 — Medium: flow-style `scorecards:` map breaks reconciliation with a duplicate-key parse error

`src/core/roadmap-source-patch.ts:132` (`upsertScorecardEntry` →
`findTopLevelSection('scorecards')`)

`findTopLevelSection` only matches a bare `scorecards:` line
(`^scorecards:\s*(#.*)?$`). When the section is authored flow-style —
`scorecards: { "6": docs/retros/sprint-6.json }` or `scorecards: {}` — the
section is "not found" and `upsertScorecardEntry` appends a **second**
top-level `scorecards:` block. The invariant reparse then throws the raw YAML
error instead of falling back:

```
phase-01.yaml: YAML parse error: Map keys must be unique at line 16, column 1
```

Confirmed end-to-end: `completeRoadmapSourceSprint(cwd, 7, { scorecardPath:
'docs/retros/sprint-7.json' })` on a block-style sprints doc with
`scorecards: { "6": ... }` hard-fails (file untouched). On `main` this input
reconciled via the full rewrite. Note the sprint entries being block-style is
exactly what lets the patcher proceed past its flow-entry guard, so this is a
realistic authored mix.

**Fix:** make `upsertScorecardEntry` return a success flag and have
`patchRoadmapSourceSprintText` return `null` (→ canonical-rewrite fallback)
when the scorecards section exists but is not a patchable block mapping.
Detecting "a top-level line starting with `scorecards:` exists but did not
match the section pattern" is sufficient.

### F2 — Medium-low: empty/comment-only `status:` values produce invalid YAML, then a hard failure

`src/core/roadmap-source-patch.ts:120-124` (`patchStatusLine` replacement)

`status:` with no value is valid YAML (parses as absent status, accepted by
`parseRoadmapSourceDocument`). Two variants misfire:

- `status:` (no trailing space): group 1 captures `    status:` with no
  separator, producing `status:complete` — invalid YAML
  (`Implicit keys need to be on a single line`). Hard failure, confirmed
  end-to-end via `completeRoadmapSourceSprint`.
- `status: # promoted later`: the greedy `\s*` in group 1 eats the separator
  space and the comment becomes group 3, producing
  `status: complete# promoted later` — the `#` glues to the scalar, status
  parses as `"complete# promoted later"`, and the invariant rejects the write
  with the misleading "would change more than the targeted sprint entry".

Both reconciled fine on `main`. **Fix:** ensure a separator after the colon and
before any comment, e.g. build the line as
`` `${indent}status: ${status}${comment ? ` ${comment.trimStart()}` : ''}` ``
from a regex like `^(\s*status:)\s*([^#]*?)(\s*#.*)?$`.

### F3 — Low: invariant false positive from path-normalization asymmetry

`src/cli/roadmap-source-store.ts:208,230` vs `src/core/roadmap-sources.ts:323`

The expected document records the new scorecard as
`normalizeDiagnosticPath(options.scorecardPath)` (backslash swap only), but the
reparsed side goes through `normalizeRoadmapSourcePath` (trim,
`posix.normalize`, `./` strip). Any input where the two differ triggers the
"would change more than the targeted sprint entry" error even though the patch
was perfect. Confirmed: `scorecardPath: './docs/retros/sprint-7.json'`
hard-fails; so does a legal filename containing a hash
(`docs/retros/sprint #7.json`, unquoted scalar truncates at ` #`). Both worked
on `main` (rewrite path lets `stringify` quote and the loader normalize). The
CLI mostly pre-normalizes via `displayPath`, but the `#`-filename case is
reachable from `slope roadmap complete --scorecard=...`, and
`completeRoadmapSourceSprint` is exported API.

**Fix:** compute the expected value with `normalizeRoadmapSourcePath`, write
that normalized value into the YAML, and decline the surgical path (return
`null`) when the value would need YAML quoting (contains ` #`, leading
indicator chars, etc.) — or always write it double-quoted.

### F4 — Low: replacing an existing scorecards entry drops its trailing comment

`src/core/roadmap-source-patch.ts:141` (`upsertScorecardEntry` replacement)

`lines[index] = ...` rebuilds the whole line from indent + key + path, so
`  "7": docs/retros/old-7.json # reviewed by SB` loses `# reviewed by SB`.
Semantics unaffected (invariant passes), but it violates the module's stated
"leave every other byte untouched" contract. Confirmed by probe. **Fix:**
capture and re-append a trailing `\s*#.*` suffix.

### F5 — Low (edge): anchors on the status value are destroyed

`patchStatusLine` replaces the entire value region, so `status: &st planned`
becomes `status: complete`, and any `*st` alias elsewhere dangles → raw
"Unresolved alias" error surfaces instead of a fallback. Confirmed by probe;
safe (nothing written) and vanishingly rare in these documents. Acceptable to
leave, but F7's fix would absorb it.

### F6 — Info: dead mutation `location.blockEnd += 1`

`src/core/roadmap-source-patch.ts:124`. After `patchStatusLine` runs,
`location` is never read again (`upsertScorecardEntry` recomputes its own
section on the mutated lines). Harmless and arguably good defensive hygiene if
future code reuses `location` — flagging so it isn't mistaken for load-bearing.

### F7 — Info (design): reparse failures should demote to the fallback rewrite

F1, F2, and F5 all share one shape: the patcher "succeeds" textually, then
`parseRoadmapSourceDocument(patchedText, ...)` at
`src/cli/roadmap-source-store.ts:220` throws a raw parse error that escapes
`completeRoadmapSourceSprint` verbatim. Wrapping the reparse in `try/catch` and
treating a parse failure as "not surgical" (set `reformatted = true`, use the
canonical rewrite) fixes all three failure modes at zero safety cost — the
fallback output *is* the `expected` document, and post-write federation
validation still runs. The deliberate hard-throw on a *successful parse that
mismatches* (`stableJson` inequality) should stay as is.

## Verified non-issues (adversarial probes, all clean)

- **Scorecards key prefixes:** `"45"` never matches `"458"`; `"458.1"` never
  matches `"458.11"` (quote backreference + escaped dots anchor correctly).
- **Ticket-level `- id:`/`status:` lines:** never matched — entry matching is
  locked to the first list-item indent, and the status regex is anchored to
  the detected property indent.
- **`Number()` id collapse:** two textual ids `458.1`/`458.10` both map to
  458.1 → 2 matches → declines to fallback; single `458.10` or `7.0`/`007`
  parse identically on both sides.
- **`propertyIndent` RegExp injection:** the captured indent is
  whitespace-only (YAML forbids tab indentation, so such docs never load);
  no metacharacters possible.
- **Block-end math:** entry at end-of-section, end-of-file, and
  no-trailing-newline all patch correctly (status inserted after the `- id:`
  line; order-insensitive invariant passes).
- **Column-0 comment inside the sprints section:** entries after it are not
  found → `null` → fallback; entries before it patch correctly.
- **CRLF preserved; mixed EOLs declined; lone-`\r` (classic Mac) files**
  degenerate to one line, find no section, and fall back.
- **`version: "1"` vs `version: 1`:** `parseVersion` canonicalizes both sides
  to the string `'1'`, so the invariant cannot mismatch on version type.
- **Quoted status values** (`status: "planned"`): replaced with an unquoted
  scalar that parses identically; invariant passes.
- **Section ordering:** `scorecards:` before `sprints:`, comment-only
  scorecards body, and absent scorecards section all upsert correctly.
- **Encoded-id identity (#618):** compiled roadmap includes all source sprints
  (incl. archive kinds), so `formatRoadmapSprintLabel` heuristics are
  consistent between the target number and each stored id across both the
  pre-lock and under-lock loads; label collisions (e.g. literal 23.5 vs
  encoded 235) refuse with the ambiguity error and leave files untouched.
- **`stableJson`:** key-order insensitive on both sides; `undefined` dropped
  symmetrically; `localeCompare` deterministic within a process.

## Required fixes

None blocking merge — no data-corruption or wrong-write path exists, and every
failure mode leaves sources untouched. Strongly recommended before release,
since F1/F2 are behavior regressions against `main` on plausible authored
documents:

1. **F1 + F7:** decline (return `null`) when the scorecards section is not a
   patchable block mapping, and/or catch reparse errors and demote to the
   canonical-rewrite fallback.
2. **F2:** fix `patchStatusLine` separator handling for empty and
   comment-only status values.
3. **F3:** normalize the scorecard path consistently
   (`normalizeRoadmapSourcePath`) on both the written and expected sides.

Test coverage suggestions: add regression tests for flow-style
`scorecards: {...}` + `scorecardPath`, `status:` (empty) and
`status: # comment` entries, and an unnormalized `./`-prefixed scorecard path.
