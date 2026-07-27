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
| `project_id` | Stable repository or project namespace | Stable across paths, worktrees, remotes, and store backends | One per configured project |
| `sprint_key` | Canonical planned-work identity within a project | Stable across the roadmap and every execution | One per `(project_id, planned sprint)` |
| `round_id` | Logical scored execution of a project sprint | Stable for the sprint, including retries and audited reopens | Exactly one canonical round per `(project_id, sprint_key)` |
| `attempt_id` | One execution attempt within the round | Immutable after creation | One or more per round |
| `scorecard_version` | Immutable published projection revision | Monotonically increases after each successful close | Zero while never closed, then `1..n` |
| `shot_id` | Canonical unit of planned work and outcome evidence | Immutable | Exactly once in the canonical scorecard version |
| `penalty_id` | Canonical team-level penalty identity | Immutable | Counted at most once in the team result |

`project_id` is an opaque durable identifier, not a filesystem path, Git remote
URL, repository display name, or PostgreSQL connection. Moving, forking, or
renaming a checkout does not silently change it. Forking history into a distinct
project requires an explicit new project identity and provenance link.

SLOPE MUST use the canonical sprint-key representation delivered by the sprint
identity migration. A display label, floating-point number, branch name, issue
number, or roadmap position MUST NOT substitute for `sprint_key`.

Every persisted or exported sprint, round, attempt, scorecard, shot, penalty,
resource, and idempotency identity is scoped by `project_id`. Implementations
MAY use globally unique opaque IDs, but uniqueness constraints and lookups MUST
still include or verify the project namespace. Idempotency scope is at least
`(project_id, operation kind, owning aggregate)`; S264.1 defines the complete
scope for each event.

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
- The mutable `draft_scorecard` has no published `scorecard_version`.
- If the round has been reopened, its immutable `latest_published_scorecard`
  remains separately readable with `publication_status:
  stale_due_to_reopen`.
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

### Projection Read Semantics

Every round read distinguishes:

- `draft_scorecard`: mutable evidence projection for the current open or
  finalizing epoch
- `latest_published_scorecard`: highest successfully closed immutable version
- `accepted_scorecard_version`: version eligible for current handicap and
  completion projections, or `null` while never closed or reopened

On first open, both published fields are absent. On close, the new immutable
version becomes both latest-published and accepted. On reopen,
`latest_published_scorecard` remains available for historical and audit reads,
but `accepted_scorecard_version` becomes `null`; current handicap and completion
views exclude that round until it closes again. An explicitly historical
`as_of` query MAY select the version that was accepted at the requested time.

Clients MUST NOT label the stale published version as the current scorecard
during reopen. They present the open draft and the stale prior publication as
separate objects.

## Exactly-Once Finalization

Finalization MUST be enforced by the authoritative store, not by a CLI prompt
or client convention.

For one `(project_id, round_id, reopen_epoch)`:

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
rewrite the prior scorecard. The prior version remains the
`latest_published_scorecard`, is marked `stale_due_to_reopen`, and is no longer
the accepted current scorecard. New scoring work occurs in a new attempt when
execution is required.

The authoritative reopen operation atomically:

- changes round state to `open`
- increments `reopen_epoch`
- clears `accepted_scorecard_version`
- clears completion eligibility for the project sprint
- creates a fresh `draft_scorecard` based on the prior published version

Roadmap and status reads MUST immediately present the sprint as reopened and
not complete. A tracked roadmap source is a denormalized projection: its
recoverable update to an in-progress disposition is part of the reopen
operation and the operation MUST NOT report success until that write is
durable. If reconciliation is interrupted, runtime reads remain governed by the
authoritative reopened state and recovery must finish the tracked projection
before further finalization.

The next finalization applies exactly-once semantics within the new reopen
epoch. Repeated reopen requests with the same identity are idempotent. A reopen
request against a stale version or epoch fails. Reclose atomically publishes
the next version, restores `accepted_scorecard_version`, and restores roadmap
completion eligibility before the tracked projection is reported complete.

## Lifecycle Invariants

An implementation is conformant only if all of these hold:

- There is never more than one canonical `round_id` for a
  `(project_id, sprint_key)`.
- A retry cannot create a competing team scorecard.
- A closed epoch has exactly one finalization identity and immutable projection
  hash.
- Score-affecting late evidence cannot mutate a closed projection.
- Reopen preserves every prior scorecard version and increments both epoch and
  published version monotonically.
