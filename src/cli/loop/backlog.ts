import { readFileSync, existsSync, mkdirSync, rmdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BacklogFile, BacklogSprint, BacklogTicket, LoopConfig } from './types.js';
import type { Logger } from './logger.js';

/** Load and parse backlog.json */
export function loadBacklog(cwd: string, config: LoopConfig): BacklogFile {
  const backlogPath = join(cwd, config.backlogPath);
  if (!existsSync(backlogPath)) {
    throw new Error(`Backlog not found: ${backlogPath}. Run: slope loop analyze --regenerate`);
  }
  const raw = JSON.parse(readFileSync(backlogPath, 'utf8'));
  return raw as BacklogFile;
}

/**
 * Select the next unscored sprint and atomically lock it.
 * Uses mkdir for TOCTOU-safe atomic locking — lock is acquired in the same
 * function as selection, not separately.
 *
 * @returns The selected sprint, or null if all sprints are completed.
 */
export function selectNextSprint(
  backlog: BacklogFile,
  cwd: string,
  config: LoopConfig,
): BacklogSprint | null {
  const resultsDir = join(cwd, config.resultsDir);
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });

  for (const sprint of backlog.sprints) {
    const lockDir = join(resultsDir, `${sprint.id}.lock`);
    const resultFile = join(resultsDir, `${sprint.id}.json`);

    // Already completed
    if (existsSync(resultFile)) continue;

    // Atomic lock: mkdir fails if another process already locked this sprint
    try {
      mkdirSync(lockDir);
    } catch {
      // Lock exists (another process claimed it), skip
      continue;
    }

    return sprint;
  }

  return null;
}

/** Select a specific sprint by ID */
export function selectSprintById(
  backlog: BacklogFile,
  sprintId: string,
): BacklogSprint | null {
  return backlog.sprints.find(s => s.id === sprintId) ?? null;
}

/** Release the lock for a sprint */
export function releaseLock(cwd: string, config: LoopConfig, sprintId: string): void {
  const lockDir = join(cwd, config.resultsDir, `${sprintId}.lock`);
  try {
    rmdirSync(lockDir);
  } catch {
    // Lock already removed or never existed
  }
}

/**
 * Validate that tickets have at least one module file present on disk.
 * Returns the validated (usable) tickets.
 */
export function validateTickets(
  tickets: BacklogTicket[],
  cwd: string,
  log: Logger,
): BacklogTicket[] {
  const valid: BacklogTicket[] = [];

  for (const ticket of tickets) {
    if (!ticket.modules || ticket.modules.length === 0) {
      log.warn(`SKIP ${ticket.key}: no modules specified`);
      continue;
    }

    let found = false;
    for (const mod of ticket.modules) {
      // Check absolute path first
      if (existsSync(join(cwd, mod))) {
        found = true;
        break;
      }
    }

    if (!found) {
      log.warn(`SKIP ${ticket.key}: no module files found on disk`);
      continue;
    }

    log.info(`VALID ${ticket.key}: ${ticket.title}`);
    valid.push(ticket);
  }

  return valid;
}

/** Check if the backlog needs enrichment (version < 1) */
export function needsEnrichment(backlog: BacklogFile): boolean {
  const version = backlog._enrichMeta?.version ?? 0;
  return version < 1;
}

/** Get remaining (unscored) sprint IDs from backlog */
export function getRemainingSprintIds(
  backlog: BacklogFile,
  cwd: string,
  config: LoopConfig,
): string[] {
  const resultsDir = join(cwd, config.resultsDir);
  return backlog.sprints
    .filter(s => !existsSync(join(resultsDir, `${s.id}.json`)))
    .map(s => s.id);
}

/**
 * Get sprints whose dependencies are all satisfied (completed).
 * Filters to remaining (unscored) sprints, then checks depends_on.
 */
export function getReadySprints(
  backlog: BacklogFile,
  cwd: string,
  config: LoopConfig,
): BacklogSprint[] {
  const resultsDir = join(cwd, config.resultsDir);
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });

  // Build set of completed sprint IDs from result files
  const completed = new Set<string>();
  try {
    const files = readdirSync(resultsDir);
    for (const f of files) {
      if (f.endsWith('.json') && !f.endsWith('.tmp.json')) {
        completed.add(f.replace('.json', ''));
      }
    }
  } catch { /* empty */ }

  return backlog.sprints.filter(s => {
    // Already completed — skip
    if (completed.has(s.id)) return false;
    // Already locked — skip
    if (existsSync(join(resultsDir, `${s.id}.lock`))) return false;
    // Check dependencies
    if (s.depends_on && s.depends_on.length > 0) {
      return s.depends_on.every(dep => completed.has(dep));
    }
    return true;
  });
}
