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

## Trust And Attribution Identities

SLOPE MUST keep authentication, attribution, execution, role, authority, and
visibility separate.

| Field | Meaning | Trust property |
|---|---|---|
| `principal_id` | Authenticated human, service, or agent-controller identity | Root for authorization and independence checks |
| `actor_id` | Durable performance identity attributed across rounds | Bound to one principal at an authoritative time |
| `session_id` | Ephemeral process, conversation, or harness lifetime | Bound to a principal and actor for its lifetime |
| `role` | Function performed for a round, attempt, or shot | Context only; grants no authority by itself |
| `contributors` | Actors with material input to a shot owned by another actor | Attribution only; does not duplicate ownership |
| `verifier` | Actor that evaluated specified evidence | Attribution plus policy result, subject to principal independence |
| `authority` | Explicit capabilities granted in scope | Deny by default and never inferred from role text |
| `visibility` | Explicit audience allowed to read a record or projection | Enforced by the store and filtered views |

Names, model names, IDE names, branch names, worktree paths, role labels,
session metadata, and user-supplied aliases are presentation data. They MUST
NOT authenticate a principal, grant authority, prove independence, or merge
handicap histories.

### Principal

`principal_id` is the stable trust root used for every authorization decision.
The concrete authentication provider is outside this contract, but every
identity-bearing mutation MUST include:

- the authenticated `principal_id`
- authentication assurance or provenance
- the effective capability and its scope
- the actor and session, when acting through them

A deployment MAY have a local principal backed by an operating-system or
repository credential. "Local" does not mean unauthenticated. Imported legacy
data MAY use an explicitly unverified principal, but an unverified principal
cannot authorize protected operations or satisfy independent verification.

### Actor

`actor_id` is the durable subject of shot attribution and descriptive handicap
history. It is not a session, role, model name, or display alias.

- One principal MAY control multiple actors for distinct durable identities.
- An actor is bound to exactly one principal at an authoritative time.
- Rebinding an actor requires an audited identity-transfer operation and MUST
  NOT rewrite prior rounds.
- Two actors controlled by the same principal remain separate attribution
  identities but are not independent for verification policy.
- Actor aliases MAY change without changing `actor_id`.

Actor history is repository-scoped by default. Cross-repository aggregation
MAY be added only with explicit namespace, consent, and provenance; matching
display names are insufficient.

### Session

`session_id` identifies one ephemeral execution channel.

- A session is bound to one principal and one actor for its lifetime.
- A session MAY perform multiple roles over time, but each role assignment is
  scoped and timestamped.
- Restart, resume in a new harness, or a replacement worker creates a new
  session unless continuity is cryptographically or transactionally proven by
  the authentication layer.
- Session expiry ends liveness, not historical attribution.
- A new session for the same principal or actor cannot become an independent
  verifier of that principal's work.

Worktree and branch observations describe where a session acts. They do not
replace the principal or actor binding.

### Role

`role` describes function, such as controller, implementer, reviewer, tester,
or observer. It MUST be scoped to the round and, where necessary, the attempt,
assignment, or shot.

Role names:

- MUST NOT grant capabilities
- MUST NOT establish ownership
- MUST NOT establish verifier independence
- MUST NOT merge actor histories
- MAY be used as a grouping dimension for descriptive metrics

The role in force at the time of a shot is immutable evidence for that
scorecard version even if the actor later changes roles.

## Shot Parties

Every canonical shot MUST identify one accountable owner:

```text
accountable_owner = {
  principal_id,
  actor_id,
  session_id,
  role
}
```

Ownership transfers MUST be explicit and ordered. The final owner is
accountable for the submitted shot outcome, while prior owners and handoffs
remain in the evidence chain. A handoff MUST NOT erase authorship, hazards, or
causation from an earlier attempt.

`contributors` is a deduplicated set of material contributors. Each entry
identifies principal, actor, session when known, role, contribution kind, and
evidence reference. Contributor presence:

- does not create another shot
- does not split or multiply the team score
- does not make the contributor the accountable owner
- does make the contributor non-independent under policies that exclude
  contributors from verification

A verifier record identifies verifier principal, actor, session, policy,
verdict, evidence references, and authoritative timestamp. Merely recording a
verifier does not make verification valid; the workflow contract determines
principal-aware independence and conflicts.

## Authority

Authority is an explicit, scoped capability decision. At minimum, the domain
distinguishes capabilities to:

- create or join a round
- assign or accept work
- mutate owned work
- transfer ownership
- record hazards or penalties
- verify evidence
- finalize a round
- reopen a round
- read, export, redact, or administer protected records

Capabilities are evaluated for a `principal_id` over a project, sprint, round,
attempt, ticket, resource, or record scope. An actor, session, or role MAY
narrow the effective scope but MUST NOT broaden principal authority.

Delegation MUST identify delegator principal, delegate principal, capability,
scope, limits, expiry, and revocation state. Delegation cannot grant a
capability the delegator does not possess. The S264.1 contract defines the
enforcement and persistence model.

## Visibility

Every identity-bearing event and projection has an explicit visibility policy.
The minimum audiences are:

- `subject`: only the record subject and authorized administrators
- `round`: participating principals for the round
- `project`: authorized repository principals
- `public`: explicitly exportable data

More restrictive project policies MAY refine these audiences. Missing
visibility is deny-by-default, not project-wide.

Authorization applies to fields as well as records. A caller allowed to see
team status is not automatically allowed to see private transcripts, secrets,
raw tool payloads, principal credentials, or hidden evaluator evidence.
Filtered projections MUST preserve enough provenance to distinguish redacted,
missing, and nonexistent data.

## Identity Invariants

- Every accepted mutation resolves to an authenticated or explicitly legacy
  principal.
- Every attributed shot has one durable actor and one ephemeral session or an
  explicit missing-session reason.
- Every session remains bound to one principal and actor.
- Role labels never grant authority or prove independence.
- Authors, contributors, delegators, aliases, and sessions controlled by the
  same principal remain non-independent where policy excludes that principal.
- Visibility and authority are explicit, scoped, and independently evaluated.
- Unknown identity data remains unknown; it is never coerced into a trusted
  default.
