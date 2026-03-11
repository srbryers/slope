# Commit Discipline

**Commit early, commit often.** Lost context from uncommitted work is the #1 risk.
The last push is the recovery point — everything since the last push is lost on crash or context loss.

> **Where to commit:** See `branch-discipline.md` — all work goes through feature branches, never directly on main.

## Commit triggers:

Commit immediately after ANY of these:
1. **Each new file** — route, migration, config, component, test. Don't batch file creations.
2. **Each endpoint or feature** — one feature implemented = one commit.
3. **Each migration** — commit each separately.
4. **Each doc update** — spec change, README edit.
5. **Each bug fix** — no matter how small.
6. **Before switching context** — moving to a different area? Commit first.
7. **Before risky operations** — large refactor, dependency upgrade.
8. **Time check** — if ~15 minutes have passed since the last commit, commit what works.
9. **Session end** — never leave uncommitted changes. Use a `wip:` prefix if incomplete.

## Push triggers:

Push immediately after ANY of these:
1. **After each completed ticket (Post-Shot Routine)** — all commits pushed before merging. Score the shot.
2. **Every 30 minutes** — never go longer without a push.
3. **Before context compaction** — if context is running low, push first.
4. **Before switching tickets** — push current branch before starting a new one.
5. **Session end** — never leave unpushed commits.

## Commit message format:

```
<type>(<ticket>): <short summary in imperative mood>

<optional body explaining why, not what>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `wip`
