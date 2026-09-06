# Team Round Deployment Profiles

Status: proposed amendment to `team-round-coordination.md`, for approval
Amends: "Authority Generation And Physical Write Barrier", "Store Protocol
Negotiation", "Canonical Cryptography", and the S268 acceptance criteria

## Why This Exists

The coordination contract asserts one set of guarantees for every store. Three
independent reviews of the S268 implementation plan found that neither shipped
backend can provide some of them, and that the contract contradicts itself
about who holds administrator authority.

The contract says, at "Authority Generation And Physical Write Barrier":

> Raw database owners and filesystem-level SQLite editors remain in the database
> administrator threat boundary. Ordinary SLOPE and custom adapter credentials
> MUST NOT have that authority.

On SQLite, ordinary SLOPE credentials *are* raw file write access. SQLite has no
roles, no `GRANT`, and no privilege system, so the sentence cannot hold. On
PostgreSQL as deployed, the adapter opens one pool as the `postgres` superuser,
which bypasses privilege checks and can disable triggers with one session
setting.

An implementation that installs a barrier, reports success, and excludes nobody
is worse than one that declines to claim a barrier. The manifest would assert a
guarantee that is not there, and every later integrity argument would rest on
it.

This amendment replaces one universal guarantee with named profiles that state
what each deployment can and cannot enforce.

## Recommendation

Adopt the two profiles below and keep SQLite supported.

The alternative considered was declaring SQLite unsupported for Team Round
coordination. It is cleaner on paper and worse in practice: SQLite is the
default store, so that choice removes Team Round from nearly every existing
deployment in order to preserve a sentence in a document. A weaker guarantee
that is written down beats a stronger one that is not true.

## Profiles

### `local_single_writer` (SQLite)

Intended for one operator, one machine, one repository.

What it enforces:

- Aborting triggers on every legacy mutable table, installed inside an
  exclusive transaction and committed, so they persist across process death.
- A DML probe that must fail before `inventory` begins.
- Refusal to proceed if the probe succeeds.

What it does not enforce, and must say so in the migration manifest:

- It cannot exclude a determined writer. `DROP TRIGGER` is DDL and no trigger
  can abort it. Anything holding the file handle can remove the fence.
- It cannot exclude the `sqlite3` CLI, a file copy, or a second library handle.

The honest name for this is **accident prevention, not access control**. It
stops the cooperating writer that forgot migration was running. It does not
stop an adversary, and the threat model must not claim otherwise.

Consequence for the descriptor: this profile reports
`write_barrier = "advisory"`.

### `managed_multi_writer` (PostgreSQL)

Intended for shared or multi-agent deployments.

Requires, and this is a deployment requirement rather than a code change alone:

- Two roles. An owner role holding DDL and table ownership, and an application
  role holding DML only. The application role is what `SLOPE_TEST_PG_URL` and
  every runtime connection use.
- Migration acquires the advisory lock as the owner, revokes application-role
  DML, installs guard triggers, and drains pre-fence transactions.

With role separation the contract's barrier holds as written, because the
application role can neither bypass privilege checks nor disable triggers.

Without role separation, this profile refuses to activate and the store falls
back to `local_single_writer` semantics with the same advisory marker. A
superuser connection does not satisfy `managed_multi_writer`.

Consequence for the descriptor: this profile reports
`write_barrier = "enforced"` only when the connected role is not a superuser
and is not the table owner. The adapter checks this at negotiation rather than
trusting configuration.

## Descriptor Changes

`coordination_protocol` gains two fields:

```text
deployment_profile          # local_single_writer | managed_multi_writer
write_barrier               # advisory | enforced
```

Both are computed from observed state, not read from configuration.
Self-reporting is already excluded as release evidence by "Store Protocol
Negotiation", and this keeps that rule.

An operation whose policy requires `write_barrier = "enforced"` fails closed
with `STORE_PROTOCOL_UNSUPPORTED` on an advisory store. Which operations those
are is a policy question this amendment does not settle, and it should be
settled before the migration ships rather than after.

