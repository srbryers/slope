import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SlopeStore } from '../core/index.js';
import { resolveRepoStateCwd } from '../core/index.js';
import { loadConfig } from './config.js';

/** Store info from config — no store connection required */
export interface StoreInfo {
  type: string;
  path?: string;
  sanitizedUrl?: string;
  projectId?: string;
}

/** Read store info from config without opening the store */
export function getStoreInfo(cwd: string = process.cwd()): StoreInfo {
  const config = loadConfig(cwd);
  const type = config.store ?? 'sqlite';
  if (type === 'sqlite') {
    return { type, path: config.store_path ?? '.slope/slope.db' };
  }
  if (type === 'postgres') {
    const url = config.postgres?.connectionString;
    let sanitizedUrl: string | undefined;
    if (url) {
      try {
        const parsed = new URL(url);
        if (parsed.password) parsed.password = '***';
        sanitizedUrl = parsed.toString();
      } catch {
        sanitizedUrl = '(invalid URL)';
      }
    }
    return {
      type,
      sanitizedUrl,
      projectId: config.postgres?.projectId ?? config.projectId,
    };
  }
  return { type };
}

/**
 * True when opening the store would read rather than create.
 *
 * `resolveStore` on sqlite runs `mkdirSync` and a full schema migration, so a
 * read-only report that opens one materialises a database in a repo that never
 * had one. Non-sqlite backends are remote and have no local file to create, so
 * they answer true and let the connection attempt decide.
 */
export function storeAlreadyExists(cwd: string = process.cwd()): boolean {
  const stateCwd = resolveRepoStateCwd(cwd);
  const info = getStoreInfo(stateCwd);
  if (info.type !== 'sqlite') return true;
  return existsSync(resolve(stateCwd, info.path ?? '.slope/slope.db'));
}

export async function resolveStore(cwd: string = process.cwd()): Promise<SlopeStore> {
  const stateCwd = resolveRepoStateCwd(cwd);
  const config = loadConfig(stateCwd);
  const storeType = config.store ?? 'sqlite';
  if (storeType === 'sqlite') {
    const { createStore } = await import('../store/index.js');
    return createStore({ storePath: config.store_path ?? '.slope/slope.db', cwd: stateCwd });
  }
  if (storeType === 'postgres') {
    try {
      const { createPostgresStore } = await import('../store-pg/index.js');
      return createPostgresStore({
        connectionString: config.postgres?.connectionString,
        projectId: config.postgres?.projectId ?? config.projectId,
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND' ||
          (err instanceof Error && err.message.includes('Cannot find module'))) {
        throw new Error('PostgreSQL support requires the "pg" package. Run: npm install pg');
      }
      throw err;
    }
  }
  // Custom adapter: dynamic import of the store module
  const mod = await import(storeType);
  return mod.createStore({ cwd: stateCwd, ...config });
}
