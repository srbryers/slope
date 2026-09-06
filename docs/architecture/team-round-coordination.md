# Team Round Coordination Integrity And Security Contract

Status: proposed normative contract for S264.1, S268, and S269

Amended by:
[Team Round Deployment Profiles](./team-round-deployment-profiles.md),
accepted 2026-09-06. That amendment governs where the two disagree. It replaces
the single universal write-barrier guarantee with two named deployment
profiles, scopes the managed-key criteria to PostgreSQL, resolves this
document's self-contradiction on legacy import identity, and moves
authentication to before the append transaction opens.

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

### Authority Generation And Physical Write Barrier

The store persists a project-scoped monotonic `authority_generation`. Every
canonical append request and adapter session pins the generation it observed.
Append locks and compares the active value inside the transaction. A mismatch
fails with `STORE_AUTHORITY_CHANGED`.

Cutover increments the generation in the same transaction that accepts
`store.authority_changed`, switches the mutation dispatch to canonical append,
and replaces the pre-inventory maintenance fence with the permanent
canonical-only barrier.

Physical enforcement is adapter-specific but mandatory:

- SQLite rebuilds mutable compatibility tables as read-only views or guarded
  projections whose legacy write triggers abort. Canonical projection tables
  are reachable only by the canonical store implementation.
- PostgreSQL revokes application-role DML on ledger and projection tables and
  exposes canonical append plus filtered read procedures. Compatibility names
  are read-only views.
- An adapter with equivalent database-enforced controls documents and tests
  them in its conformance packet.

An already-running old process therefore fails its next legacy DML or presents
a stale authority generation. Observation mode compares readers; it does not
leave a legacy writer enabled.

Raw database owners and filesystem-level SQLite editors remain in the database
administrator threat boundary. Ordinary SLOPE and custom adapter credentials
MUST NOT have that authority.

### Store Protocol Negotiation

At resolution, every adapter reports a structured protocol descriptor:

```text
coordination_protocol = {
  protocol_revision,
  team_round_ledger_revision,
  authority_generation,
  project_scoped_keys,
  canonical_append,
  transactional_projections,
  filtered_reads,
  deterministic_replay,
  authoritative_time,
  lease_fencing,
  redaction_retention
}
```

S268 and later Team Round operations require compatible revisions and every
listed capability. Missing, false, unknown, or stale descriptors fail closed
with `STORE_PROTOCOL_UNSUPPORTED`.

Dynamic custom stores do not inherit trust from implementing the legacy
`SlopeStore` shape. Before cutover they may run only in explicit compatibility
mode. After cutover they must implement the protocol descriptor, canonical
append, filtered reads, replay verification, authority-generation check, and
lease fencing, and pass the published adapter conformance suite.

Self-reported support is not sufficient release evidence. Runtime negotiation
prevents accidental old-adapter use; conformance tests and deployment policy
establish that the implementation actually enforces the descriptor.

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

Before `inventory`, the adapter acquires its exclusive migration lock and
installs a physical maintenance fence before persisting
`team_round_migration_mode = write_frozen`.

- SQLite obtains an exclusive database transaction, installs aborting write
  triggers on every legacy mutable table, commits the fence, and verifies a
  legacy DML probe fails before inventory begins.
- PostgreSQL acquires the migration advisory lock, revokes application-role
  DML, installs migration-mode guard triggers, and drains every transaction
  that began before the fence generation before inventory begins.
- Custom adapters install their conformance-tested equivalent and prove no
  pre-fence writer remains.

The adapter records the drained transaction boundary and fence generation in
the migration manifest. If an installed adapter cannot physically enforce the
fence across every session, claim, workflow, scorecard, common-issue, and event
writer, or cannot drain pre-fence application transactions, migration refuses
to start.

The write barrier remains active through `inventory`, `expand`, `backfill`, and
`verify`. No delta may enter behind the inventory watermark. Read-only legacy
views may remain available with an explicit maintenance and staleness marker.

Migration proceeds through these durable phases:

1. `inventory`
   - Verify the exclusive migration lock and durable write barrier.
   - Record source schema versions, project binding, row counts, content
     commitments, and the maximum existing event position.
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
   - Replace `write_frozen` with `canonical_only` in that transaction. A
     legacy writer remains denied after the barrier is lifted.
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

If the process dies while frozen, restart verifies the manifest and resumes or
explicitly rolls back before any writer is re-enabled. Merely deleting a lock
file or restarting a process cannot clear the durable barrier.

### Deterministic Import Plan

Inventory materializes a canonical import plan before backfill. Every source
row receives:

- dependency rank derived from declared parent and causation requirements
- source-kind rank from this fixed order: project bootstrap, identity and
  policy, session, claim, workflow execution, workflow step, telemetry event,
  scorecard, common issue
- canonical source table name
- canonical source identity bytes
- normalized source occurrence time or an explicit invalid-time sentinel
- classification-safe source-row commitment and commitment-key revision
- deterministic destination event type, schema version, and event ID
- disposition: import, quarantine, or superseded compatibility row
- complete destination envelope bytes, including pinned migration
  `accepted_at`, migration principal and authentication context, authorization
  and visibility decisions, policy revisions, idempotency fields, sequence,
  aggregate version, prior hashes, and final event hash

Import order is the bytewise ascending tuple:

```text
(
  dependency_rank,
  source_kind_rank,
  normalized_source_time_or_sentinel,
  canonical_source_table_name,
  canonical_source_identity_bytes,
  source_row_commitment
)
```

The comparison uses unsigned canonical UTF-8 bytes and numeric rank, never
database collation or unordered query results. Equal tuples are a manifest
conflict.

The import planner builds an acyclic dependency graph before assigning rank.
Genesis, project, identity, and policy events have the first ranks. A claim
follows its session, a workflow step follows its execution, and an imported
scorecard close follows every imported evidence event it references. Each event
may reference only a lower dependency rank or an earlier event in its own rank.
A missing parent, cycle, or forward causation is quarantined.

A valid source time is parsed as RFC 3339, converted to UTC, and encoded exactly
as `YYYY-MM-DDTHH:mm:ss.SSSSSSSSSZ` with years `0001..9999` and nine fractional
digits. Fractions are right-padded; precision beyond nanoseconds or an invalid
calendar or offset is rejected as invalid time rather than rounded. The exact
invalid sentinel is ASCII `~invalid-rfc3339-time~`, which sorts after every
valid digit-leading timestamp within its dependency and source class.

Canonical import events receive contiguous project event sequences in that
order. A resumed run reuses the same plan, IDs, sequences, hashes, and
dispositions. Any source-row drift after inventory proves a broken write
barrier and aborts migration.

Inventory pins one migration acceptance instant from authoritative store time.
Backfill does not call the clock, allocate identity, or re-evaluate policy; it
inserts the fully materialized planned envelope bytes.

The signed migration manifest records every planned destination envelope and
sequence plus the expected final project chain head, per-aggregate heads, and
projection hashes. Verify compares computed values byte-for-byte before
cutover.

Before any source commitment or deterministic event ID is computed, the
migration classifier applies the same full-row ingress classification used by
canonical append:

- retention-safe non-restricted rows use domain-separated SHA-256;
- restricted rows use the project-separated HMAC-SHA-256 commitment and record
  its key revision;
- secret-bearing rows are quarantined without exposing raw value, plain digest,
  or value-derived public identifier.

Ordering compares commitment bytes regardless of algorithm. Manifests, event
IDs, logs, and quarantine output never expose an unkeyed digest of restricted
content.

