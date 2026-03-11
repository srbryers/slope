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

## Recovery

If you realize you're on main after making changes:
```
git checkout -b feat/<description>
```
Uncommitted and committed work carries forward to the new branch.
