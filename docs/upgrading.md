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

The comparison normalises dependency ids on read, so a projection written by either version compares equal to one written by the other. This is the half that helps a pinned CI, because it works regardless of which binary wrote the file.

**What to do.**

If everything runs the same version, upgrade normally. Expect one large diff on `docs/backlog/roadmap.json` the first time you compile.

If your CI pins an older version than you run locally, either align the pin, or compile with the pinned binary as the last step before committing. `slope roadmap archive` only exists on 2.x, so compacting a roadmap on a pinned repository means archiving with 2.x and then recompiling with the pin.

Reported as [#702](https://github.com/srbryers/slope/issues/702).

## Unregistered roadmap sources are now reported

`docs/roadmap/project.yaml` carries an explicit `sources:` registry. It is not a glob. A `.yaml` file dropped beside registered ones compiled to nothing, with exit 0 and no warning, so freshly authored sprints could sit inert while looking tracked.

`slope roadmap validate-sources` now warns for any `.yaml` file in a directory that holds registered sources but which no registry entry produces. Add it to `sources:` or move it out of the tree.

Reported as [#700](https://github.com/srbryers/slope/issues/700).