Legacy rows already occupying `events` are not left beside their canonical
replacement. SQLite may transactionally rebuild the physical `events` table;
PostgreSQL may rewrite rows into the expanded canonical shape. At verified
cutover:

- imported rows exist once in canonical envelope form;
- quarantined rows exist only in the migration quarantine and are excluded from
  ledger queries, project hash chains, and projections;
- superseded legacy rows are inaccessible to ordinary store APIs;
- a bounded observation archive may retain sealed source bytes by manifest
  hash, then retention removes it;
- no noncanonical row remains active in the authoritative `events` substrate.

### Current Event Rows

Current `SlopeEvent` rows are session telemetry with generated IDs, client
timestamps, optional session/sprint/ticket fields, and an untyped data object.
They do not establish authenticated principal, actor, authority, visibility,
round, or attempt identity.

Migration MUST import them as `legacy.telemetry_observed` evidence with:

- deterministic canonical event ID derived from project ID, source adapter,
  source table, legacy event ID, and classification-safe source-row commitment
- `trust = unverified_legacy`
- no invented principal or actor
- original timestamp preserved as `occurred_at`
- migration acceptance time as `accepted_at`
- original payload under a versioned legacy namespace
- source row locator and classification-safe source-row commitment

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

### Project-Scoped Relational Rewrite

Project scoping applies to physical constraints, not just query filters.
Migration rebuilds every authoritative identity and relationship so its key
includes `project_id`.

At minimum this covers:

- sessions and session references
- events and event references
- claims and lease ownership
- scorecards and scorecard versions
- common issues and learning
- testing sessions and findings
- workflow executions and step results
- memories
- idempotency, projections, outbox, quarantine, payload, and integrity rows

PostgreSQL's current globally keyed `sessions.session_id` and `events.id`, and
its child foreign keys that name only session or execution ID, MUST be replaced
with composite project-scoped primary, unique, and foreign keys. SQLite gains
the same logical constraints even though one repository owns its database
path.

Backfill joins parent and child on explicit project plus source identity. A
child with no unique project-scoped parent is quarantined. No migration may
attach it to the first matching global ID or the adapter's configured default
project.

Every post-cutover lookup and mutation includes the project predicate.
Application-generated globally unique IDs MAY remain, but they do not replace
the composite constraint.

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
    actor_id?,
    session_id?,
    authentication_context_id,
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
    subjects: [{
      subject_type,
      subject_id,
      membership_revision?,
      history_mode?
    }]
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
  payload_storage: {
    mode,
    inline_payload?,
    sealed_payload_ref?,
    payload_commitment
  },
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
- `visibility` is an explicit typed allowlist. Group-like subjects pin a
  membership revision and historical-access mode. An empty `subjects` list
  does not mean public.
- `correlation_id` groups one requested operation. `causation_id` names the
  direct accepted event that caused this event when one exists.
- `lease_proof` is mandatory for protected resource mutations and absent only
  for event types whose policy declares no resource ownership requirement.
- `payload_classification` cannot be weaker than any field in the payload.
- Inline payload is allowed only for retention-safe fields. Restricted
  removable content uses a sealed payload reference and immutable commitment.
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
| `round` | opened, finalization_started, finalization_aborted, finalization_timed_out, closed, reopened | round and scorecard |
| `attempt` | started, paused, abandoned, completed | attempt status |
| `assignment` | created, accepted, blocked, completed | assignment status |
| `shot` | evidence_added, ownership_changed, accepted | draft scorecard |
| `penalty` | recorded, causation_linked, resolved | draft scorecard |
| `lease_request` | requested, set_acquired, set_renewed, set_released, expired, fenced | lease and queue view |
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

### Finalization Recovery

Finalization is a persisted two-step round transition:

1. `round.finalization_started` changes `open -> finalizing` and records
   `finalization_id`, finalization epoch, owner principal, optional actor and
   session, deadline from authoritative store time, policy revision, and the
   aggregate preconditions to recheck.
2. `round.closed` presents that identity and epoch, rechecks all close
   invariants in one append transaction, publishes one immutable scorecard
   version, and changes `finalizing -> closed`.

Validation or projection failure emits `round.finalization_aborted` and changes
`finalizing -> open` without publishing. A crashed owner leaves the term
finalizing only until its deadline.

At or after the deadline, any authorized recovery request may append
`round.finalization_timed_out`, which changes `finalizing -> open` and fences
the old finalization epoch. A new finalizer then starts a greater epoch.
Correctness does not depend on a sweeper; close and new-start requests detect
the expired term and return the required timeout transition as their next
action.

No takeover reuses the old finalization identity. An exact retry of an already
accepted close returns the accepted scorecard through idempotency.

Finalizer identity always records `principal_id` and
`authentication_context_id`. `actor_id` and `session_id` are required for an
agent- or human-initiated close. They may be absent only for a registered
service principal holding a service-scoped finalization capability; absence
never causes actor inference.

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
- `lease_request.set_acquired` locks every canonical conflict domain and
  overlapping active lease subject under the evaluated policy revision.
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

A single event may atomically transition several child entries owned by its
one primary aggregate, such as a `lease_request` set. That is not batch append:
there is one event ID, sequence, aggregate version, idempotency record, and
payload schema.

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
| `STORE_AUTHORITY_CHANGED` | Caller or adapter pins a stale authority generation | Re-resolve store; never fall back |
| `STORE_PROTOCOL_UNSUPPORTED` | Adapter lacks the required coordination protocol | No until adapter changes |
| `TIME_AUTHORITY_UNHEALTHY` | Store time cannot safely grant or renew a lease | No until clock authority recovers |
| `REDACTION_STATE_CONFLICT` | Approval, target, policy, or round state changed before apply | Re-read and request fresh review |
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

## Resource Lease Model

### Lease Record

A protected resource ownership term is:

```text
resource_lease_v1 = {
  project_id,
  lease_request_id,
  lease_id,
  resource_subject,
  requested_access_mode,
  effective_access_mode,
  resource_policy_revision,
  conflict_set_revision,
  fence_domains: [{
    conflict_domain_id,
    fencing_token
  }],
  owner: {
    principal_id,
    actor_id,
    session_id,
    round_id,
    round_epoch,
    attempt_id,
    assignment_id?
  },
  lease_epoch,
  grant_fencing_token,
  state,
  acquired_at,
  renewed_at,
  renew_by,
  expires_at,
  ttl_seconds,
  acquisition_event_id,
  latest_renewal_event_id?
}
```

`resource_subject` is the mode-independent typed identity defined by the Team
Round domain contract. Access mode and policy revision MUST NOT create another
subject namespace.

`lease_id` identifies one ownership term. Releasing, abandoning, expiring,
revoking, or fencing that term makes it permanently terminal. Reacquisition
creates a new lease ID.

`lease_request_id` is the primary aggregate identity for one atomic requested
set. A client supplies a unique opaque request ID, and the idempotency scope
binds it to the canonical request. A one-resource acquisition is a set of one.
The server allocates child lease IDs only after locking the request aggregate
and conflict domains.

`lease_epoch` increases monotonically for each acquisition of the same canonical
resource subject. Renewal does not change it.

`grant_fencing_token` increases monotonically across all lease grants within a
project.

Every canonical resource subject maps under its pinned conflict policy to one
or more durable `conflict_domain_id` values. Any two subjects that may conflict
MUST share at least one domain. A grant updates each domain watermark to its
greater project grant token. This makes unequal overlapping subjects, including
ancestor and descendant file areas, share a fencing authority.