- Reopen separates the stale latest-published version from the current draft
  and removes the round from current completion and handicap projections.
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

Actor creation records principal, reason, creation authority, and immutable
lineage. Actors transition from `active` to `retired`; retirement never deletes
history, and a retired identity cannot be silently reused. Creating or selecting
a new actor MUST NOT reset the controlling principal's default performance
history. Principal-level reports aggregate every actor controlled by that
principal during the requested window, including retired actors, while
actor-level reports remain available as narrower descriptive views.

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

- `subject`: principals explicitly listed in
  `visibility_subject_principal_ids`, plus authorized administrators
- `round`: participating principals for the round
- `project`: authorized repository principals
- `public`: explicitly exportable data

More restrictive project policies MAY refine these audiences. Missing
visibility is deny-by-default, not project-wide.

For a record involving several actors or principals, subject visibility is not
inferred from authorship, contribution, verification, or mention. The writer
must supply the complete deduplicated subject-principal allowlist and possess
authority to disclose the record to each member. Field-level policy may narrow
that list further.

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

## Canonical Team Score

The canonical scorecard retains SLOPE's existing team-level interpretation:

```text
round_differential = score - par
```

The versioned scoring revision determines how misses, hazards, and penalties
change `score`. Multiplayer participation does not change the formula:

- The round has one `par`, one `score`, one `round_differential`, and one score
  label.
- Each canonical `shot_id` appears once in the top-level shot sequence.
- A participant projection references canonical shot IDs; it MUST NOT copy
  shots into a second scoring source.
- Agent, actor, session, role, attempt, or assignment subtotals MUST NOT be
  summed or selected to produce the team score.
- A fourball best-of result, foursomes alternate-shot result, or scramble
  best-attempt result is not a SLOPE Team Round.
- Coordination events, token cost, elapsed time, handoff count, and queue time
  are separate operating metrics and do not add strokes by default.

The team handicap remains a rolling descriptive summary of canonical round
differentials under a pinned handicap revision. Scorecards from different
scoring revisions MUST either be migrated through an explicit compatibility
rule or reported in separate strata.

## Accountable Shot Ownership

Each canonical shot contains:

- one `shot_id` and ticket or planned-work reference
- one accountable owner principal, actor, session, and role
- zero or more contributors
- zero or more ownership and attempt evidence references
- pre-outcome difficulty features and their revision
- observed result, hazards, penalties, and verification evidence
- typed missingness for any required field that was not observed

Accountable ownership is required for actor-level outcome estimation. A shot
without trusted owner identity remains part of the team score but is excluded
from identified actor estimates and lowers attribution coverage.

Ownership is not authorship:

- The accountable owner is responsible for the accepted outcome.
- Contributors retain credit and conflict relationships.
- Prior owners remain visible after a handoff.
- A verifier does not become the owner by approving or correcting a shot.
- A resolver does not inherit ownership of the miss that required resolution.

## Descriptive Handicap Estimands

Actor and role handicaps answer:

> For the work this actor or role actually owned during the stated window, how
> did observed scoring loss compare with the expected loss for the recorded
> pre-outcome difficulty and exposure?

They do not answer:

- what would have happened if another actor received the same assignments
- whether an actor or role caused the team result
- whether a controller, contributor, verifier, or resolver deserves a share of
  the team score
- which model or orchestration topology is universally better

Selection into work is not random. Difficulty adjustment reduces obvious
assignment-mix distortion but does not make the estimate causal.

### Disjoint Loss Ledger

Every new-schema scorecard reconciles its score through immutable loss
components. Each component has one `loss_component_id`, one scoring revision,
one team loss value, and exactly one source identity:

- `shot:<shot_id>:<component>` for intrinsic shot outcome loss
- `penalty:<penalty_id>` for a score-affecting hazard or penalty
- `round_adjustment:<adjustment_id>` for an explicit team-only judged
  adjustment that cannot be assigned to a shot or penalty

```text
score = par + sum(team_loss_component)
```

A loss may appear under only one source identity. Intrinsic shot loss MUST
exclude every loss represented by a `penalty_id`; attaching a penalty to a shot
does not also make it shot loss. A round adjustment is excluded from actor and
role estimates unless a later estimator revision defines an independently
reviewed allocation rule.

The existing scorecard builder folds hazard penalties into score. Migration to
the new schema MUST decompose that total into disjoint components without
changing the accepted legacy score. If decomposition is impossible, the
unexplained difference becomes an unattributed legacy round adjustment rather
than a second shot or penalty loss.

