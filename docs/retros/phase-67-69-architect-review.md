# Phases 67-69 Architect Review

Two independent passes ran. The second overturned the first on its headline finding, so the second is the one to trust.

| Pass | Model | Verdict | Outcome |
|---|---|---|---|
| 1 | sonnet | APPROVED WITH FIXES (4) | applied in 3d4dc38, then partly reverted |
| 2 | opus | CHANGES REQUIRED (7) | applied here |

Pass 1 ran on sonnet only because two opus attempts failed on server-side 529. It is recorded rather than discarded, because the sequence is the finding: a weaker reviewer produced a confident, specific, wrong instruction that then sat in a sprint note an implementer would have followed.

## What pass 2 overturned

**Pass 1's headline fix was a category error.** It told implementers that scoping the comment fix as "round-trip through the yaml document API" risked rebuilding the surgical patcher that already exists. That conflates two different write paths. The patcher (`src/core/roadmap-source-patch.ts`) handles the line-level status edit and preserves comments. The Document API is exactly what the two whole-document sites need, and the archive manifest site at `roadmap-source-store.ts:660` has no patcher to rebuild at all. Checked directly against yaml 2.8.2: `parseDocument` preserves leading and inline comments through an edit.

Had pass 1's wording shipped, an implementer would have tried to extend a line-based patcher to the document shapes it was written to decline, or declined to write anything.

**Pass 1 stopped one step short of its own correction.** It found that `agent.ts:147-168` already reads durable `ticket_done` events, then left S277-1 adding a new table with migrations in both backends as the root dependency of three other tickets. Nothing established the events table is insufficient: it exists in both backends, is indexed on `ticket_key`, and has `insertEvent` and `getEventsBySprint` on the store interface. The most expensive ticket across three phases was possibly unnecessary, and three tickets carried a fabricated dependency forcing serial execution.

**Pass 1's own retarget created a gap.** Narrowing S278-2 to a display label closed the label defect and dropped #696's explicit ask for a package-manager-aware regression command. No ticket wrote the `regression_passed` gate, so S278's "five-gate path without an override" had no writer to test for gate five.

## Required fixes from pass 2, and disposition

1. **S275 note and S275-1 title rewritten.** They now name the Document API as the fix and warn against extending the patcher, the reverse of what they said. Applied.
2. **S277-1 is now a decision, not an assumed migration.** It asks whether the existing events table suffices and builds a table only if not. Sprint drops from slope 5 to slope 4, since the driver-sized migration is contingent. Applied.
3. **S278 gains a regression-gate writer** as its own ticket, reusing `sprint-completion.ts:295` test-runner detection and the exit-code-then-`updateGate` pattern at `:456-470`. Sprint grows to 5 tickets, par 5. Applied.
4. **The second bun hardcode is in scope.** `post-push.ts:68` carries `bun test` as an actual command field, not a label. Applied.
5. **S276-4 describes both kinds of upgrade churn**, including that S276-1's new header key is unreadable to older binaries, so the improved message never reaches the reporter's pinned CI. Applied.
6. **S275-3 has a deliverable.** It now extends `--read-only` to compile and complete and records the default decision in the flag's help, rather than being a decision with no artefact. S275-4 depends on it. Applied.
7. **S279-2 covers the whole package.** `prepare` ran only `tsc` while `build` also builds `packages/pi-extension`, which `files` ships, so a PATH-only fix still yields a git-URL install missing content a tarball has. Applied.

Also applied from pass 2's observations: **S276 no longer depends on S275**, which was gating the independent #700 fix behind #706.

## Narrowed by pass 2, worth keeping

S275-2 was substantially already implemented. `validate.ts:178-180` and `roadmap.ts:708-711` already name the rewritten source file and warn on reformat. The genuine gap is narrower: neither names the projection by path, neither says comments were destroyed, and the gate write into `.slope/` is silent. A fixture forcing the reformat path already exists at `tests/cli/roadmap-sources.test.ts:928`, lowering S275-4's cost.

## Left as noted, not fixed here

- All five sprints carry no cross-phase dependency, so ordering is by numbering alone. That places Phase 64 (268-272, five unstarted slope-5 sprints) ahead of user-reported data loss. Raised for the operator rather than resolved by renumbering, since pulling these forward means deferring Phase 64.
- #705 blocks the git-URL pin downstream projects use to consume unreleased fixes, including the fixes in Phases 67 and 68, and is scheduled last.
- S279-3's second half is a real npm install from a git URL rather than a unit test. Club raised to long_iron to reflect it.
- Pre-existing and outside this change: Phases 62, 63 and 65 sit at `in_progress` with every sprint complete; sprints 268-272 have no `status` field; `CLAUDE.md` describes `packages/core` and `packages/cli` while the source lives in `src/core` and `src/cli`, which will misdirect anyone implementing these sprints.

## Checks

Both passes ran `roadmap validate-sources`, `roadmap compile --check` and `roadmap validate`; all exit 0. Sprints 275-279 are unique across 178 sprints, and cycle detection reports none. The only warnings on new content are S277 and S278 carrying five tickets each, matching S273 and S274 precedent and the repo's par formula.