A policy revision whose overlap relation cannot produce this shared-domain
property is invalid and cannot activate.

### Lease States

```text
requested -> waiting -> active -> released
                       |       -> abandoned
                       |       -> expired
                       |       -> revoked
                       +       -> fenced

requested -> denied
waiting   -> cancelled
waiting   -> timed_out
waiting   -> dead_lettered
```

Only `active` authorizes a protected mutation. Terminal states never return to
active.

`expired` is a logical result of authoritative time, not merely a cleanup
event. Once store time is at or after `expires_at`, the lease is inactive even
if its projection still says active and no sweeper has emitted
`lease_request.entry_expired`.

### Ownership Binding

The authenticated principal owns lease authority. Actor, session, round,
attempt, and assignment bind its intended execution context.

- A role, alias, model name, branch, worktree, process ID, or display label
  cannot own or renew a lease.
- A replacement session does not inherit a lease implicitly.
- Transfer to another principal, actor, or session ends the old term and grants
  a new term with a higher epoch and grant fencing token.
- A policy MAY authorize a designated controller service to renew on behalf of
  an owner, but the controller principal and delegation event are recorded.
- Session liveness and lease ownership remain separate projections.

## Authoritative Lease Time

### Store Time

Lease decisions use `authoritative_store_time`, read inside the append
transaction. Client time, event `occurred_at`, session heartbeat time, Git time,
and process uptime are never lease authority.

Each project persists a nondecreasing time floor:

```text
authoritative_store_time =
  max(adapter_database_utc_time, persisted_project_time_floor)
```

The append transaction updates the floor. If the database clock moves backward,
time does not reverse. Expiry may pause until the clock catches up, which is a
liveness degradation rather than an unsafe extension based on client input.

If configured clock-skew or time-stall bounds are exceeded:

- new lease grants and renewals fail with `TIME_AUTHORITY_UNHEALTHY`;
- existing leases cannot be extended;
- protected writes remain valid only while the persisted floor is strictly
  before their recorded expiry;
- status and escalation views report the time-authority incident.

SQLite derives database time while holding its immediate write transaction.
PostgreSQL derives time from the database server in the transaction. Application
host clocks MUST NOT be substituted.

### Default Timing Policy

The version 1 default policy is:

```text
ttl_seconds = 300
renewal_cadence_seconds = 60
renewal_grace_seconds = 60
waiting_timeout_seconds = 900
recovery_retry_limit = 3
```

Projects MAY select another checked-in policy revision within implementation
limits. The event records the effective values.

`renew_by = expires_at - renewal_grace_seconds`. Renewal before `renew_by` is
healthy. Renewal from `renew_by` up to but not including `expires_at` is
accepted but emits a late-renewal diagnostic. At or after `expires_at`, renewal
is rejected and the owner must reacquire.

A session heartbeat MUST NOT renew a resource lease. A lease renewal is an
explicit capability-checked event with its own idempotency key.

## Lease Acquisition

### Conflict Evaluation

An acquisition request includes:

- unique `lease_request_id`
- canonical resource subject
- requested access mode
- expected resource-policy and conflict-set revisions
- owner binding and round epoch
- requested TTL
- idempotency key and correlation ID

The append transaction locks the durable request row and every conflict-domain
row for the requested subjects before inspecting active or waiting leases.
Those rows exist before the first lease does, so PostgreSQL cannot admit an
absent-row phantom race.

Exact, prefix, range, and cross-mode overlap policies define a finite,
deterministic set of conflict domains or use a serializable predicate strategy
with equivalent first-acquisition exclusion. Merely locking currently existing
lease rows is forbidden.

Conflict evaluation uses:

1. canonical type-specific subject equality and overlap;
2. the cross-mode compatibility matrix;
3. active lease state at authoritative store time;
4. policy activation fencing;
5. deterministic queue order.

Missing type canonicalization, overlap behavior, or cross-mode policy means
denied or exclusive conflict. It never means compatible.

### Grant

When no incompatible active lease exists and the requester is next in queue,
grant performs one atomic append:

- use `lease_request` as the primary aggregate;
- allocate one child lease ID per requested subject;
- increment each subject lease epoch;
- allocate the next project grant fencing token;
- update every affected conflict-domain watermark to that token;
- pin effective mode and policy revisions;
- calculate lease times from authoritative store time;
- mark the request active;
- remove or advance its queue entry;
- emit one `lease_request.set_acquired` event containing the canonical child
  lease entries;
- update the lease and queue projections.

The grant response returns the exact lease proofs. No client may construct or
increment an epoch or token.

### Atomic Multi-Resource Requests

A task that needs multiple resources SHOULD request them as one
`lease_request` aggregate containing a sorted set.
The store canonicalizes and locks all conflict sets in resource-type,
namespace, and resource-key order.

One `lease_request.set_acquired` event creates every child lease entry and
updates every affected subject and conflict-domain projection in the same
append transaction. This is one event on one primary aggregate, not a
multi-event batch.

The set is granted all-or-none. Partial ownership is forbidden unless the
request explicitly uses separate lease-request aggregates for independently
useful subsets and the workflow can release them safely.

Waiting requests do not hold a subset while waiting for the rest. This avoids
deadlock by construction.

Renewal, release, abandonment, or fencing of child entries increments the
owning lease-request aggregate version. An event may target a declared subset
of entries, but all changed entries remain one atomic aggregate transition.

### Fairness

Within one policy priority class, incompatible waiting requests are ordered by
their accepted request event sequence. Policy may define bounded priority
classes and deterministic aging, but a client cannot self-assign priority.

Bypassing an earlier waiter requires a recorded policy reason, proves the
earlier request is non-conflicting or ineligible, and remains visible to the
affected requester.

## Lease Renewal

A renewal presents:

```text
lease_proof = {
  project_id,
  lease_request_id,
  lease_id,
  resource_subject,
  lease_epoch,
  grant_fencing_token,
  fence_domains[],
  resource_policy_revision
}
```

Renewal succeeds only when:

- the authenticated principal owns the lease or has recorded renewal
  delegation;
- actor, session, round epoch, attempt, and assignment binding still match;
- the lease is active and store time is before expiry;
- lease epoch, grant token, every conflict-domain token, subject, mode, and
  policy revision exactly match;
- no policy activation has fenced the term;
- the requested TTL is allowed.

The renewed expiry is `authoritative_store_time + ttl_seconds`, not the prior
expiry plus TTL. Early renewals therefore cannot accumulate an unbounded future
term.

Renewal keeps the same lease ID, lease epoch, grant token, and conflict-domain
tokens. It appends one event on the lease-request aggregate and atomically
updates the expiry. An unknown commit result is resolved by retrying the same
idempotency key.

## Fencing Protected Mutations

Every protected mutation includes the complete lease proof in its canonical
request hash. In the append transaction the store verifies:

- exact active lease identity and ownership binding
- store time strictly before expiry
- exact current epoch, grant token, and conflict-domain token vector
- compatible requested mutation mode
- active resource and capability policy revisions
- matching round epoch
- no later overlapping lease that fences the presented term

Failure returns `LEASE_FENCED` or the non-enumerating policy equivalent before
event allocation.

Checking only `lease_id`, `expires_at`, session liveness, or a boolean
"claimed" flag is insufficient.

### External Resources

For a protected mutation performed by SLOPE, the store check and event append
are authoritative.

For an external database, service, or allocator:

- its adapter SHOULD pass the conflict-domain token vector to a
  conditional-write interface that rejects a token below the greatest accepted
  token for every relevant domain;
