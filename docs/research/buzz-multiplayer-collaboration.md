# Buzz Multiplayer Collaboration: Roadmap Input for SLOPE

Date: 2026-07-27

Source reviewed: [block/buzz](https://github.com/block/buzz) at commit
[`87b3fcd3c0131683569dd4268b099d18b25dcd5e`](https://github.com/block/buzz/tree/87b3fcd3c0131683569dd4268b099d18b25dcd5e).

This note records the product and architecture lessons that feed S260.1, S264,
and Phase 64. It is roadmap input, not the final Team Round specification.

## Decision

SLOPE should define a **Team Round with attributed shots**:

- One sprint is one round with one authoritative team scorecard and outcome.
- Each shot records a stable actor identity, ephemeral session, functional role,
  contributors, and verifier where applicable.
- The team handicap derives from one canonical score-versus-par result.
- Coordination overhead is reported separately unless a future versioned
  composite formula explicitly combines it with the team result.
- Actor and role handicaps are risk-adjusted descriptive estimates, not causal
  rankings. They require accountable shot ownership, contributor metadata,
  expected difficulty, exposure denominators, an aggregation window, minimum
  sample size, and uncertainty.
- Repository and operator views are aggregations, not substitute player identities.
- A result is counted once. SLOPE does not select a best agent result as fourball
  or combine alternate actions as foursomes.
- Existing single-player scorecards remain valid as one-actor Team Rounds.

## What Buzz Demonstrates

### Shared event substrate

Buzz uses one event log as the collaboration substrate for identity, messages,
tasks, assignments, status, and orchestration. The transferable lesson is the
event model, not Nostr itself.

For SLOPE, the git common-dir store should become the shared repository
coordination ledger by evolving the existing event store, not by adding a
competing source of truth. Events need immutable IDs, schema version,
authoritative timestamps, authenticated principal plus actor/session/role
identity, authority and visibility scope, round and ticket scope, and
correlation and causation IDs.

Idempotency keys need an explicit scope. Reusing a key with a different payload
must fail. Append and projection updates must be atomic, ordering rules must be
defined, and replay must deterministically reproduce scorecard and status
views. The scorecard is a versioned projection and becomes final only through
an exactly-once round-close event.

The Team Round lifecycle must define open, finalizing, and closed states,
late-event rejection or reconciliation, and an audited reopen policy. The
canonical sprint key is the planned-work identity; a round ID identifies its
execution, attempt IDs identify retries, and scorecard version identifies a
projection revision.

### Stable identity and ephemeral execution

Buzz keeps agent identities distinct even when one orchestrator and several
workers are evaluated as a single team. SLOPE currently has session and role
fields but does not have a complete stable actor model.

SLOPE must keep these dimensions separate and bind them to an authenticated
principal:

- `actor_id`: durable identity used for attribution and handicap history.
- `session_id`: one process or conversation lifetime.
- `role`: the function performed in the round.
- `authority`: who can assign, cancel, verify, or mutate shared state.
- `visibility`: which requester, team member, or observer can see an event.

Role labels such as `primary` cannot stand in for identity or authority.
Aliases and sessions belonging to the same principal cannot satisfy an
independent-verifier requirement. Higher-risk verification must also exclude
the author, contributors, and delegator according to the policy selected in
the Team Round contract.

The ledger uses a deny-by-default capability matrix for reading, assigning,
cancelling, verifying, redacting, exporting, and reopening. Visibility is
enforced through filtered projections, not by hiding controls in a client.

### Concurrency and recovery

Buzz serializes work within one agent while allowing different agents to run in
parallel. Its pool also makes queue state and worker lifecycle explicit.

SLOPE should serialize execution for one claim or ticket and permit parallel
execution for non-overlapping claims. Claims must become renewable leases with
transactional acquire/renew, authoritative store time, monotonic lease epochs,
fencing tokens on every protected mutation, TTL, expiry grace, abandonment,
cleanup, and requeue behavior. Expired holders must be rejected after a claim
is reassigned. Recovery also needs retry limits, dead-letter state, escalation,
and visible stale or timed-out execution states.

Overlap includes typed shared development resources, not only files: ports,
local databases, and service instances need claim identity or an explicit
project-owned allocation policy.

### Assignments, callbacks, and verification

Multi-agent work needs an explicit completion channel. An assignment should
record delegator, assignee, target, success criteria, and correlation identity.
The assignee must emit a completion or blocker callback; acknowledgments should
not flood the status surface.

Risky work should be independently verified by an actor other than the author.
The shot and scorecard should preserve verifier identity and evidence.

### Attribution and shared learning

Cross-agent hazards need a canonical `penalty_id` plus `caused_by` and
`resolved_by` attribution while remaining one team-level event and penalty.
Team, actor, and role projections must be non-additive, and resolver credit
must never inherit the penalty. This avoids blaming the resolver or counting
the same miss once per participant.

Concurrent common-issues updates cannot use whole-document last-writer-wins
replacement. Use append-only reports or transactional per-pattern merges with
stable evidence IDs.

### Status and evaluation

The team activity surface should emphasize meaningful
verb-object-outcome events. Failures, blockers, idle workers, stale leases, and
timeouts should be prominent; routine reads and acknowledgments should recede.

Multiplayer evaluation must pin:

- task corpus and repository base commit
- roster and actor identities
- model, harness, evaluator, and scoring revisions
- environment, toolchain, and orchestration topology
- system prompt, persona, skill, and raw evidence hashes
- generation settings, seeds, trial count, and tool permissions
- timeout, retry, and lifecycle policy
- token, cost, and elapsed-time budgets
- price assumptions

Reports should compare team and single-agent reward, cost, elapsed time, and
coordination overhead, with overhead kept separate from the canonical team
score. Unknown measurements must remain distinct from zero through typed
observed state, missing reason, provenance, sample count, and coverage.
Measurement reliability and uncertainty must be recorded.

Manifests should store content-addressed hashes and safe references instead of
raw secrets, credentials, private transcripts, or unrestricted tool payloads.
Data classification, viewer scope, redaction, and retention apply to ledger and
benchmark artifacts.

## Boundaries

SLOPE should not copy:

- Nostr as a required transport
- cryptographic or wallet identity as a product prerequisite
- chat as the primary coordination database
- prompt-only shared-filesystem conventions
- actor labels or aliases as a trust boundary
- observer mutation or client-only authorization
- unfenced writes after lease expiry
- best-of result selection that obscures failed or duplicated work

SLOPE already has stronger repository-native enforcement through worktrees,
claims, guards, scorecards, and durable stores. The roadmap should extend those
mechanisms instead of replacing them. Adversarial acceptance tests must prove
that prompts, metadata, CLI flags, and direct event writes cannot bypass store
claims or capabilities.

Buzz also has open collaboration gaps around shared session presentation,
observer visibility, and nested replies. Those gaps reinforce the need to adopt
its orchestration semantics selectively rather than treating the project as a
finished reference architecture.

## Roadmap Mapping

- **S261:** restore one shared store across worktrees; this is the prerequisite
  coordination substrate.
- **S262:** fix immediate session/status presentation without freezing a partial
  durable identity model.
- **S264-S264.2:** write the normative Team Round domain, scoring, integrity,
  security, workflow, status, learning, and evaluation contracts.
- **S265-S267:** land canonical sprint identity before adding new
  identity-bearing coordination records.
- **S268:** evolve the event store into the authoritative ledger and enforce
  identity, access, privacy, projection, replay, and finalization.
- **S269:** implement fenced leases, concurrency, typed shared-resource claims,
  queueing, and recovery.
- **S270:** implement actor-attributed scorecards, descriptive handicaps,
  missingness/reliability, penalty identity, and merge-safe learning.
- **S271:** implement callbacks, principal-aware verifier gates, semantic
  status, and filtered operating views.
- **S272:** implement reproducible, redacted team-versus-solo evaluation.

## Primary References

- [Buzz repository](https://github.com/block/buzz)
- [Buzz Orchestra benchmark](https://github.com/block/buzz/tree/main/benchmarks/harbor-buzz-orchestra)
- [Benchmark team orchestration PR #1504](https://github.com/block/buzz/pull/1504)
- [Observer visibility issue #2716](https://github.com/block/buzz/issues/2716)
- [Nested replies issue #2851](https://github.com/block/buzz/issues/2851)
- [Shared session UI issue #3051](https://github.com/block/buzz/issues/3051)
