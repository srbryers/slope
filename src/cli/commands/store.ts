import { existsSync, copyFileSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import type DatabaseConstructor from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { resolveStore, getStoreInfo } from '../store.js';

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)(?:=(.+))?$/);
    if (match) result[match[1]] = match[2] ?? 'true';
  }
  return result;
}

function loadDatabaseConstructor(): typeof DatabaseConstructor {
  const esmRequire = createRequire(import.meta.url);
  return esmRequire('better-sqlite3') as typeof DatabaseConstructor;
}

function detectInstallCommand(cwd: string): string {
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm install';
  if (existsSync(join(cwd, 'package-lock.json'))) return 'npm ci';
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn install';
  if (existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock'))) return 'bun install';
  return 'npm install';
}

function detectExpectedNode(cwd: string): string | null {
  for (const file of ['.nvmrc', '.node-version']) {
    const path = join(cwd, file);
    if (existsSync(path)) {
      const version = readFileSync(path, 'utf8').trim();
      if (version) return `${file} (${version})`;
    }
  }
  const packagePath = join(cwd, 'package.json');
  if (existsSync(packagePath)) {
    try {
      const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as { engines?: { node?: unknown } };
      if (typeof pkg.engines?.node === 'string' && pkg.engines.node.trim()) {
        return `package.json engines.node (${pkg.engines.node})`;
      }
    } catch { /* ignore malformed package.json here */ }
  }
  return null;
}

function isNativeSqliteSetupError(message: string): boolean {
  return /better[-_]sqlite3|better_sqlite3|NODE_MODULE_VERSION|ERR_DLOPEN_FAILED|compiled against a different Node\.js version|Cannot find module.*better-sqlite3/i.test(message);
}

export function storeRecoverySuggestions(message: string, cwd: string): string[] {
  if (!isNativeSqliteSetupError(message)) return [];

  const suggestions: string[] = [];
  const installCommand = detectInstallCommand(cwd);
  if (!existsSync(join(cwd, 'node_modules'))) {
    suggestions.push(`Install this worktree's dependencies first: ${installCommand}.`);
  } else {
    suggestions.push(`Rebuild or reinstall native dependencies for the active Node version: ${installCommand}.`);
  }

  const expectedNode = detectExpectedNode(cwd);
  if (expectedNode) {
    suggestions.push(`Use the repo's expected Node version from ${expectedNode} before running SLOPE.`);
  }

  suggestions.push('In fresh parallel worktrees, prefer the worktree-local SLOPE binary after dependencies are installed.');
  return suggestions;
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
    const message = (err as Error).message;
    const recovery = storeRecoverySuggestions(message, cwd);
    if (jsonMode) {
      console.log(JSON.stringify({ ...info, error: message, ...(recovery.length > 0 ? { recovery } : {}) }));
    } else {
      console.log(`\nStore type:     ${info.type}`);
      if (info.path) console.log(`Path:           ${info.path}`);
      if (info.sanitizedUrl) console.log(`URL:            ${info.sanitizedUrl}`);
      if (info.projectId) console.log(`Project ID:     ${info.projectId}`);
      console.log(`Status:         ERROR — ${message}`);
      if (recovery.length > 0) {
        console.log(`Recovery:`);
        for (const suggestion of recovery) {
          console.log(`  - ${suggestion}`);
        }
      }
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
    const { LATEST_SCHEMA_VERSION } = await import('../../store/index.js');
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
  let db: DatabaseType;
  try {
    const Database = loadDatabaseConstructor();
    db = new Database(dbPath);
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
    const Database = loadDatabaseConstructor();
    const db = new Database(fromPath, { readonly: true });
    let validationError: string | null = null;
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'").get();
      if (!tables) {
        validationError = 'Backup file is not a valid SLOPE database (missing schema_version table)';
      } else {
        const row = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number | null } | undefined;
        const version = row?.v ?? 0;
        if (version === 0) {
          validationError = 'Backup file has no schema version — not a valid SLOPE database';
        } else {
          const coreTables = ['sessions', 'claims', 'scorecards', 'events'];
          for (const table of coreTables) {
            const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
            if (!exists) {
              validationError = `Backup file is missing required table: ${table}`;
              break;
            }
          }
        }
      }
    } finally {
      db.close();
    }
    if (validationError) {
      console.error(`Error: ${validationError}`);
      process.exit(1);
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
