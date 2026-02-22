import type { HookInput, GuardResult } from '@slope-dev/core';
import { resolveStore } from '../store.js';

/**
 * Compaction checkpoint guard: fires on PreCompact.
 * Extracts events from the session before context compaction.
 */
export async function compactionGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const sessionId = input.session_id;
  if (!sessionId) return {};

  let eventCount = 0;

  try {
    const store = await resolveStore(cwd);

    // Record a compaction event
    await store.insertEvent({
      session_id: sessionId,
      type: 'compaction',
      data: {
        trigger: 'pre_compact',
        description: 'Context compaction checkpoint',
      },
    });
    eventCount++;

    store.close();
  } catch { /* store not available — skip */ }

  if (eventCount > 0) {
    return {
      context: `SLOPE: Recorded compaction checkpoint for session ${sessionId.slice(0, 8)}...`,
    };
  }

  return {};
}
