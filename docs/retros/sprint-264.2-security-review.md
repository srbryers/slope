# Sprint 264.2 Independent Security And Correctness Review

- Reviewer: Faraday (`019fa510-9f50-70b2-91f8-f03f2a5ed31e`)
- Lane: Adversarial correctness, security, privacy, and evaluation integrity
- Scope: authority, idempotency, concurrency, verifier independence, filtered
  status, learning integrity, evaluation validity, and recovery
- Final reviewed commit: `3c5073cce06f299e39dbd193fef72398919cc753`
- Final verdict: APPROVED

## Review Rounds

| Reviewed commit | Result | Findings |
|---|---|---:|
| `e2a43de4e1ae899e41bfb2769bc54be0d173a343` | Changes requested | 14 |
| `be1b60156a5b8e436af70e11e64f28d54b7af3aa` | Changes requested | 6 |
| `83cd66f20a5494c4502eac1ea6f120a81c57dc8b` | Changes requested | 7 |
| `5bc1469dcf8bebffc327c5d2cdb71c5384656aa4` | Changes requested | 2 |
| `51f86f11c2f377c5b0cf5c912cef9a7b49f315c9` | Changes requested | 1 |
| `8fcce6badcf818e1b2ad0a311565654382ecbaa9` | Changes requested | 1 |
| `3c5073cce06f299e39dbd193fef72398919cc753` | Approved | 0 |

## Findings And Resolution

The initial review requested fourteen changes:

1. Callback completion was not unique per obligation. Resolved with durable
   execution-spell and callback-obligation identity.
2. Late contribution could race approval. Resolved with one locked compound
   mutation and approval invalidation.
3. Collection could close over unfavorable live trials. Resolved with a sealed
   census and complete terminal reconciliation.
4. Callback delivery omitted recipient and destination identity. Resolved with
   per-recipient, destination, and channel idempotency.
5. Verifier independence lacked hostile tests. Resolved with conflict-root and
   principal-control attack cases.
6. Learning merge and split lacked integrity. Resolved with one-event topology
   operations and ordered locks.
7. Duplicate wrappers could inflate recurrence. Resolved with stable occurrence
   identity separate from evidence identity.
8. Status could report false health. Resolved by computing health from the full
   authoritative signal set before filtering.
9. Filtered views could misstate coverage. Resolved with safe health classes
   and non-enumerating filtered projections.
10. Trial reuse lacked deterministic compatibility. Resolved with sealed
    compatibility fields and reuse proofs.
11. Corpus selection permitted cherry-picking. Resolved by sealing sampling
    frame and corpus draw.
12. Learning could contaminate treatment. Resolved with campaign quarantine
    unless adaptation is the treatment.
13. Arm budgets omitted coordination and retry boundaries. Resolved with
    workers, coordinator, retries, verifiers, cached tokens, and shared costs.
14. Analysis reproduction was underspecified. Resolved by pinning executable,
    dependencies, RNG, numeric semantics, precision, rounding, and vectors.

The first re-review requested six changes:

1. Slot decisions could directly approve an epoch. Resolved with a separate
   quorum reducer.
2. Compound transitions still implied event batches. Resolved with one
   authoritative compound primary event.
3. Evaluation idempotency included aggregate version. Resolved with S264.1
   identity and request-hash conflict checks.
4. Evidence lacked complete terminal paths. Resolved with explicit terminal
   evidence dispositions.
5. Assignment restart was undefined. Resolved with new execution spells and
   callback obligations.
6. Unchanged-byte rejection lacked appeal. Resolved with an independently
   authorized successor verification epoch.

The second re-review requested seven changes:

1. Learning report acceptance still implied a hidden batch. Resolved with
   `learning.report_accepted.v2` as one compound event.
2. Principal was incorrectly part of idempotency identity. Resolved with
   cross-principal conflict against the exact S264.1 key.
3. Assignment compound transitions were missing from the strict registry.
   Resolved by registering handoff, recovery, and abandonment transitions.
4. Evidence timeout lacked narrow recovery. Resolved with
   `evaluation:evidence_recover` and sealed loss policy.
5. Trial and attempt evidence could diverge. Resolved with one trial-owned
   compound disposition.
6. Historical completion could hide active work. Resolved by ranking active
   execution before non-actionable history.
7. The reducer could dispute before readiness. Resolved with sealed slot-set
   readiness and a deterministic no-op.

The third re-review requested two changes:

1. Version 2 hash construction was self-referential. Resolved with the
   cycle-free digest DAG and per-aggregate chain links.
2. Authorization entries were not replayably bound to transitions. Resolved
   with declared obligations, target commitments, policy decisions, principal
   context, and separation-of-duties proofs.

The fourth re-review found one race: one timed-out epoch could receive multiple
different-key dispositions. Resolved with a unique per-epoch disposition
aggregate and one compare-and-set transition from `undisposed`.

The fifth re-review found one authority overreach: a failure-only principal
could allocate a retry. Resolved with separate `evaluation:fail` and
`evaluation:retry_allocate` obligations, policy-controlled separation of
duties, and hostile S272-2 tests.

The final exact-head review found no remaining P1 or P2 security or correctness
findings and confirmed all earlier remediations remained intact.

## Residual Risks

Implementation must prove database uniqueness and compare-and-set behavior,
crash atomicity, canonical lock ordering, cross-adapter golden vectors,
multi-principal authorization, and concurrent budget and resource accounting.
Recovery-sweeper liveness and deployment-specific privacy timing also require
runtime evidence.

## Verification

The final adversarial review approved exact contract commit `3c5073c`. All 31
security findings are recorded as resolved in the SLOPE review ledger. Modular
roadmap source validation and compiled projection checks passed. The complete
repository test, typecheck, and production-build gate is rerun on the final PR
head before merge.