### Observation Unit

The primary observation is an accountable ownership spell, not only the final
completed shot. A spell begins when an actor accepts ownership of a shot and
ends at accepted completion, explicit handoff, abandonment, or round close. It
records one immutable `ownership_spell_id`, actor, role, session, shot,
attempt, start and end evidence, and terminal disposition.

For eligible spell `j`:

```text
observed_loss_j = disjoint loss components incurred during and attributed to the spell
expected_loss_j = expected subsequent loss from the difficulty snapshot frozen at spell start
adjusted_loss_j = observed_loss_j - expected_loss_j
```

The response contains only loss arising after the spell begins and before it
ends. A prior owner's failures cannot be placed in a later owner's response.
The final owner receives the intrinsic accepted-shot component; earlier owners
retain any intrinsic or penalty components incurred during their spells.

For actor `a` in window `W`, let `E(a,W)` be every eligible ownership spell the
actor accepted in scorecard versions selected for that window. Version 1 uses
equal exposure weights:

```text
w_j = 1
theta(a,W) = sum(w_j * adjusted_loss_j) / sum(w_j), for every j in E(a,W)
```

The role estimand substitutes the role in force for each spell. No difficulty,
outcome, duration, success, or confidence weighting is allowed in estimator
version 1. A different weighting policy requires a new estimator revision and
must publish its construction and normalization.

Signed values MUST be retained: negative means better than expected for the
observed exposure mix, and positive means worse. Reports MAY translate the
estimate into a familiar handicap display, but MUST include the signed
estimate, unit, scoring revision, difficulty revision, estimator revision,
aggregation window, and denominator. A display clamp MUST NOT destroy the
underlying signed value.

Contributors MAY receive a separate contribution metric when evidence supports
one. Contributor metrics are not ownership handicaps and MUST NOT be added to
them.

### Difficulty

Difficulty features for a spell MUST be versioned and frozen before the first
outcome-bearing action in that spell. Permitted inputs include:

- declared club and ticket complexity
- sprint slope factors
- planned dependency position and blast radius
- predeclared risk areas and required review level
- typed resource contention known when the spell starts
- shot history and handoff state already observed before the new spell starts

A later spell may condition on history known at its own start, including an
earlier handoff, because its response contains only subsequent loss. That
history MUST NOT adjust the full-shot response or any earlier spell.

Outcome-derived values from within the current spell, such as test failures,
observed hazards, final review findings, elapsed time after completion, or
whether the shot landed cleanly, MUST NOT enter its difficulty snapshot.

The difficulty model MUST publish:

- feature and model revision
- training or calibration window
- expected-loss unit
- fallback behavior for unseen strata
- calibration and reliability evidence
- predictive uncertainty needed by the estimator

If expected loss cannot be estimated reliably, the spell remains in exposure,
raw, and team summaries while its adjusted value is missing with a reason.

### Exposure, Attrition, And Missing Outcomes

`E(a,W)` includes every ownership spell accepted by the actor in the selected
rounds, including completed, handed-off, abandoned, retried, and unresolved
spells. Removing a spell because another actor finished the shot, because its
outcome is poor, or because required data is missing is prohibited.

Every spell receives one terminal disposition. For each required outcome,
attribution, and difficulty value, the estimator stores observed state or a
typed missing reason. Estimator version 1 follows these publication rules:

1. The point estimate `theta(a,W)` is published only when every eligible spell
   has an observed adjusted loss.
2. If any eligible spell is missing, the point estimate is `unavailable`; an
   observed-complete-case mean MAY be shown only as a diagnostic explicitly
   labeled conditional on observed spells.
3. The scoring revision MUST define finite pre-outcome lower and upper loss
   bounds for each spell stratum. Missing spells remain in the denominator and
   produce a sensitivity interval by substituting those bounds.
4. If defensible bounds are unavailable, the sensitivity interval is also
   `unavailable`.
5. Outcome, identity, attribution, and difficulty coverage are reported
   separately. Reliability cannot be high when any required coverage is below
   100 percent in estimator version 1.

This strict first revision prevents successful-completion selection. A future
imputation or inverse-observation estimator requires a new version, a
predeclared missingness model, calibration evidence, and independent review.

### Window, Sample Size, And Uncertainty

Current aggregation selects only `accepted_scorecard_version` for each round.
An historical `as_of` aggregation pins the one version accepted at that time.
Several versions of one reopened round MUST NOT enter the same aggregation.

