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
