# Sprint 264.1 Independent Security And Privacy Review

- Reviewer: Chandrasekhar (`019fa4e7-f701-7ee1-bf21-c52972a24b6a`)
- Lane: Adversarial security, privacy, and concurrency
- Scope: authority migration, lease races, secret handling, cursors, redaction, retention, and restore
- Final reviewed commit: `4082cbd8d8c5994952dec5ee7cbb8e70cd9f5693`
- Final verdict: APPROVED

## Findings And Resolution

The initial review requested eight changes:

1. Cutover did not physically stop legacy writers or constrain custom adapters.
   Resolved with database-enforced pre-inventory barriers, transaction
   draining, protocol negotiation, and adapter conformance requirements.
2. PostgreSQL lease acquisition could race when the conflict-domain row was
   absent. Resolved with durable conflict-domain rows locked before grant.
3. Legacy import ordering was not a complete deterministic total order.
   Resolved with dependency rank, source kind and identity, normalized
   timestamps, source position, and source-key tie-breakers.
4. Secret scanning covered payloads but not the complete caller request.
   Resolved by scanning identity, authorization, scope, visibility,
   idempotency, causation, lease, and payload inputs before persistence.
5. Cursor cryptography omitted a complete authenticated-encryption contract.
   Resolved with versioned AES-GCM envelopes, managed keys, authenticated
   context, expiry, and non-enumerating rejection.
6. Canonical serialization was too weak for portable integrity commitments.
   Resolved with RFC 8785 JCS and framed, domain-separated hash inputs.
7. Redaction did not define request, approval, and apply authorization states.
   Resolved with requested, approved, applied, and failed events and distinct
   approval authority.
8. Restore could reintroduce redacted data. Resolved by reconciling backups
   against an external deletion registry, key state, and deletion high-water
   marks before serving restored data.

The first re-review found three remaining changes:

1. An already connected old process could still mutate during migration.
   Resolved with physical barriers installed before inventory and a hostile
   test spanning every migration phase.
2. Import order placed time before dependency class and did not define exact
   timestamp normalization. Resolved by ranking dependencies first and using
   fixed RFC 3339 UTC timestamps with nine fractional digits and an invalid
   sentinel.
3. Cursor AES-GCM nonce uniqueness was undefined. Resolved with a managed
   non-restorable key prefix plus monotonic invocation counter, hard issuance
   bounds, and mandatory rotation.

The final bounded re-review found no remaining P1 or P2 findings and no
regression of the five findings closed in the first remediation.

## Residual Risks

Custom adapters remain trusted in-process code and require conformance
enforcement. Non-enumeration timing classes need deployment-specific
quantitative bounds. Migration fencing, cursor issuance, and restore depend on
managed key-service and deletion-registry availability. The SQLite physical
fence still requires implementation proof through the mandated old-process
tests.

## Verification

The final review approved exact commit `4082cbd`. Modular roadmap source
validation and the compiled projection check passed. The complete repository
gate passed 259 test files and 4,324 tests with 27 skipped; TypeScript typecheck
and production build passed.
