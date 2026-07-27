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
2. Every accepted assignment ends in exactly one terminal callback:
   `completion_reported`, `blocker_reported`, `cancelled`, or `timed_out`.
   Acknowledgment alone is never completion.
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

The authoritative assignment states are:

```text
created
offered
accepted
in_progress
blocker_reported
completion_reported
verification_pending
verified
rejected
cancelled
timed_out
```

`created`, `offered`, `accepted`, `in_progress`, `blocker_reported`,
`completion_reported`, `verification_pending`, and `rejected` are non-terminal.
`verified`, `cancelled`, and `timed_out` are terminal for one assignment
revision.

`rejected` means verification rejected the completion evidence and returned a
bounded correction request. It does not mean the assignee rejected the offer.
Offer refusal is `assignment.offer_declined.v1` and transitions the revision to
`cancelled` with reason `assignee_declined`.

### Transition Table

| From | Event | To | Authorized principal |
|---|---|---|---|
| `created` | `assignment.offered.v1` | `offered` | delegator or scheduler |
| `offered` | `assignment.accepted.v1` | `accepted` | assignee |
| `offered` | `assignment.offer_declined.v1` | `cancelled` | assignee |
| `accepted` | `assignment.started.v1` | `in_progress` | assignee |
| `in_progress` | `assignment.blocker_reported.v1` | `blocker_reported` | assignee |
| `blocker_reported` | `assignment.resumed.v1` | `in_progress` | assignee |
| `in_progress` | `assignment.completion_reported.v1` | `completion_reported` | assignee |
| `completion_reported` | `verification.requested.v1` | `verification_pending` | policy engine |
| `verification_pending` | `verification.approved.v1` | `verified` | eligible verifier |
| `verification_pending` | `verification.rejected.v1` | `rejected` | eligible verifier |
| `rejected` | `assignment.resumed.v1` | `in_progress` | assignee |
| any non-terminal | `assignment.cancelled.v1` | `cancelled` | authorized canceller |
| `offered` or later non-terminal | `assignment.timed_out.v1` | `timed_out` | recovery service |

The store rejects all other transitions. A caller cannot skip `accepted`, move
directly from `in_progress` to `verified`, approve its own completion, resume a
terminal revision, or mutate a superseded revision.

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
authoritative start time. A restarted process creates a new execution spell
under the same assignment revision; it never rewrites the prior spell.

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

Every accepted revision reserves these callback keys:

```text
(project_id, assignment_id, assignment_revision, callback_kind)
```

where `callback_kind` is `blocker`, `completion`, `cancel`, or `timeout`.
The canonical append transaction enforces at most one accepted callback for a
kind and exact-retry semantics for the same request hash.

## Mandatory Callbacks

### Callback Obligation

Acceptance creates a durable callback obligation. The obligation remains open
until one of these events is accepted:

- `assignment.blocker_reported.v1`;
- `assignment.completion_reported.v1`;
- `assignment.cancelled.v1`;
- `assignment.timed_out.v1`.

An accepted blocker callback satisfies the current execution spell's
obligation but does not terminate the assignment. Resumption creates a new
obligation. Rejected verification followed by resumption also creates a new
obligation.

Process exit, session deletion, lease expiry, disconnected transport, chat
silence, acknowledgment, status polling, or a pushed commit does not satisfy a
callback obligation.

### Completion Callback

`assignment.completion_reported.v1` contains:

| Field | Contract |
|---|---|
| `assignment_id` / `revision` | Accepted assignment revision |
| `execution_spell_id` | Spell being completed |
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

1. the append transaction accepts the callback and enqueues notification work;
2. notification workers deliver at least once;
3. recipients acknowledge delivery with a projection-local receipt;
4. duplicate delivery is suppressed by callback event ID;
5. notification failure cannot erase or roll back the authoritative callback;
6. dead-lettered delivery is visible to operators without changing assignment
   state.

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
2. The destination principal explicitly accepts the exact handoff hash.
3. Acceptance proves destination capabilities and verifier implications.
4. Activation atomically:
   - fences the source execution spell;
   - releases or transfers the protected lease set under S264.1 rules;
   - records the source spell as handed off, not completed;
   - creates or activates the destination execution spell;
   - updates accountable ownership from the activation event forward.
5. If any activation step fails, none become authoritative.
6. The destination emits its own completion or blocker callback.
7. Source and destination contribution history remain attached to the shot.
8. Handoff never removes the delegator, source contributor, or destination
   contributor from verifier-conflict evaluation.

Lease ownership is not edited in place. Transfer is a fenced release and
acquire transaction using new lease epochs and fencing tokens.

### Partial Handoff

A partial handoff MUST identify a subset of criterion IDs and resource
subjects. Overlapping responsibility is forbidden unless the assignment
explicitly creates child assignments with non-conflicting resource lease sets.

A split that changes the required outcome or evidence creates child
assignments. The parent cannot verify until every required child reaches its
policy-required terminal state.

