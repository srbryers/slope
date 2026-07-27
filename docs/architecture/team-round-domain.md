# Team Round Domain And Scoring Contract

Status: proposed normative contract for S264-S264.2 and Phase 64

Issue: [#669](https://github.com/srbryers/slope/issues/669)

Research input: [Buzz Multiplayer Collaboration](../research/buzz-multiplayer-collaboration.md)

## Purpose

SLOPE models a multi-agent sprint as one Team Round with one canonical
score-versus-par result and actor-attributed evidence. Parallel execution changes
who owns and contributes to shots. It does not create competing rounds, select a
best agent result, or make individual projections additive.

This document defines the domain and scoring contract. It intentionally leaves
the durable event envelope, transaction protocol, leases, capability
enforcement, workflow callbacks, operating views, and evaluation manifest to
the S264.1 and S264.2 contracts.

The words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are normative.

## Decisions

1. One canonical sprint key identifies one logical Team Round.
2. A round MAY contain multiple execution attempts, but has one accepted
   scorecard projection at a time.
3. The top-level scorecard is the only source of truth for the team result.
4. Every canonical shot has one accountable actor. Contributors and a verifier
   MAY also be attributed without duplicating the shot.
5. Team handicap uses canonical round score versus par. Actor and role
   handicaps are risk-adjusted descriptive estimates with explicit coverage and
   uncertainty. They are not causal rankings.
6. Coordination overhead is reported separately from the canonical score unless
   a future schema and scoring revision explicitly defines a composite.
7. Existing one-player scorecards remain valid as one-actor Team Rounds.

## Contract Boundary

This contract owns:

- sprint, round, attempt, scorecard, shot, participant, and penalty semantics
- round lifecycle and scorecard version rules
- exactly-once finalization and audited reopen behavior
- identity dimensions required for attribution, authority, and visibility
- canonical team scoring and descriptive actor and role estimands
- single-player compatibility and typed shared-resource ownership

This contract does not own:

- event serialization, ordering, idempotency key syntax, or replay algorithms
- lease TTLs, fencing token formats, queues, retries, or dead-letter policy
- concrete authentication providers or capability storage
- assignment, handoff, callback, status-feed, or verifier-gate workflows
- benchmark manifests or multiplayer evaluation procedures

Those details MUST preserve the invariants here.

## Core Identities

| Identity | Meaning | Lifetime | Cardinality |
|---|---|---|---|
| `sprint_key` | Canonical planned-work identity | Stable across the roadmap and every execution | One per planned sprint |
| `round_id` | Logical scored execution of a sprint | Stable for the sprint, including retries and audited reopens | Exactly one canonical round per `sprint_key` |
| `attempt_id` | One execution attempt within the round | Immutable after creation | One or more per round |
| `scorecard_version` | Immutable published projection revision | Monotonically increases after each successful close | Zero while never closed, then `1..n` |
| `shot_id` | Canonical unit of planned work and outcome evidence | Immutable | Exactly once in the canonical scorecard version |
| `penalty_id` | Canonical team-level penalty identity | Immutable | Counted at most once in the team result |

SLOPE MUST use the canonical sprint-key representation delivered by the sprint
identity migration. A display label, floating-point number, branch name, issue
number, or roadmap position MUST NOT substitute for `sprint_key`.

`round_id` is stable across retries because retries are attempts at the same
planned outcome. A new `attempt_id` MUST NOT create another scorecard or reset
prior evidence. A future operation that intentionally supersedes an entire
round is outside version 1 of this contract and requires a new audited policy.

## Attempt Semantics

An attempt records an execution boundary, not a scoring boundary.

- A round starts its first attempt when execution begins.
- A retry, resumed harness, or replacement worker creates a new attempt when
  the prior execution cannot safely continue.
- Accepted shots from different attempts MAY coexist in one final scorecard.
- A retried shot MUST retain causation to the prior attempt and MUST NOT erase
  hazards or penalties that affected the team outcome.
- Evidence from an abandoned attempt remains auditable even when none of its
  shots are accepted into the final projection.
- Attempt-local telemetry MUST NOT be added to team score merely because an
  attempt existed.

The coordination contract will define attempt state transitions and recovery.

## Round Lifecycle

The persisted round lifecycle has three states:

```text
open -> finalizing -> closed
  ^         |
  +---------+

closed --audited reopen--> open
```

### `open`

- Attempts, assignments, shots, hazards, penalties, and verification evidence
  MAY be added according to authority and visibility policy.
- A scorecard view is a draft projection and has no published
  `scorecard_version`.
- A blocked or paused sprint remains open. Operational inactivity does not
  imply closure.

### `finalizing`

- One authorized finalization operation owns the transition.
- Mutations that could change the scorecard projection MUST be rejected or
  serialized behind that operation.
- Required ticket disposition, review, evidence, and scoring invariants MUST be
  checked against one transactional snapshot.
- Failure returns the round to `open` without publishing a new version.

### `closed`

- The canonical scorecard version, its content hash, finalization identity, and
  close timestamp are immutable.
- No event that changes the canonical score, shot set, attribution, penalty
  set, or verification result may be accepted.
- Read models MAY add non-scoring delivery metadata such as a merged PR
  reference, but such metadata MUST be distinguishable from the closed
  scorecard projection.

Roadmap dispositions such as blocked, deferred, superseded, cancelled, skipped,
or absorbed do not mean `closed`. A round closes only through the finalization
contract. A completed roadmap sprint MUST identify its closed round and
published scorecard version.

## Exactly-Once Finalization

Finalization MUST be enforced by the authoritative store, not by a CLI prompt
or client convention.

For one `(round_id, reopen_epoch)`:

1. At most one finalization identity may publish `closed`.
2. The operation reads all score-affecting evidence from one consistent
   snapshot.
3. It validates that every canonical shot and penalty has stable identity and
   appears no more than once.
4. It computes the scorecard with a pinned schema version, scoring revision,
   and projection revision.
5. It atomically persists the closed state, immutable scorecard version,
   content hash, and finalization evidence.
6. A retry with the same scoped idempotency identity and same payload returns
   the existing outcome.
7. Reuse of that identity with a different payload is a conflict.
8. A competing finalizer observes the existing close or fails; it never
   publishes a second version for the same epoch.

The first successful close publishes `scorecard_version: 1`. Every successful
close after an audited reopen increments the version by exactly one. Failed
finalization does not consume a version.

## Late Evidence

An author timestamp is not authority to backdate a mutation.

- Score-affecting evidence received after `closed` MUST be rejected.
- Evidence created before close but delivered afterward is still late.
- A non-scoring audit annotation MAY reference a closed version, but MUST NOT
  alter its projection or masquerade as accepted round evidence.
- Correcting a closed score, shot, attribution, penalty, or verification result
  requires an audited reopen.
- Unknown or missing evidence at close remains explicitly unknown in that
  scorecard version. It MUST NOT be silently filled later.

## Audited Reopen

Reopen is exceptional and capability-gated. It MUST record:

- `round_id`, prior `scorecard_version`, and prior content hash
- a monotonic `reopen_epoch`
- requesting and authorizing authenticated principals
- reason, scope, and referenced late or incorrect evidence
- authoritative timestamp

Reopen changes the same round from `closed` to `open`; it does not delete or
rewrite the prior scorecard. The prior version remains queryable and marked
superseded only by the later published version. New scoring work occurs in a
new attempt when execution is required.

The next finalization applies exactly-once semantics within the new reopen
epoch. Repeated reopen requests with the same identity are idempotent. A reopen
request against a stale version or epoch fails.

## Lifecycle Invariants

An implementation is conformant only if all of these hold:

- There is never more than one canonical `round_id` for a `sprint_key`.
- A retry cannot create a competing team scorecard.
- A closed epoch has exactly one finalization identity and immutable projection
  hash.
- Score-affecting late evidence cannot mutate a closed projection.
- Reopen preserves every prior scorecard version and increments both epoch and
  published version monotonically.
- Protected roadmap dispositions cannot be mistaken for round closure.
- Team result selection never uses best-of-agent, alternate-shot, or duplicate
  per-agent scorecards.
