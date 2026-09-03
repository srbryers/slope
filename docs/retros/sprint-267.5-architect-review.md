# S267.5 Architect Review

**Agent:** workflow-architecture-reviewer
**Lane:** architect
**Model:** opus
**Provenance:** independent review, clean context, instructed to say plainly if the sprint claimed more than it delivered.
**Verdict:** CHANGES REQUIRED. All four applied.

## Findings and disposition

**1. #700 was half closed.** The issue asks for a warning from `slope roadmap compile` **and** `validate-sources`. Only the second shipped: `compileSourcesSubcommand` read `validation.errors` and discarded the warnings. The reviewer dropped an orphan file into this repository and ran all five commands; `compile` printed "Roadmap projection unchanged", exit 0, no warning, which is the reported symptom verbatim. The fix as shipped reached only someone who already suspected a problem, and the scorecard scored the ticket green. **Applied:** `compile` now prints the unregistered-source warnings.

**2. `compile --dry-run` disagreed with `compile`.** The dry-run branch used the loosened semantic comparison while the real write compares exact bytes. On a simulated 1.64.1 projection the dry run said "already current" and the next `compile` rewrote the file, adding the format key and restringifying dependencies. A dry run that lies immediately before a write is the failure the previous sprint in this phase existed to remove. **Applied:** the dry run predicts using the bytes it would write, and distinguishes a content change from a bytes-only rewrite.

**3. `docs/upgrading.md` overclaimed cross-version equality.** Same finding as the code review's third. **Applied.**

**4. #702's second symptom was dropped, not deferred.** The issue reports 1.64.1's `roadmap compile` mutating a source YAML it was not asked to touch. It appears nowhere in the diff, the phase file, the upgrade note or the scorecard, while the scorecard asserts "Closes #702". The reviewer checked it: the checksum of all 60 sources is unchanged across a 2.x `roadmap compile`, so 2.x does not reproduce it. A good answer, previously unrecorded. **Applied:** recorded in `docs/upgrading.md`.

## Assessment of what shipped

**The format key ships zero behaviour today.** The branch needs an explicit differing format, 2 is the only value ever written, and pre-key files return null by design. It first fires when a format 3 exists and this binary is the old one. Still the right call for a forward-compatibility key. Two points the sprint did not make: the branch sits inside `if (changed)`, and the S267.5-2 shim makes `changed` false for exactly the 1.64.1 case, so the two #702 tickets can never both act on one file.

**Format 3 fails closed, which is sound.** The shim is gated on both sides parsing to canonical two-space JSON, so any future change to indentation, key order or field set returns null and falls back to drift. It does not silently stop working; format 3 will need its own explicit allowance.

**Blast radius is safe.** Three production callers, all loosening only over semantically identical dependency ids. The integrity boundary is `assertNoProjectionContentLoss`, driven by exact bytes, which the shim cannot reach. No security boundary is weakened. The generated-file tamper claim now tolerates one hand edit, rewriting a numeric dependency to its string form, which is semantically null.

**The manifest false positive is structurally impossible.** `parseRoadmapSourceProject` forces each source kind into `phases/`, `backlog/` or `archive/`, so a registered source can never sit in the manifest's own directory. That dependency now has a comment in `unregisteredSourceWarnings`, since the scan's safety rests on a rule in another file with no test tying them together.

**Warning severity is right and noise here is zero.** 60 sources, 0 unregistered. The scan matches any `.yaml` with no ignore mechanism, so a deliberately kept `phases/_template.yaml` would be permanent noise. Carried forward, not fixed.

**Scorecard attribution was inverted.** Both misses were for over-reaches caught and fixed before shipping, on tickets whose code is fine, while both greens sat on the tickets carrying the real gaps. Candid about internal mistakes and quiet about delivery limits, which is the more flattering error. **Applied:** the misses now sit on S267.5-3 and S267.5-4.

## Tool results

Build clean. `roadmap validate-sources` exit 0 with 0 unregistered warnings. `compile --check` current. `roadmap validate` exit 0, flagging `S267.5 marked complete but no shipped commits found on main`, which is expected pre-merge. Source-mutation check: md5 of all 60 sources unchanged across `roadmap compile`. 74 targeted tests passing.
