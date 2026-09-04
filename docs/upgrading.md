# Upgrading

Notes for upgrades that change files SLOPE writes, where a mixed-version setup needs a decision rather than just a version bump.

## 1.64.x to 2.x — the compiled roadmap projection changes shape

**Who this affects:** any repository whose CI pins a SLOPE version different from the one developers run locally, and which uses modular roadmap sources under `docs/roadmap/`.

**What changes.** `docs/backlog/roadmap.json` is generated, and 2.x writes it differently from 1.64.x in two ways.

Dependency entries. 1.64.x wrote `depends_on` as JSON numbers; 2.x writes canonical strings, because sprint identity became a string that preserves a trailing zero (`"458.10"` is not `458.1`). In a large roadmap this is every dependency entry in one commit. A 570-sprint project saw 1,334 lines change and nothing else.

A format key. The generated header now carries `"format": 2`. An older binary reads the file without complaint, because it strips the whole generated header before comparing, but it cannot act on the key. So the improved diagnostics below reach you when your pin moves, not before.

**What you will see.** Before this release, each version accepted its own output and rejected the other's, reporting `Roadmap projection drift` and advising you to run `slope roadmap compile`. That advice could not work: recompiling with the newer binary produced a file the pinned one rejected again.

Two things improve that now.

`roadmap compile --check` distinguishes a version mismatch from real drift and says which format is on disk, rather than blaming your working tree.

The comparison also normalises dependency ids on read, so a numeric entry compares equal to its canonical string form. Two limits are worth stating plainly.

It does not help a trailing-zero id. A sprint authored `"458.10"` was written by 1.64.1 as the number `458.1`, and that is genuinely a different id, so drift is still reported. That is the right answer, and it is also the exact id shape canonical sprint identity exists for, so it is not a rare case in a project that uses decimal inserts.

It only runs in a binary that has this code. A CI pinned at 1.64.1 does not, so the improvement reaches you when the pin moves, not before.

**What to do.**

If everything runs the same version, upgrade normally. Expect one large diff on `docs/backlog/roadmap.json` the first time you compile.

If your CI pins an older version than you run locally, either align the pin, or compile with the pinned binary as the last step before committing. `slope roadmap archive` only exists on 2.x, so compacting a roadmap on a pinned repository means archiving with 2.x and then recompiling with the pin.

**The source-mutation symptom.** #702 also reports that 1.64.1's `roadmap compile` rewrote a source YAML it was not asked to touch, converting dependency numbers to strings, after which its own `compile --check` failed on the projection it had just written. 2.x does not reproduce this: the checksum of every source file is unchanged across a `roadmap compile` run. Nothing was changed for it, because there is nothing to change here; the fix for anyone still on 1.64.1 is to move the pin.

Reported as [#702](https://github.com/srbryers/slope/issues/702).

## Unregistered roadmap sources are now reported

`docs/roadmap/project.yaml` carries an explicit `sources:` registry. It is not a glob. A `.yaml` file dropped beside registered ones compiled to nothing, with exit 0 and no warning, so freshly authored sprints could sit inert while looking tracked.

Both `slope roadmap compile` and `slope roadmap validate-sources` now warn for any `.yaml` file under `phases/`, `backlog/` or `archive/` that no registry entry produces. `compile` is where this bites, so the warning appears there even when the projection is unchanged. The file is named in the form `sources:` wants, so the fix is to paste it in, or move the file out of the tree.

Reported as [#700](https://github.com/srbryers/slope/issues/700).

## `slope ticket done --commit` now refuses a value git cannot resolve

**Who this affects:** anyone scripting `ticket done` with a commit value that is not resolvable in the working repository. This is a behaviour change, and it exits 1 where the command previously exited 0.

**What changed.** The flag used to be stored verbatim while the no-flag path resolved `HEAD` properly. So `--commit=HEAD` became permanent completion evidence pointing at a moving reference, and a typo became permanent evidence pointing at nothing. Explicit values now go through `git rev-parse --verify <value>^{commit}`, so an abbreviated SHA expands to 40 characters and a tag or branch resolves to the commit it names.

Three cases that used to succeed now fail:

- A value git cannot resolve, including a typo and a SHA fetched from another repository.
- Any explicit value in a shallow clone that does not contain the named commit. CI checkouts using `fetch-depth: 1` are the common case.
- Any explicit value outside a git work tree, or where `git` is not on `PATH`. The old behaviour recorded the raw string under a warning that said no SHA had been attached, which contradicted itself.

Nothing is written when the value is refused, and the ticket's claim is not released, so the command can be re-run once the value is right.

**What to do.** Pass a commit-ish the local repository can resolve, or omit the flag and let it use `HEAD`. In shallow CI, either deepen the fetch or drop the flag.

**If evidence is already wrong,** `slope ticket repair <key> --commit=<sha>` corrects it. Repair needs no claim, because `ticket done` released it, and records a superseding entry rather than editing history. `slope ticket show <key>` prints what is currently recorded.

Reported as [#698](https://github.com/srbryers/slope/issues/698).

## Next-ticket answers now depend on actor identity

**Who this affects:** anyone parsing `slope now --json` or `slope agent status --json`, and anyone running more than one agent against a single repository.

**What changed.** `slope now`, `slope agent status` and compact `slope roadmap status` used to answer "what next" three different ways. They now share one rule: your own unfinished claim first, then the first unfinished ticket nobody has claimed, then a reason saying whether the rest is held by others or genuinely done.

Two JSON shapes changed with it.

`slope now --json` previously omitted `nextTicket` when the sprint had nothing to start. It is now always present and `null` in that case, matching `agent status`. Code doing `parsed.nextTicket.key` still throws, but it throws consistently on both surfaces rather than only one.

`agent status --json` gains `nextTicketReason` (`in_flight`, `available`, `all_claimed`, `all_complete`, `no_tickets`) and an optional `ledgerError`. `slope now --json` gains `tickets: { total, completed, status }` and the same optional `ledgerError`. `AGENT_STATUS_VERSION` stays at 2, because these are additions rather than removals.

**The identity limitation, stated plainly.** "Your own claim" is decided by player name, which is the identity model the rest of SLOPE already uses: `slope ticket done` finds your claim the same way. Claims carry a `session_id` column, but `slope claim` does not populate it, so name is the only discriminator available.

The consequence: two agents on one machine, in one repository, with no explicit identity, both resolve to the same name (from `SLOPE_ACTOR`, `SLOPE_PLAYER`, a configured team actor, `USER`, `USERNAME`, then `git user.name`). Each then reads the other's claim as its own work in flight.

**What to do** when running more than one agent against a repository: give each a distinct identity. Set `SLOPE_ACTOR` per agent, or pass `--actor=<name>`, which `now`, `agent status` and `roadmap status` all accept now for parity with `claim` and `ticket done`. A single agent needs no change.

Tracked as [#715](https://github.com/srbryers/slope/issues/715).
