# Portable Sprint Resume

Portable sprint resume lets an agent recreate local SLOPE sprint state on a fresh checkout without syncing another machine's runtime files.

## What Travels

The durable handoff is the tracked resume pointer:

```bash
slope sprint resume --write-pointer
```

By default this writes `docs/backlog/.sprint-active.json`. Commit it with the branch when an active sprint must continue on another machine.

The pointer records:

- sprint number and phase
- source branch and source commit
- roadmap or retro evidence
- active claim pointers and their last evidence
- local-only files that must not be imported

## What Stays Local

The resume pointer deliberately excludes runtime state:

- `.slope/slope.db`
- session locks
- guard metrics
- baselines

Those files are machine-local. A portable resume creates fresh local sprint-state and restores claim pointers only.

## Resuming on Another Machine

After checking out the same branch:

```bash
slope sprint resume --portable
```

The top-level alias is equivalent:

```bash
slope resume
```

Before writing `.slope/sprint-state.json`, SLOPE prints the resume plan, evidence, claim pointers, current branch, and current `HEAD`.

Portable resume refuses unsafe pointers unless `--force` is supplied. Unsafe conditions include:

- the current branch differs from the pointer source branch
- the pointer source commit is not an ancestor of `HEAD`
- roadmap or retro evidence is missing
- the pointer phase conflicts with a completed roadmap sprint
- a different local sprint-state is already active

Use `--dry-run` to inspect inference without changing local files:

```bash
slope sprint resume --portable --dry-run
```

Use `--force` only after reviewing the printed unsafe condition and confirming the replacement is intentional.

## Inference Without a Pointer

When no pointer exists, portable resume infers the sprint from:

1. `--sprint=N`
2. branch name
3. recent git commit subjects
4. pending roadmap sprint
5. latest scorecard plus one

Explicit flags win over inferred values:

```bash
slope sprint resume --portable --sprint=177 --phase=implementing
```

## Common-Issues Mirror

Do not commit `.slope/common-issues.json` as part of portable resume. Common-issues ranking is local runtime memory, and syncing it blindly would mix machine-local observations with durable roadmap or retro facts.

If SLOPE later adds a committed common-issues mirror, it should be a curated artifact with explicit source evidence, last-seen sprint or commit, and validation that rejects stale or conflicting observations. Portable resume should continue to treat local rankings as local-only.
