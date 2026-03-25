import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveLoopConfig } from './config.js';
import { loadBacklog, getReadySprints } from './backlog.js';
import { runSprint, isShuttingDown } from './executor.js';
import { createLogger } from './logger.js';
import type { BacklogSprint } from './types.js';

/** Default max concurrent sprints */
const DEFAULT_MAX_PARALLEL = 3;

/**
 * N-sprint parallel execution with dependency-aware scheduling
 * and module overlap detection.
 */
export async function runParallel(flags: Record<string, string>, cwd: string): Promise<void> {
  const config = resolveLoopConfig(cwd);
  const dryRun = flags['dry-run'] === 'true';
  const maxParallel = parseInt(flags['max-parallel'] ?? String(DEFAULT_MAX_PARALLEL), 10);

  mkdirSync(join(cwd, config.resultsDir), { recursive: true });
  mkdirSync(join(cwd, config.logDir), { recursive: true });

  const log = createLogger('loop:parallel', join(cwd, config.logDir, 'parallel.log'));

  log.info('=== Parallel Runner Starting ===');
  if (dryRun) log.info('DRY RUN mode');
  log.info(`Max parallel: ${maxParallel}`);

  const backlog = loadBacklog(cwd, config);
  let ready = getReadySprints(backlog, cwd, config);

  if (ready.length === 0) {
    log.info('No sprints available in backlog.');
    return;
  }

  // Run groups until no more ready sprints
  let round = 0;
  while (ready.length > 0 && !isShuttingDown()) {
    round++;
    // Build a non-overlapping group from ready sprints (greedy)
    const group = buildNonOverlappingGroup(ready, maxParallel);
    log.info(`── Round ${round}: ${group.map(s => s.id).join(' + ')} (${group.length} sprint${group.length > 1 ? 's' : ''}) ──`);

    if (group.length === 1) {
      // Single sprint — run directly (no parallel overhead)
      const runFlags: Record<string, string> = { sprint: group[0].id };
      if (dryRun) runFlags['dry-run'] = 'true';
      const result = await runSprint(runFlags, cwd).catch(err => {
        log.error(`Sprint ${group[0].id} failed: ${err}`);
        return null;
      });
      log.info(`Sprint ${group[0].id}: ${result ? 'PASS' : 'FAIL'}`);
    } else {
      // Multi-sprint — run concurrently
      const results = await Promise.allSettled(
        group.map(sprint => {
          const runFlags: Record<string, string> = { sprint: sprint.id };
          if (dryRun) runFlags['dry-run'] = 'true';
          return runSprint(runFlags, cwd);
        }),
      );

      for (let i = 0; i < group.length; i++) {
        const r = results[i];
        const status = r.status === 'fulfilled' ? 'PASS' : 'FAIL';
        if (r.status === 'rejected') {
          log.error(`Sprint ${group[i].id} failed: ${r.reason}`);
        }
        log.info(`Sprint ${group[i].id}: ${status}`);
      }
    }

    // Recompute ready sprints (completed deps may unblock more)
    ready = getReadySprints(backlog, cwd, config);
  }

  log.info('=== Parallel Runner Complete ===');
}

/**
 * Build a group of non-overlapping sprints from the ready list.
 * Greedy: take sprints in order, skip any that overlap with already-selected.
 */
function buildNonOverlappingGroup(ready: BacklogSprint[], maxSize: number): BacklogSprint[] {
  const group: BacklogSprint[] = [];
  const usedModules = new Set<string>();

  for (const sprint of ready) {
    if (group.length >= maxSize) break;

    const modules = getSprintModules(sprint);

    // Check overlap with already-selected sprints
    let overlaps = false;
    for (const mod of modules) {
      if (usedModules.has(mod)) {
        overlaps = true;
        break;
      }
    }

    if (!overlaps) {
      group.push(sprint);
      for (const mod of modules) {
        usedModules.add(mod);
      }
    }
  }

  // If greedy yielded nothing (all overlap with first), take just the first
  if (group.length === 0 && ready.length > 0) {
    group.push(ready[0]);
  }

  return group;
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