- an adapter that accepts only one token MUST use one policy-declared enclosing
  conflict domain shared by every subject that may overlap;
- if the external system cannot fence, SLOPE coordinates intent but cannot
  claim exactly-once or stale-writer prevention for the external side effect;
- if the adapter cannot represent the policy's overlap domains, every write
  MUST revalidate through SLOPE immediately before the side effect and the
  policy still reports external fencing as unsupported;
- that limitation is declared in the resource policy and visible to affected
  participants;
- secrets needed by an adapter remain outside event payloads.

Opening a TCP port or process that cannot consume a fencing token may still be
coordinated through exclusive allocation. The lease does not make the process
itself transactional.

## Release, Abandonment, And Expiry

### Release

An owner releases work it completed or no longer needs. Release is idempotent,
terminal, and immediately makes the subject eligible for the next compatible
waiter. Release does not erase activity, evidence, shots, hazards, or penalties.

### Abandonment

An owner emits abandonment when it knows the execution cannot continue.
Abandonment records:

- reason code and redacted detail
- last safe workflow state
- accepted output and evidence references
- uncertain external side effects
- recoverability classification
- causal assignment and attempt

Abandonment terminates the lease immediately. It does not mark work successful
or turn an incomplete ownership spell into observed zero loss.

### Expiry

Expiry requires no owner event. Any append that observes store time at or after
expiry treats the lease as inactive and may atomically materialize the expiry
event before evaluating the queue.

A sweeper MAY materialize expiries proactively. Correctness MUST NOT depend on
the sweeper running.

Session loss, heartbeat staleness, process exit, worktree deletion, or network
disconnect may trigger an early recovery warning. They do not themselves prove
lease expiry or authorize reassignment before an explicit revoke policy or TTL.

### Revocation And Fencing

Revocation before expiry requires a specific administrative capability and
reason. Policy activation may fence incompatible terms under its recorded
transition rule.

Both operations:

- terminate the old term;
- preserve its epoch and token in history;
- notify every affected visible participant;
- require later ownership to use a new lease and greater fencing token.

Administrative urgency cannot mutate or reuse the old lease.

## Retry, Requeue, And Recovery

### Failure Classification

Recovery classifies the failed operation:

| Class | Examples | Default action |
|---|---|---|
| `transient_store` | busy, serialization, temporary connection | Retry same operation and idempotency key |
| `unknown_commit` | response lost after possible commit | Resolve with same idempotency key |
| `execution_transient` | worker crash, bounded tool outage | Abandon attempt, requeue work |
| `execution_permanent` | invalid input, unsupported task contract | Dead-letter |
| `policy_denied` | missing capability or visibility | Escalate; do not retry automatically |
| `integrity_or_schema` | corrupt chain, unknown mandatory version | Stop affected work and escalate |
| `external_uncertain` | side effect may have happened | Reconcile before requeue |

Lease-operation retry and work retry are different. Store retry preserves the
same operation identity. Work retry creates a new attempt and new lease term
while retaining the same round and assignment lineage.

### Recovery Item

```text
recovery_item_v1 = {
  project_id,
  recovery_id,
  round_id,
  assignment_id,
  prior_attempt_id,
  prior_lease_ids[],
  failure_event_id,
  classification,
  retry_count,
  retry_limit,
  available_at,
  state,
  reconciliation_required,
  dead_letter_reason?
}
```

Requeue is an event, not a mutable queue overwrite. It preserves causation to
the failure and prior attempt.

### Requeue

Requeue requires:

- every prior required lease is terminal or fenced;
- uncertain external side effects are reconciled or explicitly contained;
- accepted shot, penalty, and evidence IDs are known and cannot be duplicated;
- retry count and age remain within policy;
- assignment policy permits another attempt.

The new execution gets a new `attempt_id`. Resource acquisition gets new lease
IDs, epochs, and fencing tokens. Prior accepted evidence remains immutable.

`available_at` is assigned from authoritative store time plus the versioned
backoff policy. Optional jitter is derived deterministically from recovery ID
and retry count and is persisted in the event.

### Dead Letter

A recovery item enters `dead_lettered` when:

- retry limit or maximum recovery age is exceeded;
- failure is permanent;
- integrity or schema safety cannot be established;
- external effects remain irreconcilably uncertain;
- required identity or authority cannot be reconstructed.

Dead-letter records contain reason code, redacted diagnostic, failure and
attempt lineage, retry history, affected resource subjects, and required
operator capability. They MUST NOT copy secret payloads.

Dead-letter is terminal for that recovery item. An authorized operator may
create a new recovery item with explicit causation and remediation evidence;
they do not reopen or edit the dead-letter row.

### Escalation

Escalation is an append event and filtered projection visible to authorized
operators and affected participants. It includes:

- severity and reason
- blocked round, assignment, and resource subjects
- current owner and waiter identities only where visible
- deadline or service objective
- safe available actions
- evidence and dead-letter references

Escalation does not grant capability, steal a lease, count a shot, waive
verification, or close a round. An operator action still uses the ordinary
capability, idempotency, append, and fencing contract.

## Lease Observability

Authorized status views distinguish:

- active and healthy
- active in renewal grace
- logically expired but not yet materialized
- waiting with queue position and blocking subject
- abandoned and recovery pending
- fenced or revoked
- timed out
- dead-lettered
- time-authority unhealthy

The view shows authoritative store time and projection cursor. It does not
refresh heartbeat or lease state merely by reading.

Hidden principals or resources use redacted, non-enumerating blockers while
still telling an affected requester that its request cannot proceed.

## S264.1-3 Acceptance Criteria

The lease and recovery contract is complete when an implementer can answer:

- Which identity owns a lease and can a role or replacement session inherit it?
- Which clock decides expiry, and what happens when that clock moves backward?
- Do heartbeat or status reads renew a lease?
- Which values change on renewal versus reacquisition?
- Can a stale holder write after another actor receives an overlapping subject?
- How are multi-resource deadlocks prevented?
- Does correctness depend on an expiry sweeper?
- Can a crashed worker erase accepted evidence or create a second scorecard?
- When does retry preserve an idempotency key and when does it create a new
  attempt?
- What blocks requeue when an external side effect is uncertain?
- When does work dead-letter, and can escalation silently grant authority?

## Security Model

### Protected Assets

The security boundary protects:

- project, sprint, round, attempt, assignment, shot, penalty, and scorecard
  identity
- capability and visibility policy
- resource leases and fencing tokens
- unpublished evidence and restricted diagnostics
- accepted scorecard versions and exports
- identity bindings and verifier evidence
- event order, idempotency, causation, and integrity checkpoints

### Adversaries And Failures

The implementation assumes:

- a client may forge actor, session, role, scope, time, event ID, version,
  capability, visibility, or lease fields;
- an authenticated principal may be curious, compromised, or malicious;
- two aliases, actors, or sessions may resolve to one principal;
- a worktree or process may use stale cached authority;
- concurrent requests may race policy revocation, lease expiry, reopen, or
  finalization;
- payloads may accidentally contain credentials or private transcripts;
- caches, cursors, diagnostics, metrics, and error text may leak hidden
  existence;
- an adapter or compatibility method may bypass the canonical append path;
- a database operator may corrupt partial state.

A database administrator who can rewrite the complete ledger, projections,
keys, and every independent checkpoint is outside the tamper-prevention
guarantee. Independently anchored checkpoints can make that attack detectable.

Authentication provider compromise, host compromise, and malicious external
tools require deployment controls beyond this contract. They do not relax
store-side authorization, filtering, or audit requirements.

