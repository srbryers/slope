# S268 Plan — Revision 2

Status: re-planned after review; both operator decisions taken 2026-09-06
Contract: `team-round-coordination.md`, `team-round-domain.md`,
`team-round-workflow.md`
Amendment: `docs/architecture/team-round-deployment-profiles.md`

## What Happened To Revision 1

Revision 1 planned all of Phase 64's storage layer as one sprint of four
tickets. Three independent reviews at opus tier, architect, backend and
security, all returned re-plan. The structure was wrong, not the ordering.

The defect they agreed on: the last ticket built the authorization substrate the
first ticket needed. Every canonical event carries `authorization.capability`,
`policy_revision`, `decision_id` and a visibility decision *inside its own event
hash*. An append path built before its policy model writes placeholder values
that are immutable forever, and the contract's default classification is
`restricted`, so a wrong placeholder over-discloses permanently.

The second defect: revision 1 changed schema at landing 1d and installed the
write fence at 1e. The contract installs the fence before `inventory`, and
`expand` is a phase behind that barrier. A store upgrading between those two
landings would take a schema change with no barrier and no manifest.

Neither reorders away inside four tickets, which is why the sprint split.

## The Split

S268 becomes six sprints. Decimal ids sort between 268 and 269, so S269 through
S272 keep their numbers. S269 was retargeted from 268 to 268.5, because leases
need an append path that the first of the six does not yet provide.

| Sprint | Delivers |
|---|---|
| S268 | Project identity and trust bootstrap, policy registry, envelope types and validator, canonical request hash, integrity chain, HMAC commitments, secret ingress scanner, published golden vectors. Additive only: no migration, no cutover. |
| S268.1 | Migration machine. Fence conformance suite first, then both fences, the durable resumable phase machine, deterministic import planner, expand, backfill, quarantine, verify, signed manifest, rollback. Cutover-capable, not cut over. |
| S268.2 | Canonical append per adapter behind one narrow interface, idempotency, conflict outcomes, error taxonomy, protocol negotiation, authority generation, cutover, legacy compatibility mode. |
| S268.3 | Projection substrate, scorecard projection, replay, exactly-once finalization, audited reopen with enforced correction scope and roadmap reconciliation. |
| S268.4 | Compound version 2 envelopes and the digest DAG. Open question below. |
| S268.5 | Filtered views, cursor AEAD, redaction, retention, backup and restore gate, adversarial corpus. |

The full ticket breakdown lives in `docs/roadmap/phases/phase-64.yaml`, which is
the source of truth. This document records why.

## What Is Already Built

`src/core/team-round/canonical.ts`, exported from the core barrel, with 28
tests. RFC 8785 canonical JSON and the domain-separated SHA-256 digest.

The security pass found three real defects in it and they are fixed. Sparse
arrays emitted invalid JSON. `Date`, `Map`, `Set` and `RegExp` all hashed as
`{}`, so a timestamp would have hashed as an empty object. The digest segments
carrying the domain separation went unchecked, so three different project ids
produced one digest, which broke the single property the framing exists to
provide.

It is one of five pinned primitives. HMAC commitments, cursor AEAD and sealed
payload encryption do not exist yet, so "everything hashes through it" was an
overstatement and S268-4 now owns the HMAC.

## Two Decisions, Both Taken

Both went the recommended way on 2026-09-06 and are recorded in the amendment. Reopening either means amending that document, not working around it in code.

**1. The write fence.** Neither backend enforces it as deployed. SQLite has no
privilege model, so anything holding the file handle can drop the triggers.
PostgreSQL runs as the `postgres` superuser in every documented setup, which
bypasses privilege checks and can disable triggers with one session setting.

Decided: two named profiles. `local_single_writer` reports an advisory barrier,
and `managed_multi_writer` requires a non-superuser application role and
reports an enforced one. The rejected alternative was declaring SQLite
unsupported for Team Round, which is cleaner on paper and removes the feature
from nearly every existing deployment.

**2. Key management.** Sealed payloads, cursor encryption and cryptographic
deletion need a managed key service that a local SQLite deployment does not
have. Storing the key beside the ciphertext is not key management.

Decided: those criteria scope to `managed_multi_writer`. `local_single_writer`
reports `redaction_retention = false` and fails those operations closed, which
is a real capability reduction rather than a pretend one.

## Open Question Carried Forward

Whether S268.4 belongs in this phase at all. Every aggregate a compound event
serves belongs to S270, S271 or S272, none of which exist. Decide before
starting it rather than during.

## Review Notes Worth Keeping

- `slope roadmap focus` draws hazards from direct dependencies only. S268
  declared `[264.2, 267]`, so S264's and S264.1's findings never appeared, and
  those are exactly this subject. Adding 264 and 264.1 took the hazard context
  from 63 to 111 and surfaced the unenforced `correction_scope` finding that
  revision 1 had assumed away.
- Byte-identical cross-backend replay needs `TEXT`/`BYTEA` payload storage
  rather than `JSONB`, decimal-string normalisation at the row-mapper boundary,
  and `COLLATE "C"` on every PostgreSQL text ordering. All three must land
  before the first canonical row, because changing them afterwards rewrites
  every row.
- Authentication cannot happen inside the append transaction on
  `better-sqlite3`, whose transactions are synchronous. It resolves first, and
  the transaction re-checks the identity revision under the lock it holds.
- PostgreSQL must run locally from S268.1 onward. Finding a composite-key or
  sequence-gap defect in CI means a red main on the riskiest sprint of the
  phase.
