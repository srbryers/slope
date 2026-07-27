# Team Round Coordination Integrity And Security Contract

Status: proposed normative contract for S264.1, S268, and S269

Issue: [#669](https://github.com/srbryers/slope/issues/669)

Domain dependency:
[Team Round Domain And Scoring Contract](./team-round-domain.md)

Research input:
[Buzz Multiplayer Collaboration](../research/buzz-multiplayer-collaboration.md)

## Purpose

This document defines how SLOPE persists and protects one Team Round when
multiple principals, actors, and sessions collaborate concurrently. It evolves
the existing SLOPE event store into the authoritative coordination ledger,
defines deterministic projections, and makes stale or unauthorized mutations
fail in the store.

The contract does not introduce a second event ledger. Existing SQLite and
PostgreSQL event storage, migrations, store resolution, and repository state
ownership are the implementation substrate.

The words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are normative.

## Decisions

1. The existing `events` substrate becomes the only authoritative Team Round
   coordination ledger.
2. Mutable coordination tables and files become projections or exports. They
   MUST NOT accept authoritative writes outside the event append transaction.
3. Every canonical event uses a complete versioned envelope, authenticated
   identity, authoritative store time, scoped idempotency, and deterministic
   ordering.
4. The accepted scorecard is an immutable versioned projection produced by an
   exactly-once close transition.
5. Resource ownership is a renewable lease with a monotonic epoch and fencing
   proof on every protected mutation.
6. Capabilities and visibility are deny-by-default and enforced before append
   and again while producing filtered views.
7. Redaction and retention preserve audit meaning without retaining secrets or
   allowing unauthorized existence disclosure.
8. SQLite and PostgreSQL provide the same observable protocol even when their
   physical migration and locking mechanisms differ.

## Contract Boundary

This contract owns:

- authoritative ledger and projection boundaries
- migration from current store rows and JSON artifacts
- minimum canonical scorecard schema needed before finalization
- complete event envelope and deterministic replay rules
- append, idempotency, ordering, integrity, and schema evolution
- lease acquisition, renewal, expiry, fencing, and recovery
- capability, visibility, filtered-view, redaction, and retention enforcement
- adversarial acceptance criteria for S268 and S269

This contract does not own:

- assignment, handoff, callback, or human status-feed workflow
- verifier-independence policy selection
- merge-safe learning behavior
- team-versus-solo evaluation manifests
- actor and role estimator implementation
- authentication provider selection
- undeclared development environment resources

S264.2 owns the first four omitted workflow and evaluation concerns. S270 owns
attribution projections and estimators. Authentication providers are adapters
that MUST produce the principal bindings required here.

## Authoritative State Model

### Authority Matrix

| State | Authoritative source | Derived or exported copies |
|---|---|---|
| Planned sprint identity and ticket plan | Modular roadmap YAML source bundle | Compiled roadmap JSON, focus output |
| Round, attempt, assignment, and resource lifecycle | Accepted canonical ledger events | Status views, workflow state, CLI output |
| Draft scorecard evidence | Canonical events plus deterministic projection | Working scorecard view |
| Published and accepted scorecard | Immutable scorecard projection named by close event | `docs/retros` export, dashboard, handicap input |
| Session liveness | Store-time heartbeat events and session projection | Session status output |
| Claims and leases | Canonical lease events and lease projection | Legacy claim reads |
| Git, PR, CI, and release facts | Referenced external evidence snapshot | Ledger evidence event and scorecard references |
| Sprint workflow progress | Workflow events and deterministic projection | `.slope/sprint-state.json` compatibility mirror |

The roadmap remains authoritative for what was planned. It MUST NOT become the
execution ledger. The Team Round ledger is authoritative for what happened and
which scorecard version was accepted.

Git-tracked scorecard and review files remain durable project evidence. During
an active or reopened round, they are not a mutable coordination channel.
After close, an export MUST identify the exact accepted scorecard version,
content hash, closing event, and projection schema revision.

### One Append Authority

After cutover, every authoritative Team Round mutation enters through one store
operation, referred to here as `append_team_event`.

Existing store methods such as session registration, claim acquisition,
workflow updates, scorecard save, and event insertion MUST either:

- adapt their request to `append_team_event`; or
- be explicitly limited to pre-cutover compatibility mode.

They MUST NOT update an authoritative projection directly and later emit an
event. Event acceptance and every affected projection update occur in the same
transaction.

Auxiliary tables for idempotency records, projection cursors, snapshots,
integrity checkpoints, and dead-letter entries are permitted. They are not
alternate event sources and MUST be reconstructible from the canonical event
ledger plus declared administrative policy.

## Existing Store Migration

### Migration Identity

SQLite and PostgreSQL currently use independent numeric schema sequences.
S264.1 does not assign a shared database migration number. It defines a logical
feature revision:

```text
team_round_ledger_revision = 1
```

Each adapter maps that revision to its next local schema migration. Store
health MUST report both the adapter schema version and the logical Team Round
ledger revision.

### Stable Project Binding

Migration requires a stable `project_id` before any Team Round row is
backfilled.

- PostgreSQL MUST replace the default project namespace with the configured
  durable project identity before accepting canonical Team Round events.
- SQLite MUST persist `project_id` in the store even though the database path is
  already repository-owned.
- A filesystem path, Git remote, checkout, worktree, branch, display name, or
  connection string MUST NOT be used as `project_id`.
- A store whose existing rows map ambiguously to more than one project MUST
  stop in migration quarantine and require an explicit mapping.

### Cutover Phases

Migration proceeds through these durable phases:

1. `inventory`
   - Acquire the adapter migration lock.
   - Record source schema versions, project binding, row counts, content
     digests, and the maximum existing event position.
   - Reject ordinary Team Round writes while inventory is open.
2. `expand`
   - Add canonical envelope columns, append metadata, idempotency records,
     projection cursors, immutable scorecard-version storage, lease state, and
     integrity checkpoints.
   - Do not change read authority yet.
3. `backfill`
   - Convert eligible current rows with deterministic import identifiers.
   - Preserve source row identity and content hash.
   - Quarantine ambiguous identity, malformed payload, or conflicting
     idempotency data instead of guessing.
4. `verify`
   - Replay canonical events into empty projections.
   - Compare row counts, accepted scorecard hashes, active lifecycle state, and
     declared compatibility views against the migration manifest.
5. `cutover`
   - Commit one `store.authority_changed` event naming the old and new read
     authorities, verified event position, manifest hash, and ledger revision.
   - Switch all mutation adapters to canonical append in the same transaction.
6. `observe`
   - Compare production reads against shadow replay for a bounded policy
     window.
   - Any divergence blocks cleanup and emits an integrity incident.
7. `contract`
   - Remove or deny direct authoritative writes to legacy tables and files.
   - Keep compatibility reads only for the declared support window.

A failed phase is resumable from its durable checkpoint. Re-running a completed
phase with the same manifest is a no-op. Re-running it with different inputs is
a conflict and requires a new migration attempt.

### Current Event Rows

Current `SlopeEvent` rows are session telemetry with generated IDs, client
timestamps, optional session/sprint/ticket fields, and an untyped data object.
They do not establish authenticated principal, actor, authority, visibility,
round, or attempt identity.

Migration MUST import them as `legacy.telemetry_observed` evidence with:

- deterministic canonical event ID derived from project ID, source adapter,
  source table, legacy event ID, and source-row hash
- `trust = unverified_legacy`
- no invented principal or actor
- original timestamp preserved as `occurred_at`
- migration acceptance time as `accepted_at`
- original payload under a versioned legacy namespace
- source row locator and source-row hash

Legacy telemetry MUST NOT acquire a lease, authorize a mutation, verify a shot,
close a round, or establish actor handicap history.

### Current Mutable Rows

Sessions, claims, workflow executions, workflow step results, scorecards, and
common issues require type-specific import:

- A live session imports only when it can be bound to a known project and a
  valid authenticated principal. Otherwise it imports as inactive historical
  evidence.
- A claim imports as an expired compatibility claim unless migration can prove
  a live session, canonical resource subject, authoritative expiry, and
  exclusive ownership at cutover.
- A workflow execution imports as attempt evidence. It does not create a second
  round or accepted scorecard.
- A legacy scorecard follows the deterministic import rules in the Team Round
  domain contract and publishes synthetic scorecard version 1 only when the
  source is unambiguous.
- Common issues import as one merge baseline. S264.2 defines subsequent
  merge-safe learning events.

SQLite may rebuild a table transactionally to add constraints that SQLite
cannot add in place. The replacement still becomes the existing canonical
`events` substrate at cutover; two durable event tables MUST NOT remain active.

### Rollback

Before `store.authority_changed`, migration MAY roll back to the captured
inventory without accepting Team Round writes.

After authority changes:

- event append MUST NOT roll back to a legacy writer;
- a bad projection deploy MAY roll back its reader to the last compatible
  projection schema while append continues;
- a bad envelope or append revision requires a forward repair event and schema
  revision;
- imported source data and quarantine evidence remain immutable.

## Minimum Canonical Scorecard Schema

S268 MUST implement at least the following immutable published shape before
round finalization ships:

```text
canonical_scorecard_v1 = {
  schema_version: 1,
  project_id,
  sprint_key,
  round_id,
  scorecard_version,
  publication_status,
  accepted,
  round_epoch,
  source_event_range: {
    first_event_sequence,
    last_event_sequence,
    closing_event_id
  },
  projection: {
    name,
    schema_version,
    reducer_revision
  },
  finalized: {
    principal_id,
    actor_id,
    session_id,
    accepted_at
  },
  scoring: {
    par,
    slope,
    team_score,
    score_label,
    loss_components[]
  },
  attempts[],
  shots[],
  penalties[],
  evidence_refs[],
  content_hash
}
```

Required identities and constraints:

- `(project_id, sprint_key)` names one canonical round.
- `(project_id, round_id, scorecard_version)` is unique and immutable.
- `round_epoch` increases on audited reopen and is included in every
  score-affecting mutation after reopen.
- `attempts[]` contains canonical attempt IDs referenced by accepted evidence.
- Every `shot_id`, `penalty_id`, and `loss_component_id` is unique within the
  project and appears at most once in a scorecard version.
- Each shot names one accountable actor and may name contributors and a
  verifier according to the domain contract.
- Each loss component names exactly one of `shot_loss`, `penalty_loss`, or
  `round_adjustment` and references its canonical source identity.
- `accepted` is true for at most one version of a round and false for every
  version while the round is reopened.
- `content_hash` covers the canonical serialization of every field except
  itself.

The published schema MUST NOT embed secrets, raw credentials, unrestricted tool
payloads, private transcripts, or mutable display labels as trusted identity.

## Canonical Event Envelope

Every canonical event has this envelope:

```text
team_event_v1 = {
  envelope_version: 1,
  event_id,
  event_type,
  event_schema_version,
  project_id,
  aggregate: {
    type,
    id,
    version
  },
  scope: {
    sprint_key?,
    round_id?,
    round_epoch?,
    attempt_id?,
    ticket_key?,
    shot_id?,
    penalty_id?,
    resource_subject?
  },
  identity: {
    principal_id,
    actor_id?,
    session_id?,
    role?,
    authentication_context_id
  },
  authorization: {
    capability,
    policy_revision,
    decision_id
  },
  visibility: {
    classification,
    policy_revision,
    subject_ids[]
  },
  time: {
    occurred_at?,
    accepted_at
  },
  ordering: {
    event_sequence,
    aggregate_version
  },
  idempotency: {
    scope,
    key,
    payload_hash
  },
  correlation_id,
  causation_id?,
  lease_proof?,
  payload_classification,
  payload,
  integrity: {
    previous_aggregate_hash,
    event_hash
  }
}
```

### Required Envelope Semantics

- `event_id` is immutable and unique within `project_id`.
- `event_type` and `event_schema_version` select one registered payload schema.
- `aggregate.type`, `aggregate.id`, and `aggregate.version` identify the state
  machine mutation and its optimistic concurrency position.
- `principal_id` and `authentication_context_id` come from the trusted
  authentication boundary. Clients cannot self-assert them in payload.
- Actor, session, and role are attribution or execution context and MUST be
  bound to the authenticated principal under the active identity revision.
- `accepted_at`, `event_sequence`, and `aggregate_version` are assigned by the
  authoritative store.
- `occurred_at` is evidence only. It cannot win ordering, extend a lease, or
  move an authorization decision backward in time.
- `authorization` records the exact allow decision used for append.
- `visibility` is an explicit allowlist. An empty `subject_ids` list does not
  mean public.
- `correlation_id` groups one requested operation. `causation_id` names the
  direct accepted event that caused this event when one exists.
- `lease_proof` is mandatory for protected resource mutations and absent only
  for event types whose policy declares no resource ownership requirement.
- `payload_classification` cannot be weaker than any field in the payload.
- Hashes use the contract canonical serialization and include all envelope
  fields except `integrity.event_hash`.

An event with a missing required field, unknown schema revision, unbound
identity, unauthorized capability, stale lease proof, invalid hash, or
non-canonical payload is rejected before it receives an event sequence.

## Event Types And Aggregate Ownership

Initial aggregate types are:

| Aggregate | Representative events | Projection owner |
|---|---|---|
| `round` | opened, finalization_started, closed, reopened | round and scorecard |
| `attempt` | started, paused, abandoned, completed | attempt status |
| `assignment` | created, accepted, blocked, completed | assignment status |
| `shot` | evidence_added, ownership_changed, accepted | draft scorecard |
| `penalty` | recorded, causation_linked, resolved | draft scorecard |
| `resource_lease` | acquired, renewed, released, expired, fenced | lease view |
| `verification` | requested, recorded, revoked | verification view |
| `learning` | observed, merged, redacted | common-issue view |
| `store` | authority_changed, integrity_failed, repaired | store health |

S264.2 defines assignment, callback, verification, learning, and human-facing
status transitions. Their events still use this envelope and append protocol.

## Deterministic Projection And Replay

### Projection Contract

A projection is identified by:

```text
(project_id, projection_name, projection_schema_version, reducer_revision)
```

Its durable cursor records the highest contiguous `event_sequence` applied and
the resulting projection hash. A cursor MUST NOT advance across a missing,
quarantined, unauthorized, or unrecognized event.

Reducers MUST be:

- pure with respect to the event stream and declared static policy revision
- deterministic across SQLite, PostgreSQL, operating systems, and time zones
- free of current wall clock, randomness, environment variables, network
  reads, filesystem discovery, and unordered iteration
- explicit about decimal/canonical sprint identity and canonical JSON ordering
- total for every registered event version or fail closed

Display formatting, live Git inspection, current branch, and current session
liveness are not reducer inputs.

### Replay Order

`event_sequence` provides the store acceptance order and replay cursor.
`aggregate_version` provides strict per-aggregate optimistic order.

- Each accepted aggregate event increments its aggregate version by exactly
  one.
- Two events on different aggregates may be concurrent even though the store
  assigns a deterministic sequence.
- Causation MUST NOT be inferred from adjacent sequence numbers.
- A causal event must reference an accepted earlier event ID.
- Ties in client timestamps have no semantic effect.

### Replay Procedure

1. Select genesis or a verified snapshot whose event sequence and hash chain
   are trusted.
2. Load events after the cursor in ascending `event_sequence`.
3. Verify envelope schema, canonical hash, aggregate hash chain, identity and
   policy references, and contiguous aggregate version.
4. Upcast the payload through registered pure transformations.
5. Apply the reducer and record the new projection hash.
6. At a checkpoint, compare the rebuilt hash and declared invariants with the
   live projection.

Unknown event or projection schema versions stop replay. They MUST NOT be
ignored. An optional projection may be disabled, but a round, lease,
authorization, or scorecard projection cannot continue past unknown semantics.

### Scorecard Replay

Replaying one closed round from accepted events MUST reproduce byte-identical
canonical scorecard content and `content_hash`, including:

- round and scorecard version
- accepted attempts and shots
- accountable actors, contributors, and verifier references
- penalty and loss-component identity
- par, slope, team score, and score label
- finalizer identity and close evidence

Reopen replay preserves every earlier published version, makes accepted version
null, increments round epoch, and starts a new draft. A later close publishes a
new immutable version without mutating prior bytes.

## S264.1-1 Acceptance Criteria

The source-of-truth and replay contract is complete when an implementer can
answer all of the following without inventing policy:

- Which existing storage becomes the ledger, and may another event ledger be
  introduced?
- Which state remains roadmap-authoritative and which state becomes
  event-authoritative?
- How does each adapter prove and resume migration?
- Can legacy telemetry invent a principal, actor, lease, verification, or
  scorecard close?
- What minimum scorecard fields exist before finalization?
- Does every accepted event record trusted identity, authorization, visibility,
  authoritative time, idempotency, ordering, causation, and integrity?
- Can replay consult the wall clock, Git, environment, filesystem, or network?
- What happens when replay encounters an unknown event revision or integrity
  gap?
- Can a reopened round mutate a prior published scorecard?