## Deny-By-Default Capabilities

### Capability Grant

Authority is represented by immutable grant and revocation events:

```text
capability_grant_v1 = {
  project_id,
  grant_id,
  principal_id,
  capability,
  scope: {
    subject_type,
    subject_id,
    constraints
  },
  issued_by_principal_id,
  issued_at,
  not_before?,
  expires_at?,
  delegable,
  policy_revision,
  grant_event_id
}
```

A request is allowed only when an active grant matches principal, capability,
subject, operation constraints, store time, and policy revision. Missing,
unknown, malformed, expired, revoked, or ambiguous grants deny.

Role, actor alias, model, session, branch, worktree, environment variable,
display name, or client-provided group does not grant capability.

Group or team authority is permitted only through a store-verified membership
projection whose membership event, grant, scope, and effective sequence are
recorded in the authorization decision.

### Trust Bootstrap

A new project has no implicit administrator. Bootstrap is a one-time
store-initialization ceremony:

1. create or verify stable project identity;
2. authenticate one provider principal through an installation-local trusted
   channel;
3. write the genesis project, identity-policy, capability-policy, visibility,
   resource-policy, and integrity checkpoint records;
4. issue an enumerated bootstrap administration grant;
5. close the bootstrap token and channel permanently.

The bootstrap manifest, principal binding, policy revisions, and checkpoint
hash are displayed for operator confirmation and recorded in project evidence.

Bootstrap MUST NOT derive administrator identity from `$USER`, role text,
repository ownership, Git author, branch, worktree path, or the first remote
request. An existing project refuses bootstrap unless an authorized recovery
policy proves the prior trust root unavailable.

Migration from a store without principal identity requires an explicit
operator-supplied mapping and migration manifest. Ambiguous rows remain
quarantined; they do not inherit the bootstrap grant.

Trust-root recovery and key rotation are policy events requiring the dedicated
recovery capability, bounded scope, distinct approval, prior checkpoint
verification, and immediate revocation of superseded authentication contexts.
Recovery cannot create a new project identity over existing history.

### Capability Registry

Version 1 defines at least:

| Capability | Protected operation | Required scope |
|---|---|---|
| `round.read` | Read filtered round state | project, sprint, or round |
| `round.open` | Create canonical round | sprint |
| `round.append_evidence` | Add score-affecting evidence | round and ticket or shot |
| `round.finalize` | Enter finalizing and publish close | round |
| `round.reopen` | Audited reopen and correction scope | round |
| `assignment.manage` | Create, cancel, or reassign work | round and ticket |
| `assignment.act` | Accept, block, or complete assigned work | assignment |
| `lease.acquire` | Request protected resource ownership | resource subject |
| `lease.renew_own` | Renew an owned lease | lease and resource subject |
| `lease.release_own` | Release or abandon an owned lease | lease and resource subject |
| `lease.revoke` | Revoke or fence another owner | resource subject |
| `verification.request` | Request independent verification | round and shot or scorecard |
| `verification.record` | Record verifier evidence | verification target |
| `scorecard.read_draft` | Read filtered mutable scorecard | round |
| `scorecard.read_published` | Read an immutable version | round and version |
| `scorecard.export` | Create a redacted durable export | round and version |
| `event.read_filtered` | Query filtered ledger events | declared subject scope |
| `recovery.manage` | Requeue or dead-letter recovery | recovery item |
| `redaction.request` | Request content redaction | event or payload object |
| `redaction.approve` | Approve high-impact redaction | redaction request |
| `redaction.apply` | Apply an approved tombstone or key destruction | redaction request and target |
| `retention.apply` | Materialize due retention policy | policy scope |
| `policy.manage` | Grant, revoke, or activate policy | policy subject |
| `integrity.verify` | Run protected integrity verification | project |
| `integrity.repair` | Append a forward repair | project and incident |

An implementation MAY split capabilities more finely. It MUST NOT combine them
into a broad role that silently grants more authority.

`round.read` does not imply raw event, draft scorecard, export, or restricted
diagnostic access. `round.finalize` does not imply reopen. `lease.acquire` does
not imply revoke. `policy.manage` does not imply integrity repair.

### Scope And Constraints

Capability scope uses canonical typed subject identity. A grant may constrain:

- sprint, round, round epoch, attempt, assignment, ticket, shot, or penalty
- resource type, namespace, key pattern, and access mode
- maximum lease TTL
- event types and payload classifications
- visibility classifications and subjects
- scorecard version and export purpose
- time window and maximum uses
- required independent approval

Wildcard scope is denied unless policy explicitly enables that exact wildcard
for the issuing principal. A project-wide administrative bundle expands to
enumerated capabilities and constraints; it is not an unlogged superuser bit.

### Authorization Ordering

Capability state is an authoritative synchronous projection.

Append locks the active capability-policy row and relevant grant or revocation
rows. A concurrent revocation is ordered before or after the mutation:

- if revocation commits first, the mutation denies;
- if the authorized mutation commits first, it remains valid and the later
  revocation affects subsequent operations.

Cached grants cannot authorize append. A cache may accelerate a negative or
candidate lookup, but the transaction verifies active authority.

### Delegation

A delegable grant states which narrower capabilities and scopes may be issued.
Delegation cannot:

- exceed the parent capability or scope;
- outlive the parent grant;
- remove required approvals;
- cross projects;
- become delegable when the parent is not;
- survive parent revocation.

Every descendant decision records its grant chain. Revoking a parent makes all
descendants ineffective at the same ordered policy transition.

### Break Glass

Break-glass authority is an explicit short-lived grant, not a hidden bypass.
It requires:

- a dedicated break-glass capability;
- strong provider authentication;
- incident or recovery reason;
- minimal subject scope and expiry;
- a distinct approving principal for reopen, broad export, redaction approval,
  policy replacement, or integrity repair;
- immediate audit and affected-party notification where visibility permits.

Break glass cannot edit accepted events, reuse a fenced lease, skip integrity
verification, invent verifier independence, or disclose secret payloads in
audit output.

## Visibility And Classification

### Classifications

Version 1 classifications are ordered:

```text
public < project < round < restricted < security
```

| Classification | Intended content | Default audience |
|---|---|---|
| `public` | Explicitly publishable result | Policy-declared public readers |
| `project` | Ordinary project coordination | Authorized project principals |
| `round` | Draft evidence and participant state | Authorized round subjects |
| `restricted` | Private diagnostics or limited evidence | Explicit principal or group allowlist |
| `security` | Policy, incident, redaction, or integrity detail | Explicit security capability |

The default classification is `restricted`, not `project` or `public`.
Projects may introduce stricter classes but cannot reorder built-in meaning
without a new policy revision.

Visibility subjects are typed. Supported subject types include principal,
verified group, round participant, affected resource requester, and explicit
observer grant. Role text alone is not a visibility subject.

### Membership Semantics

A group-like visibility subject records both `membership_revision` and one
explicit history mode:

- `event_members`: only principals who were verified members at event
  acceptance are in the event allowlist;
- `current_members`: current verified members may read historical events while
  removed members lose access;
- `event_and_current`: the viewer must have been a member at acceptance and
  remain a current member.

The default for `restricted` and `security` data is `event_and_current`. The
default for ordinary `round` participant data is `event_members`; a later
participant receives earlier context only through a separate capability and
visibility grant.

Historical `as_of` reads still evaluate the viewer's current authentication,
capability, and revocation state. A past grant or membership cannot resurrect
access revoked now.

### Write-Time Enforcement

Before append the store:

