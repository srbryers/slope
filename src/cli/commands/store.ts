import { existsSync, copyFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import type DatabaseConstructor from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { resolveStore, getStoreInfo } from '../store.js';
import { loadConfig } from '../config.js';
import { resolveRepoStateCwd, resolveRepoStatePath } from '../../core/repo-state-scope.js';

type MigrationDoctorStatus = 'not_initialized' | 'upgrade_required' | 'ready' | 'inconsistent';

interface MigrationColumn {
  table: string;
  column: string;
  actualType: string | null;
  expectedType: 'TEXT';
  ok: boolean;
}

export interface MigrationDoctorReport {
  type: string;
  path?: string;
  sanitizedUrl?: string;
  projectId?: string;
  initialized: boolean;
  currentSchemaVersion: number;
  targetSchemaVersion: number;
  pendingMigrations: number;
  migrationRequired: boolean;
  status: MigrationDoctorStatus;
  identityColumns: MigrationColumn[];
  issues: string[];
  readOnly: true;
}

const SPRINT_IDENTITY_COLUMNS = [
  { table: 'claims', column: 'sprint_number' },
  { table: 'scorecards', column: 'sprint_number' },
  { table: 'events', column: 'sprint_number' },
  { table: 'testing_sessions', column: 'sprint' },
] as const;

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
  suggestions.push(`Active Node: ${process.version} (NODE_MODULE_VERSION ${process.versions.modules ?? 'unknown'}).`);

  const abi = nativeAbiDetails(message);
  if (abi) suggestions.push(abi);

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

function nativeAbiDetails(message: string): string | null {
  const match = message.match(/NODE_MODULE_VERSION\s+(\d+).*?requires NODE_MODULE_VERSION\s+(\d+)/i);
  if (!match) return null;
  return `Native binding ABI mismatch: compiled NODE_MODULE_VERSION ${match[1]}, runtime requires NODE_MODULE_VERSION ${match[2]}.`;
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
      await migrateCommand(args.slice(1), cwd);
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
  slope store migrate status         Open the store and show its schema version
  slope store migrate doctor [--json] Inspect migration readiness without applying it
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

async function migrateCommand(args: string[], cwd: string): Promise<void> {
  const sub = args[0];
  if (sub === 'doctor') {
    await migrationDoctor(parseArgs(args.slice(1)), cwd);
    return;
  }
  if (sub !== 'status') {
    console.log(`
slope store migrate — Migration management

Usage:
  slope store migrate status         Open the store and show its schema version
  slope store migrate doctor [--json] Inspect migration readiness without applying it
`);
    if (sub) process.exit(1);
    return;
  }

  const store = await resolveStore(cwd);
  try {
    const version = await store.getSchemaVersion();
    const targetVersion = await targetSchemaVersion(getStoreInfo(cwd).type);
    console.log(`\nCurrent schema version: ${version}`);
    console.log(`Total migrations:       ${targetVersion}`);
    if (version >= targetVersion) {
      console.log(`Status:                 up to date`);
    } else {
      console.log(`Status:                 ${targetVersion - version} migration(s) pending`);
    }
    console.log('');
  } finally {
    store.close();
  }
}

async function targetSchemaVersion(type: string): Promise<number> {
  if (type === 'postgres') {
    const { LATEST_PG_SCHEMA_VERSION } = await import('../../store-pg/index.js');
    return LATEST_PG_SCHEMA_VERSION;
  }
  const { LATEST_SCHEMA_VERSION } = await import('../../store/index.js');
  return LATEST_SCHEMA_VERSION;
}

export function assessMigrationDoctor(input: {
  type: string;
  info?: { path?: string; sanitizedUrl?: string; projectId?: string };
  initialized: boolean;
  currentSchemaVersion: number;
  targetSchemaVersion: number;
  columnTypes: Map<string, string>;
}): MigrationDoctorReport {
  const identityColumns: MigrationColumn[] = input.initialized
    ? SPRINT_IDENTITY_COLUMNS.map(({ table, column }) => {
        const actualType = input.columnTypes.get(`${table}.${column}`) ?? null;
        return {
          table,
          column,
          actualType,
          expectedType: 'TEXT',
          ok: actualType?.toUpperCase() === 'TEXT',
        };
      })
    : [];
  const pendingMigrations = input.initialized
    ? Math.max(0, input.targetSchemaVersion - input.currentSchemaVersion)
    : 0;
  const issues: string[] = [];
  for (const check of identityColumns) {
    if (!check.ok) {
      issues.push(`${check.table}.${check.column} is ${check.actualType ?? 'missing'}; expected TEXT`);
    }
  }

  let status: MigrationDoctorStatus;
  if (!input.initialized) status = 'not_initialized';
  else if (input.currentSchemaVersion > input.targetSchemaVersion || (pendingMigrations === 0 && issues.length > 0)) {
    status = 'inconsistent';
  } else if (pendingMigrations > 0 || issues.length > 0) {
    status = 'upgrade_required';
  } else {
    status = 'ready';
  }

  return {
    type: input.type,
    ...input.info,
    initialized: input.initialized,
    currentSchemaVersion: input.currentSchemaVersion,
    targetSchemaVersion: input.targetSchemaVersion,
    pendingMigrations,
    migrationRequired: status === 'upgrade_required',
    status,
    identityColumns,
    issues,
    readOnly: true,
  };
}

async function migrationDoctor(flags: Record<string, string>, cwd: string): Promise<void> {
  const info = getStoreInfo(cwd);
  const report = info.type === 'postgres'
    ? await inspectPostgresMigration(cwd)
    : info.type === 'sqlite'
      ? await inspectSqliteMigration(cwd)
      : {
          ...info,
          initialized: false,
          currentSchemaVersion: 0,
          targetSchemaVersion: 0,
          pendingMigrations: 0,
          migrationRequired: false,
          status: 'inconsistent' as const,
          identityColumns: [],
          issues: [`Migration doctor does not support custom store type "${info.type}"`],
          readOnly: true as const,
        };

  if (flags.json === 'true') {
    console.log(JSON.stringify(report));
    return;
  }

  console.log('\nSprint ID migration doctor (read-only)');
  console.log(`Store type:             ${report.type}`);
  if (report.path) console.log(`Path:                   ${report.path}`);
  if (report.sanitizedUrl) console.log(`URL:                    ${report.sanitizedUrl}`);
  if (report.projectId) console.log(`Project ID:             ${report.projectId}`);
  console.log(`Initialized:            ${report.initialized ? 'yes' : 'no'}`);
  console.log(`Current schema version: ${report.currentSchemaVersion}`);
  console.log(`Target schema version:  ${report.targetSchemaVersion}`);
  console.log(`Pending migrations:     ${report.pendingMigrations}`);
  console.log(`Status:                 ${report.status.replaceAll('_', ' ')}`);
  if (report.identityColumns.length > 0) {
    console.log('Sprint identity columns:');
    for (const check of report.identityColumns) {
      console.log(`  ${check.ok ? '[ok]' : '[!!]'} ${check.table}.${check.column}: ${check.actualType ?? 'missing'}`);
    }
  }
  if (report.issues.length > 0) {
    console.log('Issues:');
    for (const issue of report.issues) console.log(`  - ${issue}`);
  }
  if (report.migrationRequired) {
    console.log('Action: create a verified backup, stop old writers, then open the store with SLOPE 2.0.');
  } else if (report.status === 'not_initialized') {
    console.log('Action: no existing SLOPE schema requires migration.');
  } else if (report.status === 'ready') {
    console.log('Action: no sprint identity migration is pending.');
  } else {
    console.log('Action: inspect or restore the store before allowing writes.');
  }
  console.log('No migrations were run.\n');
}

async function inspectSqliteMigration(cwd: string): Promise<MigrationDoctorReport> {
  const info = getStoreInfo(cwd);
  const target = await targetSchemaVersion('sqlite');
  const dbPath = resolveRepoStatePath(cwd, info.path ?? '.slope/slope.db');
  if (!existsSync(dbPath)) {
    return assessMigrationDoctor({
      type: 'sqlite',
      info: { path: dbPath },
      initialized: false,
      currentSchemaVersion: 0,
      targetSchemaVersion: target,
      columnTypes: new Map(),
    });
  }

  const Database = loadDatabaseConstructor();
  const db = new Database(dbPath, { readonly: true });
  try {
    const hasVersionTable = Boolean(db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'",
    ).get());
    if (!hasVersionTable) {
      const report = assessMigrationDoctor({
        type: 'sqlite',
        info: { path: dbPath },
        initialized: false,
        currentSchemaVersion: 0,
        targetSchemaVersion: target,
        columnTypes: new Map(),
      });
      return {
        ...report,
        status: 'inconsistent',
        issues: ['SQLite store exists but schema_version is missing'],
      };
    }
    const currentSchemaVersion = hasVersionTable
      ? ((db.prepare('SELECT MAX(version) AS version FROM schema_version').get() as { version?: number | null } | undefined)?.version ?? 0)
      : 0;
    const columnTypes = new Map<string, string>();
    for (const { table, column } of SPRINT_IDENTITY_COLUMNS) {
      const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; type: string }>;
      const match = rows.find(row => row.name === column);
      if (match) columnTypes.set(`${table}.${column}`, match.type);
    }
    return assessMigrationDoctor({
      type: 'sqlite',
      info: { path: dbPath },
      initialized: hasVersionTable,
      currentSchemaVersion,
      targetSchemaVersion: target,
      columnTypes,
    });
  } finally {
    db.close();
  }
}

