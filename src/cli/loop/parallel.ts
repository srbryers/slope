import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveLoopConfig } from './config.js';
import { loadBacklog, getRemainingSprintIds } from './backlog.js';
import { runSprint, isShuttingDown } from './executor.js';
import { createLogger } from './logger.js';
import type { BacklogFile, BacklogSprint } from './types.js';

/**
 * Dual-sprint parallel execution with module overlap detection.
 * Mirrors slope-loop/parallel.sh behavior.
 */
export async function runParallel(flags: Record<string, string>, cwd: string): Promise<void> {
  const config = resolveLoopConfig(cwd);
  const dryRun = flags['dry-run'] === 'true';

  mkdirSync(join(cwd, config.resultsDir), { recursive: true });
  mkdirSync(join(cwd, config.logDir), { recursive: true });

  const log = createLogger('loop:parallel', join(cwd, config.logDir, 'parallel.log'));

  log.info('=== Parallel Runner Starting ===');
  if (dryRun) log.info('DRY RUN mode');

  const backlog = loadBacklog(cwd, config);
  const remaining = getRemainingSprintIds(backlog, cwd, config);

  if (remaining.length === 0) {
    log.info('No sprints available in backlog.');
    return;
  }

  const sprintA = remaining[0];

  if (remaining.length < 2) {
    log.info(`Only one sprint available (${sprintA}) — running sequentially`);
    const runFlags: Record<string, string> = { sprint: sprintA };
    if (dryRun) runFlags['dry-run'] = 'true';
    await runSprint(runFlags, cwd);
    return;
  }

  const sprintB = remaining[1];
  log.info(`Candidate pair: ${sprintA} + ${sprintB}`);

  // Check module overlap
  const overlap = hasModuleOverlap(backlog, sprintA, sprintB);
  if (overlap) {
    log.info('Module overlap detected — falling back to sequential execution');
    log.info(`Running ${sprintA} first...`);
    const flagsA: Record<string, string> = { sprint: sprintA };
    if (dryRun) flagsA['dry-run'] = 'true';
    await runSprint(flagsA, cwd);

    if (!isShuttingDown()) {
      log.info(`Running ${sprintB} second...`);
      const flagsB: Record<string, string> = { sprint: sprintB };
      if (dryRun) flagsB['dry-run'] = 'true';
      await runSprint(flagsB, cwd);
    }
    return;
  }

  log.info('No module overlap — running in parallel');

  // Run both sprints concurrently via Promise.allSettled
  const flagsA: Record<string, string> = { sprint: sprintA };
  const flagsB: Record<string, string> = { sprint: sprintB };
  if (dryRun) {
    flagsA['dry-run'] = 'true';
    flagsB['dry-run'] = 'true';
  }

  const [resultA, resultB] = await Promise.allSettled([
    runSprint(flagsA, cwd),
    runSprint(flagsB, cwd),
  ]);

  const statusA = resultA.status === 'fulfilled' ? 'PASS' : 'FAIL';
  const statusB = resultB.status === 'fulfilled' ? 'PASS' : 'FAIL';

  if (resultA.status === 'rejected') {
    log.error(`Sprint A (${sprintA}) failed: ${resultA.reason}`);
  }
  if (resultB.status === 'rejected') {
    log.error(`Sprint B (${sprintB}) failed: ${resultB.reason}`);
  }

  log.info('=== Parallel Runner Complete ===');
  log.info(`Sprint A (${sprintA}): ${statusA}`);
  log.info(`Sprint B (${sprintB}): ${statusB}`);
}

/**
 * Check if two sprints have overlapping modules.
 * Extracts module lists from tickets and computes set intersection.
 */
function hasModuleOverlap(backlog: BacklogFile, sprintIdA: string, sprintIdB: string): boolean {
  const sprintA = backlog.sprints.find(s => s.id === sprintIdA);
  const sprintB = backlog.sprints.find(s => s.id === sprintIdB);

  if (!sprintA || !sprintB) return false;

  const modulesA = getSprintModules(sprintA);
  const modulesB = getSprintModules(sprintB);

  if (modulesA.size === 0 || modulesB.size === 0) return false;

  for (const mod of modulesA) {
    if (modulesB.has(mod)) return true;
  }
  return false;
}

function getSprintModules(sprint: BacklogSprint): Set<string> {
  const modules = new Set<string>();
  for (const ticket of sprint.tickets) {
    if (ticket.modules) {
      for (const mod of ticket.modules) {
        modules.add(mod);
      }
    }
  }
  return modules;
}