1. validates every payload field against the registered classification schema;
2. raises the event classification to the strictest contained field;
3. canonicalizes and verifies visibility subjects;
4. proves the writer may disclose each field to that subject set;
5. rejects secret-bearing or disallowed payload content;
6. records the exact visibility decision and policy revision.

A writer cannot make evidence visible to a principal the writer is not
authorized to inform.

## Filtered Views

### Query Request

All ordinary reads use a filtered projection request:

```text
filtered_view_request_v1 = {
  project_id,
  viewer_authentication_context_id,
  capability,
  subject_scope,
  purpose,
  as_of_event_sequence?,
  projection_name,
  projection_schema_version,
  cursor?
}
```

Project and principal are derived from trusted authentication context. The
client cannot query another project by changing `project_id`.

`purpose` is a registered policy identifier, not free text. The viewer must
hold a capability permitting that purpose and subject scope.

The response identifies:

- pinned as-of event sequence
- projection and reducer revision
- visibility policy revision
- redaction and retention policy revision
- filtered records
- field-level redaction reasons safe for that viewer
- viewer-bound next cursor

### Row And Field Filtering

The store applies both:

- row-level visibility: whether the viewer may know the event or aggregate
  exists;
- field-level visibility: which permitted fields may be returned.

Projection reducers keep sufficient classification metadata to filter each
field. They MUST NOT flatten restricted content into an unlabeled string.

Raw table access, unfiltered event lists, internal persistence records, and
adapter-specific JSON are not ordinary application APIs.

### Non-Enumeration

For a viewer who cannot know an object exists:

- missing and denied use the same external result;
- error code, response shape, pagination count, timing bucket, cache behavior,
  and diagnostic text avoid confirming existence;
- idempotency, lease, conflict, and causation errors do not reveal hidden owner
  or resource identity;
- aggregate counts and queue positions include only visible records or an
  explicitly policy-safe approximation.

An affected requester may be told that a visible resource request is blocked
without learning the hidden owner's identity or work.

### Cursors And Caches

Every cursor is opaque, integrity-protected, and bound to:

- project and viewer principal
- capability and subject scope
- purpose
- as-of event sequence
- projection schema and reducer revision
- visibility, redaction, and retention policy revisions
- expiry

Using a cursor under another principal, project, purpose, or policy revision
fails without revealing the original scope.

Cursor plaintext is the JCS-canonical object containing every binding above,
issued-at time, expiry, and cursor invocation identity. It is encrypted and
authenticated with AES-256-GCM under a project-separated cursor key. The
external cursor envelope contains only cursor format version, key revision,
nonce, ciphertext, and authentication tag.

Each key revision receives a 32-bit CSPRNG prefix at creation and a monotonic
64-bit invocation counter held and incremented by the non-restorable managed
key service. The 96-bit GCM nonce is:

```text
cursor_nonce = key_random_prefix_32 || u64be(invocation_counter)
```

Issuance is forbidden if the counter cannot be incremented atomically. A crash
may skip a value but cannot reuse one. Backup restore cannot roll the counter
back. The service rotates the cursor key before `2^32` invocations and refuses
further issuance at that bound.

Project, principal, hidden subject IDs, and purpose remain inside ciphertext.
The AEAD additional authenticated data uses the cursor domain-separation frame
and key revision. Verification checks tag, key revision, expiry, current
authentication, current authorization, and every plaintext binding before
using a cursor.

Cursor keys are separate from payload, commitment, idempotency, and wrapping
keys. Rotation retains old verification keys no longer than the maximum cursor
lifetime. Bit flips, cross-binding substitution, replay after expiry, and use
after visibility-policy invalidation fail with the same non-enumerating cursor
error.

Cache keys include the same dimensions. An unfiltered cache entry MUST NOT be
shared with a filtered reader. Grant revocation, visibility reduction,
redaction, or retention activation invalidates affected cache generations.

### Diagnostics And Observability

Logs, traces, metrics, health output, exception messages, audit summaries, and
review packets are filtered surfaces too.

They use opaque identity where possible and MUST NOT include:

- credentials or secret values
- sealed payload plaintext
- unrestricted tool arguments or output
- private transcript content
- hidden principal, actor, assignment, or resource names

Operators with security capability may retrieve deeper diagnostics through an
explicit filtered security view rather than ordinary process logs.

## Secret Prevention And Payload Storage

### Ingress

Credentials, private keys, access tokens, session cookies, raw authentication
headers, secret environment values, and unrestricted private transcripts are
prohibited in every caller-controlled request field, not only event payload.

Before logging, hashing, lookup, canonicalization output, or append, the trusted
boundary validates field-specific grammar and size and scans:

- idempotency key and operation ID
- correlation and causation ID
- aggregate and scope identifiers
- ticket, shot, penalty, assignment, and lease-request ID
- resource type, namespace, key, and mode
- visibility subjects and purpose
- actor/session attribution supplied by the client
- every precondition, lease-proof field, and payload field

Opaque identifiers have an ASCII grammar and bounded length. Typed resource
keys and human text use their registered canonicalizer and size bound. A field
whose legitimate grammar can resemble a credential is still secret-scanned and
uses a sealed reference rather than an inline escape hatch.

A detected secret causes rejection. The rejected raw value is not logged,
placed in an error, hashed into a user-visible identifier, used as a lookup key,
or copied into an incident.

The incident may record secret category, source operation, affected project,
and an opaque detection ID.

### Inline And Sealed Payloads

Retention-safe, non-secret payload fields may be stored inline in the immutable
event.

Allowed restricted content that must later be removable uses:

- an immutable sealed payload reference in the event;
- an immutable commitment and ciphertext digest;
- encrypted ciphertext in protected payload storage;
- a separately controlled data-encryption key;
- classification, retention deadline, and visibility metadata.

The event hash covers the reference, commitment, digest, and metadata, not
plaintext. Decrypt capability is checked separately from event visibility.

Essential lifecycle, ordering, authority, fencing, score impact, and integrity
facts MUST be retained in non-secret canonical fields. A projection needed to
authorize later writes cannot depend on decrypting content that policy permits
to expire.

### Canonical Cryptography

Version 1 pins algorithms through the schema registry:

- canonical serialization: RFC 8785 JSON Canonicalization Scheme (JCS) over
  I-JSON-compatible input
- event, response, ciphertext, checkpoint, and projection digest:
  SHA-256 over domain-separated canonical bytes
- restricted request and payload commitment: HMAC-SHA-256 with a
  project-separated protected key and recorded key revision
- filtered cursor confidentiality and integrity: AES-256-GCM with a
  project-separated cursor key and recorded key revision
- sealed payload encryption: AES-256-GCM with a unique random nonce and
  per-object data-encryption key wrapped by a managed key-encryption key

JCS input additionally obeys:

- duplicate object keys, lone Unicode surrogates, NaN, infinity, and negative
  zero are rejected;
- event sequences, aggregate versions, epochs, fencing tokens, and other
  potentially 64-bit integers are canonical unsigned decimal strings matching
  `0|[1-9][0-9]*`;
- other JSON numbers are safe integers only;
- non-integer quantities use schema-defined decimal strings with fixed scale,
  never binary floating point or exponent variants;
- typed identity and resource strings complete their domain canonicalization
  before JCS; arbitrary human text preserves its exact Unicode scalar sequence.

Domain-separated digest input is:

```text
ASCII("SLOPE-TEAM-ROUND-V1") || 0x00 ||
u32be(len(purpose))         || purpose_utf8 ||
u32be(len(project_id))      || project_id_utf8 ||
u32be(len(schema_revision)) || schema_revision_utf8 ||
u32be(len(jcs_bytes))       || jcs_bytes
```

