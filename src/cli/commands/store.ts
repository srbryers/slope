import { existsSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import Database from 'better-sqlite3';
import { resolveStore, getStoreInfo } from '../store.js';
import { LATEST_SCHEMA_VERSION } from '../../store/index.js';

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)(?:=(.+))?$/);
    if (match) result[match[1]] = match[2] ?? 'true';
  }
  return result;
}

export async function storeCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const flags = parseArgs(args.slice(1));
  const cwd = process.cwd();

  switch (sub) {
    case 'status':
      await storeStatus(flags, cwd);
      break;
    case 'migrate':
      await migrateStatus(args.slice(1), cwd);
      break;
    case 'backup':
      await backupStore(flags, cwd);
      break;
    case 'restore':
      await restoreStore(flags, cwd);
      break;
    default:
      console.log(`
slope store — Store diagnostics and management

Usage:
  slope store status [--json]        Show store type, schema version, and stats
  slope store migrate status         Show current schema version
  slope store backup [--output=<p>]  Back up the store
  slope store restore --from=<path>  Restore from a backup
`);
      if (sub) process.exit(1);
  }
}

async function storeStatus(flags: Record<string, string>, cwd: string): Promise<void> {
  const info = getStoreInfo(cwd);
  const jsonMode = flags.json === 'true';

  let store;
  try {
    store = await resolveStore(cwd);
  } catch (err) {
    if (jsonMode) {
      console.log(JSON.stringify({ ...info, error: (err as Error).message }));
    } else {
      console.log(`\nStore type:     ${info.type}`);
      if (info.path) console.log(`Path:           ${info.path}`);
      if (info.sanitizedUrl) console.log(`URL:            ${info.sanitizedUrl}`);
      if (info.projectId) console.log(`Project ID:     ${info.projectId}`);
      console.log(`Status:         ERROR — ${(err as Error).message}`);
    }
    return;
  }

  try {
    const version = await store.getSchemaVersion();
    const stats = await store.getStats();

    if (jsonMode) {
      console.log(JSON.stringify({
        ...info,
        schemaVersion: version,
        ...stats,
      }));
    } else {
      console.log(`\nStore type:     ${info.type}`);
      if (info.path) console.log(`Path:           ${info.path}`);
      if (info.sanitizedUrl) console.log(`URL:            ${info.sanitizedUrl}`);
      if (info.projectId) console.log(`Project ID:     ${info.projectId}`);
      console.log(`Schema version: ${version}`);
      console.log(`Sessions:       ${stats.sessions}`);
      console.log(`Claims:         ${stats.claims}`);
      console.log(`Scorecards:     ${stats.scorecards}`);
      console.log(`Events:         ${stats.events}`);
      console.log(`Last event:     ${stats.lastEventAt ?? '—'}`);
      console.log('');
    }
  } finally {
    store.close();
  }
}

async function migrateStatus(args: string[], cwd: string): Promise<void> {
  const sub = args[0];
  if (sub !== 'status') {
    console.log(`
slope store migrate — Migration management

Usage:
  slope store migrate status    Show current schema version and available migrations
`);
    if (sub) process.exit(1);
    return;
  }

  const store = await resolveStore(cwd);
  try {
    const version = await store.getSchemaVersion();
    console.log(`\nCurrent schema version: ${version}`);
    console.log(`Total migrations:       ${LATEST_SCHEMA_VERSION}`);
    if (version >= LATEST_SCHEMA_VERSION) {
      console.log(`Status:                 up to date`);
    } else {
      console.log(`Status:                 ${LATEST_SCHEMA_VERSION - version} migration(s) pending`);
    }
    console.log('');
  } finally {
    store.close();
  }
}

async function backupStore(flags: Record<string, string>, cwd: string): Promise<void> {
  const info = getStoreInfo(cwd);

  if (info.type === 'postgres') {
    console.log(`\nPostgreSQL backup — run manually:\n`);
    console.log(`  pg_dump "<connection-string>" > slope-backup-$(date +%Y%m%dT%H%M%S).sql`);
    console.log(`\nRestore with:`);
    console.log(`  psql "<connection-string>" < slope-backup-TIMESTAMP.sql`);
    console.log(`\nReplace <connection-string> with your actual PostgreSQL URL.\n`);
    return;
  }

  // SQLite backup
  const dbPath = resolve(cwd, info.path ?? '.slope/slope.db');
  if (!existsSync(dbPath)) {
    console.error(`Error: Store not found at ${dbPath}`);
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const output = flags.output ?? join(cwd, `.slope/slope-backup-${timestamp}.db`);

  // Validate output path is writable
  try {
    const outputDir = dirname(output);
    if (!existsSync(outputDir)) {
      console.error(`Error: Output directory does not exist: ${outputDir}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error: Cannot access output path: ${(err as Error).message}`);
    process.exit(1);
  }

  // Checkpoint WAL to flush pending writes before copying
  let db: Database;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch (err) {
    console.error(`Error: Cannot open database for backup: ${(err as Error).message}`);
    process.exit(1);
  }

  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (err) {
    console.error(`Warning: WAL checkpoint failed: ${(err as Error).message}`);
  } finally {
    db.close();
  }

  try {
    copyFileSync(dbPath, output);
    console.log(`\nBackup created: ${output}\n`);
  } catch (err) {
    console.error(`Error: Backup failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

async function restoreStore(flags: Record<string, string>, cwd: string): Promise<void> {
  const info = getStoreInfo(cwd);

  if (info.type === 'postgres') {
    console.log(`\nPostgreSQL restore — run manually:\n`);
    console.log(`  psql "<connection-string>" < <backup-file>.sql\n`);
    return;
  }

  const fromPath = flags.from;
  if (!fromPath) {
    console.error('Error: --from=<path> is required');
    process.exit(1);
  }

  if (!existsSync(fromPath)) {
    console.error(`Error: Backup file not found: ${fromPath}`);
    process.exit(1);
  }

  // Validate the backup file is a valid SLOPE database
  try {
    const db = new Database(fromPath, { readonly: true });
    try {
      // Check if schema_version table exists
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'").get();
      if (!tables) {
        console.error('Error: Backup file is not a valid SLOPE database (missing schema_version table)');
        process.exit(1);
      }

      const row = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number | null } | undefined;
      const version = row?.v ?? 0;
      if (version === 0) {
        console.error('Error: Backup file has no schema version — not a valid SLOPE database');
        process.exit(1);
      }

      // Verify core tables exist
      const coreTables = ['sessions', 'claims', 'scorecards', 'events'];
      for (const table of coreTables) {
        const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
        if (!exists) {
          console.error(`Error: Backup file is missing required table: ${table}`);
          process.exit(1);
        }
      }
    } finally {
      db.close();
    }
  } catch (err) {
    console.error(`Error: Cannot read backup file: ${(err as Error).message}`);
    process.exit(1);
  }

  const dbPath = resolve(cwd, info.path ?? '.slope/slope.db');
  const existed = existsSync(dbPath);

  // Ensure target directory exists
  try {
    const dbDir = dirname(dbPath);
    if (!existsSync(dbDir)) {
      console.error(`Error: Target directory does not exist: ${dbDir}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error: Cannot access target directory: ${(err as Error).message}`);
    process.exit(1);
  }

  try {
    copyFileSync(fromPath, dbPath);
  } catch (err) {
    console.error(`Error: Restore failed: ${(err as Error).message}`);
    process.exit(1);
  }

  if (existed) {
    console.log(`\nStore restored from ${fromPath} (overwritten)\n`);
  } else {
    console.log(`\nStore created from ${fromPath}\n`);
  }
}
