# S267.7 Independent Review Findings

Four passes at opus tier, each with clean context, given the branch diff as untrusted data and told to verify against the repository rather than believe comments or commit messages. Both reviewers ran the built CLI in throwaway repos.

| Pass | Blockers | Should-fix | Nits |
|---|---|---|---|
| Code review | 1 | 5 | 5 |
| Architect review | 0 | 5 | 7 |

Counts overlap; a defect both found is listed once. All thirteen distinct findings were applied.

## The Blocker, And Its Two Follow-On Faults

**Gates recorded mid-phase, so the boundary opened on a phase that was not finished.** `slope validate`, `card` and `map` run every sprint under the post-hole routine. Nothing checked whether the phase was done, so from a phase's first scorecard onward all five gates could go true.

The code reviewer reproduced it on a three-sprint phase with one sprint scored: every gate flipped, `phase status` printed COMPLETE, and the boundary guard went from `deny` to silent for a sprint two phases later. Sprints 2 and 3 were never played. The architect found the same thing already true in this repository: `.slope/phase-cleanup.json` held a Phase 68 gate earned at a commit behind HEAD.

Before this sprint the gates were unreachable, which was #696. The first fix made them reachable by ordinary hygiene, which was worse.

The fix took three attempts, and the reviewers caught two of them:

1. Resolving from the current sprint recorded against the **next** phase, because after a phase closes the current sprint is already the first sprint of the one after. Caught by the workflow test, before review.
2. Resolving from the latest scorecard broke in two further ways the code reviewer demonstrated. Once the next phase had one scorecard, everything recorded there and the phase being closed got none. And one recovery scorecard outside every phase, read as the highest sprint number, silently vetoed all recording with no message.
3. Requiring a scorecard from every sprint in the phase used `isRoadmapSprintTerminal`, which counts `complete` as terminal, so it excluded exactly the sprints whose scorecards it needed. The code reviewer predicted this from reading the uncommitted tree before it was built, and named the ten superseded sprints across six phases here that it would lock out.

The rule is now one function with the reasoning written beside it: the last phase in roadmap order whose scorable sprints all have scorecards, skipped if already recorded complete.

## Other Findings That Changed Shipped Behaviour

- `validate --sprint=N` and a path argument satisfied a gate meaning every scorecard in the phase is valid. The label had also silently lost the words "for all phase sprints".
- `--clear` left `completed_at` set, so `phase status` printed a pending gate and a completion time together, and the session briefing reported COMPLETE, because it branches on the stamp alone.
- The ledger was per-worktree while config and sprint state are repo-scoped. The architect reproduced the split: a phase complete in the primary checkout read as "nothing recorded yet" inside a linked worktree, and a gate written there was invisible to everything else. `slope loop parallel` runs sprints in worktrees.
- The session briefing parsed the ledger itself instead of calling the shared readers, so it printed raw gate keys rather than the labels naming each command, and sorted phase keys lexicographically, making `["68","7"]` yield `"7"`.
- `slope phase` sat in `CLI_INTERNAL_MODULES`, so `slope help` never listed it. Every gate names one of its subcommands. The registry test cannot catch this class, because the internal-modules list is an allowlist the assertion unions in.
- The phase-boundary guard's blocked options carried gate labels with no runnable command, so the only actionable option was the override.
- `phase regression` split its command on whitespace before handing it to a shell, collapsing any quoted argument, and the banner printed something different from what ran.
- Phase arguments accepted `-1`, `0`, `3.7` and `1abc`, each writing a phantom ledger entry.
- No lockfile returned `npm test`, telling a Python or Go repo to run npm. That is the bun hardcode with a different name on it.
- `slope doctor --fix` and `slope init` both call `mapCommand`, so a repair command and project scaffolding wrote phase-boundary evidence as a side effect. The finished-phase precondition makes this harmless in practice.

## Test Discrimination

The code reviewer mutated a copy of `dist/` and reverted each fix in turn. Six of eight tests discriminated. Two did not, and both are fixed:

- The card filter case used `--player=<nonexistent>`, which exits at "no scorecards for player" before reaching the branch it meant to test, so deleting the guard left it green.
- Nothing covered the implicit phase default at all, which is precisely where the blocker lived.

Seven tests were added, bringing the file to 15.

## Deferred, With Issues Filed

- The configured test command (`LoopConfig.loopTestCmd`) is not consulted; `regressionCommand` reads the lockfile only. #696 asked for "project configuration/package-manager detection".
- Phase gates are bare booleans. Sprint review gates carry `provenance`, `evidence[]`, `reviewer`, `verdict` and `reviewed_commit`, so `slope phase gate` records a flag under an evidence name.
- `phase-cleanup.ts` imports only `node:fs`, `node:path` and one core analyzer. It is core-shaped and sits in `src/cli`, which is why no MCP tool can read phase gates.
- `savePhaseCleanup` uses a fixed `.tmp` name with read-modify-write. Three new writers make a `slope loop parallel` collision likelier. Pre-existing.