Every segment is length-prefixed and bounded below `2^32` bytes. Concatenating
unframed strings is forbidden.

Plain SHA-256 of low-entropy restricted content is forbidden because it permits
dictionary recovery.

Integrity hashes are unkeyed so independent verifiers can recompute them.
Restricted commitments are keyed so the ledger does not expose a plaintext
guessing oracle.

Events record algorithm and key revisions, never key material. Rotating an
integrity algorithm, commitment key, or wrapping key is an authorized policy
event:

- old immutable events keep their original revision;
- verifiers retain the algorithms and protected commitment keys needed for the
  declared history window;
- wrapping-key rotation rewraps data-encryption keys without changing event
  commitments;
- redaction destroys the target data-encryption key, not the commitment key;
- key loss that prevents required verification marks integrity unhealthy and
  cannot be papered over with a new key.

The conformance suite publishes cross-language and cross-adapter golden vectors
for canonical bytes, each digest purpose, restricted commitments, cursor AEAD,
and sealed payload metadata, including Unicode and numeric rejection cases.

## Redaction

### Redaction State Machine

Manual redaction is an append-only aggregate:

```text
requested -> approved -> applied
    |            |       -> failed
    +-> cancelled
```

Events are `redaction.requested`, `redaction.approved`,
`redaction.applied`, `redaction.failed`, and `redaction.cancelled`.

```text
redaction_v1 = {
  project_id,
  redaction_id,
  target_event_id,
  target_payload_fields_or_ref,
  reason_code,
  requested_by_principal_id,
  approval_requirement,
  approved_by_principal_id?,
  applied_by_principal_id?,
  state,
  effective_event_sequence,
  replacement_tombstone,
  key_destruction_evidence?,
  policy_revision
}
```

Request requires `redaction.request`. Approval requires
`redaction.approve`. Destruction or tombstone activation requires
`redaction.apply` and reauthorizes the current request, target, approval,
visibility, retention policy, scorecard dependency, and round state inside the
apply transaction.

Restricted or security content, identity-profile removal, broad subject scope,
score-supporting evidence, and any redaction that changes current round
acceptance require an approving principal distinct from requester and applier.
Lower-risk project content may use a policy revision whose
`approval_requirement = none`; the applied event records that explicit rule
rather than an ambiguous absent approval.

The applier cannot expand target fields beyond the approved request. Approval
expiry, policy change, target change, or scorecard-state change returns the
request to a non-applied conflict requiring fresh review.

Failure records a redacted reason and leaves plaintext disclosure failed closed
when destruction may have partially occurred.

Applied redaction does not edit the target event, event hash, sequence,
aggregate version, idempotency identity, or integrity chain.

For sealed payload, redaction deletes ciphertext when permitted and destroys
the data-encryption key. The immutable reference and commitment remain as an
audit tombstone. For inline data that policy later decides should have been
removable, the store cannot pretend deletion while preserving immutable bytes;
that is a schema incident requiring forward migration and deployment review.

### Protected Facts

Redaction MUST NOT erase or change:

- that an accepted event occurred
- event sequence, aggregate version, correlation, or causation
- capability decision and policy revision
- lease epoch, fencing token, and ownership term identity
- round epoch, close, reopen, or scorecard version
- canonical shot, penalty, loss-component, or team-score effect
- integrity commitments and checkpoints

Personal display data is stored in a separable identity profile. Erasing that
profile leaves an opaque principal or actor ID in immutable history without
retaining the removed display mapping.

### Score-Affecting Evidence

If valid redaction removes evidence required to justify a currently accepted
scorecard, policy must either:

- retain a sufficient non-sensitive derived fact already committed before
  close; or
- audited-reopen the round, apply a scoped correction, and publish a new
  scorecard version before the evidence becomes unavailable.

Redaction itself cannot silently change a score.

When law or incident response requires immediate destruction before ordinary
reconciliation, the first durable step is an authorized `round.reopened` event
with reason `required_redaction`, the approved redaction request ID, and a
correction scope covering the affected evidence. That ordinary audited reopen
atomically changes `closed -> open`, increments round epoch, and clears
`accepted_scorecard_version`.

The redaction apply then verifies the open round and correction scope before
destruction. The reopen requires `round.reopen`; application requires
`redaction.apply`; the approved request binds both operation IDs and their
causation. Possessing either capability alone is insufficient.

Break-glass policy may expedite the two authorized operations but cannot
introduce a fourth lifecycle state or clear acceptance outside audited reopen.
The latest published version remains stale historical evidence, and current
handicap and completion views exclude the open round until a later close.

## Retention

### Default Policy

The built-in safe default is:

| Data | Default retention |
|---|---|
| Credentials, secrets, raw auth headers | Never accepted |
| Unrestricted tool payloads and private transcripts | Never accepted |
| Restricted removable diagnostics | 30 days |
| Ordinary removable coordination content | 90 days |
| Sealed payload ciphertext after redaction | Delete immediately |
| Core event envelope and integrity facts | Project lifetime |
| Capability, lease, idempotency, close, reopen, shot, penalty, and score facts | Project lifetime |
| Published canonical scorecard bytes and checkpoint | Project lifetime |
| Personal display profile | Account lifetime or stricter project policy |
| Idempotency and redaction tombstones | Project lifetime |

A checked-in project policy may shorten removable content retention and may
lengthen it only with an explicit purpose, access scope, and maximum. Legal or
organizational requirements may override durations through a versioned policy
event.

### Retention Application

Retention deadlines are assigned at append from store time and pinned policy.
A retention worker materializes due transitions, but read filtering treats
content as expired at the deadline even before deletion runs.

Retention application:

- is capability checked and idempotent;
- records affected references and policy, not removed plaintext;
- invalidates filtered caches and cursors;
- preserves commitments and essential facts;
- verifies projections no longer depend on removed content;
- reports deletion or key-destruction failure as a security incident.

Retention failure fails closed for further disclosure of expired data. It does
not rewrite event history.

### Backup And Restore

Backups MUST NOT make destroyed or expired content recoverable to an ordinary
reader.

Per-object data-encryption keys are wrapped by a non-restorable managed key
service; database backups contain only wrapped keys and ciphertext. Applied
redaction destroys the key in that service and writes a tombstone to an
independently durable deletion registry containing project ID, payload
reference, commitment, redaction event ID, effective sequence, and policy
revision. The registry stores no plaintext or decryptable key.

The project authority generation and highest trusted integrity checkpoint are
also recorded outside the restorable database boundary.

A restored SQLite or PostgreSQL store starts isolated with all ordinary reads
and writes disabled. Before activation it must:

1. verify stable project identity and adapter protocol;
2. prove restored authority generation is not ahead of or ambiguously forked
   from the independently recorded generation;
3. replay canonical archived events through at least the independent trusted
   checkpoint and deletion-registry high-water mark;
4. reconcile every redaction tombstone and KMS destruction state, deleting any
   restored ciphertext whose key is destroyed;
5. apply every retention deadline due at current authoritative store time;
6. rebuild filtered projections and verify project and aggregate hash chains;
7. issue a new, greater authority generation and `store.restored` event before
   enabling canonical append.

If the event archive cannot reach the trusted high-water mark, the restored
copy remains a quarantined forensic snapshot. It cannot become the
authoritative writer or serve payloads merely because its local schema and hash
chain are internally consistent.

