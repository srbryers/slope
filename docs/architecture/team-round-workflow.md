# Team Round Collaboration Workflow And Evaluation Contract

Status: normative design contract  
Sprint: S264.2  
Issue: [#669](https://github.com/srbryers/slope/issues/669)  
Research input:
[Buzz multiplayer collaboration](../research/buzz-multiplayer-collaboration.md)  
Prerequisites:
[Team Round domain and scoring contract](team-round-domain.md) and
[coordination integrity and security contract](team-round-coordination.md)

## Purpose

This document completes the product and operating contract for multi-agent Team
Rounds. It defines:

- how work is assigned, acknowledged, executed, handed off, blocked, completed,
  verified, cancelled, and recovered;
- which durable principals may independently verify another principal's work;
- how concurrent learning merges without losing evidence;
- which activity is prominent on the status surface;
- how multiplayer and single-agent trials are reproduced, redacted, compared,
  and interpreted.

The contract is transport-neutral. A CLI, MCP client, local service, or future
hosted coordinator may present the workflow, but only authoritative ledger
events and their deterministic projections establish workflow truth.

## Decisions

1. An assignment is a durable aggregate, not a chat message, prompt, claim, or
   process invocation.
2. Every started execution spell closes exactly one callback obligation with
   `completion`, `blocker`, `handoff`, `cancel`, or `timeout`. Resumption or a
   correction revision creates a new spell and obligation. Acknowledgment
   alone is never completion.
3. Success criteria are immutable after acceptance. A material change creates
   a superseding assignment revision that requires fresh acceptance.
4. Handoff transfers accountable execution through an explicit offer and
   acceptance protocol. It never silently rewrites shot ownership or verifier
   eligibility.
5. Correlation and causation identities are project-scoped, immutable, and
   propagated through assignment, lease, callback, verification, and status
   events.
6. Verifier independence is evaluated over durable principals and contribution
   history, not actor names, aliases, roles, sessions, or worktrees.
7. Concurrent learning uses append-only evidence and deterministic per-pattern
   merges. Whole-document last-writer-wins replacement is forbidden.
8. Status emphasizes semantic verb-object-outcome activity. Routine reads,
   polling, acknowledgments, and lease renewals are available diagnostically
   but do not flood the primary activity surface.
9. Multiplayer evaluation pins every material input and records unknown
   measurements as unknown, never as zero.
10. Coordination overhead is reported separately from the canonical Team Round
    score unless a future versioned scoring contract explicitly changes that
    rule.

## Contract Boundary

This document consumes rather than redefines:

- the project, sprint, round, attempt, scorecard, principal, actor, session,
  role, shot-party, visibility, and scoring identities from
  [S264](team-round-domain.md);
- the event envelope, append transaction, projection, replay, idempotency,
  ordering, integrity, lease, capability, privacy, redaction, retention, and
  restore rules from [S264.1](team-round-coordination.md);
- canonical sprint identity work assigned to S265-S267;
- ledger and finalization implementation assigned to S268;
- lease and capability enforcement assigned to S269;
- attribution and merge-safe learning implementation assigned to S270;
- callback, verifier, and status implementation assigned to S271;
- evaluation implementation assigned to S272.

The workflow contract does not make prompts enforceable, turn chat into a
database, grant observers mutation rights, infer authority from role labels, or
permit client-only authorization.

## Normative Language

`MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are normative. A
projection is descriptive; the ledger event and the append transaction that
accepted it are authoritative. "Principal" always means the authenticated
durable principal defined by S264. "Actor" identifies attribution. A session is
an ephemeral execution lifetime and never establishes independence.

## Compound Primary Events

S264.1 permits exactly one primary event per canonical append and does not
provide batch append. Atomic workflow operations in this document therefore
use one compound primary event, never a hidden event batch.

A compound primary event owns a deterministic transition set:

```text
envelope_schema_version = 2
integrity_protocol_version = 2
operation_id
operation_type
owner_aggregate_type
owner_aggregate_id
owner_expected_version
owner_next_version
owner_transition
affected_aggregates[]
aggregate_chain_links[]
authorization_set
precondition_root
body_commitment
authorization_root
transition_root
aggregate_chain_root
idempotency_key
request_hash
```

Each `affected_aggregates` entry contains aggregate type and ID, expected and
next version, prior and next state, and transition reason. Entries sort by
domain-separated canonical aggregate key. The append transaction:

1. authorizes the compound operation and every affected transition;
2. locks the owner, affected aggregates, and conflict domains in canonical key
   order;
3. checks all versions, capabilities, fencing tokens, and preconditions;
4. assigns one event ID and one project sequence;
5. appends one compound primary event to its owner aggregate;
6. writes one `event_aggregate_link` for the owner and every affected aggregate;
7. advances affected aggregate version, state, and hash-chain positions from
   the event's transition set and chain links;
8. updates all other synchronous projections;
9. commits all or none.

There are no implied child ledger events. Reducers treat the compound event as
the authoritative cause for every listed transition. Replay validates the
transition root, applies entries in canonical order at the primary event's
project sequence, and rejects a partial, duplicated, unauthorized,
version-skipping, or differently ordered transition set.

Each `aggregate_chain_links` entry commits:

```text
aggregate_type
aggregate_id
prior_version
next_version
prior_aggregate_hash
transition_commitment
next_aggregate_hash
aggregate_chain_position
```

`event_aggregate_link` is a relational index to the single event row, not
another event. One event ID and project sequence can occupy one
domain-separated position in every affected aggregate chain while remaining
one primary append. The compound event's integrity hash commits the canonical
chain-link vector. Per-aggregate replay discovers the event through this link,
verifies prior and next versions and hashes, and advances once. Missing,
duplicate, partial, or disagreeing links are integrity failure.

### Version 2 Digest DAG

Version 2 replaces the singular aggregate-chain derivation from S264.1 for
compound events only. It retains the S264.1 canonical cryptography rules:
RFC 8785 JCS, I-JSON restrictions, canonical unsigned decimal strings, and the
length-framed domain separator. Every digest below uses SHA-256 with schema
revision `team-round-compound-v2` and the stated purpose. The derivation is a
directed acyclic graph:

1. Form `canonical_body` from the complete accepted event envelope after
   removing only `integrity.event_hash`, `body_commitment`,
   `authorization_root`, `transition_root`, `aggregate_chain_root`,
   every `aggregate_chain_links[].transition_commitment`, and every
   `aggregate_chain_links[].next_aggregate_hash`, and every
   `authorization_set[].target_transition_commitment`. The retained chain-link
   skeleton includes aggregate identity, prior and next versions,
   `prior_aggregate_hash`, and `aggregate_chain_position`. The retained
   envelope includes `integrity.previous_project_hash`, the owner transition,
   affected transition descriptors, authorization entries, request hash, and
   every other S264.1 field.
2. Compute `body_commitment =
   H("compound-body-v2", JCS(canonical_body))`.
3. Construct one canonical transition descriptor for `owner_transition` and
   one for every `affected_aggregates` entry. Each descriptor contains
   `operation_id`, aggregate type and ID, prior and next versions, prior and
   next state, transition reason, transition-schema revision, and the
   canonical payload-slice commitment. Compute each
   `transition_commitment = H("compound-transition-v2",
   JCS({body_commitment, transition_descriptor}))`.
4. Populate each transition-target authorization entry with exactly one
   matching step 3 `transition_commitment`, then compute authorization-entry
   commitments and `authorization_root` as specified below.
5. Compute `transition_root = H("compound-transition-root-v2",
   JCS(transition_commitments))`, where the commitment array follows canonical
   aggregate-key order.
6. For each transition compute `next_aggregate_hash =
   H("compound-aggregate-link-v2", JCS({body_commitment,
   authorization_root, transition_commitment, event_id, event_sequence,
   aggregate_type, aggregate_id, prior_version, next_version,
   prior_aggregate_hash, aggregate_chain_position}))`.
7. Compute `aggregate_chain_root = H("compound-aggregate-root-v2",
   JCS(aggregate_chain_links))` over the complete link vector in canonical
   aggregate-key order.
8. Compute `integrity.event_hash = H("compound-event-v2",
   JCS({body_commitment, authorization_root, transition_root,
   aggregate_chain_root, previous_project_hash}))`.

`H` means the S264.1 length-framed domain-separated SHA-256 construction, not
string concatenation. The stored derived fields MUST equal these calculations.
No derived field is an input to an earlier step, so the construction has no
self-reference.

`affected_aggregates` MUST exclude the owner and contain no repeated canonical
aggregate key. `owner_transition` and `affected_aggregates` together form the
transition set. There MUST be exactly one chain link and one
`event_aggregate_link` for every transition, no extras, and each link identity,
version pair, and transition commitment MUST match its descriptor.
`aggregate_chain_position` is the aggregate's canonical `next_version`; the
owner's legacy `integrity.previous_aggregate_hash` MUST equal the owner link's
`prior_aggregate_hash`. For version 2, the owner and every affected aggregate
advance to their link's `next_aggregate_hash`; `integrity.event_hash` advances
the project chain and is not an aggregate-chain head. Substitution, reordering,
duplication, omission, or owner/link disagreement fails before projection.

Version 1 events replay under the S264.1 singular owner-chain rule and are never
rewritten. Version 2 replay selects this DAG by both envelope and integrity
protocol version. An unknown combination fails closed. Migration checkpoints
pin the last version 1 project hash and aggregate heads; the first version 2
event uses those prior hashes without synthesizing bridge events.

### Replayable Authorization Set

An authorization entry has this canonical schema:

```text
authorization_obligation_id
target_kind                 # operation | transition
primary_operation           # true for exactly one operation entry
target_operation_id
target_aggregate_type?
target_aggregate_id?
target_transition_commitment?
capability
authority_role
policy_revision
policy_activation_sequence
decision_id
decision_revision
decision_effect             # allow
requesting_principal_id
authorizing_principal_id
authentication_context_id
decision_context_hash
separation_of_duties_rule?
separation_of_duties_proof?
```

Each registered compound-event schema declares its complete authorization
obligations: operation capabilities, per-transition capabilities, distinct
authority roles, active policy revision, and separation-of-duties rules.
The schema designates exactly one operation obligation as
`primary_operation = true`; callers and adapters never choose it dynamically.
When several operation capabilities are required, the schema-designated
primary capability authorizes the append operation and every other capability
is a separate non-primary obligation.
`authorization_obligation_id` is the domain-separated commitment to the event
schema revision, target kind and identity, capability, and authority role. An
operation entry binds `target_operation_id` and its decision context to
`body_commitment`. A transition entry additionally binds exactly one canonical
`transition_commitment`. Recovery plus waiver, for example, requires distinct
entries for the recovery operation and the waiver transition when policy
declares separate authorities.

For each entry compute:

```text
target_commitment =
  body_commitment                                      # operation
  H("compound-authorization-target-v2",
    JCS({body_commitment, transition_commitment}))     # transition

authorization_entry_commitment =
  H("compound-authorization-entry-v2",
    JCS({authorization_entry, target_commitment}))
```

Sort entries by target kind, canonical target identity, capability,
authority role, and decision ID. Then compute:

```text
authorization_root =
  H("compound-authorization-root-v2",
    JCS(authorization_entry_commitments))
```

There MUST be a one-to-one match between declared authorization obligations
and entries. The authoritative policy record at
`policy_activation_sequence` must reproduce each allow decision and principal
binding. Replay rejects a missing, duplicate, denied, stale, substituted,
unrelated, ambiguously targeted, or separation-of-duties-invalid entry. A
decision for one transition, operation, policy revision, principal, or
authentication context cannot authorize another.

Version 2 retains the singular S264.1 `authorization` field as a compatibility
projection, not an independent allow decision. Exactly one authorization-set
entry MUST be the schema-designated primary operation entry. Its `capability`,
`policy_revision`, and `decision_id` MUST equal the singular authorization
field; its `requesting_principal_id` and `authentication_context_id` MUST equal
the trusted envelope identity. The entry's decision record MUST identify the
same authenticated principal and context. These equalities are checked before
`canonical_body` is committed. Missing or multiple primary entries, a
caller-selected primary capability, or any field mismatch rejects the append.
Version 1 replay validates only its singular decision and does not synthesize
an authorization set; every version 2 event requires both representations and
their exact equivalence.

S268-2 publishes cross-adapter golden vectors for the canonical body, every
intermediate commitment, each chain link, both roots, and final event hash. The
conformance corpus covers link and authorization substitution, reordering,
duplication, omission, owner mismatch, singular-versus-set authorization
substitution, primary-operation substitution, version 1-to-2 replay, and
digest-cycle regressions. S268-4 adds capability and separation-of-duties
bypass attempts, including distinct recovery and waiver authorities, on
SQLite, PostgreSQL, and an independent verifier.

The compound event's idempotency identity follows S264.1:

```text
(project_id, operation_kind, primary_aggregate_type,
 primary_aggregate_id, round_epoch?, idempotency_key)
```

`round_epoch` is mandatory for score- or authority-affecting round mutations.
Authenticated principal and actor, expected versions, affected transitions,
capabilities, fencing tokens, manifest hashes, and all other preconditions
belong in the canonical request hash and stored idempotency record, not the
idempotency identity. A same-key request from another principal conflicts.

The initial compound events are:

- `handoff.activated.v2`, owned by the handoff aggregate;
- `assignment.spell_recovered.v1`, owned by the assignment aggregate;
- `assignment.reassigned_after_abandonment.v1`, owned by the assignment
  aggregate;
- `contribution.material_mutation_accepted.v2`, owned by the assignment
  verification domain;
- `verification.appeal_granted.v1`, owned by the verification family;
- `verification.timed_out.v2`, owned by the verification family and creating
  its timeout-disposition aggregate;
- `verification.timeout_disposed.v1`, owned by the timeout-disposition
  aggregate;
- `verification.escalation_disposed.v1` and
  `verification.escalation_expired.v1`, owned by the verification escalation;
- `learning.patterns_merged.v2` and `learning.pattern_split.v2`, owned by a
  learning-topology operation aggregate;
- `learning.report_accepted.v2`, owned by the learning report aggregate;
- `evaluation.evidence_verified.v2`,
  `evaluation.evidence_rejected.v2`, and
  `evaluation.evidence_unverifiable.v2`, owned by the trial aggregate;
- `evaluation.attempt_retryable_failed.v2`,
  `evaluation.trial_allocated.v2`,
  `evaluation.trial_failed.v2`, `evaluation.trial_timed_out.v2`, and
  `evaluation.trial_cancelled.v2`, owned by the trial aggregate;
- `evaluation.campaign_invalidated.v1`, owned by the campaign aggregate when it
  transitions current analysis and report projections.

## Assignment Aggregate

### Identity

An assignment aggregate has the key:

```text
(project_id, assignment_id)
```

`assignment_id` is a server-assigned UUIDv7. It is never reused after terminal
state, redaction, retention expiry, failed import, or project deletion.

An assignment belongs to exactly one:

```text
canonical_sprint_key
round_id
attempt_id
assignment_revision
```

`assignment_revision` starts at `1` and increases by exactly one when a
materially changed assignment supersedes an earlier revision. Earlier
revisions remain immutable ledger history.

### Required Assignment Envelope

The canonical `assignment.created.v1` payload contains:

| Field | Contract |
|---|---|
| `assignment_id` | Server-assigned durable aggregate identity |
| `assignment_revision` | Positive, gap-free revision number |
| `canonical_sprint_key` | Planned-work identity |
| `round_id` / `attempt_id` | Execution identity |
| `ticket_key` | Canonical ticket identity, when ticket-scoped |
| `target_subjects` | Typed protected resources required by the work |
| `delegator_principal_id` | Principal accountable for delegation |
| `delegator_actor_id` | Attributed actor issuing the assignment |
| `assignee_principal_id` | Principal accountable for execution |
| `assignee_actor_id` | Initial attributed execution actor |
| `assignee_role` | Functional role snapshot, never an authority grant |
| `title` | Concise object of work |
| `objective` | Required outcome, not only an action |
| `success_criteria` | Ordered, typed, individually testable criteria |
| `required_evidence` | Evidence classes and minimum provenance |
| `verification_policy_id` | Versioned verifier policy |
| `required_capabilities` | Capability names and constrained scopes |
| `budget` | Optional token, cost, elapsed, attempt, and tool limits |
| `priority` | Versioned scheduling class |
| `not_before` / `deadline_at` | Store-time scheduling bounds |
| `correlation_id` | End-to-end project-scoped workflow identity |
| `parent_assignment_id` | Parent for a decomposed assignment, if any |
| `caused_by_event_id` | Immediate durable cause |
| `visibility` / `classification` | S264.1 access labels |
| `created_at` | Authoritative store time |

Success criteria use this minimum shape:

```json
{
  "criterion_id": "criterion-stable-within-revision",
  "statement": "Observable outcome",
  "required": true,
  "verification_method": "test | review | inspection | measurement",
  "evidence_requirement": "content-addressed evidence policy reference"
}
```

Free-form text MAY supplement criteria but MUST NOT replace typed criterion
identity, requiredness, verification method, and evidence requirement.

### Creation Rules

Creation MUST:

1. authenticate the caller and authorize `assignment:create`;
2. validate project, round, attempt, sprint, ticket, actor, and principal
   references against authoritative projections;
3. prove the delegator may bind the requested assignee and resources;
4. validate that the assignee can receive every required capability without
   implicit privilege escalation;
5. validate criteria and evidence policy schemas;
6. reject deadlines earlier than `not_before` or authoritative store time;
7. scan the complete request for secrets under the S264.1 ingress policy;
8. append `assignment.created.v1` through the canonical append transaction;
9. update assignment, queue, and semantic-status projections atomically.

Creating an assignment does not acquire protected-resource leases and does not
prove the assignee has accepted it.

### Material And Non-Material Changes

A change is material when it affects objective, required criteria, required
evidence, assignee principal, target resources, capabilities, budget hard
limits, deadline, visibility, classification, verification policy, or parent
relationship.

A material change MUST:

1. create revision `n + 1`;
2. reference the superseded revision and change reason;
3. preserve prior acceptance and work evidence;
4. cancel or fence uncommitted work under the superseded revision;
5. require the assignee to accept the new revision;
6. cause verifier eligibility to be recalculated.

Non-material presentation metadata, such as a corrected display title that
does not change scope, MAY append a metadata-correction event. The event cannot
change authorization, scoring, evidence, deadline, or verification semantics.

## Assignment Lifecycle

### States

Assignment work state and verification state are separate aggregates. The
authoritative assignment-revision work states are:

```text
created
offered
accepted
in_progress
blocked
completion_reported
cancelled
timed_out
superseded
```

`completion_reported`, `cancelled`, `timed_out`, and `superseded` are terminal
for one immutable assignment revision. Verification never changes assignment
work state. A rejected verification that requires changed output creates
revision `n + 1`; a reverification of unchanged bytes creates a new
verification epoch against the same completed revision.

Offer refusal is `assignment.offer_declined.v1` and transitions the revision to
`cancelled` with reason `assignee_declined`.

### Transition Table

| From | Event | To | Authorized principal |
|---|---|---|---|
| `created` | `assignment.offered.v1` | `offered` | delegator or scheduler with `assignment:offer` |
| `offered` | `assignment.accepted.v1` | `accepted` | assignee with `assignment:accept` |
| `offered` | `assignment.offer_declined.v1` | `cancelled` | assignee with `assignment:accept` |
| `accepted` | `assignment.started.v1` | `in_progress` | assignee with `assignment:execute` |
| `in_progress` | `assignment.blocker_reported.v1` | `blocked` | assignee with `assignment:execute` |
| `blocked` | `assignment.resumed.v1` | `in_progress` | assignee with `assignment:execute` |
| `in_progress` | `assignment.spell_recovered.v1` | `in_progress` | recovery service with `assignment:recover` |
| `in_progress` | `assignment.completion_reported.v1` | `completion_reported` | assignee with `assignment:execute` |
| any non-terminal | `assignment.cancelled.v1` | `cancelled` | principal with `assignment:cancel` |
| `offered`, `accepted`, `in_progress`, or `blocked` | `assignment.timed_out.v1` | `timed_out` | recovery service with `assignment:recover` |
| any non-terminal | `assignment.superseded.v1` | `superseded` | delegator or policy engine with `assignment:supersede` |

Compound assignment transition entries use this additional authoritative
registry:

| Compound event | Aggregate role | Prior state | Next state |
|---|---|---|---|
| `handoff.activated.v2` | source revision | `in_progress` | `superseded` |
| `handoff.activated.v2` | successor or partial-handoff child revision | absent | `in_progress` |
| `assignment.spell_recovered.v1` | recovered revision | `in_progress` | `in_progress` |
| `assignment.reassigned_after_abandonment.v1` | abandoned source revision | `in_progress` or `blocked` | `timed_out` |
| `assignment.reassigned_after_abandonment.v1` | successor revision | absent | `in_progress` |

Absent-to-`in_progress` is legal only when the compound payload contains and
authorizes the complete created, offered, accepted, lease-granted, and started
inputs and matching preacceptance hash. The reducer validates every transition
entry against the ordinary or compound registry before advancing any chain
link.

The store rejects all transitions absent from both registries. A caller cannot
use a compound event to skip acceptance without the declared preacceptance
proof, move
directly from `in_progress` to a verified composite state, resume a terminal
revision, or mutate a superseded revision.

### Verification Aggregate States

A verification aggregate is keyed by:

```text
(project_id, assignment_id, assignment_revision, verification_epoch)
```

`verification_epoch` is monotonic and gap-free for one completed revision. Its
states are:

```text
not_required
requested
reserved
active
disputed
approved
rejected
waived
cancelled
timed_out
invalidated
```

`not_required`, `approved`, `rejected`, `waived`, `cancelled`, `timed_out`, and
`invalidated` are terminal for one verification epoch. The legal transitions
are:

| From | Event | To | Authorized principal |
|---|---|---|---|
| absent | `verification.not_required.v1` | `not_required` | policy engine with `verification:policy` |
| absent | `verification.requested.v1` | `requested` | policy engine with `verification:request` |
| `requested` | `verification.reserved.v1` | `reserved` | scheduler with `verification:reserve` |
| `reserved` | `verification.started.v1` | `active` | selected verifier with `verification:execute` |
| `active` | `verification.slot_decided.v1` | `active` | eligible slot verifier with `verification:decide` |
| `active` | `verification.epoch_reduced.v1` | `approved`, `rejected`, or `disputed` | quorum reducer with `verification:reduce` |
| `disputed` | `verification.slot_decided.v1` | `disputed` | eligible added-slot verifier with `verification:decide` |
| `disputed` | `verification.epoch_reduced.v1` | `approved`, `rejected`, or `disputed` | quorum reducer with `verification:reduce` |
| `requested`, `reserved`, `active`, or `disputed` | `verification.waived.v1` | `waived` | waiver authority with `verification:waive` |
| any non-terminal | `verification.cancelled.v1` | `cancelled` | principal with `verification:cancel` |
| `requested`, `reserved`, `active`, or `disputed` | `verification.timed_out.v2` | `timed_out` | recovery service with `verification:recover` |
| `approved`, `waived`, or `not_required` | `verification.invalidated.v1` | `invalidated` | policy engine with `verification:invalidate` |

An invalidated epoch never resumes. Reverification of unchanged completion
bytes creates epoch `e + 1`. A rejection requiring any output, criterion,
evidence, assignee, resource, or policy change creates assignment revision
`r + 1`, which requires fresh acceptance and a new completion callback.

### Composite Projection

The operating projection combines assignment and current verification states
without mutating either aggregate:

| Assignment work | Current verification | Composite outcome |
|---|---|---|
| `completion_reported` | `not_required` | `complete_unverified` |
| `completion_reported` | `requested`, `reserved`, `active`, or `disputed` | `verification_pending` |
| `completion_reported` | `approved` | `verified` |
| `completion_reported` | `waived` | `verified_with_waiver` |
| `completion_reported` | `rejected` | `correction_required` |
| `completion_reported` | `cancelled` | `verification_cancelled` |
| `completion_reported` | `timed_out` | `verification_timed_out` |
| `completion_reported` | `invalidated` | `reverification_required` |

No-review completion is therefore explicit, disputes and waivers are declared,
and invalidation cannot reverse an assignment terminal state.

### Acceptance

`assignment.accepted.v1` binds:

- exact assignment revision and canonical request hash;
- assignee principal and actor;
- accepted success criteria and evidence policy hashes;
- accepted target resources and capability constraints;
- accepted deadline and budget;
- authoritative acceptance time;
- idempotency key and correlation ID.

Acceptance MUST fail when:

- the offer is expired, cancelled, superseded, or already terminal;
- the caller is not the named assignee principal;
- the actor is not controlled by the assignee principal;
- required capabilities are unavailable;
- a policy revision made the offer invalid;
- the same idempotency key names a different acceptance payload.

### Start

Starting execution requires:

1. accepted current assignment revision;
2. an active session controlled by the assignee principal;
3. acquired lease set for all protected target subjects;
4. matching lease request, subject epochs, and fencing token vector;
5. unexpired hard budget and deadline;
6. `assignment:execute` capability.

The `assignment.started.v1` event records the session, actor, lease set,
fencing tokens, tool-permission snapshot, environment reference, and
authoritative start time.

A replacement process cannot call `assignment.started.v1` on `in_progress`.
The recovery service uses compound primary event
`assignment.spell_recovered.v1`. It requires an open old obligation, failed or
expired session under policy, fenced or recoverable old leases, and
`assignment:recover`. In one transition set it:

- closes the old obligation with disposition `timeout` or `cancel` reason
  `abandoned_process`;
- fences old lease tokens;
- grants new lease epochs and tokens;
- creates the replacement execution spell and next callback-obligation epoch;
- records carried and discarded state;
- updates semantic progress and recovery projections.

If any precondition fails, the old spell remains authoritative. Exact retries
return the accepted recovery event. Replay proves one old disposition and one
replacement obligation.

## Correlation And Causation

### Correlation Identity

`correlation_id` is a server-assigned UUIDv7 scoped by `project_id`. It binds
one logical workflow across:

- assignment revisions;
- child assignments;
- lease acquisition and renewal;
- execution spells;
- blocker and completion callbacks;
- verification requests and decisions;
- recovery and escalation;
- semantic status entries.

Child assignments inherit the parent correlation ID unless they deliberately
start an independently reportable workflow. Such a fork records both a new
correlation ID and `parent_correlation_id`.

### Causation

Every workflow event identifies exactly one immediate `caused_by_event_id`
except the root `assignment.created.v1`. Additional related events MAY be
recorded as typed links but cannot replace the single causation edge.

The causation graph MUST be acyclic within a project. Import validates the
graph before append. Replay rejects missing ancestors, cross-project edges, and
cycles rather than guessing an order.

### Callback Identity

Each ordinary `assignment.started.v1` or `assignment.resumed.v1` event creates
one execution spell and one monotonic callback obligation. Compound
`handoff.activated.v2`, `assignment.spell_recovered.v1`, and
`assignment.reassigned_after_abandonment.v1` create the declared destination
or replacement obligation in their transition set:

```text
(project_id, assignment_id, assignment_revision,
 execution_spell_id, callback_obligation_epoch)
```

The store assigns `callback_obligation_id` as a UUIDv7 and enforces uniqueness
for the tuple above. One obligation accepts exactly one disposition:

```text
blocker
completion
handoff
cancel
timeout
```

Disposition identity is:

```text
(project_id, callback_obligation_id)
```

The canonical append transaction uses compare-and-set from `open` to exactly
one disposition. Competing blocker, completion, handoff, cancel, and timeout
requests lock the obligation row; one wins and the rest receive
`CALLBACK_OBLIGATION_CLOSED` with the winning event ID. Exact retries of the
winning request return the prior result. A resume or correction revision
creates a new execution spell, epoch, obligation ID, and idempotency scope.

## Mandatory Callbacks

### Callback Obligation

Starting or resuming an accepted assignment creates a durable callback
obligation. The obligation remains open until one disposition event is
accepted:

- `assignment.blocker_reported.v1`;
- `assignment.completion_reported.v1`;
- `handoff.activated.v2`;
- `assignment.cancelled.v1`;
- `assignment.timed_out.v1`;
- `assignment.spell_recovered.v1`;
- `assignment.reassigned_after_abandonment.v1`.

The two recovery compound events close the old obligation with `timeout` or
`cancel` and create exactly one replacement obligation. Handoff closes the old
obligation with `handoff` and creates exactly one destination obligation.
Replay reconciles every creating or closing event to its obligation transition
and rejects a missing old disposition, extra replacement, or epoch gap.

An accepted blocker callback satisfies the current execution spell's
obligation but does not terminate the assignment. Resumption creates a new
execution spell and obligation. Verification rejection cannot resume the
terminal revision; correction creates and accepts a new assignment revision,
whose start creates a new obligation.

Process exit, session deletion, lease expiry, disconnected transport, chat
silence, acknowledgment, status polling, or a pushed commit does not satisfy a
callback obligation.

### Completion Callback

`assignment.completion_reported.v1` contains:

| Field | Contract |
|---|---|
| `assignment_id` / `revision` | Accepted assignment revision |
| `execution_spell_id` | Spell being completed |
| `callback_obligation_id` / `epoch` | Exact open obligation |
| `assignee_principal_id` / `actor_id` | Authenticated reporter |
| `criterion_results` | One typed result per criterion |
| `evidence_refs` | Content-addressed, classified evidence references |
| `output_refs` | Durable artifacts, commits, or projections |
| `test_summary` | Typed pass, fail, skipped, not-run, and unknown counts |
| `budget_actuals` | Observed cost, token, and elapsed values with provenance |
| `lease_token_vector` | Current fencing proof |
| `completed_at` | Authoritative store time |

Each required criterion result is `met`, `not_met`, or `unknown`. Missing is
invalid. A completion with any required `not_met` or disallowed `unknown` is
rejected before append. Completion cannot claim verification.

### Blocker Callback

`assignment.blocker_reported.v1` contains:

- blocker class: `dependency`, `authority`, `resource`, `environment`,
  `ambiguity`, `budget`, `test_failure`, `security`, or `other`;
- concise description and classified evidence references;
- first observed store time and current lease state;
- work safely completed and work not attempted;
- whether protected resources can be released;
- requested decision, capability, resource, or dependency;
- retry recommendation and earliest useful retry time;
- escalation policy reference.

A blocker callback MUST NOT include raw secrets, private transcripts, or
unrestricted tool output. Reporting a blocker releases only resources marked
safe to release and authorized by policy.

### Callback Delivery

Callbacks are ledger appends, not best-effort notifications. Client delivery
uses an outbox projection:

1. the callback transaction snapshots policy-required recipient principal,
   destination, and channel tuples;
2. it creates one outbox row keyed by:

   ```text
   (project_id, callback_event_id, recipient_principal_id,
    destination_id, channel)
   ```

3. notification workers deliver each row at least once;
4. authenticated recipients acknowledge the exact row and callback hash;
5. duplicate delivery is suppressed per row, never globally across recipients;
6. retry count, next attempt, receipt, and dead letter are tracked per row;
7. notification failure cannot erase or roll back the authoritative callback;
8. recipient-scoped dead letters are visible to authorized operators without
   changing assignment state or another recipient's delivery.

## Handoff

### Handoff Aggregate

A handoff is keyed by:

```text
(project_id, handoff_id)
```

It records source assignment revision, source principal and actor, proposed
destination principal and actor, scope, reason, completed evidence, remaining
criteria, resource subjects, lease-transfer plan, deadline, correlation ID,
and visibility.

The handoff states are:

```text
offered -> accepted -> activated
        \-> declined
        \-> cancelled
        \-> timed_out
```

`declined`, `cancelled`, `timed_out`, and `activated` are terminal for the
handoff offer.

### Handoff Rules

1. The source principal appends `handoff.offered.v1`.
2. The coordinator constructs assignment revision `r + 1` with the destination
   assignee, remaining criteria, carried evidence, resources, deadline, budget,
   and explicit `supersedes_revision=r`.
3. The destination principal appends `handoff.accepted.v1`, binding the exact
   handoff hash and proposed revision hash. This is consent to activate, not
   yet execution authority.
4. Acceptance proves destination capabilities and verifier implications.
5. The source or an authorized recovery service invokes compound primary event
   `handoff.activated.v2` with `handoff:activate`, the source obligation ID,
   source lease token vector, accepted destination revision hash, and
   idempotency key.
6. Its transition set locks assignment, handoff, source callback obligation, source
   lease conflict domains, destination revision, and destination lease request
   in canonical key order, then atomically:
   - compare-and-sets the source obligation to disposition `handoff`;
   - fences the source execution spell;
   - releases source leases and grants destination leases with new epochs and
     token vectors;
   - transitions source revision `r` to `superseded`;
   - initializes revision `r + 1` directly in `accepted` with transition reason
     `preaccepted_handoff`, preserving the equivalent created, offered, and
     accepted inputs in the compound event rather than emitting child events;
   - starts the destination execution spell and callback obligation;
   - records ownership effective at the activation project sequence;
   - updates assignment, handoff, lease, callback, contribution, verifier, and
     semantic-status projections.
7. If any check or append fails, none become authoritative and the source
   remains holder of its still-open obligation and leases.
8. Exact activation retries return the original result. A competing source
   callback or stale lease token loses with the recorded winning disposition.
9. The destination emits its own completion, blocker, handoff, cancel, or
   timeout disposition.
10. Source and destination contribution history remain attached to the shot.
11. Handoff never removes the delegator, source contributor, or destination
   contributor from verifier-conflict evaluation.

Lease ownership is not edited in place. Transfer is a fenced release and
acquire transaction using new lease epochs and fencing tokens.

### Partial Handoff

A partial handoff MUST identify a subset of criterion IDs and resource
subjects. Overlapping responsibility is forbidden unless the assignment
explicitly creates child assignments with non-conflicting resource lease sets.

A split always creates child assignments with their own revisions, acceptance,
execution spells, obligations, and lease sets. The parent records an immutable
criterion-to-child map, required child composite outcomes, and evidence merge
policy. Activation locks parent and children in canonical ID order. The parent
cannot complete until every required child reaches its required composite
outcome, every child callback obligation is closed, and evidence reconciliation
passes. Child cancellation, timeout, waiver, or invalidation follows the
parent's explicit reconciliation policy and is never treated as success.

### Abandonment

A vanished source cannot offer a handoff. Recovery either uses
`assignment.spell_recovered.v1` for a policy-permitted replacement spell under
the same assignee or compound primary event
`assignment.reassigned_after_abandonment.v1`. Reassignment:

1. locks the old assignment, obligation, leases, recovery item, and reserved
   successor revision;
2. closes the old obligation with `timeout`, fences leases, and transitions the
   old revision to `timed_out`;
3. creates and accepts a successor revision for the destination principal;
4. grants new lease epochs and starts its spell and obligation;
5. carries forward only evidence that passes integrity and visibility checks;
6. leaves the original ownership spell missing, not zero-loss or completed.

## Cancellation And Timeout

### Cancellation

Cancellation requires `assignment:cancel`, a reason code, and the current
assignment revision. It atomically:

- fences active execution;
- releases or revokes lease sets;
- closes callback obligations;
- records completed and uncompleted criteria;
- preserves contribution and budget history;
- schedules cleanup or recovery items;
- updates semantic status.

Assignment cancellation is legal only before `completion_reported` and competes
for the current callback obligation. After completion, an authorized caller
may cancel only the current verification epoch through
`verification.cancelled.v1`. That preserves completion bytes and projects
`verification_cancelled`; it does not retroactively create an assignment
callback or erase the completion.

### Timeout

Timeout decisions use authoritative store time and a versioned lifecycle
policy. The recovery service locks the current assignment and lease rows,
rechecks the deadline, and appends `assignment.timed_out.v1` with the observed
state, last semantic progress, current lease epoch, callback obligation, and
recovery disposition.

Timeout is not inferred from a missing heartbeat alone. Session liveness,
lease liveness, semantic progress, deadline, and notification delivery are
distinct observations.

### Recovery

Recovery dispositions are:

- `retry_same_assignee`;
- `reassign`;
- `split`;
- `cancel`;
- `dead_letter`;
- `escalate`.

Each disposition creates a new durable event or assignment revision. A
recovered worker must obtain new lease epochs and cannot reuse a fenced token.

## Acknowledgments And Notification Noise

Acknowledgments confirm transport receipt only. They:

- do not advance assignment state;
- do not satisfy callback obligations;
- do not renew leases;
- do not prove progress;
- do not count as contribution;
- do not appear in the primary semantic activity feed.

The diagnostic view MAY show acknowledgments, retries, polling, lease renewal,
and delivery receipts to an authorized operator. Aggregation groups repetitive
diagnostic events by object, event type, outcome, and time bucket.

## Assignment Projection

The deterministic assignment projection exposes:

- current revision and state;
- objective and criteria summary;
- delegator and assignee identities visible to the requester;
- current accountable actor and contribution set;
- accepted, started, last semantic progress, deadline, and terminal times;
- open callback obligation;
- blocker class and requested action;
- completion evidence coverage;
- verification policy and current eligible-verifier count;
- current handoff state;
- lease health summarized without leaking restricted resource identity;
- retry, dead-letter, or escalation state;
- data classification and visibility summary.

Unknown fields remain typed `unknown` with a reason and provenance. They never
default to healthy, zero, idle, complete, or authorized.

## Assignment Replay Invariants

Replay MUST prove:

1. assignment revisions are gap-free and each supersedes exactly one prior
   revision;
2. every transition is legal from the preceding state;
3. every actor is controlled by the authenticated event principal at event
   time;
4. acceptance binds the exact material assignment hash;
5. every execution spell starts with a valid lease token vector;
6. every started spell has one monotonic callback obligation that is either
   visibly open or closed by exactly one disposition;
7. blocker or correction resumption creates a new spell and obligation;
8. handoff activation closes the source obligation, fences the source, creates
   and accepts a successor revision, and starts the destination atomically;
9. callback retry races reproduce one winning disposition;
10. terminal revisions and verification epochs do not resume;
11. child requirements reconcile to the parent;
12. projections reproduce identical canonical bytes on every supported
    adapter.

## S264.2-1 Adversarial Criteria

S271 implementation acceptance includes:

1. blocker, completion, handoff, cancel, and timeout racing one obligation
   produce exactly one winning disposition;
2. exact callback retry returns the accepted event and changed-payload retry
   conflicts;
3. blocker then resume creates a new spell and permits a later blocker;
4. verification correction creates a successor assignment revision rather
   than resuming completed work;
5. handoff cannot activate without destination preacceptance and complete
   transition-set authorization;
6. handoff activation either closes the source, fences leases, accepts the
   successor, and starts its obligation together or changes nothing;
7. a dead process restart closes the old obligation before creating a
   replacement spell;
8. a stale source lease or callback cannot mutate after handoff or recovery;
9. partial handoff cannot double-own one criterion or overlapping lease set;
10. one callback fan-out reaches every required recipient independently and
    dead-letters only the failing destination;
11. cancellation after completion cannot fabricate another assignment
    callback or erase completion;
12. replay rejects partial compound transitions, duplicate dispositions, and
    obligation-epoch gaps.
13. a compound event missing one affected aggregate chain link, prior hash, or
    next version fails integrity and cannot partially project.

## S264.2-1 Acceptance Criteria

S264.2-1 is complete when the contract:

- defines assignment identity, revisioning, required fields, and material
  changes;
- defines every assignment and handoff state and legal transition;
- binds acceptance and execution to immutable criteria, evidence, capability,
  lease, budget, and deadline snapshots;
- requires one completion, blocker, handoff, cancel, or timeout disposition per
  execution-spell obligation and makes recipient-scoped delivery durable;
- distinguishes acknowledgment, liveness, lease renewal, semantic progress,
  and completion;
- defines cancellation, timeout, abandonment, recovery, and replay behavior;
- preserves attribution and verifier-conflict history across handoff;
- assigns implementation to S271 without changing S268 or S269 ownership.

## Verifier Independence

### Goal

Verification establishes that a policy-eligible principal, independent under a
versioned conflict rule, evaluated immutable completion evidence against the
accepted success criteria. It does not establish absolute correctness, erase
the author's accountability, or convert a reviewer into a contributor.

Independence is a property of principals and their control and contribution
relationships at a defined time. It is never inferred from:

- different actor IDs controlled by the same principal;
- different sessions, conversations, processes, models, roles, aliases,
  worktrees, machines, or access tokens;
- different display names or provider-local account IDs;
- a handoff between actors controlled by one principal;
- deletion or redaction of contribution display fields.

### Verification Policy

Every assignment binds a versioned `verification_policy_id`. The policy
contains:

| Field | Contract |
|---|---|
| `policy_id` / `version` | Immutable policy identity |
| `risk_class` | `low`, `standard`, `high`, or `critical` |
| `tier` | Required independence tier |
| `required_quorum` | Number of approving verifier roots |
| `required_methods` | Review, test, inspection, or measurement methods |
| `required_evidence` | Evidence policy references |
| `conflict_lookback` | Contribution and control relationship window |
| `allowed_unknowns` | Explicitly tolerated unavailable facts |
| `reverification_triggers` | Events that invalidate approval |
| `timeout_policy` | Store-time deadline and escalation |
| `override_policy` | Whether and how a waiver may be recorded |
| `visibility` / `classification` | Access labels for policy details |

Policy versions are append-only. The assignment uses the version accepted by
the assignee unless a security policy marks a later version mandatory. A
mandatory policy upgrade supersedes the assignment revision and requires fresh
acceptance; it cannot silently change verifier eligibility mid-review.

### Independence Tiers

The supported tiers are:

| Tier | Minimum rule |
|---|---|
| `none` | No verification required; completion remains unverified |
| `self_review` | Author principal may review under an explicit low-risk policy |
| `peer_actor` | Different actor, but policy may allow the same principal |
| `independent_principal` | Verifier conflict root differs from every conflicted principal |
| `separation_of_duties` | Independent principal and no prohibited delegation, authority, or operational relationship |
| `multi_principal_quorum` | Required number of mutually independent conflict roots |

`peer_actor` is not independent verification and MUST be labeled accordingly.
High-risk and critical assignments require at least `independent_principal`.
Critical actions that alter authority, integrity anchors, redaction approval,
retention policy, restore state, release credentials, or production publishing
require `separation_of_duties` or `multi_principal_quorum`.

### Conflict Roots

The principal registry deterministically resolves a `conflict_root_id` for
each principal. A conflict root represents common effective control for
verification purposes.

Relationship events include:

```text
principal.same_controller_declared.v1
principal.control_delegated.v1
principal.service_owned.v1
principal.alias_bound.v1
principal.relationship_revoked.v1
principal.compromise_reported.v1
```

The conflict-root projection uses the transitive closure of active
`same_controller`, `control_delegated`, `service_owned`, and alias-binding
relationships under the verification policy's lookback and event-time
semantics. Revocation ends future control but does not rewrite the historical
conflict root used by earlier work.

When the registry cannot prove two principals independent, an
`independent_principal` or stronger policy treats them as conflicted. Operators
may correct the registry with audited evidence, but clients cannot assert
independence in a verification request.

### Conflicted Principals

For assignment revision `r`, the conflict set contains the historical conflict
roots of:

1. every author principal for any output under `r`;
2. every contributor principal whose action changed code, artifacts, tests,
   data, configuration, criteria, evidence, or the claimed outcome;
3. the assignee principal;
4. every source and destination principal in a handoff;
5. the delegator when the policy prohibits delegator verification;
6. any principal that selected, trained, tuned, or directly controlled the
   evaluated actor when the policy includes model-operation conflicts;
7. any principal that approved a material assignment revision;
8. any principal that supplied restricted evidence not independently
   reproducible by the verifier;
9. principals linked by a prohibited organizational or financial relationship
   when configured by the policy.

Routine transport, scheduling, infrastructure hosting, observation, or
read-only evidence retrieval does not automatically create contribution.
Those actions may still create a separation-of-duties conflict when the policy
explicitly says so.

### Contribution Events

Contribution is established by authoritative events, not self-description. A
minimum `contribution.recorded.v1` event contains:

- assignment, revision, ticket, shot, and execution-spell identities;
- authenticated principal, actor, session, and role snapshot;
- contribution kind;
- affected subject and criterion IDs;
- content-addressed before and after evidence;
- causation and correlation IDs;
- authoritative time;
- visibility and classification;
- integrity commitment.

Contribution kinds include:

```text
author
code_change
artifact_change
test_change
data_change
configuration_change
criteria_change
evidence_creation
analysis_used_in_outcome
resolution
operational_control
```

`resolution` remains contribution. Resolver credit does not inherit a penalty,
but a resolver cannot independently verify the same corrected outcome unless a
policy explicitly permits a later independent review boundary and all
resolver-produced evidence is independently re-established.

### Producer Provenance Coverage

Every `output_ref` and `evidence_ref` accepted by a completion callback points
to an artifact record keyed by:

```text
(project_id, artifact_id, artifact_version)
```

The artifact record binds canonical content commitment, producer principal,
actor and session, producing contribution event, source subjects, creation
time, classification, visibility, and integrity metadata. Multi-producer
artifacts bind an ordered producer set and one contribution event per producer.

The completion transaction locks the assignment contribution domain and every
referenced artifact version. It requires:

1. verified integrity for each artifact;
2. authenticated producer provenance for every byte or declared derivation;
3. a contribution event causally preceding completion for every producer;
4. exact equality between the artifact producer set and covered contribution
   principals;
5. no uncommitted output subject or unknown producer;
6. a `contribution_high_water_mark` and `artifact_set_root` in the completion
   event.

Missing, hidden-but-uncommitted, unverifiable, externally unattributed, or
unknown producer provenance sets conflict state to `unknown`. An
`independent_principal` or stronger policy fails closed and cannot select or
accept a verifier while conflict state is unknown.

External artifacts require an authenticated importer principal and a signed or
otherwise policy-verifiable producer assertion. When original producer
identity remains unknown, the importer joins the conflict set and the
independence policy decides whether the unknown original producer is
tolerable; the default is not tolerable.

### Historical Conflict Snapshot

`verification.requested.v1` freezes:

- assignment revision and completion event ID;
- scorecard or artifact version being reviewed;
- criteria and evidence policy hashes;
- contribution event set and its Merkle root;
- conflicted principal IDs and historical conflict roots;
- principal relationship registry version;
- verifier policy version;
- eligible-verifier query version;
- request time and deadline.

The snapshot contains classification-safe commitments for hidden contributors.
A filtered viewer may see `conflict_present` without learning a restricted
principal's identity.

If a contribution or relationship event with effective time at or before the
snapshot was omitted, the verification is invalid and must be repeated.

## Verifier Selection

### Eligibility Query

The policy engine computes eligible verifier principals. It MUST:

1. authenticate and authorize the requesting coordinator;
2. read the accepted assignment and completion at one projection high-water
   mark;
3. resolve the historical contribution and conflict-root closure;
4. exclude conflicted, disabled, retired, compromised, expired, or
   capability-deficient principals;
5. enforce visibility without disclosing hidden candidates;
6. enforce workload, timeout, and quorum policy;
7. return a query commitment and candidate count, not unrestricted registry
   rows;
8. append the selected verifier assignment atomically with its reservation.

Selection MAY be deterministic round-robin, weighted scheduling, random draw,
or operator choice, but the algorithm and seed inputs are versioned and
recorded. The selection method cannot relax eligibility.

### Verifier Assignment

Verification is itself an assignment with:

- immutable review target and criteria;
- permitted evidence and tools;
- prohibited mutation subjects;
- expected methods and output schema;
- verifier deadline and budget;
- conflict snapshot commitment;
- independent callback obligation.

The verifier gets read capability for allowed evidence and
`verification:decide` for the exact assignment revision. It does not receive
work mutation, redaction, policy, or release authority merely by being a
verifier.

### Reservation And Race Safety

Verifier reservation is a protected resource lease on:

```text
verification:<project_id>:<assignment_id>:<revision>:<review_slot>
```

All material mutations and release/finalization gates also lock:

```text
verification-domain:<project_id>:<assignment_id>:<revision>
```

The reservation transaction locks the verification domain, aggregate,
conflict snapshot, and slot. It rejects duplicate slot assignment, changed
completion version, changed policy, or stale fencing tokens.

Multiple quorum slots MAY run concurrently. Their verifiers cannot share a
conflict root with each other under `multi_principal_quorum`.

### Verification Slot Aggregate

Each slot is keyed by:

```text
(project_id, assignment_id, revision, verification_epoch, slot)
```

Its states are:

```text
reserved
active
approved
rejected
unable_to_verify
cancelled
timed_out
invalidated
```

Only the selected eligible verifier may transition its `active` slot to
`approved`, `rejected`, or `unable_to_verify` through
`verification.slot_decided.v1`. Slot decisions are terminal and independently
versioned. They never transition the verification epoch directly.

Cancellation, timeout, late contribution, or changed conflict roots transition
the affected slot to its matching terminal state under policy. Replacement
uses a new slot identity or explicitly versioned replacement slot; it never
rewrites a decision.

### Late Contribution Atomicity

A material artifact, evidence, contribution, principal-relationship,
scorecard, criteria, or policy mutation affecting a completed revision MUST
use compound primary event `contribution.material_mutation_accepted.v2`, owned
by the assignment verification domain. Its one transition set:

1. validates mutation authority and fencing;
2. increments the contribution or conflict epoch;
3. records the material mutation in the primary payload;
4. transitions any current `approved`, `waived`, or `not_required`
   verification epoch projection to `invalidated` without a child event;
5. fences active verifier slots whose snapshot is stale;
6. updates composite status to `reverification_required`;
7. prevents release, finalization, export, or dependent completion from
   consuming the old approval.

Every dependent gate locks the same verification domain and revalidates target
hash, contribution epoch, relationship-registry high-water mark, current
verification epoch, and policy before its own commit. This closes the interval
between a late mutation and invalidation.

## Verification Decision

### Required Decision Envelope

`verification.slot_decided.v1` contains:

| Field | Contract |
|---|---|
| `verification_id` / `slot` | Stable review and quorum slot |
| `assignment_id` / `revision` | Exact target |
| `completion_event_id` | Immutable completion callback |
| `verifier_principal_id` / `actor_id` | Authenticated reviewer |
| `verifier_conflict_root_id` | Event-time conflict root |
| `policy_id` / `version` | Bound policy |
| `conflict_snapshot_hash` | Frozen eligibility input |
| `criterion_decisions` | One decision per required criterion |
| `method_results` | Required method outcomes |
| `evidence_refs` | Content-addressed review evidence |
| `finding_refs` | Typed findings, if any |
| `decision` | `approve`, `reject`, or `unable_to_verify` |
| `decided_at` | Authoritative store time |

Criterion decisions are `satisfied`, `not_satisfied`, or `unable_to_verify`.
Approval is invalid when a required criterion is not satisfied or an
`unable_to_verify` result is not explicitly allowed by policy.

### Transaction Checks

Before accepting a slot decision, the store rechecks:

1. verifier identity and capability;
2. current verifier lease and fencing token;
3. assignment, revision, completion, policy, and conflict snapshot hashes;
4. verifier conflict root against the frozen and current relationship views;
5. contribution events through the append high-water mark;
6. evidence integrity, visibility, retention, and redaction state;
7. criterion and method coverage;
8. quorum uniqueness;
9. idempotency scope and request hash.

A verifier who contributed after selection becomes ineligible. Its pending
decision is rejected, its slot is fenced, and a replacement review is
scheduled.

### Quorum

The quorum reducer is the only principal allowed to append
`verification.epoch_reduced.v1`. It locks the verification domain, epoch, all
required slots, contribution and relationship high-water marks, target, and
policy. A one-slot policy still passes through this reducer.

Epoch approval requires:

- all required slots filled by mutually independent eligible roots;
- the configured approval threshold;
- no unresolved critical finding;
- identical target, completion, criteria, policy, and conflict snapshot;
- decisions within the policy's validity window.

The reducer records every slot version, decision, conflict root, threshold,
target hash, unresolved-finding root, reduction-policy version, and
`reduction_input_root`. It verifies root uniqueness and target equality
atomically.

Reduction is ready only when:

- current slot decisions already make approval or rejection mathematically
  decisive under the sealed threshold; or
- all required slots are terminal; or
- the authoritative review deadline expired; or
- an authorized escalation predicate added or cancelled slots and marked the
  set reducible.

While required slots remain live and the result is not decisive, the epoch
stays `active`. `disputed` requires a ready reduction whose terminal decisions
conflict or cannot satisfy policy; mere insufficiency while work is pending is
not dispute. A repeated reduction with unchanged slot, policy, finding,
deadline, and escalation inputs has the same `reduction_input_root` and returns
the prior result or is rejected as a no-op.

An escalation policy may request another independent slot, return the
assignment for correction, or require an authorized human decision. It cannot
average away a failed required criterion.

### Rejection And Correction

A rejection records typed findings:

```text
finding_id
criterion_id
severity
description
evidence_refs
required_correction
visibility
classification
```

Findings never embed unrestricted secrets. A correction creates assignment
revision `r + 1`, references the rejected verification epoch and findings,
requires fresh acceptance, and starts a new execution spell and callback
obligation. All correcting principals join the contribution conflict set. A
new completion event and verification epoch are required.

### Decision Appeal

When completion bytes, criteria, evidence, and contribution epoch are
unchanged but a rejection is proven erroneous, compromised, procedurally
invalid, or successfully appealed, an independent appeal authority with
`verification:appeal` may append `verification.appeal_granted.v1`.

The appeal event targets the verification family rather than mutating the
rejected epoch. It records:

- rejected epoch and decision roots;
- unchanged completion, criteria, evidence, and contribution hashes;
- appeal reason and supporting evidence;
- appeal-authority principal and conflict root;
- policy and separation-of-duties proof;
- reserved next epoch `e + 1`.

In one compound transition it preserves epoch `e` as rejected and creates epoch
`e + 1` in `requested` against identical bytes. The appeal authority cannot
serve as a new slot verifier unless independently eligible. Changed bytes or
criteria are not appealable and require assignment revision `r + 1`.

### Verification Timeout Disposition

A terminal timed-out epoch follows its versioned recovery policy and can
receive exactly one semantic disposition. Compound event
`verification.timed_out.v2` transitions the epoch to `timed_out` and atomically
creates a timeout-disposition aggregate keyed by:

```text
(project_id, verification_family_id, timed_out_epoch)
```

Its initial state is `undisposed`, version 1. The key is unique for all time.
An authorized principal with `verification:recover` invokes compound primary
event `verification.timeout_disposed.v1`, owned by this aggregate, with one
compare-and-set transition from `undisposed` to:

- `abandon`: preserve `verification_timed_out` as final and escalate the
  assignment;
- `requeue`: preserve epoch `e` as timed out and create gap-free epoch `e + 1`
  in `requested` against unchanged completion bytes;
- `waive`: preserve epoch `e` and create epoch `e + 1` in `waived` only when
  the separate waiver authority and policy also approve;
- `escalate`: preserve epoch `e`, create a protected escalation item, and
  require a later disposition event.

The event binds authoritative deadline, slot terminal states, notification
delivery, target and contribution hashes, recovery count, retry limit,
principal eligibility, waiver proof when applicable, and idempotency. The
recovery principal cannot serve as a successor verifier unless independently
eligible. Acceptance locks the disposition aggregate, verification family,
assignment verification domain, and successor-epoch key. It requires state
`undisposed`, expected version 1, no prior disposition, and no successor epoch.
No disposition resumes or rewrites the timed-out epoch.

`abandon`, `requeue`, `waive`, and `escalate` are terminal disposition states.
The accepted event ID, outcome, idempotency identity, request hash, and
successor or escalation identity are persisted on the disposition aggregate.
An exact retry returns that event. Every different key, request hash, or
outcome conflicts without append, even when it arrives after the first
transaction. Concurrent different-key requests serialize on the disposition
row and only one can win.

For `escalate`, `verification.timeout_disposed.v1` creates exactly one
verification escalation aggregate keyed by:

```text
(project_id, verification_family_id, timed_out_epoch, escalation_id)
```

`escalation_id` is a server-assigned UUIDv7. A uniqueness constraint permits
one escalation for a verification-family epoch. Its immutable opening payload
binds the assignment revision, unchanged target and contribution hashes,
timed-out epoch and decision root, recovery-policy revision, reason,
requesting and recovery principals, open and disposition deadlines, required
authorities, notification route, and canonical idempotency record.

The escalation states are:

```text
open -> requeued
     -> waived
     -> abandoned
     -> superseded
```

All states after `open` are terminal. An authorized escalation authority uses
compound event `verification.escalation_disposed.v1` with one outcome:

- `requeued`: transition the escalation to `requeued` and create gap-free
  verification epoch `e + 1` in `requested` against unchanged bytes;
- `waived`: transition it to `waived` and create epoch `e + 1` in `waived`,
  with a distinct authorization entry from a policy-eligible waiver authority;
- `abandoned`: transition it to `abandoned`, create no successor epoch, and
  preserve the assignment's `verification_timed_out` composite outcome;
- `superseded`: transition it to `superseded` only when a newer assignment
  revision or target hash has already made the escalation inapplicable.

The event requires `verification:escalation_dispose`; `requeued` also requires
`verification:recover`, `waived` also requires `verification:waive`, and
`superseded` also requires `verification:invalidate`. Required authorities and
separation of duties use distinct replayable authorization-set entries.
`verification.escalation_expired.v1` transitions overdue `open` to `abandoned`
under the policy recovery principal with `verification:recover`; authoritative
store time must be at or after the disposition deadline.

Both events lock the escalation, verification family, assignment verification
domain, and required conflict domains. They validate expected versions and the
exact S264.1 idempotency identity before appending one transition set.
Uniqueness plus the `open` precondition permits exactly one terminal
disposition. Same-key retries return the accepted event; another key or outcome
after terminal state conflicts without append. Replay requires every terminal
escalation to have exactly one disposition, and requires each requeued or
waived state to have exactly one matching successor-epoch transition in that
same compound event.
An `open` escalation observed after its deadline is deterministically
`overdue`, blocks finalization that relies on the verification family, and must
be terminalized by the next recovery sweep; replay does not invent an expiry
event.

Replay also requires each timed-out verification epoch to have exactly one
timeout-disposition aggregate, at most one accepted
`verification.timeout_disposed.v1`, and no successor epoch except the one
created by a `requeue` or `waive` disposition or by the escalation aggregate
after an `escalate` disposition. Once disposition is `escalate`, only
`verification.escalation_disposed.v1` may create a successor. Replay rejects a
successor without its originating compound disposition, multiple semantic
dispositions, or an open escalation when another path already created a
successor.

## Reverification

Approval is invalidated by:

- a material artifact or scorecard change;
- a new or corrected contribution effective before approval;
- changed required criteria or policy;
- evidence integrity failure, redaction, or retention loss that removes proof;
- principal compromise effective before the decision;
- discovered conflict-root linkage;
- replay divergence;
- an audited round reopen affecting the verified outcome.

Invalidation appends `verification.invalidated.v1` and preserves the completed
assignment revision and prior decision as history. If target bytes remain
unchanged, the policy engine creates verification epoch `e + 1`. If target
bytes, criteria, assignee, evidence requirements, resources, or policy changed,
it creates assignment revision `r + 1`. Neither terminal aggregate resumes.

Non-material display corrections do not require reverification when their
canonical target hash is unchanged.

## Principal Lifecycle

### Retirement

A retired principal cannot receive new verifier assignments. Historical
decisions remain valid if the principal was eligible at decision time and no
other invalidation applies.

### Compromise

A compromise event has an effective time and confidence. Decisions at or after
the earliest proven compromise time are invalidated. Earlier decisions are
flagged for policy-directed review; they are not automatically rewritten.

### Merge And Split

When two principal records are proven to share one controller, the registry
appends a merge relationship and recalculates conflict roots from its effective
time. It does not delete either identity or attribution history.

A split after control separation affects future eligibility only. Historical
work performed under common control remains conflicted.

### Aliases And Sessions

Aliases map to actors or principals but cannot receive independent trust.
Sessions inherit the principal's conflict root at event time. Starting another
session, changing a model, switching a role, or moving to another worktree does
not create verifier independence.

### Service Principals

A service principal controlled by an author or delegator is conflicted through
`service_owned`. A genuinely independent hosted service may qualify only when
its controller, operating policy, evidence access, and audit identity are
registered and allowed by the verification policy.

## Waivers And Break Glass

An unavailable independent verifier does not make self-review independent.

Where policy allows a waiver, an authorized principal other than the assignee
appends `verification.waived.v1` with:

- exact assignment revision and completion event;
- required tier and unmet eligibility reason;
- risk acceptance authority and conflict root;
- bounded justification;
- compensating controls;
- expiry and required follow-up;
- visibility and classification.

The composite outcome is `verified_with_waiver`, distinct from `verified`.
Reports, scorecards, release gates, and evaluation manifests retain that
distinction.

Critical separation-of-duties actions cannot be waived by the delegator,
assignee, author, contributor, or their conflict roots. Break-glass access may
contain an incident but does not itself approve the affected work.

## Privacy And Non-Enumeration

Eligibility, conflicts, and decisions use S264.1 filtered views:

- unauthorized callers cannot enumerate principals, aliases, relationships,
  contribution subjects, or verifier availability;
- denial responses use policy-defined non-enumerating classes;
- restricted contributor identities remain committed in conflict snapshots;
- verifier evidence inherits the strictest classification of its inputs;
- caches and cursors bind principal, project, policy, query, and visibility;
- timing classes are measured and bounded by deployment policy.

Redaction may hide descriptive identity fields but cannot remove the protected
fact that a conflict existed. The retained keyed commitment remains sufficient
for deterministic conflict evaluation while its key is legally and
operationally retained.

## Verifier Projection

Authorized operating views expose:

- verification requirement and tier;
- pending, active, approved, rejected, disputed, invalidated, waived, or timed
  out state;
- criterion coverage;
- eligible-verifier availability class;
- quorum progress without hidden identity leakage;
- visible findings and requested corrections;
- decision age and reverification triggers;
- evidence reliability and retention health.

Unknown eligibility is not `eligible`. Hidden identity is not `no conflict`.
Missing evidence is not `passed`.

## Verifier Replay Invariants

Replay MUST prove:

1. every decision targets immutable completion bytes;
2. every deciding actor is controlled by the recorded verifier principal;
3. conflict roots are reconstructed from event-time principal relationships;
4. authors, contributors, handoff parties, and prohibited delegators are
   excluded at the required tier;
5. slot decisions are immutable and never directly approve an epoch;
6. the quorum reducer proves threshold, root uniqueness, target equality, and
   unresolved-finding policy even for one-slot review;
7. every decision covers required criteria and methods;
8. late contributions and relationships trigger deterministic invalidation;
9. appeal preserves the rejected epoch and creates one gap-free successor
   epoch against identical bytes;
10. waivers remain distinct from approval;
11. redaction preserves conflict commitments;
12. supported adapters reproduce identical eligibility and decision
    projections.

## S264.2-2 Adversarial Criteria

S271 implementation acceptance includes:

1. two aliases, actors, sessions, roles, models, or worktrees controlled by one
   principal cannot satisfy independent verification;
2. transitive delegated control and service ownership collapse to one conflict
   root;
3. an unknown controller relationship fails closed at independent tiers;
4. a hidden contributor remains conflicted without identity disclosure;
5. revocation and principal split do not rewrite historical common control;
6. duplicate quorum slots from one conflict root are rejected atomically;
7. an artifact with missing or unverifiable producer provenance cannot enter an
   independent completion snapshot;
8. a contribution racing approval either precedes the decision and blocks it
   or follows it and invalidates it in the mutation transaction;
9. finalization, release, export, and dependent completion cannot consume an
   invalidated or stale contribution epoch;
10. redaction preserves conflict commitments and restore cannot revive a
    removed producer identity as independent;
11. verifier contribution after selection fences its slot and schedules a
    replacement;
12. waiver and break-glass results remain distinguishable from independent
    approval in every projection and gate.
13. a slot decision cannot approve an epoch until the quorum reducer validates
    it, including a one-slot policy;
14. successful appeal preserves the rejected epoch, requires independent
    authority, and creates exactly one next epoch against unchanged bytes.
15. the quorum reducer cannot dispute or terminate an epoch while required
    slots are live unless the outcome is mathematically decisive;
16. verification timeout recovery preserves the old epoch and creates at most
    one authorized successor or waiver disposition.

## S264.2-2 Acceptance Criteria

S264.2-2 is complete when the contract:

- defines versioned verifier policies and independence tiers;
- evaluates independence over durable principal conflict roots;
- treats aliases, sessions, roles, actors, and worktrees as non-independent
  when controlled by one principal;
- includes authors, contributors, handoff parties, assignees, and
  policy-selected delegators in the conflict set;
- freezes contribution and relationship evidence for review while rechecking
  late conflicts at decision time;
- defines verifier assignments, protected reservation, decision evidence,
  quorum, rejection, correction, and reverification;
- distinguishes waiver and break-glass from independent approval;
- preserves privacy and non-enumeration while retaining conflict commitments;
- assigns enforcement to S271 and principal/event storage to S268.

## Merge-Safe Learning

### Goal

Concurrent Team Round participants must be able to report, corroborate,
correct, and retire durable learnings without losing another participant's
evidence. Learning is a ledger-derived projection, not a shared JSON document
that one worktree replaces after another.

The merge contract applies to common issues, yardage-book updates, bunker
locations, training recommendations, post-merge memories, and future
repository learning surfaces. Each surface may use a narrower schema, but it
cannot weaken event identity, evidence deduplication, authorization,
classification, or deterministic merge rules.

### Learning Identities

The durable identities are:

```text
learning_report_id
pattern_id
occurrence_id
evidence_id
pattern_version
```

- `learning_report_id` is a server-assigned UUIDv7 for one immutable report.
- `pattern_id` is a server-assigned durable UUIDv7 for one canonical pattern.
- `occurrence_id` is a classification-safe commitment to the immutable source
  event, artifact version, test execution, measurement, or incident occurrence.
- `evidence_id` is a classification-safe commitment to one report's evidence
  wrapper and provenance under the S264.1 integrity contract.
- `pattern_version` is a gap-free positive integer for material canonical
  pattern revisions.

Display titles, normalized descriptions, categories, filenames, sprint
numbers, and local array positions are not identities.

### Learning Report

The report payload within `learning.report_accepted.v2` contains:

| Field | Contract |
|---|---|
| `learning_report_id` | Immutable report identity |
| `candidate_pattern_id` | Existing pattern or null for a new candidate |
| `reporter_principal_id` / `actor_id` | Authenticated attribution |
| `round_id` / `attempt_id` / `ticket_key` | Origin scope |
| `category` | Versioned controlled vocabulary |
| `observation` | What happened |
| `impact` | Observable consequence |
| `prevention` | Proposed future action |
| `recurrence_claim` | `one_off`, `suspected`, or `confirmed` |
| `evidence_refs` | Stable evidence IDs and safe references |
| `related_pattern_ids` | Typed relationship candidates |
| `classification` / `visibility` | S264.1 labels |
| `correlation_id` / `caused_by_event_id` | Workflow provenance |
| `reported_at` | Authoritative store time |

The report MUST NOT contain raw credentials, unrestricted transcripts, hidden
tool payloads, or another principal's private data. Secret ingress scanning
applies to the complete report request.

### Evidence Identity

Evidence is deduplicated by:

```text
(project_id, occurrence_id)
```

`occurrence_id` excludes reporter, wrapper, and accepted time. It binds the
canonical source identity and version, occurrence class, and content or sealed
content commitment. Rewrapping, reimporting, or reporting the same source by
another principal therefore cannot create another recurrence.

The evidence wrapper is keyed by `(project_id, evidence_id)` and binds:

- evidence class and schema version;
- canonical `occurrence_id`;
- classification and visibility;
- producer principal and actor;
- observed and accepted times;
- integrity algorithm and key version.

Two reports referencing the same occurrence add one recurrence-set member,
even when their evidence wrapper, reporter, or acceptance time differs.
Different source occurrences from the same sprint remain distinct.
Redacted evidence retains a protected tombstone and keyed commitment so replay
does not count it again after restore or re-import.

### Candidate Matching

Candidate matching is advisory. It MAY propose existing patterns using
normalized text, tags, embeddings, file subjects, hazard types, or prior
evidence, but it cannot merge patterns authoritatively.

An authorized merge decision records:

- candidate report IDs and pattern IDs;
- matching algorithm and version;
- feature or embedding references safe for the viewer;
- confidence and threshold;
- deciding principal or deterministic policy;
- reason and evidence;
- resulting canonical pattern ID.

Low-confidence candidates remain separate. False merges are corrected by
versioned split events; history is never deleted.

### Canonical Pattern

The pattern projection contains:

```text
pattern_id
pattern_version
status
category
title
description
prevention
occurrence_set
evidence_wrapper_set
report_set
sprint_set
ticket_set
reporter_principal_set
first_observed_at
last_observed_at
recurrence_count
confidence
codification_status
classification
visibility
```

`recurrence_count` is the count of distinct qualifying occurrence IDs after
policy filtering, not the number of writes, reports, reporters, retries, or
array entries.

### Pattern States

Pattern states are:

```text
candidate
active
codification_proposed
codification_in_progress
paid_down
wont_fix
retired
split
merged
```

`merged` points to one canonical pattern. `split` points to resulting pattern
versions and a deterministic evidence partition. `paid_down`, `wont_fix`, and
`retired` do not prevent later evidence; new qualifying evidence triggers a
policy-directed reopen proposal rather than silently changing status.

### Transactional Merge

Adding a report to an existing pattern uses compound primary event
`learning.report_accepted.v2`, owned by the learning report aggregate. The
report payload is the sole ledger event; its affected transition advances the
pattern version, sets, and canonical fields. The transaction:

1. authorize `learning:report`;
2. validate the report, evidence, and visibility;
3. lock `(project_id, pattern_id)`;
4. read current `pattern_version`;
5. deduplicate report, occurrence, and evidence-wrapper IDs;
6. append one `learning.report_accepted.v2` containing report bytes, prior and
   next pattern bytes, and set roots;
7. advance the pattern chain link and version once;
8. update occurrence, evidence-wrapper, report, sprint, ticket, and reporter
   sets atomically;
9. recompute recurrence and confidence under the pinned policy version;
10. update learning and semantic-status projections;
11. commit.

Concurrent writes retry against the new pattern version. They do not overwrite
the entire projection. Exact retries return the prior accepted result.

### Concurrent Pattern Creation

Creating a null-candidate pattern first computes a versioned
`candidate_domain_id` as a keyed commitment over project, category, normalized
subject set, hazard class, and matching-policy fingerprint. The database has a
durable conflict-domain row for every candidate domain, including when no
pattern exists.

The `learning.report_accepted.v2` creation transaction locks the
candidate-domain row, re-runs advisory matching at the current project
high-water mark, and either:

- routes the report to one current canonical pattern; or
- initializes a server-assigned pattern at version `1` as the compound event's
  affected transition.

It never appends a second pattern-created or pattern-revision event.

Concurrent creators in the same domain serialize. Creators in different
domains may still produce semantic duplicates; later authorized merge resolves
them without losing reports. Candidate keys are matching and locking aids, not
public identities or proof that patterns are equal.

### Pattern Merge

Compound primary event `learning.patterns_merged.v2`, owned by a
learning-topology operation aggregate, is the only authoritative multi-pattern
merge. Source and survivor version changes are transition-set entries, not
child ledger events.
Its request contains:

- two or more current canonical source pattern IDs;
- expected version for every source;
- candidate matching evidence and policy version;
- authorized decision principal and `learning:merge` capability;
- requested survivor or null;
- idempotency key and canonical request hash.

Unless a policy-protected survivor is explicitly required, the canonical
survivor is the lexicographically smallest source `pattern_id`. The transaction:

1. resolves every source through existing redirects and rejects duplicates or
   cycles;
2. locks candidate-domain and pattern rows in canonical byte order;
3. rechecks expected versions, classification authority, and merge policy;
4. unions report, occurrence, evidence-wrapper, sprint, ticket, and reporter
   sets into survivor version `v + 1`;
5. recomputes canonical fields, recurrence, confidence, and strictest
   classification;
6. transitions each losing pattern to `merged` with an immutable direct
   redirect to the survivor;
7. appends one merge event containing source versions, survivor bytes, set
   roots, and redirect map;
8. updates learning and status projections atomically.

A report append resolves redirects while holding the destination pattern lock.
If a merge wins first, the append targets the survivor. If an append wins
first, the merge observes the incremented source version and must retry with
the included report. No write lands on a losing pattern after redirect commit.

### Pattern Split

Compound primary event `learning.pattern_split.v2`, owned by a
learning-topology operation aggregate, contains:

- one current source pattern and expected version;
- two or more server-reserved child pattern IDs;
- a total partition assigning every occurrence ID to exactly one child;
- assignment of each report and evidence wrapper to one or more children
  without changing occurrence count;
- canonical fields for each child;
- split evidence, reason, policy, decision principal, and
  `learning:split` capability;
- idempotency key and canonical request hash.

The transaction locks the source, child IDs, and candidate domains in canonical
byte order. It rejects missing or duplicate occurrence assignments, existing
child aggregates, stale source version, merge redirects, and any mapping that
would create a merge/split cycle. It initializes all child version-1 patterns
and the source `split` state as affected transitions of the one compound primary
event; it emits no child pattern events.

New reports targeting the split source are rejected with safe child candidate
references; the caller or deterministic matching policy must choose a child.
A split never redirects all future writes to an arbitrary child.

### Merge And Split Concurrency

Multi-pattern operations share a project-scoped learning topology lock plus
ordered pattern and candidate-domain locks. The topology version increments on
every merge or split. Requests bind the expected topology version and all
source versions.

Concurrent overlapping merge/split operations cannot both commit. Disjoint
operations may commit concurrently when adapter conformance proves equivalent
serialization. Replay validates:

- one terminal topology edge per source version;
- direct merge redirects only toward a current canonical survivor;
- no merge or split cycles;
- total occurrence partitions;
- stable set roots before and after topology changes;
- every concurrently appended report reachable from exactly one current
  canonical pattern.

### Deterministic Field Merge

Set-valued fields use canonical set union over stable IDs. Times use minimum
for first observation and maximum for last observation. Recurrence derives
from the occurrence set. Confidence derives from a versioned deterministic
policy.

Canonical category, title, description, prevention, status, and classification
are not last-writer-wins registers. A conflict creates
`learning.revision_proposed.v1`. Authorized resolution appends
`learning.revision_accepted.v1` with:

- base and proposed pattern versions;
- changed fields and reasons;
- supporting and dissenting evidence;
- resolver principal and capability;
- policy version;
- resulting canonical bytes.

If the base version is stale, resolution fails and must be rebased on the
current version.

### Attribution

Every report retains its reporter. Pattern projection attribution is
non-exclusive: it may list multiple reporters, affected actors, cause
principals, and resolver principals.

Cross-agent hazards use the canonical `penalty_id`, `caused_by`, and
`resolved_by` rules from S264. Learning projections may reference that penalty
once. They cannot copy the penalty per reporter, assign it to the resolver, or
turn corroboration into another penalty.

### Promotion And Codification

Promotion to an active common issue uses a versioned policy with:

- minimum distinct evidence count;
- minimum independent sprint or round count;
- evidence reliability requirement;
- severity or impact threshold;
- classification and visibility constraints;
- allowed manual override authority.

Codification records a target artifact or guard, responsible assignment,
verification evidence, and outcome. Paying down a pattern requires evidence
that the preventive mechanism exists and works; a commit message alone is not
proof.

### Offline And Cross-Worktree Reports

A disconnected worktree MAY queue signed or authenticated report requests, but
local queue order is not authority. On reconnect:

1. validate project and principal binding;
2. scan and authorize each complete request;
3. append each report independently through canonical idempotency;
4. preserve original observation time as an observation, not store order;
5. assign authoritative project sequence at append;
6. merge against current pattern versions;
7. quarantine ambiguous or invalid reports.

Copying `common-issues.json`, `.slope` state, or an entire projection between
worktrees is forbidden.

### Retention, Redaction, And Restore

Learning reports and evidence follow the strictest input classification.
Redaction is evented and preserves protected facts required for deduplication,
conflict evaluation, and score integrity.

Restore reconciles against the external deletion registry and high-water marks
before rebuilding patterns. A deleted or redacted evidence item cannot revive
from a stale projection, backup, local worktree, or benchmark bundle.

### Learning Replay Invariants

Replay MUST prove:

1. each report and occurrence ID contributes at most once to recurrence;
2. report order does not change canonical set membership;
3. material pattern versions are gap-free;
4. stale-base canonical revisions never apply;
5. merge and split mappings are acyclic and deterministic;
6. recurrence derives from qualifying evidence rather than write count;
7. resolver attribution does not inherit cause or penalty;
8. redacted evidence tombstones prevent revival and recounting;
9. SQLite, PostgreSQL, and conforming custom adapters produce identical
   canonical pattern bytes;
10. no whole-document replacement is required for convergence.

## Semantic Activity

### Goal

The primary activity surface answers:

```text
Who did what to which object, with what outcome, and what needs attention?
```

It does not present every storage read, heartbeat, notification receipt,
acknowledgment, lease renewal, retry poll, or projection refresh as meaningful
progress.

### Activity Record

`semantic_activity.v1` is a deterministic projection record with:

| Field | Contract |
|---|---|
| `activity_id` | Stable projection identity derived from source event IDs |
| `source_event_ids` | Ordered authoritative source events |
| `principal_id` / `actor_id` / `role` | Visible attribution |
| `verb` | Versioned semantic action |
| `object_type` / `object_id` | Typed subject |
| `outcome` | Versioned result |
| `attention` | `none`, `watch`, `action`, or `urgent` |
| `summary_code` | Localizable allowlisted code |
| `safe_parameters` | Allowlisted display values |
| `correlation_id` | Workflow grouping |
| `occurred_at` | Source store time |
| `project_sequence` | Stable total order |
| `classification` / `visibility` | Access labels |

Display prose is rendered from `summary_code` and allowlisted parameters.
Untrusted event payload text is never interpolated directly into an operating
view.

### Verb Vocabulary

The initial primary verbs are:

```text
assigned
accepted
started
handed_off
blocked
resumed
completed
verification_requested
approved
rejected
cancelled
timed_out
requeued
dead_lettered
escalated
released
merged
redacted
restored
```

Diagnostic verbs include:

```text
read
polled
acknowledged
heartbeat_sent
lease_renewed
notification_retried
projection_refreshed
```

Diagnostic verbs do not enter the primary feed unless their outcome creates a
semantic failure, such as repeated renewal failure causing `stale` or a
notification dead letter causing `action`.

### Outcomes

Primary outcomes are:

```text
succeeded
failed
blocked
partial
pending
declined
cancelled
expired
unknown
```

Outcome is not inferred from HTTP status, process exit alone, or presence of a
message. It derives from accepted workflow state and typed evidence.

### Activity Levels

Activity is projected into:

1. `primary`: state changes, outcomes, blockers, verification, timeout,
   escalation, dead letter, and operator-relevant recovery;
2. `secondary`: bounded progress milestones, handoff offers, queue movement,
   and learning promotion;
3. `diagnostic`: transport, polling, heartbeat, lease renewal, cache, and
   delivery details.

Authorized users may expand lower levels. Default status views show primary
and attention-bearing secondary records.

## Worker And Assignment Status

### Orthogonal Signals

The status engine keeps these signals separate:

```text
session_liveness
lease_liveness
assignment_state
semantic_progress
callback_obligation
queue_state
notification_delivery
deadline_state
```

One signal never silently substitutes for another. A live session may hold an
expired lease. A renewed lease may accompany no semantic progress. A completed
callback may have a failed notification. A quiet worker may be validly waiting
on an external dependency.

### Derived Operating States

The projection first computes orthogonal facets:

```text
work = created | offered | accepted | in_progress | blocked |
       completion_reported | cancelled | timed_out | superseded
verification = absent | not_required | pending | disputed | approved |
               rejected | waived | cancelled | timed_out | invalidated
lease = not_required | healthy | grace | expired | fenced | unknown
session = not_required | healthy | grace | expired | unknown
progress = not_due | recent | due | stale | unknown
callback = absent | open | blocker | completion | handoff | cancel | timeout
attention = none | watch | action | urgent
```

It then selects exactly one assignment operating state with this first-match
precedence:

| Rank | State | Deterministic predicate |
|---|---|---|
| 1 | `unknown` | Any policy-required source is unknown, integrity-invalid, or mutually inconsistent |
| 2 | `dead_lettered` | Current recovery item has accepted dead-letter state |
| 3 | `timed_out` | Assignment work is `timed_out` |
| 4 | `cancelled` | Assignment work is `cancelled` |
| 5 | `correction_required` | Work completed and current verification is `rejected` |
| 6 | `reverification_required` | Work completed and verification is `invalidated` |
| 7 | `verification_timed_out` | Work completed and verification is `timed_out` |
| 8 | `verification_cancelled` | Work completed and verification is `cancelled` |
| 9 | `blocked` | Current blocker requests an external action now |
| 10 | `waiting` | Current blocker declares dependency wait with a future decision or retry deadline and no action due now |
| 11 | `stale` | Active work has expired or fenced required lease, expired required session, overdue progress, or overdue open obligation inside recovery grace |
| 12 | `starting` | Work is accepted, no spell has started, and dispatch grace has not expired |
| 13 | `queued` | Work is created or offered and eligible to schedule |
| 14 | `working` | Work is in progress, callback is open, required lease and session are healthy, and progress is not stale |
| 15 | `verification_pending` | Work completed and verification is requested, reserved, active, or disputed |
| 16 | `verified_with_waiver` | Work completed and verification is waived |
| 17 | `complete_unverified` | Work completed and verification is explicitly not required |
| 18 | `complete` | Work completed and verification is approved |
| 19 | `idle` | No active assignment exists and availability policy says available |

`complete` never includes cancelled, timed-out, dead-lettered, waived,
invalidated, rejected, unknown, or superseded work. Superseded revisions are
historical and do not become a current operating state unless no successor is
visible, which is `unknown`.

`stale` is a warning derived from policy and observations. `timed_out` is an
authoritative workflow state. They are not interchangeable. Accepted but
unstarted work is `starting`, not queued, working, or idle.

### Worker Aggregation

Worker status is derived after every visible assignment receives one state. It
exposes state counts and a primary state selected by:

1. highest attention among `unknown`, `dead_lettered`, `timed_out`, `blocked`,
   `stale`, `correction_required`, `reverification_required`,
   `verification_timed_out`, and `verification_cancelled`;
2. otherwise `working` when any assignment is working;
3. otherwise `starting`, `verification_pending`, `waiting`, then `queued`;
4. otherwise `verified_with_waiver` or `complete_unverified` as distinct
   historical attention states during a store-time policy window;
5. otherwise `idle` when availability is known and no active assignment
   exists;
6. otherwise `unknown`.

Active or actionable work always outranks non-actionable historical completion.
Historical attention ages out only from authoritative store time under the
versioned status policy; no acknowledgment event mutates or clears it.

Ties use oldest unresolved attention time, then canonical project sequence,
assignment ID, and revision. Completion of one assignment cannot hide another
blocked or stale assignment. Hidden assignments participate in authoritative
health before filtering but do not leak their identity. Worker projections
always retain counts for `complete`, `complete_unverified`,
`verified_with_waiver`, `verification_timed_out`,
`verification_cancelled`, correction, invalidation, cancellation, and timeout,
even after the primary availability state returns to idle.

### Semantic Progress

Semantic progress events are allowlisted and versioned. They include:

- assignment start;
- criterion state change;
- accepted artifact or code output;
- typed test or measurement milestone;
- handoff activation;
- blocker or resumed callback;
- completion callback;
- verification decision;
- recovery disposition.

Reads, acknowledgments, chat messages, heartbeat, lease renewal, token usage,
tool calls without accepted output, and repeated status text are not semantic
progress.

An adapter cannot declare arbitrary event types progress. Protocol negotiation
pins the semantic mapping registry version.

### Idle

`idle` means no accepted active assignment and availability is not disabled.
It is neutral, not a failure, timeout, or zero utilization. An operator may
distinguish:

- `available`;
- `scheduled`;
- `paused`;
- `offline`;
- `unknown`.

These labels require their own evidence and visibility rules.

### Stale

Staleness uses authoritative store time and a versioned status policy:

```text
semantic_progress_due_at
session_heartbeat_due_at
lease_renewal_due_at
grace_expires_at
```

The projection records which clock or signal is stale. A missing heartbeat
cannot mark an assignment stale when the session is not required by policy.
A blocker with a future retry time is `waiting`, not stale, until its decision
or retry deadline passes.

### Timeout

Only `assignment.timed_out.v1` produces `timed_out`. The status evaluator may
emit `timeout_due` attention before the recovery transaction, but clients
cannot promote that warning to terminal state.

### Blocker Prominence

Blocker activity includes:

- blocker class and safe summary;
- affected object;
- responsible decision or dependency owner when visible;
- first observed and escalation times;
- requested action;
- lease-release and recovery state;
- evidence reliability.

Primary views sort `urgent` and `action` blockers ahead of routine progress
within a bounded time horizon. Sorting never changes authoritative project
sequence or hides older unresolved blockers.

## Semantic Collapse And Noise Control

Projection MAY collapse repetitive source events when:

- all records share project, correlation, object, verb, outcome,
  classification, and visible actor;
- no record changes workflow state, attention, evidence, budget class, or
  error class;
- the collapse window and algorithm version are recorded;
- source event IDs remain recoverable for authorized diagnostics.

Examples:

- twenty successful lease renewals become one diagnostic summary;
- repeated identical polls do not enter primary activity;
- one blocker plus five delivery retries remains one primary blocker and one
  diagnostic delivery warning;
- completion and later approval remain two primary outcomes.

Collapse never combines different principals, hidden and visible records,
distinct blockers, failed and successful outcomes, or events from different
correlations.

## Status Ordering And Pagination

Primary activity uses:

```text
(project_sequence, event_id)
```

as canonical order. Attention views may rank unresolved urgency first but
include canonical cursor position and event order.

Cursors use the S264.1 encrypted, principal-bound query contract. A cursor
cannot be replayed by another principal, against another visibility policy, or
after its key or policy expiry.

At one read high-water mark, pagination MUST return every visible activity
record exactly once. Concurrent appends appear only after advancing the
high-water mark or starting a new read.

## Status Privacy

Filtered views:

- omit unauthorized assignments, actors, resources, evidence, and blockers;
- replace restricted details only with policy-approved safe summaries;
- do not reveal hidden object existence through counts, cursors, errors, cache
  keys, or timing classes;
- bind cached projections to principal, project, policy, query, visibility,
  classification, and high-water mark;
- keep raw diagnostic payloads out of public status serialization.

An observer gets no mutation capability. Seeing a blocker does not grant the
ability to cancel, reassign, verify, redact, or inspect its restricted
evidence.

Health and attention are computed from the complete authoritative signal set
before viewer filtering. Filtering never removes a hidden failure from the
health calculation or renormalizes coverage over only visible signals.

The viewer projection maps authoritative state to a policy-safe health class:

```text
healthy
attention_required
urgent_attention
unknown
```

When hidden state affects health, the view may disclose only the safe class and
an opaque authorized escalation route. Counts, denominators, timestamps,
object classes, and reason codes are coarsened or withheld so they cannot
enumerate hidden assignments. A viewer-specific `visible_coverage` MAY be
reported separately, but it is never labeled total coverage or used to
override authoritative health.

## Status Reliability

Every derived status includes:

```text
observed_state
observed_at
source_high_water_mark
policy_version
coverage
missing_reasons
staleness
```

Authoritative coverage is the fraction of all policy-required source classes
observed before filtering, with numerator, denominator, and provenance.
Viewer-visible coverage is a separately named measure. Unknown source health
cannot be represented as 100% coverage or a healthy worker.

Projection divergence, unavailable store, failed integrity verification, or
unsupported adapter capability yields `unknown` plus operator attention.

## S264.2-3 Adversarial Criteria

Implementation acceptance includes:

1. two worktrees concurrently report different evidence to one pattern and
   both survive;
2. exact retries do not increase recurrence;
3. stale pattern revisions cannot overwrite a newer canonical prevention;
4. concurrent create, merge, append, and split serialize deterministically,
   preserve every occurrence and evidence-wrapper ID, and never create a
   topology cycle;
5. redacted evidence cannot revive after restore;
6. resolver attribution does not receive the cause penalty;
7. one thousand acknowledgments and lease renewals do not flood primary
   activity;
8. a blocker remains prominent despite notification retries;
9. a live session with a fenced lease is not shown as working;
10. a healthy lease without semantic progress becomes specifically stale;
11. a declared dependency wait is not stale before its retry deadline;
12. only an accepted timeout event produces terminal timeout;
13. tied event times remain ordered by project sequence and event ID;
14. filtered status does not enumerate hidden objects or principals;
15. cursor reuse across principals or policy versions fails;
16. projection outage reports unknown rather than healthy or idle.
17. accepted-but-unstarted work projects `starting` and becomes stale after
    dispatch grace rather than appearing queued or working;
18. cancellation, timeout, dead letter, waiver, invalidation, and hidden
    failure cannot project `complete` or healthy;
19. a hidden blocker changes the safe health class without leaking its count,
    identity, object, or timestamp.
20. no-review completion remains `complete_unverified`, and verification
    timeout or cancellation remains visible before worker status can return to
    idle.
21. new starting, working, verification-pending, waiting, or queued work
    outranks non-actionable historical waiver or no-review completion.

## S264.2-3 Acceptance Criteria

S264.2-3 is complete when the contract:

- replaces whole-document learning writes with immutable reports and
  transactional per-pattern merges;
- defines stable report, pattern, occurrence, evidence-wrapper, and version
  identities;
- defines deterministic field merges, conflict resolution, split, promotion,
  codification, redaction, retention, and replay;
- defines verb-object-outcome activity with primary, secondary, and diagnostic
  levels;
- separates session, lease, workflow, progress, callback, queue, delivery, and
  deadline signals;
- gives blocker, idle, stale, timeout, unknown, and dead-letter states distinct
  semantics;
- defines semantic progress and bounded collapse without hiding failures;
- applies filtered views, stable ordering, encrypted cursors, and reliability
  metadata;
- assigns merge-safe learning to S270 and callback/status enforcement to S271.

## Multiplayer Evaluation

### Goal

Multiplayer evaluation estimates how a declared orchestration topology performs
relative to a declared single-agent or alternative-team baseline on a pinned
task population under comparable budgets, permissions, lifecycle rules, and
measurement.

It does not prove that every observed difference was caused by agent count, nor
does it rank durable principals without the exposure, difficulty, uncertainty,
and missingness rules from S264.

### Evaluation Units

The durable hierarchy is:

```text
evaluation_campaign
  -> task_case
    -> comparison_block
      -> arm
        -> trial
          -> trial_attempt
```

- A campaign defines the question, population, arms, policies, and analysis.
- A task case is one immutable task and repository starting state.
- A comparison block groups trials intended to be compared under common task
  and environment conditions.
- An arm defines one roster and orchestration topology.
- A trial is one predeclared draw for one arm and task case.
- A trial attempt is an execution retry governed by the pinned retry policy.

IDs are server-assigned UUIDv7 values scoped by `project_id`. Display names,
task indexes, seeds, sprint keys, and arm labels are not identities.

### Estimand

Every campaign declares a primary estimand before execution. The default paired
estimand is:

```text
mean over task cases of
  (team trial outcome - solo trial outcome)
```

under the campaign's declared outcome scale and trial aggregation rule.

The campaign must state:

- target task population;
- unit of assignment;
- unit of analysis;
- treatment arms;
- primary outcome;
- handling of retries, failures, timeouts, cancellation, and missing outcomes;
- task and trial weighting;
- paired or unpaired comparison;
- aggregation across seeds and attempts;
- uncertainty method;
- minimum task, trial, and coverage thresholds.

Changing the estimand after any unblinded outcome is observed creates a new
campaign version and is labeled exploratory.

### Canonical Team Score

When an evaluation trial executes a Team Round, its canonical score is the one
versioned scorecard outcome defined by S264. Evaluation does not select the best
agent result, add actor handicaps, average participant scores, or count one
shared penalty per participant.

Task reward MAY be separate from the SLOPE score when the external benchmark
defines one. Reports must label:

- external task reward;
- canonical SLOPE Team Round score;
- coordination overhead;
- cost;
- elapsed time;
- reliability and coverage.

These values remain separate measures. A future composite requires a new
versioned scoring contract and cannot rewrite prior reports.

## Campaign Manifest

### Manifest Identity And Seal

The canonical manifest is keyed by:

```text
(project_id, campaign_id, campaign_version)
```

Before execution, `evaluation.campaign_sealed.v1` commits to canonical manifest
bytes. Sealing is irreversible for that version. Any material change creates a
new campaign version.

Every trial binds the exact `campaign_manifest_hash`. Prior trials are reusable
only after `evaluation.trial_reuse_approved.v1` records a deterministic
field-level compatibility result. Reuse is forbidden when any of these change:

- estimand, outcome, inclusion, exclusion, missingness, retry, or stopping
  policy;
- task bytes, sampling frame, allocation, arm definition, roster, topology, or
  budget treatment;
- evaluator, success criteria, tools, environment, lifecycle, privacy, or
  analysis semantics;
- any input whose compatibility rule is absent or returns unknown.

Compatibility rules are versioned manifest policy, not caller declarations.
The decision records source and destination manifest hashes, field diff,
rule-version results, deciding service principal, and provenance.

### Required Manifest Fields

The manifest pins:

| Area | Required inputs |
|---|---|
| Question | Hypothesis, primary estimand, primary and secondary outcomes |
| Corpus | Corpus ID, version, sampling frame, eligibility rules, content hash, deterministic draw, exclusions, prior exposure, selection time, task IDs |
| Repository | Remote identity, base commit, submodules, patches, dirty-state policy |
| Roster | Principal, actor, role, model, provider, and controller identities |
| Topology | Orchestrator graph, assignment policy, communication channels, parallelism |
| Harness | Harness code commit, image or environment hash, evaluator revision |
| Models | Provider model IDs, model revisions when exposed, routing policy |
| Generation | Temperature, top-p, seed policy, context and output limits |
| Prompts | System, developer, persona, skill, template, and task prompt commitments |
| Tools | Tool registry version, capability grants, network and filesystem policy |
| Environment | OS, architecture, runtime, package manager, dependency lock hashes |
| Services | Database, port, service, cache, and external API allocation policy |
| Lifecycle | Timeout, retry, cancellation, handoff, blocker, recovery, and dead-letter policy |
| Verification | Verifier policy, evaluator independence, evidence requirements |
| Budgets | Token, cost, elapsed, tool-call, concurrency, and attempt limits |
| Pricing | Currency, price table, effective time, discounts, rounding, missing-price policy |
| Trials | Complete trial census, arm allocation, task order, seeds, trial count, blocking, randomization |
| Analysis | Analysis executable hash, dependency lock, inclusion set, weighting, missingness, RNG, uncertainty, precision, rounding, ordering, multiplicity policy |
| Privacy | Classification, visibility, redaction, retention, export, and deletion policy |
| Integrity | Schema registry, algorithms, key versions, manifest hash, anchors |

References use content-addressed safe locators. The manifest does not embed raw
credentials, private transcripts, unrestricted prompts, hidden test answers,
or full tool payloads.

### Corpus Selection

Before any campaign outcome is inspected, sealing commits to:

- eligible sampling frame and its content root;
- inclusion and exclusion rules;
- deterministic draw algorithm and seed;
- selected task IDs and selection timestamp;
- task strata and weights;
- prior model, prompt, operator, and evaluator exposure when known;
- contamination and benchmark-familiarity assessment.

Outcome-informed, manually favorable, convenience, or post hoc task selection
is labeled `exploratory_corpus`. It cannot support a confirmatory superiority
claim. An unknown prior-exposure record lowers reliability and is reported; it
is not silently treated as no exposure.

### Sealed Trial Census

The manifest enumerates every planned trial:

```text
trial_id
task_case_id
comparison_block_id
arm_id
allocation_index
seed
planned_order
required_disposition
```

The census root is part of the manifest hash. Trials cannot be added, removed,
or reassigned after seal. A sequential stopping policy may mark pre-enumerated
future trials `not_exposed` only through its sealed decision rule; it cannot
delete them.

### Prompt And Skill Commitments

For each prompt, persona, skill, instruction bundle, or template, the manifest
stores:

- artifact class and version;
- classification-safe content commitment;
- safe repository or sealed-object reference;
- producer and approval provenance;
- normalization and hash algorithm;
- effective order in the final instruction stack.

Concatenating individual hashes is insufficient. The manifest commits to the
ordered, framed instruction stack, including separators, roles, and expansion
rules.

### Model And Provider Identity

The manifest distinguishes:

```text
requested_model_id
resolved_model_id
provider_revision
routing_policy_version
fallback_model_ids
```

When a provider does not expose an immutable revision, the field is
`unknown` with provenance and the report lowers reproducibility confidence.
It never substitutes the requested marketing name as a proven immutable
revision.

### Environment Reproduction

The environment commitment includes:

- repository tree and Git metadata required by the task;
- dependency lockfiles and resolved artifact hashes;
- container or machine image identity;
- runtime and tool versions;
- locale, timezone, clock policy, and relevant environment allowlist;
- deterministic fixture, database, and service initialization;
- network allowlist and external response capture policy;
- CPU, memory, storage, and concurrency class;
- cache warm or cold policy;
- secret names and providers without secret values.

Unpinned external services are declared dependencies with observed versions,
response commitments, availability, and contamination risk.

### Analysis Reproduction

The sealed analysis specification commits to:

- executable, container, or source-tree content hash;
- dependency lock and resolved analysis-library hashes;
- inclusion-set reducer and canonical sort order;
- task, trial, arm, and missingness weighting;
- RNG algorithm, seed derivation, and independent stream labels;
- bootstrap, permutation, or interval algorithm and exact variant;
- resampling unit, repetition count, confidence level, and multiplicity rule;
- decimal or floating-point model, precision, platform constraints, and
  treatment of non-finite values;
- rounding mode and display precision;
- canonical JSON and table serialization;
- golden input and output vectors.

Analysis execution that cannot reproduce the golden vectors on the declared
platform is blocked. Cross-platform floating-point results may be reported as
semantically equivalent only under an explicit tolerance policy; they cannot
claim byte-identical replay.

## Campaign Lifecycle

### States

Campaign states are:

```text
draft
sealed
scheduled
running
collecting
collection_closed
analysis_pending
complete
failed
cancelled
invalidated
```

`complete`, `failed`, `cancelled`, and `invalidated` are terminal for one
campaign version.

### Legal Transitions

| From | Event | To | Capability |
|---|---|---|---|
| absent | `evaluation.campaign_created.v1` | `draft` | `evaluation:create` |
| `draft` | `evaluation.campaign_sealed.v1` | `sealed` | `evaluation:seal` |
| `sealed` | `evaluation.campaign_scheduled.v1` | `scheduled` | `evaluation:schedule` |
| `scheduled` | `evaluation.campaign_started.v1` | `running` | `evaluation:execute` |
| `running` | `evaluation.collection_started.v1` | `collecting` | `evaluation:execute` |
| `collecting` | `evaluation.collection_closed.v1` | `collection_closed` | `evaluation:collect_close` |
| `collection_closed` | `evaluation.analysis_requested.v1` | `analysis_pending` | `evaluation:analyze` |
| `analysis_pending` | `evaluation.campaign_completed.v1` | `complete` | `evaluation:complete` |
| any non-terminal | `evaluation.campaign_failed.v1` | `failed` | `evaluation:fail` |
| any non-terminal | `evaluation.campaign_cancelled.v1` | `cancelled` | `evaluation:cancel` |
| any non-`invalidated` state | `evaluation.campaign_invalidated.v1` | `invalidated` | `evaluation:invalidate` |

The store rejects execution for an unsealed manifest, append after terminal
state except invalidation metadata, or analysis before collection closure.

Collection closure locks the campaign and complete sealed trial census. It
requires every planned trial to have one terminal disposition or a
`not_exposed` disposition produced by the sealed stopping rule. It records
trial-state counts, terminal-event IDs, census root, stopping-rule inputs and
decision, collection high-water mark, and integrity root. Planned, allocated,
running, outcome-reported, or evidence-pending trials block closure.
Every attempt must also be terminal and its state, evidence disposition,
consumed budget, and terminal cause must reconcile to its trial through the
same compound evidence, failure, timeout, cancellation, or retry event. Any
divergent or non-terminal attempt blocks closure.

Campaign completion requires a current completed analysis run, independently
verified and published report version, no unresolved integrity failure, and
all required policy-deviation dispositions. Compound campaign invalidation
atomically transitions current analysis and report projections to invalidated
in its transition set; no invalidated campaign report may remain current or
exportable.

`evaluation.campaign_invalidated.v1` is a campaign-owned compound event. Its
payload contains a canonical child-disposition registry for the current
analysis run and current report lineage. Each registry entry is exactly one of:

- `transitioned`, with the child's prior state, expected version, and affected
  transition to `invalidated`;
- `already_invalidated`, with the child's current version and hash as a locked
  precondition and no affected transition;
- `absent`, with the canonical absent-row predicate and no affected
  transition.

For a present analysis run, `planned`, `running`, `completed`, `failed`, or
`cancelled` transitions to `invalidated`. For a present report, `draft`,
`generated`, `verified`, or `published` transitions to `invalidated`. No child
resumes. The event locks the campaign and child lineages, validates the
registry against authoritative current pointers, and includes one chain link
for every `transitioned` child. It atomically clears publication, export,
analysis-current, and report-current pointers.

An already invalidated campaign accepts no new invalidation event: a retry
under the original idempotency identity returns the original event, while a
different key returns `already_invalidated` without append. Replay rejects an
omitted current child, an invented absent child, a stale or extra registry
entry, a present non-invalidated child without a transition, or any current or
exportable analysis/report pointer remaining after invalidation.

### Trial Lifecycle

Trial states are:

```text
planned
allocated
running
outcome_reported
evidence_verified
included
excluded
failed
timed_out
cancelled
not_exposed
evidence_rejected
unverifiable
```

`included`, `excluded`, `failed`, `timed_out`, `cancelled`, `not_exposed`,
`evidence_rejected`, and `unverifiable` are terminal for one trial. Legal
transitions are:

| From | Event | To | Capability |
|---|---|---|---|
| absent | `evaluation.trial_planned.v1` | `planned` | `evaluation:seal` |
| `planned` | `evaluation.trial_allocated.v2` | `allocated` | `evaluation:allocate` |
| `allocated` | `evaluation.trial_started.v1` | `running` | `evaluation:execute` |
| `running` | `evaluation.trial_outcome_reported.v1` | `outcome_reported` | `evaluation:execute` |
| `outcome_reported` | `evaluation.evidence_verified.v2` | `evidence_verified` | `evaluation:evidence_verify` |
| `outcome_reported` | `evaluation.evidence_rejected.v2` | `evidence_rejected` | `evaluation:evidence_verify` |
| `outcome_reported` | `evaluation.evidence_unverifiable.v2` | `unverifiable` | `evaluation:evidence_verify` or `evaluation:evidence_recover` |
| `evidence_verified` | `evaluation.trial_included.v1` | `included` | `evaluation:disposition` |
| `evidence_verified` | `evaluation.trial_excluded.v1` | `excluded` | `evaluation:disposition` |
| `planned` | `evaluation.trial_not_exposed.v1` | `not_exposed` | `evaluation:stop_rule` |
| `allocated` or `running` | `evaluation.trial_failed.v2` | `failed` | `evaluation:fail` |
| `allocated` or `running` | `evaluation.trial_timed_out.v2` | `timed_out` | `evaluation:fail` |
| any non-terminal | `evaluation.trial_cancelled.v2` | `cancelled` | `evaluation:cancel` |

Exclusion requires a sealed rule, evidence, and an independent disposition
principal when policy requires it. A poor outcome, high cost, long duration,
coordination failure, timeout, or unfavorable arm is not an exclusion reason.
`failed`, `timed_out`, `cancelled`, `evidence_rejected`, and `unverifiable`
remain terminal census dispositions and enter the primary estimand under its
sealed loss rule. Evidence terminal events record typed cause, consumed budget,
metric missingness, evidence and integrity state, verifier or recovery
provenance, and loss-policy result.

### Trial Attempt Lifecycle

Attempts are keyed by:

```text
(project_id, trial_id, attempt_number)
```

`attempt_number` starts at `1` and is gap-free. States are:

```text
planned -> running -> outcome_reported -> verified
                                      \-> evidence_rejected
                                      \-> unverifiable
                  \-> retryable_failed
                  \-> terminal_failed
                  \-> timed_out
                  \-> cancelled
```

| From | Event | To | Capability | Guard |
|---|---|---|---|---|
| absent | `evaluation.trial_allocated.v2` or `evaluation.attempt_retryable_failed.v2` | `planned` | `evaluation:allocate` or `evaluation:retry_allocate` | Create attempt 1 or the next gap-free retry in the same trial-owned compound event |
| `planned` | `evaluation.attempt_started.v1` | `running` | `evaluation:execute` | Trial running, assignment and leases valid |
| `running` | `evaluation.attempt_outcome_reported.v1` | `outcome_reported` | `evaluation:execute` | Callback, scorecard, budget, and evidence roots present |
| `outcome_reported` | `evaluation.evidence_verified.v2` | `verified` | `evaluation:evidence_verify` | Evidence policy satisfied |
| `outcome_reported` | `evaluation.evidence_rejected.v2` | `evidence_rejected` | `evaluation:evidence_verify` | Integrity or evidence policy rejected |
| `outcome_reported` | `evaluation.evidence_unverifiable.v2` | `unverifiable` | `evaluation:evidence_verify` or `evaluation:evidence_recover` | Evidence unavailable, expired, redacted, or verification timed out |
| `running` | `evaluation.attempt_retryable_failed.v2` | `retryable_failed` | `evaluation:fail` | Failure class retryable and attempts remain |
| `planned` or `running` | `evaluation.trial_failed.v2` | `terminal_failed` | `evaluation:fail` | Non-retryable or attempts exhausted |
| `planned` or `running` | `evaluation.trial_timed_out.v2` | `timed_out` | `evaluation:fail` | Authoritative lifecycle timeout |
| any non-terminal | `evaluation.trial_cancelled.v2` | `cancelled` | `evaluation:cancel` | Cancellation policy permits |

Attempt terminal events preserve consumed resource and elapsed accounting.
Initial allocation locks the trial, budget meter, and resource claims and uses
`evaluation.trial_allocated.v2` to create attempt 1 in `planned` atomically
with the trial's transition to `allocated`. Retry creation locks the trial,
prior attempt, budget meter, and resource claims, cannot exceed the sealed
limit, and occurs inside `evaluation.attempt_retryable_failed.v2`.
That compound event carries two distinct authorization obligations:
`evaluation:fail` authorizes classifying and terminalizing attempt `n`;
`evaluation:retry_allocate` authorizes reserving budget and resources, creating
attempt `n + 1`, and advancing the current-attempt pointer. A fail-only
principal cannot allocate a retry. The two decisions may come from the same
principal only when the sealed campaign policy permits it; otherwise their
authorization-set entries must prove the configured separation of duties.

`evaluation:execute` is constrained to the allocated trial assignee principal
or an explicitly authorized orchestrator. `evaluation:evidence_verify` is
constrained to a policy-eligible evidence verifier.
The three `evaluation.evidence_*.v2` events are trial-owned compound primary
events that transition the current attempt and trial together with one event
ID, project sequence, transition root, and both aggregate chain links.

Failure, timeout, and cancellation use the same compound reconciliation rule:

| Compound event | Trial transition | Current attempt transition |
|---|---|---|
| `evaluation.attempt_retryable_failed.v2` | `running` -> `running`, advance current-attempt pointer | `running` -> `retryable_failed`; successor absent -> `planned` |
| `evaluation.trial_failed.v2` | `allocated` or `running` -> `failed` | `planned` or `running` -> `terminal_failed` |
| `evaluation.trial_timed_out.v2` | `allocated` or `running` -> `timed_out` | `planned` or `running` -> `timed_out` |
| `evaluation.trial_cancelled.v2` | any non-terminal -> `cancelled` | current non-terminal -> `cancelled`, when one exists |

The trial owns each event. The current attempt is an affected aggregate and
advances in the same transition set. Retryable failure is the only terminal
attempt disposition that leaves the trial active: it increments the trial
attempts-consumed count, records the failed attempt as reconciled, creates
attempt `n + 1` in `planned`, and advances the current pointer to it in the same
transition set under the sealed retry and budget policy. Allocation similarly
creates attempt 1 atomically. An `allocated` or `running` trial therefore has
exactly one current attempt: `planned` while allocated, and `planned` or
`running` while the trial is running. Once the trial is
`outcome_reported`, its current attempt must also be `outcome_reported`; a
one-sided transition blocks evidence processing. Terminal trial failure and
timeout transition the current `planned` or `running` attempt in the same
event. Cancellation MAY encounter no attempt when the trial is still
`planned`, or an already terminal current attempt after evidence disposition.
The compound event then records `attempt_disposition = absent` or
`attempt_disposition = already_terminal`; the latter includes the attempt
version and hash as a precondition. Neither case creates an attempt transition
or link.

Every compound terminal event records typed cause, attempt and trial prior
states, consumed arm budget and resources, elapsed time, metric missingness,
evidence availability, sealed loss-policy result, and the trial/attempt
reconciliation root. Replay rejects a separate attempt-only terminal event,
multiple terminal dispositions for one attempt, a terminal trial with a live
attempt, an allocated or running trial without exactly one current attempt, a
retry transition without exactly one reconciled failed attempt and one
gap-free planned successor, or a new attempt that exceeds the sealed limit.
Collection closure recomputes the reconciliation root from these compound
events and requires every attempt to appear exactly once.

`evaluation:evidence_recover` is constrained to a registered recovery principal
and may invoke only `evaluation.evidence_unverifiable.v2` after an authoritative
evidence-verification deadline, verifier timeout or unavailability, conflict
recheck, and sealed loss-policy decision. It records deadline, recovery
principal, missingness, consumed budget, verifier state, and provenance.

`evaluation:fail` and `evaluation:stop_rule` are constrained to registered
recovery and stopping-rule service principals. These identities do not grant
authority; the scoped capability and principal constraint must both pass.
`evaluation:retry_allocate` is constrained to a policy-eligible retry allocator
and does not grant failure classification, execution, or evidence authority.

### Authorization And Idempotency

Campaign policy binds principals or service-principal selectors for:

```text
evaluation:create
evaluation:seal
evaluation:schedule
evaluation:execute
evaluation:collect_close
evaluation:analyze
evaluation:report_draft
evaluation:report_verify
evaluation:complete
evaluation:invalidate
evaluation:allocate
evaluation:retry_allocate
evaluation:evidence_verify
evaluation:evidence_recover
evaluation:disposition
evaluation:fail
evaluation:stop_rule
evaluation:cancel
evaluation:export
```

Sealing, evidence verification, trial disposition, analysis approval, and
invalidation honor the configured separation-of-duties policy. Role labels do
not grant capabilities.

S272-2 adversarial tests include fail-only retry attempts, stale allocator
decisions, substitution between `evaluation:fail` and
`evaluation:retry_allocate`, separation-of-duties bypass, budget exhaustion,
and concurrent retry allocation. Every case must preserve one failed attempt,
at most one gap-free successor, and all-or-none budget and pointer updates.

Every lifecycle mutation supplies expected aggregate version, manifest hash,
capability, fencing tokens for protected resources, and an idempotency key
scoped to:

```text
(project_id, operation_kind, primary_aggregate_type,
 primary_aggregate_id, round_epoch?, idempotency_key)
```

`round_epoch` is mandatory when the evaluation mutation affects a round's score
or authority. Authenticated principal and actor, expected aggregate version,
event type, manifest hash, capabilities, fencing tokens, and transition
preconditions are canonical request-hash and stored-record fields. They are not
idempotency identity. Reusing a key after a version change or from another
principal therefore returns the original exact result for the same request hash or
`IDEMPOTENCY_PAYLOAD_CONFLICT` for a changed request. Terminal retries return
the accepted event. Recovery can only create a policy-allowed next attempt or
terminal disposition; it cannot reopen a terminal trial, attempt, campaign, or
report.

### Attempt Policy

Retry policy declares:

- retryable failure classes;
- maximum attempts;
- whether state, context, or artifacts carry forward;
- seed reuse or redraw;
- budget accounting across attempts;
- which attempt determines outcome;
- how earlier attempts enter cost and reliability metrics.

The default intention-to-treat policy counts all consumed cost and elapsed time
and treats exhausted retry, timeout, and orchestration failure as outcomes
under a predeclared loss rule. It never keeps only the best attempt.

### Assignment And Lease Integration

Every trial is a Team Round or single-player round using the same authoritative
assignment, callback, lease, verifier, and finalization contracts. Trial
orchestration cannot write directly to evaluation tables to fabricate progress
or completion.

Evaluation resources use typed claims for worktrees, ports, databases, service
instances, caches, and rate-limit pools. Cross-arm contamination is an
integrity failure, not ordinary noise.

## Experimental Design

### Comparable Arms

Team and solo arms must share, unless the estimand explicitly varies them:

- task cases and base commits;
- allowed task information;
- tool and network capabilities;
- evaluator and success criteria;
- environment resource class;
- timeout and retry loss rules;
- pricing basis;
- evidence and privacy policy.

Differences in aggregate token, elapsed, cost, concurrency, or tool budgets are
declared treatment components. Reports do not call arms "same budget" when
only per-agent limits match and the team has multiple agents.

### Arm Budget Accounting

Each arm has one aggregate budget meter keyed by:

```text
(project_id, campaign_id, campaign_version, comparison_block_id, arm_id)
```

The meter includes, according to sealed attribution rules:

- every worker and coordinator input, cached-input, reasoning, output, and
  total token observation;
- all retry and failed-attempt consumption;
- verifier, evaluator, recovery, and orchestration usage;
- tool and external service cost;
- queue, active, and wall-clock elapsed time;
- parallel compute and concurrency occupancy;
- allocated share of a common rate-limit or service pool.

Shared usage is allocated by a sealed deterministic rule and also reported
unallocated when no reliable rule exists. Unknown shared use remains unknown.

Protected mutations reserve budget before execution and settle observed usage
afterward. A hard limit fences new work and follows the sealed failure rule;
it does not discard the trial. A soft tolerance and measurement uncertainty
are declared per metric.

An estimand is labeled:

- `topology_only` only when aggregate arm meters are comparable within every
  sealed tolerance;
- `joint_topology_budget` when budget differs by design;
- `not_comparable` when an undeclared or unmeasured material mismatch occurs.

Per-agent equality is never sufficient for `topology_only`.

### Blocking And Randomization

Task case is the default comparison block. Arm order and seed assignment use a
pinned algorithm and recorded randomization seed generated before outcomes.

When temporal provider drift is plausible, trials interleave arms within
blocks. Running every solo trial before every team trial is not acceptable
without an explicit time-trend model and residual-risk statement.

### Leakage Prevention

The campaign declares whether agents or evaluators may observe:

- hidden tests;
- prior arm outputs;
- another trial's artifacts;
- evaluator feedback;
- corpus labels;
- benchmark exemplars;
- learning projections produced by campaign trials.

Training, memory, and common-issue updates produced during evaluation are
quarantined from every campaign arm until campaign collection closes. They may
enter later campaigns only after normal review and promotion. If carryover or
online adaptation is the declared treatment, the sealed manifest defines which
arm receives which learning, the causal ordering, delay, and comparison
interpretation. Cache keys, worktrees, databases, service state, message
channels, and learning projections must enforce that isolation.

### Sample Size

The manifest records:

- planned task-case count;
- trials per arm and task;
- minimum completed blocks;
- minimum outcome and cost coverage;
- minimum reliable sample for uncertainty;
- stopping rule.

Stopping after a favorable interim result is forbidden unless a sequential
analysis rule and alpha-spending policy were sealed in advance.

No fixed universal sample size proves multiplayer superiority. Reports show
the observed sample and uncertainty and label underpowered comparisons.

## Evidence Contract

### Trial Evidence Bundle

Each trial closes with a content-addressed bundle containing safe references
or commitments for:

- sealed campaign and arm manifest;
- task case and repository state;
- roster and resolved model identities;
- assignment, lease, callback, handoff, and verification events;
- tool calls and outputs allowed by retention policy;
- code, artifact, test, and evaluator outputs;
- token, cost, elapsed, queue, retry, and coordination measurements;
- terminal reason and missingness;
- scorecard and external reward versions;
- integrity chain and projection high-water marks.

Raw evidence remains in its classified store. Export bundles expose only
authorized fields and commitments.

### Evaluator Independence

External or model-based evaluators are service principals subject to the same
conflict-root and capability rules as other verifiers. An evaluated actor,
orchestrator, prompt author where prohibited, or service under common control
cannot satisfy an independent evaluator policy.

When blinded evaluation is required, the evaluator receives arm-neutral
artifact identifiers and no roster, topology, cost, or treatment labels.
Unblinding is an auditable event after decisions are sealed.

### Evidence Reliability

Every evidence class records:

```text
observed_state
value_or_commitment
unit
source
collection_method
collector_version
observed_at
sample_count
coverage
missing_reason
reliability_class
```

Reliability classes are:

```text
verified
observed
estimated
self_reported
unknown
```

An estimated token count is not verified usage. A self-reported completion is
not verified success. Unknown cost is not zero cost.

## Metrics

### Outcome Metrics

Required outcome metrics are:

- external task reward, when defined;
- canonical Team Round score versus par;
- required-criterion success rate;
- verified completion rate;
- failure, timeout, cancellation, dead-letter, and waiver rates.

Reports show pre-review coding score separately from final review-amended SLOPE
score when both are relevant. More thorough review must not be misreported as
worse raw execution without that distinction.

### Resource Metrics

Required resource metrics are:

- input, cached-input, output, reasoning, and total tokens when available;
- monetary cost under observed and normalized price tables;
- wall-clock elapsed time;
- active compute time when observed;
- queue and wait time;
- tool-call counts by class;
- peak and average parallelism;
- attempt and retry counts.

Price-normalized comparisons preserve raw usage and observed invoice cost.
Historical reports are not rewritten when provider prices change.

### Coordination Metrics

Coordination overhead includes:

- assignment creation and acceptance;
- orchestration messages and callbacks;
- handoffs;
- lease waits and conflicts;
- duplicate or abandoned work;
- verification and correction;
- recovery and escalation;
- coordinator-only token, cost, and elapsed measurements.

Each measure states whether it is directly observed, attributed by role,
estimated, or unavailable. Coordination overhead remains separate from the
canonical score and external reward.

### Reliability Metrics

Reports include:

- metric coverage by arm and evidence class;
- missing-reason distribution;
- integrity verification rate;
- evaluator agreement;
- replay success rate;
- manifest completeness;
- provider-revision observability;
- contamination and policy-deviation counts.

A campaign cannot be labeled reproducible when required manifest fields are
unknown or evidence cannot replay, even if task reward is complete.

## Missingness And Failure

### Typed Missing Reasons

Missing reasons include:

```text
not_exposed
not_supported
permission_denied
collector_failure
provider_unavailable
redacted
retention_expired
integrity_failure
trial_failed
trial_timed_out
trial_cancelled
not_applicable
unknown
```

Missingness is stored per metric and trial. It cannot be collapsed into zero,
false, success, or exclusion.

### Failure Outcomes

The campaign predeclares outcome values or bounds for failed, timed-out,
cancelled, dead-lettered, and unverifiable trials. Sensitivity analysis reports
reasonable alternative assignments when those choices materially affect the
result.

Complete-case analysis MAY appear as secondary analysis but cannot replace the
primary estimand when completion differs by arm.

### Policy Deviations

Any unplanned change to prompt, model routing, tools, environment, retry,
timeout, roster, topology, evaluator, pricing, or analysis appends
`evaluation.policy_deviation.v1`.

The deviation records affected trials and whether policy requires exclusion,
separate stratum, sensitivity analysis, or campaign invalidation. Operators
cannot silently patch the manifest after observing results.

## Analysis And Uncertainty

### Trial Aggregation

Trial attempts aggregate under the sealed attempt policy. Multiple trials for
one task aggregate first at task-case level so tasks with more retries or seeds
do not gain accidental weight.

The report shows:

- arm-level task outcomes;
- paired task differences where available;
- aggregate point estimate;
- uncertainty interval;
- task, trial, attempt, and observed-metric counts;
- coverage and missingness by arm.

### Uncertainty

The default uncertainty method resamples task-case comparison blocks, not
individual agent messages, shots, tool calls, or retries. It preserves
within-task dependence between arms and within-team dependence among actors.

When the completed block count is too small for the configured bootstrap or
interval method, the report provides descriptive ranges and labels inferential
uncertainty unavailable. It does not print a misleading narrow interval.

### Secondary Analysis

Secondary analyses MAY examine:

- reward-cost frontier;
- reward-elapsed frontier;
- coordination overhead by topology;
- outcome by task class;
- retry and failure mechanisms;
- actor and role descriptive performance under S264 rules;
- sensitivity to missing outcomes and price normalization.

Multiplicity policy and exploratory labeling are required. Actor or role
results are non-causal descriptive estimates and include exposure,
difficulty, sample size, uncertainty, and missingness.

### Claim Language

Reports use language matching evidence:

- "observed higher mean reward" for a point estimate;
- "estimated difference with interval" when inferential requirements pass;
- "inconclusive" when coverage, sample, reliability, or uncertainty is
  insufficient;
- "not comparable" when a material manifest or policy mismatch exists;
- "invalidated" when integrity, leakage, or lifecycle rules fail.

They do not claim "multiplayer is better" from one task, best-of attempts,
complete cases only, overlapping uncertainty ignored, or unpriced team usage.

## Privacy, Redaction, And Retention

### Classification

Campaign manifests, task cases, prompts, transcripts, tool evidence, scorecards,
metrics, and reports each have classification and visibility. A derived report
inherits the strictest contributing classification unless an approved
declassification policy produces a safe aggregate.

### Safe Manifest References

Secrets are represented by provider and secret-name commitments, never values.
Private prompts, transcripts, hidden tests, and tool payloads use sealed-object
references and keyed commitments.

Hashing low-entropy restricted values without a keyed commitment is forbidden
because dictionary attacks could recover them.

### Redaction

Evaluation redaction uses S264.1 request, approval, apply, and failure states.
It preserves:

- campaign and trial existence where legally permitted;
- protected metric missingness;
- conflict and evidence commitments;
- score-affecting correction history;
- deletion registry and key-destruction state.

Redaction that changes an outcome, verifier evidence, manifest input, or
analysis set invalidates the affected report and triggers deterministic
reanalysis or a documented inability to reproduce.

### Retention

The manifest pins retention by artifact class. Raw sensitive evidence MAY
expire before aggregate reports only when the policy declares which future
verification and reproduction claims will become unavailable.

Restore reconciles against deletion registry, KMS state, and high-water marks
before any evaluation artifact is served or reanalyzed.

### Export

Exports are capability-checked, filtered, integrity-protected, and
content-addressed. An export records campaign version, viewer policy,
projection high-water mark, included and omitted classes, redactions, and
expiry.

Public reports must not expose hidden task answers, private prompts, principal
relationships, resource identifiers, or unbounded event payloads.

## Analysis Run And Report Lifecycle

### Analysis Run Identity

An analysis execution is keyed by:

```text
(project_id, campaign_id, campaign_version, analysis_run_id)
```

It binds:

- sealed manifest and analysis-spec hashes;
- `evaluation.collection_closed.v1` event and collection high-water mark;
- canonical trial census and terminal-disposition roots;
- ordered trial evidence-bundle roots;
- policy-deviation, redaction, deletion, and integrity-registry high-water
  marks;
- inclusion decision set and canonical root;
- price tables and metric schema versions;
- analysis executable, dependency lock, RNG streams, precision, rounding, and
  serialization;
- initiating and approving principals.

States are:

```text
planned
running
completed
failed
cancelled
invalidated
```

Transitions use `evaluation.analysis_planned.v1`,
`evaluation.analysis_started.v1`, `evaluation.analysis_completed.v1`,
`evaluation.analysis_failed.v1`, `evaluation.analysis_cancelled.v1`, and
`evaluation.analysis_invalidated.v1`. They require expected version,
`evaluation:analyze` or `evaluation:invalidate`, separation-of-duties policy,
and canonical idempotency.

Direct `evaluation.analysis_invalidated.v1` and the analysis transition inside
`evaluation.campaign_invalidated.v1` are legal from `planned`, `running`,
`completed`, `failed`, or `cancelled`. The former is analysis-owned; the latter
is campaign-owned and follows the compound child-disposition registry.

### Inclusion Set

The canonical inclusion set contains one row for every sealed trial ID, sorted
by canonical trial bytes:

```text
trial_id
terminal_disposition_event_id
analysis_disposition
rule_id
metric_missingness
evidence_bundle_root
```

`analysis_disposition` is `included`, `loss_assigned`, `not_exposed`, or
`excluded_by_sealed_rule`. Omission is invalid. The reducer recomputes the set
from the census and terminal events; callers cannot submit an arbitrary list.

### Report Identity And States

A report is keyed by:

```text
(project_id, campaign_id, campaign_version, report_id, report_version)
```

`report_id` is stable for one report lineage and `report_version` is gap-free.
States are:

```text
draft
generated
verified
published
invalidated
```

| From | Event | To | Capability |
|---|---|---|---|
| absent | `evaluation.report_drafted.v1` | `draft` | `evaluation:report_draft` |
| `draft` | `evaluation.report_generated.v1` | `generated` | `evaluation:analyze` |
| `generated` | `evaluation.report_verified.v1` | `verified` | `evaluation:report_verify` |
| `verified` | `evaluation.report_published.v1` | `published` | `evaluation:complete` |
| `draft`, `generated`, `verified`, or `published` | `evaluation.report_invalidated.v1` | `invalidated` | `evaluation:invalidate` |

A correction creates `report_version + 1`, references the invalidated version
and analysis run, and replays from canonical inputs. No report state resumes.
The same transition is legal as an affected transition of
`evaluation.campaign_invalidated.v1`; it does not imply a child event.

`evaluation:report_draft` is constrained to the registered analysis service
principal for the completed analysis run. `evaluation:report_verify` is
constrained to a report-verifier principal independently eligible under the
campaign verification policy. Both capability and principal constraint must
pass.

### Canonical Reducer

The report reducer consumes only:

1. canonical sealed manifest bytes;
2. collection-closure census and high-water mark;
3. canonical inclusion rows;
4. terminal trial and attempt events;
5. verified evidence-bundle roots and metric observations;
6. policy deviations, waivers, invalidations, redactions, and missingness;
7. pinned pricing and analysis specification;
8. exact analysis-run identity and golden-vector result.

Inputs are sorted by domain-separated canonical keys and serialized with the
S264.1 JCS and framing contract. Projection-local timestamps, database row
order, wall-clock analysis start, host path, and viewer filtering do not enter
canonical metric bytes.

### Evaluation Replay Invariants

Replay MUST prove:

1. every sealed trial appears exactly once in the inclusion set;
2. collection cannot close over a non-terminal unaccounted trial;
3. every attempt is gap-free and reconciles to one trial terminal disposition;
4. report versions are gap-free and preserve invalidation lineage;
5. reducer inputs match their recorded high-water marks and set roots;
6. task, arm, trial, metric, and table ordering is canonical;
7. pinned RNG, precision, rounding, and interval algorithms reproduce golden
   vectors and report bytes on supported platforms;
8. failed, timed-out, cancelled, and not-exposed trials follow the sealed
   estimand rather than disappearing;
9. redaction and deletion state cannot revive evidence or silently change an
   inclusion row;
10. SQLite, PostgreSQL, and conforming custom adapters produce identical
    inclusion and report bytes or explicitly fail byte-replay conformance.

## Evaluation Integrity And Invalidation

A campaign or report is invalidated by:

- manifest hash mismatch;
- execution before seal;
- unrecorded material policy change;
- cross-arm state leakage;
- evaluator conflict at a required independent tier;
- fabricated or unreplayable terminal events;
- omitted failed trials outside predeclared policy;
- best-of attempt selection contrary to policy;
- missing required price, cost, or budget inputs misrepresented as zero;
- evidence chain failure;
- restore of deleted or redacted evidence;
- analysis code or inclusion set differing from the sealed manifest.

Invalidation preserves all prior evidence and reason codes. A corrected analysis
gets a new report version; it does not rewrite the invalid report.

## Evaluation Report

The canonical report version contains:

1. campaign question, version, and manifest commitment;
2. primary estimand and analysis population;
3. arm roster and topology descriptions safe for the viewer;
4. task, trial, attempt, inclusion, failure, and missingness flow;
5. primary and secondary outcome tables;
6. cost, elapsed, token, retry, and coordination tables;
7. reliability, coverage, and integrity tables;
8. point estimates, uncertainty, and sensitivity analyses;
9. deviations, waivers, redactions, and invalidations;
10. content-addressed evidence and analysis references;
11. explicit limitations and claim language.

Every numeric table states unit, denominator, sample count, coverage, and
price or policy version where applicable.

## S264.2-4 Adversarial Criteria

S272 implementation acceptance includes:

1. changing one manifest byte after seal prevents trial start;
2. requested and resolved model identities remain distinct;
3. ordered instruction-stack commitments change when role order changes;
4. a team with three per-agent budgets is not labeled equal-budget to one solo
   budget;
5. best-of retry selection is rejected;
6. failed and timed-out trials remain in the primary analysis under policy;
7. complete-case results cannot replace the sealed primary estimand;
8. task-block bootstrap resamples tasks rather than messages or agents;
9. insufficient blocks suppress inferential confidence;
10. unknown token or price data remains unknown, not zero;
11. raw and price-normalized cost remain separately reproducible;
12. coordinator overhead does not alter canonical Team Round score;
13. cross-arm cache, worktree, database, or message leakage invalidates trials;
14. an evaluator under the author's conflict root cannot satisfy independence;
15. restricted prompt commitments resist low-entropy dictionary recovery;
16. redaction of outcome evidence invalidates and reanalyzes the report;
17. restore cannot revive deleted trial evidence;
18. filtered export omits hidden inputs while retaining integrity commitments;
19. replay produces identical inclusion and metric bytes across supported
    adapters;
20. one favorable task cannot produce an unqualified superiority claim.
21. collection closure fails while any sealed trial is planned, allocated,
    running, outcome-reported, or evidence-pending;
22. every sealed trial appears once in the canonical inclusion set;
23. unauthorized sealing, allocation, disposition, analysis, completion,
    invalidation, and export fail without partial writes;
24. prior trials cannot be reused after an incompatible manifest field change;
25. outcome-informed or convenience corpus selection is labeled exploratory;
26. campaign-generated learning remains quarantined until collection closure;
27. coordinator, retry, verifier, cached-token, and shared-service usage enters
    the arm-level meter under sealed attribution;
28. undeclared aggregate budget mismatch yields `not_comparable`;
29. changed analysis code, RNG, interval variant, precision, rounding, sort
    order, or dependency lock changes the analysis commitment and blocks stale
    replay;
30. corrected reports create a new version and retain invalidation lineage.
31. reusing one evaluation idempotency key after an aggregate-version change
    returns the original result or a payload conflict, never a fresh mutation;
32. rejected, corrupt, redacted, retained-out, timed-out, or unverifiable
    evidence reaches a typed terminal attempt and trial disposition with
    consumed budget and sealed loss treatment;
33. compound campaign invalidation cannot leave current analysis or report
    state partially valid.
34. one compound evidence event terminalizes the current attempt and trial
    together, and collection closure rejects any divergence;
35. evidence-verification timeout can be terminalized only after authoritative
    deadline by a principal with `evaluation:evidence_recover`;
36. same-key evaluation mutation from another principal conflicts rather than
    opening another idempotency namespace.

## S264.2-4 Acceptance Criteria

S264.2-4 is complete when the contract:

- defines campaign, task, block, arm, trial, and attempt identities;
- defines a sealed estimand and material manifest versioning;
- pins corpus, repository, roster, topology, model, harness, prompt, skill,
  tools, environment, lifecycle, budget, pricing, privacy, and analysis inputs;
- defines complete campaign, trial, attempt, analysis-run, and report
  lifecycles with capabilities, idempotency, recovery, and terminal behavior;
- seals the complete trial census and prevents collection closure over
  unaccounted trials;
- defines deterministic trial reuse, corpus selection, learning quarantine,
  aggregate arm budgets, leakage controls, and comparable arms;
- defines content-addressed trial evidence and independent evaluation;
- separates outcome, canonical score, resource, coordination, and reliability
  metrics;
- preserves typed missingness, failures, policy deviations, coverage, and
  uncertainty;
- defines redaction, retention, restore, export, invalidation, and report
  contracts;
- defines report identity, reducer inputs, inclusion canonicalization,
  high-water marks, version lineage, and replay invariants;
- assigns implementation to S272.

## Downstream Ownership

### S265-S267

These sprints land canonical sprint identity and migration prerequisites. They
do not implement Team Round workflow behavior.

### S268

S268 owns principal and event schema required by this document, assignment and
verification aggregate storage, deterministic projection support, filtered
views, replay, finalization, privacy, redaction, retention, and restore
foundations.

### S269

S269 owns protected-resource leases for assignments, handoffs, verifier slots,
learning patterns, evaluation trials, ports, databases, worktrees, services,
queues, and recovery.

### S270

S270 owns contributor and penalty attribution, actor and role descriptive
projections, merge-safe learning reports, pattern merge and split, promotion,
codification, and learning replay.

### S271

S271 owns assignment and handoff lifecycle, mandatory callbacks, principal-aware
verifier gates, semantic activity, blocker and timeout operating views, noise
collapse, and status reliability.

### S272

S272 owns sealed campaign manifests, trial orchestration, evidence bundles,
team-versus-solo metrics, reliability, paired analysis, redacted reports, and
evaluation replay.

No downstream sprint may weaken an invariant here without a new versioned
contract and migration.

## Explicit Non-Goals

This contract does not:

- require Nostr, chat, or any particular transport;
- treat model instances, sessions, roles, aliases, or worktrees as independent
  principals;
- make acknowledgments or heartbeats proof of progress;
- permit prompts or client metadata to bypass store enforcement;
- provide causal actor rankings from descriptive handicaps;
- select the best agent or retry outcome;
- fold coordination cost into the canonical score;
- expose raw secrets, transcripts, hidden tests, or unrestricted tool output;
- guarantee reproducibility when a provider hides material model revisions;
- claim multiplayer superiority from inadequate or unreliable samples.

## Contract Completion

S264.2 is complete when:

1. all four ticket acceptance criteria in this document are satisfied;
2. the artifact remains consistent with S264 and S264.1;
3. assignment, verifier, learning, status, and evaluation identities are
   project-scoped and replayable;
4. every state transition has an authoritative event, authorization boundary,
   idempotency scope, and deterministic projection;
5. privacy and non-enumeration apply to operating and benchmark views;
6. unknown, missing, stale, timed-out, waived, and invalidated states remain
   distinct from healthy, zero, verified, and complete;
7. the adversarial criteria are assigned to S270-S272 implementation;
8. issue #669 has a complete product and architecture answer without reopening
   the settled Team Round scoring format.