Estimator version 1 requires at least:

- 20 eligible ownership spells
- 5 distinct closed rounds

Below either threshold, the result is `insufficient_data`, not zero. With equal
weights, effective sample size is:

```text
n_eff = (sum(w_j) * sum(w_j)) / sum(w_j * w_j)
```

Every actor or role estimate MUST identify:

- round and date window
- eligible spell count, observed spell count, and `n_eff`
- distinct independent-round count and threshold
- terminal-disposition counts
- identity, attribution, outcome, and difficulty coverage percentages
- point-estimate, sensitivity-interval, and reliability status
- scoring, difficulty, and estimator revisions

When a point estimate is available, uncertainty uses a 95 percent
round-clustered bootstrap with 2,000 resamples of rounds. Each resample includes
all selected spells and shared penalty allocations from each sampled round.
If the expected-loss model was fitted on the evaluated data, it is refitted in
each resample. An externally fitted model contributes draws from its published
predictive uncertainty. This propagates within-round dependence, shared
penalties, and expected-loss uncertainty.

If there are fewer than five independent rounds, the model cannot supply
predictive uncertainty, or bootstrap computation fails, the uncertainty
interval is `unavailable`, never zero-width. Reliability is low until every
required interval and coverage field is available.

Repository and operator views aggregate canonical rounds or actor estimates.
They are reporting scopes, not player identities.

## Penalty Identity And Attribution

Every score-affecting penalty has one immutable `penalty_id`. Its record
contains:

- team-level loss component and scoring revision
- round, attempt, ticket, shot, ownership spell, and resource scope as
  applicable
- `caused_by` principals and actors, which MAY be shared or unknown
- normalized descriptive allocation weights when causation is verified
- `resolved_by` principals and actors
- evidence references, confidence, and verification status
- typed attribution missingness

The canonical team score counts the `penalty:<penalty_id>` component at most
once. Participant and role views reference the same component; they do not
clone it.

Verified `caused_by` allocation weights are non-negative and sum to exactly
`1.0` across unique actor recipients. The allocated fraction enters each
recipient's spell `observed_loss_j` once, using the role and spell in force when
the causal action occurred. If causation is unknown, disputed, unverified, or
cannot be mapped to an ownership spell, the full penalty remains in team score
and is diagnostic-only for participant estimates.

`caused_by` and `resolved_by` are independent:

- A resolver MUST NOT inherit causal attribution.
- A verifier MUST NOT inherit causal attribution.
- Allocation weights do not alter full team impact.
- Unknown causation remains unknown and lowers attribution coverage.
- Disputed causation remains visibly disputed until resolved by policy.
- A penalty already represented in `observed_loss_j` through its
  `penalty_id` MUST NOT also appear in intrinsic shot loss.

Participant penalty projections are not a source for team scoring. Summing
actor or role views is invalid because unattributed penalties, team-only round
adjustments, overlapping role views, and missing data may remain.

## Measurement Invariants

- Current team score, team handicap, and participant estimates use at most one
  accepted scorecard version per round.
- Every score loss has one disjoint component identity; every canonical shot
  and penalty affects team score at most once.
- Actor and role estimates use all eligible accountable ownership spells and
  spell-start difficulty, never display aliases or sessions as durable
  identity.
- Exposure includes incomplete and handed-off work instead of selecting only
  successful completions.
- Missing exposure outcomes suppress the version 1 point estimate and remain in
  sensitivity bounds.
- Every estimate carries sample size, coverage, missingness, reliability, and
  uncertainty.
- Unknown is never represented as zero.
- Difficulty adjustment is descriptive and MUST NOT be presented as causal.
- Coordination overhead remains separate from canonical score.

## Single-Player Compatibility

Version 1 Team Rounds are a strict generalization of existing single-player
scorecards.

For a legacy scorecard:

- The existing sprint identity is resolved to canonical `sprint_key`.
- Import computes a canonical artifact hash and deterministic
  `legacy_import_id` from `(project_id, sprint_key, artifact hash,
  importer revision)`.
- Import creates a deterministic `round_id` scoped by
  `(project_id, sprint_key, legacy contract revision)`.
- The existing top-level shots, par, score, score label, hazards, and penalties
  remain authoritative and MUST NOT be recomputed merely because the schema is
  imported.
- The imported round is `closed` at `reopen_epoch: 0` with
  `scorecard_version: 1`, its artifact content hash, and synthetic
  `legacy_import` finalization evidence. Original scorecard date and
  authoritative import time are stored separately.
