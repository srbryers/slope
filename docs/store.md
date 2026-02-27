# SLOPE Store

The SLOPE store persists sessions, claims, scorecards, events, and common issues. Two backends are supported: SQLite (default) and PostgreSQL.

## Configuration

Store type is set in `.slope/config.json`:

```json
{
  "store": "sqlite",
  "store_path": ".slope/slope.db"
}
```

For PostgreSQL:

```json
{
  "store": "postgres",
  "postgres": {
    "connectionString": "postgres://user:pass@host:5432/slope",
    "projectId": "my-project"
  }
}
```

PostgreSQL requires the `pg` package: `npm install pg`.

## Migration Behavior

Migrations run automatically when the store is opened. Each migration is applied exactly once and tracked in a `schema_version` table.

- **SQLite:** Migrations run synchronously in the constructor.
- **PostgreSQL:** Migrations use a transaction-scoped advisory lock (`pg_advisory_xact_lock`) for concurrency safety. Multiple agents can safely open the store simultaneously.

Current schema version: **3** (sessions, claims, scorecards, common issues, events, swarm support).

## CLI Commands

### `slope store status`

Show store type, schema version, and row counts:

```
$ slope store status
Store type:     sqlite
Path:           .slope/slope.db
Schema version: 3
Sessions:       2
Claims:         5
Scorecards:     12
Events:         847
Last event:     2026-02-27T14:30:00Z
```

Use `--json` for machine-readable output:

```
$ slope store status --json
{"type":"sqlite","path":".slope/slope.db","schemaVersion":3,"sessions":2,...}
```

### `slope store migrate status`

Show current schema version and whether migrations are pending:

```
$ slope store migrate status
Current schema version: 3
Total migrations:       3
Status:                 up to date
```

### `slope store backup`

Back up the store to a file:

```
$ slope store backup
Backup created: .slope/slope-backup-2026-02-27_14-30-00.db

$ slope store backup --output=/path/to/backup.db
Backup created: /path/to/backup.db
```

For SQLite, the backup flushes the WAL (Write-Ahead Log) before copying to ensure all pending writes are included. For PostgreSQL, the command prints the `pg_dump` command for you to run manually.

### `slope store restore`

Restore from a backup file:

```
$ slope store restore --from=.slope/slope-backup-2026-02-27_14-30-00.db
Store restored from .slope/slope-backup-2026-02-27_14-30-00.db (overwritten)
```

The restore validates that the backup is a valid SLOPE database (checks for `schema_version` table) before overwriting. For PostgreSQL, it prints the `psql` command.

## MCP Tool

The `store_status` MCP tool exposes store health checks to AI agents:

```
search({ module: 'store', query: 'store_status' })
```

Returns `StoreHealthResult` with `healthy`, `type`, `schemaVersion`, `stats`, and `errors` fields.

## Health Check API

The `checkStoreHealth()` function runs `getSchemaVersion()` and `getStats()`, catches any errors, and returns a structured result:

```typescript
import { checkStoreHealth } from '@slope-dev/slope';

const result = await checkStoreHealth(store, 'sqlite');
// { healthy: true, type: 'sqlite', schemaVersion: 3, stats: {...}, errors: [] }
```

## PostgreSQL Hardening

The PostgreSQL store validates connections at startup:

1. **Connection string format** — must start with `postgres://` or `postgresql://`, include a hostname and database name.
2. **Connection ping** — executes `SELECT 1` before returning the store. On failure, the pool is cleaned up and a clear error is thrown.
