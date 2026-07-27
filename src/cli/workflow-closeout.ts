import { existsSync } from 'node:fs';
import { resolveRepoStatePath, type SprintId, type WorkflowExecution } from '../core/index.js';
import { getStoreInfo, resolveStore } from './store.js';
import { completeWorkflowExecutionsForSprints } from './workflow-resync.js';

export const WORKFLOW_EXECUTION_ID_ENV = 'SLOPE_WORKFLOW_EXECUTION_ID';

export interface WorkflowCloseoutResult {
  completed: WorkflowExecution[];
  warning?: string;
}

export async function reconcileWorkflowCloseout(
  cwd: string,
  sprints: Iterable<SprintId>,
  options: {
    preserveExecutionIds?: Iterable<string>;
    preserveNewestPerSprint?: boolean;
  } = {},
): Promise<WorkflowCloseoutResult> {
  const storeInfo = getStoreInfo(cwd);
  if (storeInfo.type === 'sqlite') {
    const storePath = resolveRepoStatePath(cwd, storeInfo.path ?? '.slope/slope.db');
    if (!existsSync(storePath)) return { completed: [] };
  }

  let store: Awaited<ReturnType<typeof resolveStore>> | null = null;
  try {
    store = await resolveStore(cwd);
    return {
      completed: await completeWorkflowExecutionsForSprints(store, sprints, options),
    };
  } catch (error) {
    return {
      completed: [],
      warning: (error as Error).message,
    };
  } finally {
    store?.close();
  }
}