### Abandonment

A vanished source cannot offer a handoff. Recovery may:

1. expire and fence the source leases;
2. append `assignment.timed_out.v1` for the abandoned spell;
3. create a recovery assignment linked to the same correlation ID;
4. carry forward only evidence that passes integrity and visibility checks;
5. leave the original ownership spell missing, not zero-loss or completed.

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

Cancellation after `completion_reported` does not erase the completion. It
records that verification was cancelled and why.

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
6. every accepted spell has a terminal callback or remains visibly open;
7. handoff activation fences the source before destination mutation;
8. terminal revisions do not resume;
9. child requirements reconcile to the parent;
10. projections reproduce identical canonical bytes on every supported
    adapter.

## S264.2-1 Acceptance Criteria

S264.2-1 is complete when the contract:

- defines assignment identity, revisioning, required fields, and material
  changes;
- defines every assignment and handoff state and legal transition;
- binds acceptance and execution to immutable criteria, evidence, capability,
  lease, budget, and deadline snapshots;
- requires completion or blocker callbacks and makes callback delivery durable;
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

The append transaction locks the verification aggregate, conflict snapshot,
and slot. It rejects duplicate slot assignment, changed completion version,
changed policy, or stale fencing tokens.

Multiple quorum slots MAY run concurrently. Their verifiers cannot share a
conflict root with each other under `multi_principal_quorum`.

## Verification Decision

### Required Decision Envelope

`verification.approved.v1` and `verification.rejected.v1` contain:

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
| `decision` | `approve` or `reject` |
| `decided_at` | Authoritative store time |

Criterion decisions are `satisfied`, `not_satisfied`, or `unable_to_verify`.
Approval is invalid when a required criterion is not satisfied or an
`unable_to_verify` result is not explicitly allowed by policy.

### Transaction Checks

Before accepting a decision, the store rechecks:

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

Quorum approval requires:

- all required slots filled by mutually independent eligible roots;
- the configured approval threshold;
- no unresolved critical finding;
- identical target, completion, criteria, policy, and conflict snapshot;
- decisions within the policy's validity window.

Conflicting quorum decisions transition to `verification_disputed`. An
escalation policy may request another independent slot, return the assignment
for correction, or require an authorized human decision. It cannot average
away a failed required criterion.

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

Findings never embed unrestricted secrets. Resuming the original assignment
creates a correction execution spell. All correcting principals join the
contribution conflict set. A new completion event and fresh verification
snapshot are required.

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

Invalidation appends `verification.invalidated.v1`, returns the assignment to
`verification_pending` or `rejected` according to policy, and preserves the
prior decision as history.

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

The assignment terminal state is `verified_with_waiver`, distinct from
`verified`. Reports, scorecards, release gates, and evaluation manifests retain
that distinction.

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
5. quorum roots are mutually independent;
6. every decision covers required criteria and methods;
7. late contributions and relationships trigger deterministic invalidation;
8. waivers remain distinct from approval;
9. redaction preserves conflict commitments;
10. supported adapters reproduce identical eligibility and decision
    projections.

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
evidence_id
pattern_version
```

- `learning_report_id` is a server-assigned UUIDv7 for one immutable report.
- `pattern_id` is a server-assigned durable UUIDv7 for one canonical pattern.
- `evidence_id` is a classification-safe commitment to one evidence item under
  the S264.1 integrity contract.
- `pattern_version` is a gap-free positive integer for material canonical
  pattern revisions.

Display titles, normalized descriptions, categories, filenames, sprint
numbers, and local array positions are not identities.

### Learning Report

`learning.reported.v1` contains:

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
(project_id, evidence_id)
```

The evidence commitment binds:

- evidence class and schema version;
- canonical content or sealed-object commitment;
- source event, artifact, commit, test, or measurement identity;
- classification and visibility;
- producer principal and actor;
- observed and accepted times;
- integrity algorithm and key version.

Two reports referencing the same evidence ID add one evidence-set member, not
two occurrences. Different evidence from the same sprint remains distinct.
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
evidence_set
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

`recurrence_count` is the count of distinct qualifying evidence IDs after
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

Adding a report to an existing pattern uses one append transaction:

1. authorize `learning:report`;
2. validate the report, evidence, and visibility;
3. lock `(project_id, pattern_id)`;
4. read current `pattern_version`;
5. deduplicate report and evidence IDs;
6. append `learning.reported.v1`;
7. append a material pattern revision event only when canonical fields change;
8. update evidence, report, sprint, ticket, and reporter sets atomically;
9. recompute recurrence and confidence under the pinned policy version;
10. update learning and semantic-status projections;
11. commit.

Concurrent writes retry against the new pattern version. They do not overwrite
the entire projection. Exact retries return the prior accepted result.

### Deterministic Field Merge

Set-valued fields use canonical set union over stable IDs. Times use minimum
for first observation and maximum for last observation. Recurrence derives
from the evidence set. Confidence derives from a versioned deterministic
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

