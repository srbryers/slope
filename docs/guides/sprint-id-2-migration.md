# Sprint ID 2.0 Migration

SLOPE 2.0 makes sprint identity a canonical string from the store through the
public API. This preserves identifiers such as `458.1` and `458.10` as distinct
values. The upgrade includes automatic schema migrations for SQLite and
PostgreSQL.

## Before Upgrading

Stop every SLOPE process that can write to the project store, including agents,
hooks, dashboards, and MCP servers. Do not start the 2.0 binary until the
backup is complete because opening the store applies pending migrations.

Check the installed version:

```sh
slope --version
```

For the default SQLite store, create and verify a backup while still running
SLOPE 1.64.1:

```sh
slope store status
slope store backup --output=.slope/slope-before-2.0.db
test -s .slope/slope-before-2.0.db
```

Keep the backup outside ephemeral worktrees if several worktrees share the
same repository state.

For PostgreSQL, stop writers and create an operator-managed dump:

```sh
pg_dump --format=custom --file=slope-before-2.0.dump "$SLOPE_POSTGRES_URL"
pg_restore --list slope-before-2.0.dump >/dev/null
```

Use the actual connection string from the project's store configuration. The
placeholder environment variable above is only an example.

## Inspect Before Migration

After installing 2.0, run the read-only doctor before any ordinary SLOPE
command:

```sh
slope store migrate doctor
slope store migrate doctor --json
```

The doctor inspects schema metadata without running migrations. It reports the
backend, installed schema version, target schema version, whether an upgrade is
required, and whether the sprint identity columns have the expected text type.

## What Changes

SQLite applies migrations in individual transactions:

- v9 rebuilds `claims`, `scorecards`, and `events` with text sprint keys and
  recreates their constraints and indexes.
- v10 rebuilds `testing_sessions` with a text sprint key and preserves
  `testing_findings` plus its cascading foreign key and index.

PostgreSQL applies migrations under a transaction-scoped advisory lock:

- v6 changes claim, scorecard, and event sprint keys to `TEXT`, restores their
  constraints and indexes, and normalizes workflow execution sprint IDs.
- v7 changes testing-session sprint identity to `TEXT`.

Each migration is recorded in `schema_version` and runs once. Existing numeric
values are converted to their exact text representation, such as `458` to
`"458"` and `458.1` to `"458.1"`.

## Compatibility Caveats

- Public `SprintId` values and `sprint_number` outputs are strings in 2.0.
  Compatibility inputs may still accept numbers, but callers must not assume
  returned values are numeric.
- JavaScript numbers cannot preserve a trailing zero. Any legacy database that
  already stored `458.10` as numeric `458.1` cannot reconstruct the lost
  authored identity. Resolve that ambiguity from roadmap or scorecard evidence
  before creating new records.
- Legacy encoded values are not guessed during migration. A stored numeric
  value such as `435` remains canonical string `"435"`; it is not silently
  rewritten to `"43.5"`.
- Compare and sort sprint IDs with SLOPE's canonical helpers, not `Number`,
  `parseInt`, lexical ordering, or arithmetic.
- Roadmap `id` and `sprints` numeric fields remain compatibility mirrors.
  `id_key` and `sprint_keys` carry identity where authored trailing zeros
  matter.

## Upgrade And Verify

With a verified backup and all old writers stopped:

```sh
npm install @slope-dev/slope@2
slope store migrate doctor
slope store status
```

The first command that opens the store applies the migrations. Run the doctor
again afterward; it should report no pending migration and no identity-column
problems.

Verify project behavior:

```sh
slope validate
slope now
slope roadmap compile --check
```

For shared PostgreSQL deployments, roll out the 2.0 binary to every writer.
Do not leave a 1.x process connected after migration.

## Downgrade

SLOPE 1.x does not support canonical string sprint identity. Do not run a 1.x
binary against a store after 2.0 has written canonical values.

To downgrade:

1. Stop all SLOPE processes.
2. Reinstall SLOPE 1.64.1.
3. Restore the pre-2.0 SQLite backup with
   `slope store restore --from=.slope/slope-before-2.0.db`, or restore the
   PostgreSQL dump into a clean database.
4. Revert any 2.0-only scorecard or roadmap changes before resuming writes.

Records created after the backup are not present after restore. Export or
reconcile them before downgrading if they must be retained.
