# S268 Plan — Coordination Ledger and Access Control

Status: draft for architect review
Contract: `docs/architecture/team-round-coordination.md`, `team-round-domain.md`, `team-round-workflow.md`
Par 4, slope 5, four `driver` tickets.

## The Shape Of The Problem

S268 evolves the existing `events` table into the authoritative coordination
ledger. Today that table has seven columns and no project, round, sequence,
hash chain, or idempotency record. The target envelope carries about twenty
identity fields, a per-project and per-aggregate hash chain, a store-assigned
sequence, and an authorization decision, on both SQLite and PostgreSQL.

The contract also requires a seven-phase migration behind a physical write
fence, deterministic replay that reproduces byte-identical scorecard hashes,
and hostile concurrency tests passing on both backends before the sprint can
ship.

This is larger than one session. The plan below sequences it so each landing is
independently useful and independently reviewable, rather than one commit that
has to be right everywhere at once.

## What Is Already Done

`src/core/team-round/canonical.ts` implements RFC 8785 canonical JSON and the
domain-separated SHA-256 digest, with 21 tests written against the contract.
Everything else hashes through it, so it went first deliberately.

## Sequencing

The tickets are numbered in dependency order and the contract makes that
ordering real, not stylistic. Each stage below is a landing.

### S268-1 — Envelope And Migration

**1a. Envelope types and validation.** The `team_event_v1` shape as types, plus
a validator that rejects a missing required field, an unknown schema revision,
an unbound identity, or a non-canonical payload *before* a sequence is
assigned. Pure, no store. Tests are table-driven over each rejection.

**1b. Chain and integrity.** `previous_project_hash`, `previous_aggregate_hash`,
`event_hash` computed through the canonical digest, with verification over a
built chain. The property that matters: a tampered event anywhere invalidates
every later link.

**1c. Project binding.** A durable `project_id` persisted in both stores,
independent of path, remote, branch, or connection string. A store whose rows
map ambiguously to more than one project stops in quarantine rather than
guessing. This gates every backfill.

**1d. Expand migration.** New columns and tables in both adapters: envelope
columns, append metadata, idempotency records, projection cursors, immutable
scorecard-version storage, integrity checkpoints. Additive only, read authority
unchanged. SQLite is at schema 10, PostgreSQL at 7; both map to
`team_round_ledger_revision = 1`, which store health reports alongside the
adapter version.

**1e. Write fence and phase machine.** The durable `inventory → expand →
backfill → verify → cutover → observe → contract` machine, resumable from each
checkpoint, with the adapter-specific physical fence. Migration refuses to start
if the adapter cannot prove no pre-fence writer remains.

**Honest risk.** 1e is the single riskiest piece in the phase. The fence is
per-adapter and the contract says a custom adapter must install a
conformance-tested equivalent. I intend to define the conformance test first and
let it drive the two implementations, rather than write SQLite's fence and
generalise afterwards.

### S268-2 — Idempotency, Conflict Rejection, Compound Envelopes

**2a. Idempotency identity and request hash.** The six-part identity, and the
request hash covering exactly the listed semantic inputs and excluding the
listed transport ones. The test that earns its place: changing any covered
field under the same identity is a payload conflict, and changing an excluded
one is not.

**2b. Retry outcomes.** Exact-hash retry writes no event, returns the original
identity, and cannot refresh a lease or heartbeat.

**2c. Version-2 compound envelopes.** The cycle-free digest DAG, owner/link
bijection, and per-affected-aggregate chain positions. Eight of the inherited
S264.2 hazards are about this exact area, so it gets its own landing and its own
review pass.

### S268-3 — Projection, Replay, Finalization

**3a. Reducer substrate.** Projection identity, durable cursor, and the purity
rules. A cursor must not advance across a missing, quarantined, unauthorized, or
unrecognized event. Determinism across both backends is a test, not a comment.

**3b. Draft and published scorecard projection.** The `canonical_scorecard_v1`
shape and its `content_hash`.

**3c. Replay.** Byte-identical reproduction of a closed round's scorecard from
accepted events. This is the acceptance test for the whole phase.

**3d. Exactly-once finalization.** The two-step `finalization_started → closed`
transition with recovery, plus late-event and audited-reopen behaviour. Reopen
preserves earlier published versions, nulls acceptance, increments the epoch.

### S268-4 — Capabilities And Redaction

Deny-by-default capabilities, principal binding, authenticated artifact
provenance, atomic late-contribution approval invalidation, filtered
projections, and redaction that destroys removable payload without rewriting the
hash chain.

The contract's own acceptance questions are the test list here, and they are
adversarial by design: can a cursor, cache, count, error, or timing class
disclose hidden existence?

## Cross-Cutting Decisions To Settle Before Coding

These are the questions I want the architect pass to answer, because getting
them wrong is expensive after the migration lands.

1. **Where does this code live?** `src/core/team-round/` is a new subtree. The
   store adapters are `src/store/` and `src/store-pg/`. The append protocol
   needs both, so either the protocol lives in core and adapters implement a
   narrow interface, or each adapter implements the protocol. The first keeps
   one authority; the second is easier to make atomic per backend.

2. **Does this replace `SlopeStore.insertEvent` or sit beside it?** The
   contract says evolve rather than parallel. But `insertEvent` has many callers
   today, including `ticket done` from Phase 68. A shim that upgrades legacy
   inserts into canonical events is one option; another is leaving legacy events
   readable and only writing canonical ones after cutover.

3. **How much of the fence is real in version 1?** The contract's fence is
   demanding. A partial implementation that cannot prove the barrier is worse
   than none, because the manifest would claim a guarantee it does not have.

4. **What is `project_id` derived from on first migration?** It must not come
   from path, remote, or branch. Something must mint it, and that decision is
   permanent.

5. **Do we need PostgreSQL running to develop this?** The hostile tests must
   pass on both. `SLOPE_TEST_PG_URL` gates the PG suite today and CI runs a
   service container, so the answer is probably yes for local work on 1d onward.

## Review Tier

Deep, three rounds, per `.claude/rules/review-loop.md`: new infrastructure and
architectural changes. Round one is this plan.

## What Would Make Me Stop And Re-Plan

- The fence cannot be implemented honestly on SQLite. Then the migration story
  changes and so does the sprint.
- `project_id` minting turns out to need operator input. Then S268-1 grows a
  human step and the sequencing changes.
- Byte-identical replay across both backends proves impossible without pinning
  something the contract has not pinned. Then the contract needs an amendment
  before more code.
