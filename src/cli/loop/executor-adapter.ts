/**
 * Executor adapter — abstracts the execution backend so the loop can
 * dispatch to Aider (local models) or SlopeExecutor (API models).
 *
 * C-2: This file wraps existing Aider logic into AiderExecutor.
 * C-3 will add SlopeExecutor alongside it.
 */

import type {
  ExecutorAdapter,
  ExecutorId,
} from './types.js';
import { isLocalModel } from './model-selector.js';

// Registry of available executors
const executors = new Map<ExecutorId, ExecutorAdapter>();

export function registerExecutor(executor: ExecutorAdapter): void {
  executors.set(executor.id, executor);
}

export function getExecutor(id: ExecutorId): ExecutorAdapter {
  const executor = executors.get(id);
  if (!executor) throw new Error(`Unknown executor: ${id}`);
  return executor;
}

/**
 * Select executor based on config and model.
 * - 'aider': always use Aider
 * - 'slope': always use SlopeExecutor
 * - 'auto' (default): local model → Aider, API model → SlopeExecutor (once available)
 */
export function selectExecutor(
  model: string,
  executorOverride?: string,
): ExecutorAdapter {
  if (executorOverride === 'aider') return getExecutor('aider');
  if (executorOverride === 'slope') return getExecutor('slope');

  // Auto: for now, everything goes to Aider until SlopeExecutor is registered
  if (executors.has('slope') && !isLocalModel(model)) {
    return getExecutor('slope');
  }
  return getExecutor('aider');
}