Backup tooling, manual PostgreSQL restore, and SQLite file replacement all use
this same activation gate. Schema-shape validation alone is insufficient.

### Export

Export requires `scorecard.export` or a more specific explicit capability. An
export pins:

- project, round, and immutable scorecard version
- as-of event sequence
- projection, reducer, visibility, redaction, and retention revisions
- viewer principal and stated purpose
- included classifications and redaction summary
- export content hash and creation event

Export runs from a filtered projection. Raw ledger dumps are security
administration operations, not scorecard export.

## Adversarial Enforcement Criteria

S268 and S269 MUST ship automated evidence for every scenario below against
both SQLite and PostgreSQL behavior.

### Identity And Project Isolation

1. A client-supplied project or principal ID cannot cross the authenticated
   project boundary.
2. Forged actor, session, role, or group fields cannot grant capability.
3. Two actors or sessions bound to one principal remain one principal for
   security and later verifier-independence checks.
4. Equal event, idempotency, round, or resource labels in different projects do
   not collide or leak.
5. A legacy unverified event cannot authorize, verify, lease, reopen, or close.
6. A second bootstrap attempt or environment-derived administrator is denied.

### Append And Concurrency

7. Two concurrent appends expecting one aggregate version produce one success
   and one version conflict.
8. Event, idempotency record, synchronous projections, cursor, outbox, and
   integrity heads commit all-or-none under injected failure at each step.
9. Rolled-back PostgreSQL append leaves no canonical sequence gap.
10. Same-key exact retry returns one operation; changed payload, principal,
    precondition, policy expectation, or lease proof conflicts.
11. Capability revocation racing append has a serial order and never permits a
    post-revocation stale-cache write.
12. Audited reopen racing close cannot accept two scorecard versions or mutate
    prior published bytes.

### Leases And Recovery

13. Client time cannot extend, renew, or revive a lease.
14. Session heartbeat and status reads do not renew lease or session authority.
15. A stale owner is rejected after release, expiry, revocation, policy fence,
    transfer, or overlapping reacquisition.
16. A renewal preserves epoch and token; reacquisition changes lease ID, raises
    epoch, and raises fencing token.
17. Multi-resource acquisition grants all-or-none and remains deadlock-free
    under reversed client request order.
18. Correct expiry and queue advancement do not depend on a sweeper.
19. Recovery preserves accepted evidence, creates a new attempt, and cannot
    duplicate shot or penalty identity.
20. Unknown external side effect blocks automatic requeue.
21. Retry exhaustion produces a redacted dead-letter and escalation without
    granting authority.

### Visibility And Privacy

22. Hidden and nonexistent objects are indistinguishable in externally visible
    error shape, count, cursor, cache, and bounded timing class.
23. Viewer-bound cursor or cache material cannot be replayed by another
    principal, project, purpose, or policy revision.
24. Field-level restricted content never appears in a row-visible lower-trust
    view.
25. Historical reads cannot revive a currently revoked grant or membership.
26. A later group or round member sees prior restricted content only under its
    recorded history mode and an active current grant.
27. Ordinary logs, metrics, health, exceptions, and review packets contain no
    sealed plaintext or hidden identity.
28. Credential fixtures are rejected before append and do not appear in event,
    incident, log, or hash output.
29. Restricted idempotency and payload commitments do not provide an offline
    plaintext guessing oracle.
30. Redaction leaves event and integrity hashes valid while plaintext becomes
    unavailable.
31. Retention expiry hides data before asynchronous deletion and fails closed
    if deletion fails.
32. A redaction or retention action cannot silently alter the accepted team
    score.
33. Immediate destruction of required evidence clears current scorecard
    acceptance until reconciliation.
34. Export contains only the authorized filtered scorecard and a pinned
    redaction manifest.

### Replay, Migration, And Bypass

35. Full replay after redaction produces the same retained authoritative state
    and deterministic tombstones.
36. Unknown mandatory schema or broken hash chain stops authoritative replay
    and append.
37. Migration quarantine refuses ambiguous project, identity, idempotency, or
    scorecard input.
38. Compatibility methods cannot write sessions, claims, workflows,
    scorecards, or events outside `append_team_event` after cutover.
39. Direct adapter construction still resolves the repository-owned project
    state and cannot create worktree-local authority.
40. Policy downgrade cannot create a second resource namespace, expose prior
    restricted content, or preserve incompatible live leases.
41. Concurrent first acquisition on absent rows produces one compatible result
    for exact, prefix, range, and cross-mode overlap on both adapters.
42. Credential fixtures in every caller-controlled identifier, scope,
    visibility, lease-proof, and payload field are rejected before lookup,
    hashing, or logging.
43. Cursor bit flips, expiry replay, and cross-principal, project, purpose, and
    policy substitution fail AEAD verification without existence disclosure.
44. Redaction cannot skip required independent approval, self-approve,
    over-expand its target, or apply after stale reauthorization.
45. Restoring a backup before redaction or retention cannot decrypt, disclose,
    or reactivate removed content and cannot lower authority generation.
46. A custom or old adapter without the complete coordination protocol
    descriptor cannot resolve for Team Round operations after cutover.
47. RFC 8785 canonicalization and every domain-separated digest match published
    golden vectors across SQLite, PostgreSQL, and an independent
    implementation.
48. Cursor nonce allocation remains unique under concurrency, crash, key
    rotation, and database restore, and refuses issuance at the per-key
    invocation bound.
49. A legacy process connected before migration is denied every session, claim,
    workflow, scorecard, common-issue, and event mutation during inventory,
    expand, backfill, verify, cutover, and observe.

### Test Methods

Evidence includes:

- shared adapter contract tests
- transaction fault injection before every durable write
- concurrent writer and policy-race tests
- virtual authoritative clock tests
- property tests for canonicalization, overlap, idempotency, and filtering
- replay from genesis and verified snapshots
- migration resume, divergence, and rollback tests
- malicious request corpus and credential fixtures
- cache and cursor confusion tests
- full scorecard close and reopen replay

Wall-clock sleeps, prompt compliance, client-hidden buttons, and manual log
inspection are not sufficient enforcement evidence.

## Downstream Ownership

S268 implements:

- canonical Team Round event envelope and existing-store migration
- scorecard, shot, penalty, loss-component, and version schema
- atomic append, idempotency, ordering, projection, replay, and integrity
- exactly-once close and audited reopen mechanics
- capability and filtered-view substrate required by finalization

S269 implements:

- typed resource canonicalization and conflict policy
- renewable lease, epoch, fencing, queue, retry, dead-letter, and escalation
- protected mutation lease proof
- capability enforcement for resource and recovery operations
- adversarial concurrency and stale-owner tests

S270 and S271 consume this substrate. They MUST NOT add alternate identity,
authorization, event, lease, or scorecard authorities.

## S264.1-4 Acceptance Criteria

The security contract is complete when an implementer can answer:

- Which explicit capability authorizes every protected operation?
- Can a role, alias, session, branch, worktree, or client group grant access?
- How is a grant revocation ordered against an in-flight append?
- Can a cursor, cache, count, error, or timing class disclose hidden existence?
- Where is field-level classification retained for projection filtering?
- Can credentials, raw tool payloads, or private transcripts enter the ledger?
- How can removable restricted payload be destroyed without rewriting the event
  hash chain?
- Which immutable score and fencing facts can never be redacted?
- What happens when evidence needed by an accepted scorecard must be removed?
- When is expired data hidden if the retention worker is late?
- What exact hostile tests must pass on SQLite and PostgreSQL before S268 or
  S269 can ship?
