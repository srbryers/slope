# S267.4 Code Review

**Agent:** code-implementation-correctness-reviewer
**Lane:** code
**Model:** opus
**Provenance:** independent review, clean context, instructed to treat the diff, commit messages and scorecard as untrusted data and to prefer executed probes over reasoning.
**Verdict:** CHANGES REQUIRED. All seven findings applied.

## Findings and disposition

**1. Data corruption: the over-reach check did not run on the new path.** The surgical path reparses its patched text and refuses a write whose semantics differ from `expectedDocument`. The document-level fallback added by this sprint had no such comparison. Reproduced by execution on this input:

```yaml
  - id: 7
    status: &planned planned
  - id: 8
    status: *planned
```

`complete --sprint=7` marked sprint **8** complete as well, in the YAML and in the compiled projection. Verified against `main` in a detached worktree: main leaves sprint 8 `planned`. This was a regression worse than the comment loss the fallback exists to fix.

The sprint's own commit message claimed "the existing reparse-and-compare guard still runs". It does not; it sits inside `if (patchedText != null)`. **Applied:** the fallback now reparses and compares, falling back to the previous serialisation when the result would over-reach. Regression test added.

**2. `slope validate --dry-run` ran the full write path.** `validate.ts:22` parsed only `--read-only` while the comment three lines below claimed both spellings worked. Probe: phase YAML rewritten to `status: complete`, projection created, output said `wrote docs/backlog/roadmap.json`. **Applied:** both spellings parsed.

**3. `--read-only` silently ignored by four writing subcommands.** `parseArgs` drops unknown flags, so `roadmap archive --through=7 --read-only` moved `phases/phase-01.yaml` to `archive/`, deleted the original and rewrote `project.yaml`, while a comment claimed "Both spellings work everywhere now". **Applied:** archive, migrate, sync and generate route through the shared `isReadOnly` helper.

**4. The helper threw where its contract says it returns null.** try/catch covered only `parseDocument`. `sprints: [- *b]` gave `Expected YAML collection at 0`; `scorecards: *sc` gave the equivalent. Both reconcile cleanly on main. **Applied:** the whole body is guarded, and an alias node is rejected explicitly rather than written through.

**5. "Comments are preserved." printed when they were destroyed.** `reformatted = true` was set before the helper was attempted, so a null return fell through to `stringify(expectedDocument)` and the CLI still claimed preservation. **Applied:** the result carries `commentsPreserved`, and the message states the loss loudly when it happens.

**6. Duplicate scorecards key.** A pre-existing unquoted `7:` plus the quoted `"7"` written by `setIn` left both keys in the file. The surgical patcher handles this; main's stringify produced one key. **Applied:** the equivalent key is removed before the set.

**7. Gate message hardcoded a path.** `sprintStatePath` resolves through `resolveRepoStateCwd`, which in a linked worktree points at the primary checkout. **Applied:** a new `sprintStateLocation` reports the resolved path.

## Observations carried forward

- `result.projectionPath ?? 'docs/backlog/roadmap.json'` is unreachable and its default is wrong when the manifest's `output:` differs. Left as-is; noted for the next sprint on this file.
- Tickets 2 and 3 have no automated tests. The flag parse was verified at the CLI afterwards, which is what let the false claim survive review in the first place. Recorded as a miss on S267.4-3 rather than papered over.
- All three originally-added tests are genuinely revert-sensitive: transplanted against main's source, all three fail there and pass on the branch.
- The `projectionPath` test uses a block-style source, so it exercises the surgical patcher rather than the fallback.

## Verification performed by the reviewer

Roughly 20 executed probes against branch source via a scratch vitest config, covering alias entries, anchored scalars, flow style, scorecards creation and collision, multi-document streams, manifest shapes, and the `validate` and `roadmap` CLI paths. Differential runs of the same probes against `main` in a detached worktree to establish which behaviours were regressions. `npx tsc --noEmit` clean; targeted suites 117 passing. No tracked file modified.