1. each report and evidence ID contributes at most once;
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

The operating states are:

| State | Derivation |
|---|---|
| `queued` | Offered or schedulable, not accepted or started |
| `working` | In progress with healthy lease and recent semantic progress |
| `waiting` | Explicit blocker or declared dependency wait within policy |
| `idle` | No active assignment or intentionally available |
| `stale` | Active non-terminal work without required semantic progress or healthy liveness inside grace |
| `timed_out` | Authoritative timeout event accepted |
| `blocked` | Active blocker callback requires action |
| `verification_pending` | Completion reported and review not terminal |
| `complete` | Assignment verified or terminal under its policy |
| `cancelled` | Cancellation accepted |
| `dead_lettered` | Recovery exhausted and dead-letter event accepted |
| `unknown` | Required source signal unavailable or inconsistent |

`stale` is a warning derived from policy and observations. `timed_out` is an
authoritative workflow state. They are not interchangeable.

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

Coverage is the fraction of required source classes observed, with numerator,
denominator, and provenance. Unknown source health cannot be represented as
100% coverage or a healthy worker.

Projection divergence, unavailable store, failed integrity verification, or
unsupported adapter capability yields `unknown` plus operator attention.

## S264.2-3 Adversarial Criteria

Implementation acceptance includes:

1. two worktrees concurrently report different evidence to one pattern and
   both survive;
2. exact retries do not increase recurrence;
3. stale pattern revisions cannot overwrite a newer canonical prevention;
4. merge then split deterministically preserves every evidence ID;
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

## S264.2-3 Acceptance Criteria

S264.2-3 is complete when the contract:

- replaces whole-document learning writes with immutable reports and
  transactional per-pattern merges;
- defines stable report, pattern, evidence, and version identities;
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
new campaign version and records whether prior trials are reusable.

### Required Manifest Fields

The manifest pins:

| Area | Required inputs |
|---|---|
| Question | Hypothesis, primary estimand, primary and secondary outcomes |
| Corpus | Corpus ID, version, content hash, selection policy, task IDs |
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
| Trials | Arm allocation, task order, seeds, trial count, blocking, randomization |
| Analysis | Inclusion set, weighting, missingness, uncertainty, multiplicity policy |
| Privacy | Classification, visibility, redaction, retention, export, and deletion policy |
| Integrity | Schema registry, algorithms, key versions, manifest hash, anchors |

References use content-addressed safe locators. The manifest does not embed raw
credentials, private transcripts, unrestricted prompts, hidden test answers,
or full tool payloads.

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

## Campaign Lifecycle

### States

Campaign states are:

```text
draft
sealed
scheduled
running
collecting
analysis_pending
complete
failed
cancelled
invalidated
```

`complete`, `failed`, `cancelled`, and `invalidated` are terminal for one
campaign version.

### Legal Transitions

| From | Event | To |
|---|---|---|
| `draft` | `evaluation.campaign_sealed.v1` | `sealed` |
| `sealed` | `evaluation.campaign_scheduled.v1` | `scheduled` |
| `scheduled` | `evaluation.campaign_started.v1` | `running` |
| `running` | `evaluation.collection_started.v1` | `collecting` |
| `collecting` | `evaluation.analysis_requested.v1` | `analysis_pending` |
| `analysis_pending` | `evaluation.campaign_completed.v1` | `complete` |
| any non-terminal | `evaluation.campaign_failed.v1` | `failed` |
| any non-terminal | `evaluation.campaign_cancelled.v1` | `cancelled` |
| any state | `evaluation.campaign_invalidated.v1` | `invalidated` |

The store rejects execution for an unsealed manifest, append after terminal
state except invalidation metadata, or analysis before collection closure.

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
```

`included`, `excluded`, `failed`, `timed_out`, and `cancelled` are terminal for
one trial. Exclusion requires a predeclared rule and evidence. A poor outcome,
high cost, long duration, coordination failure, or timeout is not an exclusion
reason unless the estimand explicitly says so.

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

Training or common-issue updates produced during evaluation are isolated until
the comparison block closes unless shared adaptation is itself the declared
treatment. Cache keys, worktrees, databases, service state, and message channels
must enforce that isolation.

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

The canonical report contains:

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

## S264.2-4 Acceptance Criteria

S264.2-4 is complete when the contract:

- defines campaign, task, block, arm, trial, and attempt identities;
- defines a sealed estimand and material manifest versioning;
- pins corpus, repository, roster, topology, model, harness, prompt, skill,
  tools, environment, lifecycle, budget, pricing, privacy, and analysis inputs;
- defines campaign and trial lifecycles, retry policy, leakage controls, and
  comparable arms;
- defines content-addressed trial evidence and independent evaluation;
- separates outcome, canonical score, resource, coordination, and reliability
  metrics;
- preserves typed missingness, failures, policy deviations, coverage, and
  uncertainty;
- defines redaction, retention, restore, export, invalidation, and report
  contracts;
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