- `accepted_scorecard_version` and `latest_published_scorecard` both reference
  version 1 after successful import.
- `player`, when present, creates an artifact-scoped unverified actor identity.
  The ID is derived from project, artifact hash, and the legacy player field,
  so matching text in different rounds does not merge histories.
- Every top-level shot maps to that artifact-scoped actor only when the
  scorecard unambiguously represents one player.
- Missing session, role, verifier, contributor, difficulty, and penalty
  attribution fields receive typed `not_recorded_legacy` missing reasons.
- The imported scorecard remains immutable. Enrichment is a new projection or
  audited identity binding, not an edit to historical JSON.

Import is idempotent for the same `legacy_import_id` and bytes. Before creating
a round, the importer groups every discovered artifact by
`(project_id, sprint_key)`:

- Byte-identical artifacts collapse to one import.
- Different canonical hashes are quarantined as
  `legacy_import_conflict`; none becomes authoritative automatically.
- Explicit conflict resolution records the selected artifact hash, rejecting
  principal, reason, and authority evidence before import proceeds.
- A later authenticated binding MAY link an artifact-scoped actor to a durable
  actor through audited provenance. It does not rewrite the imported version.

An existing single-player command MAY continue to omit explicit team options.
The runtime supplies a one-participant Team Round from the authenticated
principal and active actor/session bindings.

### Legacy `agents` Breakdowns

The current optional `agents[]` shape contains copied per-session shots and
per-agent scores. It is not a second source of truth under this contract.

- Top-level shots and score remain canonical.
- An importer MAY derive role-only attribution when a one-to-one mapping from a
  copied legacy shot to one canonical shot is provable.
- `agents[]` alone MUST NOT produce `actor_id`. Actor attribution requires the
  unambiguous artifact-scoped `player` identity or separately authenticated
  binding evidence from the legacy session to a durable actor.
- Ambiguous, duplicated, or conflicting mappings remain unknown and lower
  attribution coverage.
- Legacy per-agent scores MAY be displayed as historical diagnostics but MUST
  NOT contribute to team score or the new actor estimand.
- A legacy session ID MUST NOT be promoted to durable actor or principal
  identity.

S264.1 MUST define, and S268 MUST implement, the minimum canonical scorecard
schema before deterministic projection or finalization ships. It includes
`project_id`, canonical `sprint_key`, `round_id`, `attempt_id`,
`reopen_epoch`, scorecard schema and published version, actor/principal/session
and role identity required by each canonical shot, optional contributor and
verifier references, authority and visibility scope, loss-component identities,
content hash, and projection revision.
Participant projections reference canonical shot IDs instead of copying shot
records. Readers MUST continue to support legacy scorecards.

## Typed Shared Resources

Parallel actors contend for more than files. A Team Round resource has a
canonical subject identity:

```text
resource_subject = {
  project_id,
  resource_type,
  namespace,
  resource_key
}

resource_request = {
  resource_subject,
  requested_access_mode,
  evaluated_policy_revision
}
```

`requested_access_mode`, effective conflict behavior, and policy revision are
not part of subject identity. Requests using different modes or policy
revisions still collide on the same protected subject.

Initial resource types are:

| Type | Example key | Default conflict model |
|---|---|---|
| `ticket` | canonical ticket key | one accountable owner |
| `file_area` | canonical repository path or declared area | overlap-aware exclusive writer |
| `tcp_port` | host scope plus port | exclusive allocator |
| `udp_port` | host scope plus port | exclusive allocator |
| `local_database` | provider plus canonical instance name | project policy |
| `service_instance` | service plus environment or instance name | project policy |
| `custom` | namespaced project-defined key | explicitly declared |

Free-form labels MUST NOT establish conflict identity. Canonicalization and
overlap rules are versioned project policy.

Resource ownership records identify:

- authenticated principal, actor, session, round, and attempt
- assignment or claim that requires the resource
- canonical resource subject, requested mode, effective mode, and evaluated
  policy revision
- authoritative acquisition evidence
- current lifecycle state

Lease duration, renewal, epochs, fencing, fairness, abandonment, and recovery
belong to the coordination contract. The domain invariants are:

- A protected mutation identifies the resource ownership it relies on.
- An expired or superseded owner cannot remain authoritative.
- Different resource types cannot collide by accidental string equality.
- Equivalent resources cannot evade collision through alternate spelling.
- Exclusive access conflicts with every other active mode on an overlapping
  subject. Shared-read is compatible only with shared-read. Shared-write or
  project-managed modes require an explicit cross-mode conflict matrix;
  missing policy defaults to exclusive or denied access.
