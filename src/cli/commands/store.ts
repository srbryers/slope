import { resolveStore, getStoreInfo } from '../store.js';

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
    console.log(`Total migrations:       3`);
    if (version >= 3) {
      console.log(`Status:                 up to date`);
    } else {
      console.log(`Status:                 ${3 - version} migration(s) pending`);
    }
    console.log('');
  } finally {
    store.close();
  }
}
