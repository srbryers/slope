# Sprint 264.2 Architecture Review

- Reviewer: Meitner (`019fa510-82d6-7f03-870b-f93f4d6ecf03`)
- Lane: Collaboration workflow, lifecycle, replay, and runtime ownership
- Scope: assignment, callback, handoff, verification, learning, status,
  compound integrity, and evaluation lifecycle architecture
- Final reviewed commit: `3c5073cce06f299e39dbd193fef72398919cc753`
- Final verdict: APPROVED

## Review Rounds

| Reviewed commit | Result | Findings |
|---|---|---:|
| `e2a43de4e1ae899e41bfb2769bc54be0d173a343` | Changes requested | 9 |
| `be1b60156a5b8e436af70e11e64f28d54b7af3aa` | Changes requested | 4 |
| `83cd66f20a5494c4502eac1ea6f120a81c57dc8b` | Changes requested | 6 |
| `5bc1469dcf8bebffc327c5d2cdb71c5384656aa4` | Changes requested | 4 |
| `51f86f11c2f377c5b0cf5c912cef9a7b49f315c9` | Changes requested | 2 |
| `8fcce6badcf818e1b2ad0a311565654382ecbaa9` | Approved | 0 |
| `3c5073cce06f299e39dbd193fef72398919cc753` | Approved refresh | 0 |

## Findings And Resolution

The initial review requested nine changes:

1. Callback obligations lacked durable identity across repeated execution
   spells. Resolved with monotonic callback obligation IDs and epochs.
2. Handoff violated immutable assignment revisions and acceptance. Resolved
   with successor revision preacceptance, atomic activation, and lease fencing.
3. Verification used undeclared states and could reverse terminal decisions.
   Resolved with separate epoch and slot state machines and immutable terminals.
4. Contribution provenance could fail open. Resolved with producer-proven
   artifacts and complete contribution coverage.
5. Pattern merge and split were not concurrency-safe. Resolved with topology
   locks, ordered aggregate locks, expected versions, and compound operations.
6. Evaluation lifecycle and authorization were incomplete. Resolved with
   campaign, trial, attempt, analysis, and report state machines and
   capability maps.
7. Status precedence and worker aggregation were incomplete. Resolved with a
   total precedence table and authoritative worker aggregation.
8. Evaluation replay and report identity were missing. Resolved with stable
   report lineages, reducer identity, replay inputs, and invalidation.
9. Phase 64 ownership was incomplete. Resolved by assigning every runtime
   guarantee and adversarial test to S268-S272.

The first re-review requested four changes:

1. Compound operations contradicted the one-primary-event append model.
   Resolved by making every atomic workflow operation one compound event.
2. Evaluation idempotency incorrectly included aggregate version in identity.
   Resolved with the exact S264.1 identity and request-hash conflict behavior.
3. Evidence terminal states and capabilities were incomplete. Resolved with
   explicit verified, rejected, and unverifiable outcomes and authorities.
4. Worker status mishandled no-review and verification terminal states.
   Resolved with distinct complete-unverified, waiver, timeout, cancellation,
   and invalidation outcomes.

The second re-review requested six changes:

1. Foreign aggregate transitions lacked their own chain positions. Resolved
   with one link per owner and affected aggregate.
2. Idempotency was principal-scoped and omitted `round_epoch`. Resolved with
   exact S264.1 scope and same-key cross-principal conflict.
3. Callback recovery used inconsistent events and versions. Resolved with a
   strict compound transition registry.
4. Quorum reduction lacked readiness and no-op semantics. Resolved with a
   reduction-input root and deterministic not-ready result.
5. Verification timeout had no recovery lifecycle. Resolved with terminal
   timeout dispositions and successor epochs.
6. Report capabilities were incomplete. Resolved with draft, analyze, verify,
   complete, invalidate, and export authorities.

The third re-review requested four changes:

1. Version 2 hashing was circular. Resolved with a domain-separated digest DAG,
   owner/link bijection, per-link heads, and cross-adapter golden vectors.
2. Failed, timed-out, and cancelled attempts did not reconcile with trials.
   Resolved with trial-owned compound terminal events and closure invariants.
3. Campaign invalidation lacked a complete child-state registry. Resolved with
   transitioned, already-invalidated, and absent child dispositions.
4. Timeout escalation lacked a terminal lifecycle. Resolved with a protected
   escalation aggregate, exact dispositions, expiry, and replay invariants.

The fourth re-review requested two changes:

1. The version 2 authorization set could disagree with S264.1 authorization.
   Resolved by making the singular field an exact projection of one
   schema-designated primary operation entry.
2. Failure and timeout could occur while a trial had no current attempt.
   Resolved by creating attempt 1 and every retry successor atomically.

The final two bounded reviews found no remaining P1 or P2 architecture
findings. The exact-head refresh confirmed that separating failure and retry
allocation authority introduced no architecture regression.

## Residual Risks

Implementation must pin primary authorization ownership in the event schema
and prove atomic multi-principal authorization, digest vectors, attempt
creation, timeout-disposition races, and replay across SQLite and PostgreSQL.
One-sided outcome reporting and overdue escalation recovery remain fail-closed
liveness concerns until the runtime and recovery sweeper are tested.

## Verification

The final architecture review approved exact contract commit `3c5073c`. All 25
architecture findings were recorded as resolved and are persisted as amended
scorecard hazards. Modular roadmap source validation and compiled projection
checks passed. The complete repository test, typecheck, and production-build
gate is rerun on the final PR head before merge.