- Ownership and allocation outcomes are visible to every authorized
  participant affected by the conflict.

A policy revision cannot create a parallel ownership namespace. Before a new
revision becomes active, the store re-evaluates every live ownership on
affected subjects. Incompatible ownership is fenced, revoked, or transitioned
under an audited rule before activation commits. Protected mutations present
the currently active policy revision and fail when evaluated under a stale
revision.

SLOPE coordinates declared resource ownership. It does not automatically make
an arbitrary development environment parallel-safe. A project MAY own port,
database, or service allocation through checked-in configuration; SLOPE then
records and enforces the declared allocation boundary.

## Explicit Non-Goals

The Team Round contract does not require or adopt:

- Nostr or any other specific network transport
- wallets, public-key identity, cryptocurrency, or blockchain settlement as a
  product prerequisite
- chat messages as the coordination database
- prompt-only conventions as access control, locking, attribution, or state
  synchronization
- role names, actor aliases, model names, or session labels as trust boundaries
- one scorecard per agent, best-of-agent selection, alternate-shot scoring, or
  scramble scoring
- causal ranking from observational actor or role estimates
- additive participant projections that reproduce the team score
- client-only authorization, redaction, or visibility filtering
- a second coordination ledger alongside the existing event store
- automatic management of undeclared ports, databases, processes, or external
  services
- raw secret, credential, private transcript, or unrestricted tool-payload
  storage in scorecards

SLOPE MAY expose chat, transport, or cryptographic integrations later. Such
integrations are adapters to the same repository-native contract, not alternate
sources of truth.

## Downstream Contract Ownership

S264.1 must specify:

- how the existing event store becomes the authoritative ledger
- the minimum canonical scorecard identity/version schema that S268 implements
  before deterministic projection and finalization
- complete event envelopes and deterministic scorecard projection
- atomic append, scoped idempotency, ordering, replay, and schema evolution
- lease epochs, fencing, retries, recovery, and escalation
- deny-by-default capabilities, filtered views, redaction, and retention

S264.2 must specify:

- assignment, handoff, callback, and blocker states
- principal-aware verifier independence and conflict rules
- merge-safe learning and semantic activity status
- reproducible, redacted team-versus-solo evaluation

Phase 64 implementation must not weaken any invariant in this document. If an
implementation constraint requires a semantic change, the contract and schema
revision must change before code ships.

S268 owns the minimum scorecard schema, identity fields, immutable projection,
and finalization mechanics. S270 owns accountable attribution validation,
ownership-spell and participant projections, descriptive estimators,
missingness and reliability reporting, penalty attribution, and merge-safe
learning. S270 MUST extend the S268 schema compatibly rather than introduce the
identity or version fields finalization already hashes.

## Acceptance Criteria

The S264 contract is complete when independent reviewers can answer all of the
following from this document without inventing policy:

### S264-1

- What project namespace scopes every identity?
- Which identifiers survive retries, closes, and reopens?
- Can two finalizers publish competing scorecards?
- What happens to late score-affecting evidence?
- Does reopen preserve prior scorecard versions?
- Which draft or published scorecard is authoritative during reopen?
- Can a protected roadmap status silently close a round?

### S264-2

- Which identity authenticates a mutation and which identity receives
  attribution?
- Can role, alias, session, branch, or worktree labels grant authority?
- Can two actors or sessions controlled by one principal verify each other
  independently?
- How are contributors, verifiers, authority, and visibility represented
  without duplicating ownership?

### S264-3

- Is there exactly one team score and one canonical copy of each shot and
  penalty?
- What population and observation unit does an actor or role estimate
  describe?
- Are difficulty features frozen before outcomes?
- Do incomplete and handed-off exposures remain in denominators?
- Are uncertainty, coverage, reliability, and missingness mandatory?
- Can shot loss and penalty loss count the same event twice?
- Can resolver credit inherit a penalty?

### S264-4

- Does a legacy single-player score remain unchanged?
- Can ambiguous legacy agent data invent trusted ownership?
- Are file, ticket, port, database, and service resources distinct typed
  subjects?
- Can access mode or policy revision create a parallel resource identity?
- Is project-owned development-state allocation an explicit boundary?
- Are transport, crypto, chat, prompt-only trust, and alternate team scoring
  excluded as dependencies?