## Key Management And Retention

The contract pins five cryptographic primitives and requires a non-restorable
managed key service, an independently durable deletion registry, and
out-of-band storage of the authority generation and trusted checkpoint.

A local SQLite deployment has none of those, and inventing them inside the same
database file defeats the point: a key stored beside the ciphertext it protects
is not a key.

Amendment: acceptance criteria 45 and 48, and every requirement that depends on
a managed key service, apply to `managed_multi_writer` only.

`local_single_writer` therefore does not support sealed payloads, cursor
encryption, or redaction that must survive an adversary with file access. It
reports `redaction_retention = false`, and an operation requiring it fails
closed rather than pretending.

This is a real capability reduction and should be read as one. The alternative
is a local profile that claims cryptographic deletion it cannot perform.

## Cross-Backend Byte Equality

Two changes are required for the contract's byte-identical replay to hold, and
both must land before any canonical row is written, because changing either
afterwards rewrites every row.

1. Canonical envelope and payload bytes are stored as `TEXT` or `BYTEA`, never
   `JSONB`. PostgreSQL's `JSONB` normalises key order, drops duplicate keys,
   strips whitespace, and rewrites numeric literals, so bytes cannot round-trip.
   A `JSONB` column may exist as a derived index that never feeds a hash.

2. Every 64-bit field crosses the adapter boundary as a canonical unsigned
   decimal string. `pg` returns `int8` as a string and `better-sqlite3` returns
   INTEGER as a number, so a raw row value hashed on one backend already
   differs from the other. One typed row mapper per adapter normalises these
   before anything hashes them.

Every text ordering on PostgreSQL that affects a plan, a total order, or a
quarantine listing uses `COLLATE "C"`, or sorts in application code. SQLite
orders by BINARY and PostgreSQL by database collation, and the generated ids
mix digits, letters and hyphens, which locale collations weight differently.

## Legacy Import Identity

The contract currently contradicts itself. "Deterministic Import Plan" says to
import legacy telemetry with no invented principal or actor. "Cutover Phases"
says every destination envelope carries a migration principal, authentication
context, and authorization and visibility decisions. The envelope makes
`principal_id`, `authentication_context_id`, and the authorization and
visibility blocks required.

Amendment: imported legacy rows carry the **migration principal**, which is the
principal that ran the migration and is recorded in the manifest. They carry a
distinguished capability `legacy.import` and classification `restricted`.

What "no invented principal" means, and what the contract intended, is that the
migration principal is not attributed as the *actor* who did the original work.
`actor_id` is absent on imported rows. Legacy telemetry therefore cannot
authorize, lease, verify, or close anything, which is the property the original
sentence was protecting.

The `trust = unverified_legacy` field named in the import plan does not exist in
`team_event_v1`. Either add it to the envelope or drop the reference. This
amendment proposes dropping it, because `capability = legacy.import` already
carries the same meaning and adding a field changes every event hash.

## Authentication Inside The Append Transaction

Step 1 of the append algorithm authenticates the caller inside the transaction.
`better-sqlite3` transactions are synchronous and cannot await, so an
asynchronous authentication provider cannot be called there.

Amendment: authentication resolves **before** the transaction opens. The
resolved principal, authentication context, and identity revision are inputs to
the transaction, and the transaction re-checks that the identity revision is
still current under the row lock it already takes. That preserves the ordering
guarantee the original step wanted, without requiring an await where the
runtime forbids one.

## What This Amendment Does Not Settle

- Which operations require `write_barrier = "enforced"`.
- Whether compound version 2 belongs in this phase at all, given that every
  aggregate it serves belongs to sprints that do not exist yet.
- Whether `local_single_writer` should be allowed to finalize a round, or only
  to draft one.

Each is a policy decision for the operator rather than a consequence of the
backends.
