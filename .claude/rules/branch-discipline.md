# Branch Discipline

ALL changes go through branches. No exceptions — not even chores or docs.

## Branch naming

| Type | Branch pattern | PR required |
|------|---------------|-------------|
| Sprint work | `feat/<description>` or `feat/S{N}-<description>` | Yes |
| Bug fix | `fix/<description>` | Yes |
| Chore / cleanup | `chore/<description>` | Yes |

Branch names: lowercase, hyphen-separated. Sprint number prefix is optional.

## Hard rules

1. **NEVER commit directly to main or master**
2. **NEVER push to main or master without a PR**
3. **Check current branch BEFORE first commit** — if on main, create a branch first
4. **Unrelated fixes get their own branch** — don't bundle

## Multiple sprints in flight (stacked PRs)

Sequential sprints naturally produce a stack — PR 2 based on PR 1's branch. GitHub and
squash-merging fight this, so prefer **one phase branch** with per-sprint commits reviewed as a
single PR. That keeps sprint granularity in history and avoids everything below.

If you do stack PRs, all three rules apply or you will lose work:

1. **Merge the base with a merge commit, never squash.** Squashing rewrites history, so every
   dependent PR immediately conflicts against `main` even when it is a strict superset of what
   just merged.
2. **Never `--delete-branch` a base that has dependents.** Deleting it *closes* the dependent PR, and
   a closed PR cannot be retargeted (`Cannot change the base branch of a closed pull request`).
   Its `Closes #N` trailers never fire, so fixed issues stay open with their code already on `main`.
3. **Merge strictly in order**, retargeting each dependent to `main` before merging it.

Also: `sprint-completion` infers the sprint from the branch name, so a branch carrying several
sprints is refused once state advances past the first — `State: Sprint 250; branch suggests Sprint 249`.
Name multi-sprint branches after the phase (`chore/phase-56-...`), not a sprint.

Each PR also needs its own scorecard **and** its rollover lineage audit present on the branch
being PR'd, not merely somewhere in the stack.

Landing Phase 55-56 as four stacked PRs cost three recoveries to exactly these. See #648.

## Recovery

If you realize you're on main after making changes:
```
git checkout -b feat/<description>
```
Uncommitted and committed work carries forward to the new branch.
