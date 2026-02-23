import type { SlopeStore } from '@srbryers/core';
import { loadConfig } from './config.js';

export async function resolveStore(cwd: string = process.cwd()): Promise<SlopeStore> {
  const config = loadConfig(cwd);
  const storeType = config.store ?? 'sqlite';
  if (storeType === 'sqlite') {
    const { createStore } = await import('@srbryers/store-sqlite');
    return createStore({ storePath: config.store_path ?? '.slope/slope.db', cwd });
  }
  // Custom adapter: dynamic import of the store module
  const mod = await import(storeType);
  return mod.createStore({ cwd, ...config });
}
