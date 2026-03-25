import { mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { resolveLoopConfig } from './config.js';
import { loadBacklog, getRemainingSprintIds, getReadySprints, releaseLock } from './backlog.js';
import { runSprint, isShuttingDown } from './executor.js';
import { initStagingBranch, createUmbrellaPr, cleanupStagingBranch } from './staging.js';
import { checkGhCli } from './pr-lifecycle.js';
import { createLogger } from './logger.js';
import type { LoopConfig, SprintResult } from './types.js';
import type { Logger } from './logger.js';

/**
 * Multi-sprint continuous loop with backlog auto-regeneration.
 * Mirrors slope-loop/continuous.sh behavior.
 */
export async function runContinuous(flags: Record<string, string>, cwd: string): Promise<void> {
  const config = resolveLoopConfig(cwd);
  const maxSprints = parseInt(flags.max ?? '10', 10);
  const pauseSeconds = parseInt(flags.pause ?? '30', 10);
  const dryRun = flags['dry-run'] === 'true';
  const useStaging = flags.staging === 'true';

  mkdirSync(join(cwd, config.resultsDir), { recursive: true });
  mkdirSync(join(cwd, config.logDir), { recursive: true });

  const log = createLogger('loop:continuous', join(cwd, config.logDir, 'continuous.log'));

  log.info('=== Continuous Loop Starting ===');
  log.info(`Max sprints: ${maxSprints}`);
  log.info(`Pause between sprints: ${pauseSeconds}s`);
  if (useStaging) log.info('Staging branch mode enabled');
  if (dryRun) log.info('DRY RUN mode');

  // Initialize staging branch if requested
  let stagingBranch = '';
  if (useStaging && !dryRun) {
    // Peek at backlog to get first sprint ID for branch naming
    const peekBacklog = loadBacklogSafe(cwd, config, log);
    const peekRemaining = peekBacklog ? getRemainingSprintIds(peekBacklog, cwd, config) : [];
    if (peekRemaining.length > 0) {
      stagingBranch = initStagingBranch(peekRemaining[0], cwd, log);
    } else {
      log.warn('No sprints in backlog — skipping staging branch');
    }
  }

  let completed = 0;
  let failures = 0;
  const collectedResults: SprintResult[] = [];

  while (completed < maxSprints) {
    if (isShuttingDown()) {
      log.warn('Shutdown requested — stopping loop');
      break;
    }

    // Check remaining sprints (dependency-aware)
    let backlog = loadBacklogSafe(cwd, config, log);
    let remaining = backlog ? getRemainingSprintIds(backlog, cwd, config) : [];

    if (remaining.length === 0) {
      log.info('Backlog exhausted — regenerating...');
      if (!regenerateBacklog(cwd, log)) {
        log.warn('Backlog regeneration failed. Stopping.');
        break;
      }
      backlog = loadBacklogSafe(cwd, config, log);
      remaining = backlog ? getRemainingSprintIds(backlog, cwd, config) : [];
      if (remaining.length === 0) {
        log.info('No sprints in regenerated backlog. Nothing to do.');
        break;
      }
    }

    // Use dependency-aware selection: only pick sprints whose deps are satisfied
    const ready = backlog ? getReadySprints(backlog, cwd, config) : [];
    if (ready.length === 0 && remaining.length > 0) {
      log.warn(`${remaining.length} sprint(s) remain but all blocked by unmet dependencies. Stopping.`);
      break;
    }

    const nextSprint = ready.length > 0 ? ready[0].id : remaining[0];
    log.info(`── Sprint ${completed + 1}/${maxSprints}: ${nextSprint} ──`);

    try {
      const runFlags: Record<string, string> = { sprint: nextSprint };
      if (dryRun) runFlags['dry-run'] = 'true';
      if (stagingBranch) runFlags.stagingBranch = stagingBranch;

      let result = await runSprint(runFlags, cwd);
      let retries = 0;

      // Retry on full failure if configured
      while (
        result &&
        result.tickets_passing === 0 &&
        retries < config.maxRetries &&
        config.retryStrategy !== 'none' &&
        !dryRun &&
        !isShuttingDown()
      ) {
        retries++;
        log.info(`Sprint ${nextSprint} had 0 passing tickets — retrying (${retries}/${config.maxRetries}, strategy: ${config.retryStrategy})`);

        // Remove result file and lock so sprint can re-run
        clearSprintResult(cwd, config, nextSprint);
        releaseLock(cwd, config, nextSprint);

        // Force API model on retry if strategy is 'model'
        const retryFlags = { ...runFlags };
        if (config.retryStrategy === 'model') {
          retryFlags.forceApi = 'true';
        }

        result = await runSprint(retryFlags, cwd);
      }

      if (result) {
        if (retries > 0) result.retries = retries;
        log.info(`Sprint ${nextSprint} completed (${result.tickets_passing}/${result.tickets_total} passing${retries > 0 ? `, ${retries} retries` : ''})`);
        collectedResults.push(result);
        failures = result.tickets_passing > 0 ? 0 : failures + 1;
      } else {
        log.warn(`Sprint ${nextSprint} returned no result`);
        failures++;
      }
    } catch (err) {
      log.error(`Sprint ${nextSprint} failed: ${(err as Error).message}`);
      failures++;
    }

    if (failures >= 3) {
      log.error('3+ consecutive failures — stopping continuous loop for investigation');
      break;
    }

    completed++;

    // Pause between sprints (skip on last or dry-run)
    if (completed < maxSprints && !dryRun && !isShuttingDown()) {
      log.info(`Pausing ${pauseSeconds}s before next sprint...`);
      await sleep(pauseSeconds * 1000);
    }
  }

  // Create umbrella PR if staging mode was used (requires manual review and merge)
  if (stagingBranch && collectedResults.length > 0 && checkGhCli(log)) {
    log.info('Creating umbrella PR for staging branch...');
    const umbrella = createUmbrellaPr(stagingBranch, collectedResults, cwd, log);
    if (umbrella) {
      log.info(`Umbrella PR: ${umbrella.url} (requires manual review)`);
    }
    // Cleanup staging branch if umbrella PR was created — safe delete refuses if unmerged
    cleanupStagingBranch(stagingBranch, cwd, log);
  }

  log.info('=== Continuous Loop Complete ===');
  log.info(`Sprints attempted: ${completed}`);
  log.info(`Failures: ${failures}`);
  if (stagingBranch) {
    log.info(`Staging branch: ${stagingBranch}`);
    log.info(`Sprint results collected: ${collectedResults.length}`);
  }
}

function loadBacklogSafe(cwd: string, config: LoopConfig, log: Logger) {
  try {
    return loadBacklog(cwd, config);
  } catch {
    log.warn('No backlog found');
    return null;
  }
}

function regenerateBacklog(cwd: string, log: Logger): boolean {
  try {
    log.info('Regenerating backlog from scorecard analysis...');
    execSync('pnpm build', { cwd, stdio: 'pipe', timeout: 120_000 });
    execSync('npx tsx slope-loop/analyze-scorecards.ts', { cwd, stdio: 'pipe', timeout: 120_000 });
    log.info('Backlog regenerated');
    return true;
  } catch {
    log.error('Backlog regeneration failed');
    return false;
  }
}

/** Remove a sprint's result file so it can be re-run */
function clearSprintResult(cwd: string, config: LoopConfig, sprintId: string): void {
  const resultPath = join(cwd, config.resultsDir, `${sprintId}.json`);
  try { unlinkSync(resultPath); } catch { /* may not exist */ }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
