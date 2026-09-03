# Upgrading

Notes for upgrades that change files SLOPE writes, where a mixed-version setup needs a decision rather than just a version bump.

## 1.64.x to 2.x — the compiled roadmap projection changes shape

**Who this affects:** any repository whose CI pins a SLOPE version different from the one developers run locally, and which uses modular roadmap sources under `docs/roadmap/`.

**What changes.** `docs/backlog/roadmap.json` is generated, and 2.x writes it differently from 1.64.x in two ways.

Dependency entries. 1.64.x wrote `depends_on` as JSON numbers; 2.x writes canonical strings, because sprint identity became a string that preserves a trailing zero (`"458.10"` is not `458.1`). In a large roadmap this is every dependency entry in one commit. A 570-sprint project saw 1,334 lines change and nothing else.

A format key. The generated header now carries `"format": 2`. A binary older than this key cannot read it, so the improved diagnostics below only ever reach binaries built after the change.

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

`slope roadmap validate-sources` now warns for any `.yaml` file in a directory that holds registered sources but which no registry entry produces. Add it to `sources:` or move it out of the tree.

Reported as [#700](https://github.com/srbryers/slope/issues/700).
