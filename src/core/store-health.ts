import type { SlopeStore, StoreStats } from './store.js';

export interface StoreHealthResult {
  healthy: boolean;
  type: string;
  schemaVersion: number;
  stats: StoreStats;
  errors: string[];
}

/** Run diagnostics on a SlopeStore and return a health check result. */
export async function checkStoreHealth(store: SlopeStore, storeType: string = 'unknown'): Promise<StoreHealthResult> {
  const errors: string[] = [];
  let schemaVersion = 0;
  let stats: StoreStats = { sessions: 0, claims: 0, scorecards: 0, events: 0, lastEventAt: null };

  try {
    schemaVersion = await store.getSchemaVersion();
  } catch (err) {
    errors.push(`getSchemaVersion failed: ${(err as Error).message}`);
  }

  try {
    stats = await store.getStats();
  } catch (err) {
    errors.push(`getStats failed: ${(err as Error).message}`);
  }

  return {
    healthy: errors.length === 0,
    type: storeType,
    schemaVersion,
    stats,
    errors,
  };
}
