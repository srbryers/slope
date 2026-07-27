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

Acceptance is a separate mutable round projection:

```text
round_scorecard_pointer_v1 = {
  project_id,
  round_id,
  round_epoch,
  round_state,
  latest_published_scorecard_version?,
  accepted_scorecard_version?
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
- `accepted_scorecard_version` names at most one immutable version and is null
  while the round is reopened. Changing the pointer never changes published
  scorecard bytes.
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
  preconditions: [{
    aggregate_type,
    aggregate_id,
    expected_version
  }],
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
    previous_project_hash,
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
- `preconditions` names every additional aggregate version whose state was
  material to accepting the event. The list is canonicalized by aggregate type
  and ID before hashing.
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

## Idempotency Contract

### Scope

Every state-changing request carries a caller-generated idempotency key. The
store records it under:

```text
idempotency_identity = {
  project_id,
  operation_kind,
  primary_aggregate_type,
  primary_aggregate_id,
  round_epoch?,
  idempotency_key
}
```

The key is not scoped by session, process, worktree, branch, or transport.
Retries from a replacement session controlled by the same authenticated
principal therefore address the same operation.

`round_epoch` is mandatory for score-affecting or authority-affecting round
mutations. A key used before an audited reopen cannot alias an operation in the
new epoch.

The idempotency record stores:

- idempotency identity
- authenticated principal and attributed actor
- canonical request hash
- accepted event ID, event sequence, aggregate version, and response hash
- result classification
- first accepted store time

### Canonical Request Hash

The request hash covers all semantic mutation inputs:

- event type and event schema version
- primary aggregate and expected version
- sorted cross-aggregate preconditions
- complete scope including round epoch
- authenticated principal and attributed actor
- requested capability and any caller-supplied expected policy revision
- visibility request
- lease subject, lease epoch, and fencing token when required
- correlation and causation IDs
- payload classification and canonical payload

It excludes transport retry count, connection identity, current session when a
session is not semantically part of the event, and server-assigned event ID,
sequence, aggregate version, and acceptance time.

Changing any covered field while reusing the same idempotency identity is a
payload conflict, even when the new request would otherwise be valid.

### Retry Outcomes

For an exact request hash match:

- no event or projection is written;
- the original accepted operation identity is returned;
- the response is filtered under the caller's current visibility capability;
- an expired lease does not retroactively invalidate the original accepted
  operation;
- the retry cannot refresh a lease or session heartbeat.

A same-key request from a different principal is a conflict, not a second
namespace. The store MUST NOT disclose the prior payload or actor unless the
new caller can view the original event.

For a request hash mismatch, the store returns
`IDEMPOTENCY_PAYLOAD_CONFLICT` with the key scope and original operation ID only
when visible. It MUST NOT append a compensating or conflict event as part of
the failed mutation.

Rejected requests do not normally consume a key. A policy MAY retain a bounded
rejection fingerprint for abuse control, but that fingerprint cannot later be
mistaken for an accepted operation.

### Retention

Accepted mutation keys are retained for the lifetime of the canonical ledger.
If event payload retention removes protected data, the idempotency identity,
request hash, event identity, and redacted result tombstone remain. A purged key
MUST NOT become reusable.

## Atomic Append And Projection

### Append Request

`append_team_event` accepts:

```text
append_request = {
  event_type,
  event_schema_version,
  primary_aggregate,
  expected_aggregate_version,
  preconditions[],
  scope,
  actor_binding?,
  requested_capability,
  expected_policy_revisions?,
  visibility,
  idempotency_key,
  correlation_id,
  causation_id?,
  lease_proof?,
  payload_classification,
  payload
}
```

The caller does not supply project ID, principal ID, authentication context,
acceptance time, event sequence, new aggregate version, active policy revision,
policy decision ID, or event hashes. The trusted store boundary derives or
assigns them. A caller MAY pin an expected policy revision as an optimistic
precondition; omitting it means "evaluate the active revision."

### Transaction Algorithm

One append performs these steps in one database transaction:

1. Authenticate the caller and derive project, principal, authentication
   context, and permissible actor bindings.
2. Parse the registered request schema and canonicalize identifiers, resource
   subjects, preconditions, visibility, and payload.
3. Acquire the project sequence row, idempotency identity, primary aggregate,
   cross-aggregate preconditions, resource lease rows, and projection rows in a
   deterministic lock order.
4. Read authoritative store time and the active identity, capability,
   visibility, resource-policy, event-schema, and projection revisions.
5. Check for an existing idempotency record. Return an exact visible prior
   result or fail on a request-hash conflict.
6. Validate primary aggregate version, every precondition, lifecycle state,
   round epoch, actor binding, correlation and causation, and lease proof.
7. Evaluate the requested capability and requested visibility under the active
   policy revisions. Denial aborts before event allocation.
8. Allocate the next contiguous project event sequence and the next primary
   aggregate version.
9. Build and hash the complete canonical envelope.
10. Insert the immutable event and accepted idempotency record.
11. Apply every authoritative projection affected by that event, including
    aggregate state, leases, draft or published scorecard, workflow
    compatibility state, and projection cursor.
12. Check declared invariants and write the new project and aggregate integrity
    heads.
13. Write any transactional outbox notification that external consumers need.
14. Commit and return the accepted event identity plus a visibility-filtered
    projection result.

Failure before commit writes none of the event, idempotency record, projection
changes, cursor, integrity head, or outbox notification.

External API calls, Git operations, process signals, and network publication
MUST NOT occur inside the transaction. They consume the committed outbox and
report a later result as a causally linked event. An external side effect must
have its own idempotency contract.

### Adapter Equivalence

SQLite SHOULD use an immediate write transaction so two writers cannot both
validate the same aggregate version. PostgreSQL SHOULD use row locks plus
serializable or equivalent conflict detection. These are implementation
choices; both adapters MUST expose the same accepted, retry, conflict, and
ordering outcomes.

PostgreSQL native sequences are not sufficient for canonical
`event_sequence`, because a rolled-back allocation can leave a gap. Each
project uses a transactionally locked sequence row or an equivalent gap-free
allocator updated in the append transaction.

Serialization failures and busy-store conflicts MAY be retried internally.
Every internal retry uses the original authenticated request and idempotency
identity. A timeout whose commit outcome is unknown is reported as
`COMMIT_STATUS_UNKNOWN`; the client resolves it by retrying the same request,
never by changing the key.

### Multi-Aggregate Invariants

An event has one primary aggregate, but acceptance may depend on other
aggregates. The append request names each material expected version in
`preconditions`.

Examples:

- `round.closed` locks the round, required assignments, verification state,
  accepted shots and penalties, and every live score-affecting lease.
- `resource_lease.acquired` locks the canonical resource subject and overlapping
  active lease subjects under the evaluated policy revision.
- `shot.accepted` locks the round epoch, assignment, shot, and relevant lease.

The accepted event records the checked versions. A concurrent change causes a
version conflict and requires the caller to re-read and issue a new operation
with a new idempotency key. Reusing the old key with changed preconditions is a
payload conflict.

### Projection Classes

Authoritative projections needed to decide a later append are synchronous:

- aggregate versions and lifecycle
- identity bindings
- capabilities and visibility policy revision
- lease ownership and fencing
- draft and accepted scorecard state
- idempotency and integrity heads

Search, analytics, reports, notifications, and other non-authoritative views
MAY update asynchronously from the outbox. Their lag MUST be visible and they
MUST NOT authorize a mutation or claim to be the accepted scorecard.

## Ordering Contract

The ledger exposes three distinct ordering relations:

1. `event_sequence`: gap-free acceptance order within one project.
2. `aggregate_version`: strict state-machine order within one aggregate.
3. `causation_id`: explicit causal edge between accepted events.

None substitutes for another.

The project sequence is used for replay cursors, snapshots, and integrity
checkpoints. It does not mean that unrelated aggregates causally depend on one
another.

The aggregate version is an optimistic concurrency token. The expected value
must match exactly; last-writer-wins behavior is forbidden.

Causation forms an acyclic graph:

- the cause must exist in the same project;
- it must have a lower event sequence;
- the caller must be allowed to reference it;
- a correlation group does not imply causation;
- client timestamp order and arrival batch order do not create causal edges.

Batch append MAY be added later only if the batch has one idempotency identity,
one authorization decision set, deterministic internal order, and all-or-none
commit semantics. Version 1 does not infer a batch from multiple requests in
one transport message.

## Schema Evolution

### Registry

The authoritative store maintains a versioned registry for:

- envelope versions
- event type and payload schema versions
- identity, capability, visibility, and resource policy revisions
- projection schema versions and reducer revisions
- canonical serialization and hash revisions

Every accepted event pins all revisions material to its interpretation. A
mutable "current policy" pointer is not enough for replay.

### Event Evolution

- Existing event bytes are immutable.
- Additive optional payload fields require a new event schema version when
  their interpretation affects a projection.
- A semantic rename, changed default, changed unit, changed identity, or
  changed invariant requires a new version.
- Breaking semantics SHOULD use a new event type.
- Pure deterministic upcasters may translate an older payload into the current
  reducer input. They cannot consult current policy or external state.
- Downcasting authoritative events is forbidden.
- Writers emit only versions enabled by the active store revision.
- Readers required for migration and rollback remain able to process every
  version in the declared compatibility window.

An unknown mandatory event version halts the affected authoritative projection.
It is never skipped as "forward compatible."

### Projection Evolution

A new projection schema is built side by side from a pinned event sequence:

1. register schema and reducer revision;
2. replay from genesis or a verified compatible snapshot;
3. compare declared invariants and shared-field canonical hashes;
4. catch up to one locked cutover sequence;
5. atomically switch the active projection pointer;
6. retain the prior reader for the rollback window.

Append continues during a reader rollback only when both projection revisions
understand the active event writer schema. Otherwise writes fail closed until a
forward repair is deployed.

### Policy Evolution

Identity, capability, visibility, and resource policy changes are themselves
authorized events. Activation records the new revision and effective project
sequence.

A resource-policy revision also follows the live-lease re-evaluation and
fencing requirement in the Team Round domain contract. A visibility reduction
invalidates affected caches and filtered-view cursors at activation.

## Integrity Contract

### Hash Chains

Each event records:

- `previous_project_hash`, chaining the gap-free project event order
- `previous_aggregate_hash`, chaining the primary aggregate version
- `event_hash`, covering the canonical envelope and both prior hashes

The append transaction updates both integrity heads. Replay verifies both
chains. The project chain detects deletion or reordering across aggregates; the
aggregate chain localizes state-machine corruption.

Hash chains detect accidental or unauthorized partial mutation relative to a
trusted checkpoint. They do not prevent a database administrator who can
rewrite the complete ledger and every checkpoint. The threat model MUST state
that limitation.

### Checkpoints And Anchors

At configured sequence intervals and every round close, the store writes an
integrity checkpoint containing:

- project ID and event sequence
- project integrity head
- aggregate heads changed since the prior checkpoint
- active schema and policy revisions
- accepted scorecard version and content hash when closing a round
- checkpoint creation principal and store time

Round-close checkpoints are exported with the Git-tracked scorecard evidence.
Deployments MAY sign checkpoints or anchor them in an independently protected
system. Verification reports whether a checkpoint is local-only, signed, or
externally anchored.

### Constraints And Verification

Store constraints MUST enforce at least:

- unique `(project_id, event_id)`
- unique `(project_id, event_sequence)`
- unique `(project_id, aggregate_type, aggregate_id, aggregate_version)`
- unique accepted idempotency identity
- one accepted scorecard version per round
- monotonic round epoch, aggregate version, lease epoch, and fencing token
- referential validity for causation, scorecard source events, shots, penalties,
  loss components, and lease proof

An online verifier checks newly appended ranges. A full verifier replays from a
trusted checkpoint or genesis into empty projections. Any mismatch:

- marks affected authoritative projections unhealthy;
- blocks score-affecting, lease, capability, export, and finalization writes;
- preserves read access only through policy-filtered last-verified state;
- emits an integrity incident without embedding secret payload;
- requires an authorized forward repair or store restoration.

No repair may edit an accepted event. A correction is a new event whose
causation and administrative authority are explicit.

## Append Error Taxonomy

Clients receive stable machine-readable errors:

| Error | Meaning | Retry |
|---|---|---|
| `IDEMPOTENCY_PAYLOAD_CONFLICT` | Same scoped key, different canonical request | No; new intent and key required |
| `AGGREGATE_VERSION_CONFLICT` | Primary version changed | Re-read, then new key |
| `PRECONDITION_CONFLICT` | Material dependent aggregate changed | Re-read, then new key |
| `ROUND_EPOCH_STALE` | Request targets an earlier open/reopen epoch | No |
| `LEASE_FENCED` | Lease epoch or fencing token is stale | No |
| `CAPABILITY_DENIED` | Principal lacks requested authority | No until policy changes |
| `VISIBILITY_DENIED` | Requested input or result is not visible | No until policy changes |
| `SCHEMA_UNSUPPORTED` | Event, payload, or projection revision is unknown | No until deploy changes |
| `INTEGRITY_UNHEALTHY` | Trusted append preconditions cannot be established | No until repaired |
| `STORE_BUSY` | Transaction did not begin or serialize | Retry same key |
| `COMMIT_STATUS_UNKNOWN` | Client cannot tell whether commit completed | Retry same key |

Errors MUST NOT disclose hidden aggregate, event, principal, actor, or resource
existence. A caller without visibility receives the policy's non-enumerating
form.

## S264.1-2 Acceptance Criteria

The append and integrity contract is complete when an implementer can answer:

- Which exact dimensions scope an idempotency key?
- Can a replacement session retry an accepted operation?
- What happens when the same key carries a different payload, actor,
  precondition, policy revision, or fencing token?
- Can append commit an event without all authoritative projections, or a
  projection without its event?
- Can a rolled-back PostgreSQL sequence allocation create a replay gap?
- How are multi-aggregate preconditions locked and recorded?
- Which views may lag and which must be transactional?
- Can client time or sequence adjacency establish causation?
- What happens when an event or projection schema is unknown?
- Which integrity chains detect aggregate-local and cross-aggregate damage?
- Can a repair mutate accepted event bytes?
