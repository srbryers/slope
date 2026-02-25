import type { SlopeStore } from '../core/index.js';
import { loadConfig } from './config.js';

export async function resolveStore(cwd: string = process.cwd()): Promise<SlopeStore> {
  const config = loadConfig(cwd);
  const storeType = config.store ?? 'sqlite';
  if (storeType === 'sqlite') {
    const { createStore } = await import('../store/index.js');
    return createStore({ storePath: config.store_path ?? '.slope/slope.db', cwd });
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
  return mod.createStore({ cwd, ...config });
}
