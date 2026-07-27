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
- Individual handicap derives from actor-attributed shots.
- Team handicap measures the round outcome and coordination overhead.
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
coordination ledger. Events need immutable IDs, timestamps, actor and session
identity, round and ticket scope, correlation and causation IDs, idempotency,
and deterministic materialized views for status and scorecards.

### Stable identity and ephemeral execution

Buzz keeps agent identities distinct even when one orchestrator and several
workers are evaluated as a single team. SLOPE currently has session and role
fields but does not have a complete stable actor model.

SLOPE must keep these dimensions separate:

- `actor_id`: durable identity used for attribution and handicap history.
- `session_id`: one process or conversation lifetime.
- `role`: the function performed in the round.
- `authority`: who can assign, cancel, verify, or mutate shared state.
- `visibility`: which requester, team member, or observer can see an event.

Role labels such as `primary` cannot stand in for identity or authority.

### Concurrency and recovery

Buzz serializes work within one agent while allowing different agents to run in
parallel. Its pool also makes queue state and worker lifecycle explicit.

SLOPE should serialize execution for one claim or ticket and permit parallel
execution for non-overlapping claims. Claims must become renewable leases with
heartbeat, TTL, expiry grace, abandonment, cleanup, and requeue behavior.
Recovery also needs retry limits, dead-letter state, escalation, and visible
stale or timed-out execution states.

### Assignments, callbacks, and verification

Multi-agent work needs an explicit completion channel. An assignment should
record delegator, assignee, target, success criteria, and correlation identity.
The assignee must emit a completion or blocker callback; acknowledgments should
not flood the status surface.

Risky work should be independently verified by an actor other than the author.
The shot and scorecard should preserve verifier identity and evidence.

### Attribution and shared learning

Cross-agent hazards need both `caused_by` and `resolved_by` attribution while
remaining one team-level event and penalty. This avoids blaming the resolver or
counting the same miss once per participant.

Concurrent common-issues updates cannot use whole-document last-writer-wins
replacement. Use append-only reports or transactional per-pattern merges with
stable evidence IDs.

### Status and evaluation

The team activity surface should emphasize meaningful
verb-object-outcome events. Failures, blockers, idle workers, stale leases, and
timeouts should be prominent; routine reads and acknowledgments should recede.

Multiplayer evaluation must pin:

- roster and actor identities
- model and harness revisions
- system prompts, personas, and skill hashes
- generation settings and tool permissions
- token, cost, and elapsed-time budgets
- price assumptions

Reports should compare team and single-agent reward, cost, elapsed time, and
coordination overhead. Unknown measurements must remain distinct from zero, and
measurement reliability should be recorded.

## Boundaries

SLOPE should not copy:

- Nostr as a required transport
- cryptographic or wallet identity as a product prerequisite
- chat as the primary coordination database
- prompt-only shared-filesystem conventions
- best-of result selection that obscures failed or duplicated work

SLOPE already has stronger repository-native enforcement through worktrees,
claims, guards, scorecards, and durable stores. The roadmap should extend those
mechanisms instead of replacing them.

Buzz also has open collaboration gaps around shared session presentation,
observer visibility, and nested replies. Those gaps reinforce the need to adopt
its orchestration semantics selectively rather than treating the project as a
finished reference architecture.

## Roadmap Mapping

- **S261:** restore one shared store across worktrees; this is the prerequisite
  coordination substrate.
- **S262:** separate actor, session, role, authority, and visibility while fixing
  the immediate status-truth issues.
- **S264:** write the normative Team Round, identity, ledger, lease, callback,
  verification, learning, status, and evaluation contracts.
- **S265-S267:** land canonical sprint identity before adding new
  identity-bearing coordination records.
- **S268:** implement the coordination ledger, renewable leases, concurrency,
  queueing, and recovery.
- **S269:** implement actor-attributed scorecards, handicap derivation,
  cross-agent hazard attribution, and merge-safe learning.
- **S270:** implement callbacks, verifier gates, semantic status, visibility,
  and reproducible multiplayer benchmarks.

## Primary References

- [Buzz repository](https://github.com/block/buzz)
- [Buzz Orchestra benchmark](https://github.com/block/buzz/tree/main/benchmarks/harbor-buzz-orchestra)
- [Benchmark team orchestration PR #1504](https://github.com/block/buzz/pull/1504)
- [Observer visibility issue #2716](https://github.com/block/buzz/issues/2716)
- [Nested replies issue #2851](https://github.com/block/buzz/issues/2851)
- [Shared session UI issue #3051](https://github.com/block/buzz/issues/3051)