async function inspectPostgresMigration(cwd: string): Promise<MigrationDoctorReport> {
  const stateCwd = resolveRepoStateCwd(cwd);
  const config = loadConfig(stateCwd);
  const info = getStoreInfo(stateCwd);
  const target = await targetSchemaVersion('postgres');
  const connectionString = config.postgres?.connectionString;
  if (!connectionString) {
    throw new Error('PostgreSQL migration doctor requires postgres.connectionString in .slope/config.json');
  }

  let PgPool: typeof import('pg').Pool;
  try {
    ({ Pool: PgPool } = await import('pg'));
  } catch {
    throw new Error('PostgreSQL migration doctor requires the "pg" package. Run: npm install pg');
  }
  const pool = new PgPool({ connectionString, max: 1 });
  try {
    const versionTable = await pool.query<{ present: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'schema_version'
      ) AS present
    `);
    const initialized = Boolean(versionTable.rows[0]?.present);
    let currentSchemaVersion = 0;
    if (initialized) {
      const version = await pool.query<{ version: number | null }>(
        'SELECT MAX(version) AS version FROM schema_version',
      );
      currentSchemaVersion = version.rows[0]?.version ?? 0;
    }
    const columnTypes = new Map<string, string>();
    if (initialized) {
      const columns = await pool.query<{ table_name: string; column_name: string; data_type: string }>(`
        SELECT table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = ANY($1::text[])
      `, [[...new Set(SPRINT_IDENTITY_COLUMNS.map(item => item.table))]]);
      for (const row of columns.rows) {
        columnTypes.set(`${row.table_name}.${row.column_name}`, row.data_type);
      }
    }
    return assessMigrationDoctor({
      type: 'postgres',
      info: { sanitizedUrl: info.sanitizedUrl, projectId: info.projectId },
      initialized,
      currentSchemaVersion,
      targetSchemaVersion: target,
      columnTypes,
    });
  } finally {
    await pool.end();
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
  const dbPath = resolveRepoStatePath(cwd, info.path ?? '.slope/slope.db');
  if (!existsSync(dbPath)) {
    console.error(`Error: Store not found at ${dbPath}`);
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const output = flags.output ?? join(resolveRepoStateCwd(cwd), `.slope/slope-backup-${timestamp}.db`);

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

  const dbPath = resolveRepoStatePath(cwd, info.path ?? '.slope/slope.db');
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
