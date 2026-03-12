import { execSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveLoopConfig } from './config.js';
import { loadBacklog, selectNextSprint, selectSprintById, releaseLock, needsEnrichment, validateTickets } from './backlog.js';
import { selectModel, selectTimeout, isLocalModel } from './model-selector.js';
import { createWorktree, refreshIndex, enrichBacklog, removeWorktree, getHeadSha, pushBranch } from './worktree.js';
import { runGuards } from './guard-runner.js';
import { checkGhCli, hasCommitsAhead, createPr, runStructuralReview, autoMerge } from './pr-lifecycle.js';
import { createLogger } from './logger.js';
import { generatePlan, formatPlanAsPrompt } from './planner.js';
import { registerExecutor, selectExecutor } from './executor-adapter.js';
import { aiderExecutor, getActiveChildPids } from './aider-executor.js';
import { slopeExecutor } from './slope-executor.js';
import type { LoopConfig, BacklogSprint, BacklogTicket, TicketResult, SprintResult, ExecutionContext } from './types.js';
import type { Logger } from './logger.js';

// Register executors on module load
registerExecutor(aiderExecutor);
registerExecutor(slopeExecutor);

let shuttingDown = false;

export function isShuttingDown(): boolean {
  return shuttingDown;
}

/**
 * Run a single sprint end-to-end.
 * Main entry point for `slope loop run`.
 */
export async function runSprint(flags: Record<string, string>, cwd: string): Promise<SprintResult | null> {
  // Reset shutdown flag (allows continuous loop recovery after transient signals)
  shuttingDown = false;

  const config = resolveLoopConfig(cwd);
  const dryRun = flags['dry-run'] === 'true';
  const mainRepo = cwd;

  mkdirSync(join(cwd, config.resultsDir), { recursive: true });
  mkdirSync(join(cwd, config.logDir), { recursive: true });

  const log = createLogger('loop', join(cwd, config.logDir, 'loop.log'));

  // Signal handling — set flag and kill all active child process groups
  const cleanup = () => {
    shuttingDown = true;
    log.warn('Shutting down...');
    const pidsToKill = [...getActiveChildPids()];
    for (const pid of pidsToKill) {
      try { process.kill(-pid, 'SIGTERM'); } catch { /* already gone */ }
    }
    setTimeout(() => {
      for (const pid of pidsToKill) {
        try { process.kill(-pid, 'SIGKILL'); } catch { /* ok */ }
      }
    }, 5000);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    const backlog = loadBacklog(cwd, config);
    let sprint: BacklogSprint;

    if (flags.sprint) {
      const found = selectSprintById(backlog, flags.sprint);
      if (!found) throw new Error(`Sprint ${flags.sprint} not found in backlog`);
      sprint = found;
    } else {
      const found = selectNextSprint(backlog, cwd, config);
      if (!found) {
        log.info('All sprints completed. Run: slope loop analyze --regenerate');
        return null;
      }
      sprint = found;
    }

    log.info(`=== Starting Sprint: ${sprint.id} — ${sprint.title} ===`);
    log.info(`Strategy: ${sprint.strategy} | Tickets: ${sprint.tickets.length}`);

    if (dryRun) {
      return dryRunSprint(sprint, config, cwd, log);
    }

    // Create worktree (branch from staging if in staging mode)
    const stagingBranch = flags.stagingBranch || '';
    const wt = createWorktree(sprint.id, mainRepo, log, stagingBranch || undefined);
    const worktreeCwd = wt.path;

    try {
      refreshIndex(worktreeCwd, log);

      if (needsEnrichment(backlog)) {
        enrichBacklog(config.backlogPath, worktreeCwd, log);
      }

      // Start session
      try {
        execFileSync('pnpm', ['slope', 'session', 'start', `--sprint=${sprint.id}`], { cwd: worktreeCwd, stdio: 'pipe' });
      } catch { /* non-blocking */ }

      // Validate tickets
      const validTickets = validateTickets(sprint.tickets, worktreeCwd, log);
      if (validTickets.length === 0) {
        log.warn('All tickets failed validation — skipping sprint');
        return null;
      }

      // Process tickets
      const ticketResults: TicketResult[] = [];
      for (const ticket of validTickets) {
        if (shuttingDown) {
          log.warn('Shutdown requested — stopping ticket processing');
          break;
        }
        const result = await processTicket(ticket, config, worktreeCwd, log, sprint.strategy, flags.executor);
        ticketResults.push(result);

        // Log model usage (JSONL)
        const jsonlPath = join(cwd, config.logDir, `${sprint.id}-models.jsonl`);
        try { appendFileSync(jsonlPath, JSON.stringify(result) + '\n'); } catch { /* ok */ }

        // Push after each ticket — last push is the recovery point
        pushBranch(wt.branch, worktreeCwd, log);
      }

      // End session
      try {
        execFileSync('pnpm', ['slope', 'session', 'end'], { cwd: worktreeCwd, stdio: 'pipe' });
      } catch { /* non-blocking */ }

      // Generate scorecard
      generateScorecard(sprint, wt.branch, worktreeCwd, log);

      // PR lifecycle
      const passingCount = ticketResults.filter(t => t.tests_passing && !t.noop).length;
      const noopCount = ticketResults.filter(t => t.noop).length;
      let prNumber: number | undefined;
      let mergeStatus: SprintResult['merge_status'];
      let mergeBlockReason: string | undefined;

      const prBaseBranch = stagingBranch || 'main';
      if (passingCount > 0 && checkGhCli(log)) {
        if (hasCommitsAhead(wt.branch, worktreeCwd, prBaseBranch)) {
          const pr = createPr(
            wt.branch, sprint.id, sprint.title, sprint.strategy,
            ticketResults, worktreeCwd, log, prBaseBranch,
          );

          if (pr) {
            prNumber = pr.number;

            // Clear stale findings
            try {
              execFileSync('pnpm', ['slope', 'review', 'findings', 'clear'], { cwd: worktreeCwd, stdio: 'pipe' });
            } catch { /* ok */ }

            const sprintNum = extractSprintNum(worktreeCwd);
            const findingCount = runStructuralReview(pr.number, sprint.id, sprintNum, worktreeCwd, log);
            log.info(`Structural review: ${findingCount} finding(s)`);

            if (findingCount > 0) {
              try {
                execFileSync('pnpm', ['slope', 'review', 'amend', `--sprint=${sprintNum}`], { cwd: worktreeCwd, stdio: 'pipe' });
                log.info('Scorecard amended with review findings');
              } catch {
                log.warn('Scorecard amendment failed');
              }
            }

            const mergeResult = autoMerge(
              pr.number, findingCount, passingCount, config, worktreeCwd, log,
              stagingBranch ? { isStagingMerge: true } : undefined,
            );
            mergeStatus = mergeResult.merged ? 'merged' : 'blocked';
            mergeBlockReason = mergeResult.blockReason;
          }
        } else {
          log.info('No commits ahead of main — skipping PR creation');
          mergeStatus = 'skipped';
        }
      } else if (passingCount === 0) {
        log.info('No passing tickets — skipping PR creation');
        mergeStatus = 'skipped';
      }

      const result: SprintResult = {
        sprint_id: sprint.id,
        title: sprint.title,
        strategy: sprint.strategy,
        completed_at: new Date().toISOString(),
        branch: wt.branch,
        tickets_total: sprint.tickets.length,
        tickets_passing: passingCount,
        tickets_noop: noopCount,
        tickets: ticketResults,
        ...(prNumber !== undefined ? { pr_number: prNumber } : {}),
        ...(mergeStatus ? { merge_status: mergeStatus } : {}),
        ...(mergeBlockReason ? { merge_block_reason: mergeBlockReason } : {}),
      };

      // Atomic result write
      saveResult(result, cwd, config);

      // Guide evolution
      evolveGuide(sprint.id, ticketResults, config, worktreeCwd, log);

      // Cleanup worktree if merged
      if (mergeStatus === 'merged') {
        removeWorktree(wt.path, wt.branch, mainRepo, log);
        if (stagingBranch) {
          // Update local staging ref so next worktree branches from the latest
          try { execFileSync('git', ['fetch', 'origin', `${stagingBranch}:${stagingBranch}`], { cwd: mainRepo, stdio: 'pipe' }); } catch { /* ok */ }
        } else {
          try { execFileSync('git', ['pull'], { cwd: mainRepo, stdio: 'pipe' }); } catch { /* ok */ }
        }
        log.info(`=== Sprint ${sprint.id} done (merged, worktree cleaned) ===`);
      } else {
        log.info(`=== Sprint ${sprint.id} done ===`);
        log.info(`Worktree preserved at: ${wt.path}`);
      }

      return result;
    } finally {
      releaseLock(cwd, config, sprint.id);
    }
  } finally {
    process.removeListener('SIGINT', cleanup);
    process.removeListener('SIGTERM', cleanup);
  }
}

// ── Ticket Processing (adapter-based) ──────────────────────────────

async function processTicket(
  ticket: BacklogTicket,
  config: LoopConfig,
  cwd: string,
  log: Logger,
  strategy?: BacklogSprint['strategy'],
  executorOverride?: string,
): Promise<TicketResult> {
  const tLog = log.child(`ticket:${ticket.key}`);
  tLog.info(`-- ${ticket.key}: ${ticket.title} --`);
  tLog.info(`Club: ${ticket.club} (max_files: ${ticket.max_files}, est_tokens: ${ticket.estimated_tokens ?? 0})`);

  const primaryModel = selectModel(ticket.club, ticket.max_files, ticket.estimated_tokens ?? 0, config, cwd, strategy);
  const timeout = selectTimeout(primaryModel, config);
  tLog.info(`Model: ${primaryModel} (timeout: ${timeout}s)`);

  // Select executor based on model and config
  const executor = selectExecutor(primaryModel, executorOverride);
  tLog.info(`Executor: ${executor.id}`);

  // Claim ticket
  try { execFileSync('pnpm', ['slope', 'claim', `--target=${ticket.key}`], { cwd, stdio: 'pipe' }); } catch { /* ok */ }

  // Generate execution plan (planner) with fallback to generic prompt
  let prompt: string;
  try {
    const plan = generatePlan(ticket, primaryModel, cwd, tLog);
    prompt = formatPlanAsPrompt(plan, ticket);
    tLog.info(`Plan generated (${plan.generated} tier, ${plan.files.length} files)`);
  } catch (err) {
    tLog.warn(`Planner failed, falling back to buildPrompt: ${err instanceof Error ? err.message : err}`);
    prompt = buildPrompt(ticket, primaryModel);
  }

  const preSha = getHeadSha(cwd);
  let finalModel = primaryModel;
  let escalated = false;
  let testsPassing = false;
  let noop = false;
  let tokens_in = 0;
  let tokens_out = 0;
  let cost_usd = 0;
  let duration_s = 0;

  // Build execution context
  const ctx: ExecutionContext = {
    ticketKey: ticket.key,
    model: primaryModel,
    timeout,
    prompt,
    ticket,
    preSha,
  };

  // Attempt 1: Primary model
  const result1 = await executor.execute(ctx, config, cwd, tLog);
  tokens_in += result1.tokens_in;
  tokens_out += result1.tokens_out;
  cost_usd += result1.cost_usd;
  duration_s += result1.duration_s;
  const transcript = [...result1.transcript];

  if (result1.outcome === 'error') {
    tLog.error('Executor failed to start — skipping ticket');
  } else {
    // Check for noop (no SHA change)
    const postSha = getHeadSha(cwd);
    if (preSha === postSha) {
      tLog.warn('No code changes produced (no-op)');
      noop = true;
      testsPassing = true;
    } else if (result1.innerGuardsPassed) {
      // Inner guards already verified typecheck + tests — skip outer guards
      tLog.info('Inner guards passed — skipping outer guards');
      testsPassing = true;
    } else {
      // Run post-ticket guards
      const guardResult = runGuards(preSha, config, cwd, tLog, ticket);
      if (guardResult.passed) {
        tLog.info('Guards passed');
        testsPassing = true;
      } else {
        tLog.warn(`Guard failed: ${guardResult.failedGuard}`);
      }
    }
  }

  // Attempt 2: Escalate if primary failed
  if (!testsPassing && !noop && result1.outcome !== 'error' && config.escalateOnFail && isLocalModel(primaryModel)) {
    tLog.info(`Escalating to ${config.modelApi}`);
    finalModel = config.modelApi;
    escalated = true;

    const preEscSha = getHeadSha(cwd);
    const escExecutor = selectExecutor(config.modelApi, executorOverride);
    const escCtx: ExecutionContext = {
      ticketKey: ticket.key,
      model: config.modelApi,
      timeout: config.modelApiTimeout,
      prompt,
      ticket,
      preSha: preEscSha,
    };

    const result2 = await escExecutor.execute(escCtx, config, cwd, tLog);
    tokens_in += result2.tokens_in;
    tokens_out += result2.tokens_out;
    cost_usd += result2.cost_usd;
    duration_s += result2.duration_s;
    transcript.push(...result2.transcript);

    const postEscSha = getHeadSha(cwd);
    if (preEscSha === postEscSha) {
      tLog.warn('No code changes after escalation (no-op)');
      noop = true;
      testsPassing = true;
    } else {
      const guardResult = runGuards(preEscSha, config, cwd, tLog, ticket);
      if (guardResult.passed) {
        tLog.info('Guards passed after escalation');
        testsPassing = true;
      } else {
        tLog.warn('Tests still failing after escalation');
      }
    }
  }

  // Release claim
  try { execFileSync('pnpm', ['slope', 'release', `--target=${ticket.key}`], { cwd, stdio: 'pipe' }); } catch { /* ok */ }

  tLog.info(`-- ${ticket.key} complete --`);

  return {
    ticket: ticket.key,
    title: ticket.title,
    club: ticket.club,
    max_files: ticket.max_files,
    primary_model: primaryModel,
    final_model: finalModel,
    escalated,
    tests_passing: testsPassing,
    noop,
    tokens_in: tokens_in || undefined,
    tokens_out: tokens_out || undefined,
    cost_usd: cost_usd || undefined,
    duration_s: duration_s || undefined,
    transcript: transcript.length > 0 ? transcript : undefined,
  };
}

// ── Prompt Builder ─────────────────────────────────

export function buildPrompt(ticket: BacklogTicket, model: string): string {
  const local = isLocalModel(model);

  // Calculate token budget based on club and model tier
  const clubBudgets: Record<string, number> = {
    putter: 4000,
    wedge: 4000,
    short_iron: 8000,
    long_iron: 16000,
    driver: 24000,
  };
  const baseBudget = clubBudgets[ticket.club] ?? 8000;
  const tokenBudget = local ? Math.floor(baseBudget / 2) : baseBudget;

  // Build structured file list from enriched primary files or modules
  const targetFiles = ticket.files?.primary?.slice(0, 5) ?? ticket.modules?.slice(0, 5) ?? [];
  const fileSection = targetFiles.length > 0
    ? targetFiles.map(f => `  - ${f}`).join('\n')
    : '  (read the description to identify target files)';

  // Build structured acceptance criteria — each on its own line with checkbox
  const acSection = ticket.acceptance_criteria
    .map(ac => `  [ ] ${ac}`)
    .join('\n');

  let prompt = `You are working on the SLOPE project (Sprint Lifecycle & Operational Performance Engine).
This is a TypeScript monorepo using pnpm, vitest for tests, and strict TypeScript.

## Task
${ticket.key}: ${ticket.title}

## Description
${ticket.description}

## Target Files
${fileSection}

## Acceptance Criteria (ALL must pass)
${acSection}

## Token Budget
You have ~${tokenBudget} tokens — focus on the core change. Avoid verbose explanations or refactoring unrelated code.

## Verification Commands
  1. pnpm typecheck
  2. pnpm test

## Rules
- Read each target file BEFORE modifying it — understand existing patterns
- Make real, substantive changes — do NOT add only comments, whitespace, or no-op edits
- If a file already satisfies the criteria, move to the next file — do not force changes
- Keep changes minimal and focused on this ticket only
- Commit with message: '${ticket.key}: <what you changed>'
`;

  if (local) {
    prompt += `\n## Approach (local model — keep it simple)
- Focus on ONE file at a time
- Make the smallest possible change that satisfies the criteria
- Prefer editing existing code over adding new files`;
  } else {
    prompt += `\n## Approach (plan then execute)
1. List the specific changes needed per file
2. For each file: read it, make the change, verify
3. Run verification commands after all changes`;
  }

  return prompt;
}

// ── Helpers ────────────────────────────────────────

function dryRunSprint(sprint: BacklogSprint, config: LoopConfig, cwd: string, log: Logger): null {
  log.info('--- Dry run mode ---');
  for (const t of sprint.tickets) {
    const model = selectModel(t.club, t.max_files, t.estimated_tokens ?? 0, config, cwd, sprint.strategy);
    const modelShort = model.split('/').pop();
    log.info(`  ${t.key}: ${t.title} [club=${t.club}, files=${t.max_files}] → ${modelShort}`);
  }

  const valid = validateTickets(sprint.tickets, cwd, log);
  if (valid.length === 0) {
    log.warn('All tickets would fail validation — sprint would be skipped');
  }

  releaseLock(cwd, config, sprint.id);
  log.info('--- Dry run complete ---');
  return null;
}

export function saveResult(result: SprintResult, cwd: string, config: LoopConfig): void {
  const dir = join(cwd, config.resultsDir);
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(dir, `${result.sprint_id}.tmp.json`);
  const finalPath = join(dir, `${result.sprint_id}.json`);
  writeFileSync(tmpPath, JSON.stringify(result, null, 2) + '\n');
  renameSync(tmpPath, finalPath);
}

function generateScorecard(sprint: BacklogSprint, branch: string, cwd: string, log: Logger): void {
  try {
    const nextOutput = execFileSync('pnpm', ['slope', 'next'], { cwd, encoding: 'utf8' });
    const match = nextOutput.match(/Next sprint: S(\d+)/);
    const sprintNum = match?.[1] ?? '0';
    if (parseInt(sprintNum, 10) > 0) {
      execFileSync('pnpm', [
        'slope', 'auto-card',
        `--sprint=${sprintNum}`,
        `--theme=${sprint.title}`,
        `--branch=main..${branch}`,
      ], { cwd, stdio: 'pipe' });
      log.info(`Auto-card generated for sprint ${sprintNum}`);
    }
  } catch {
    log.warn('Auto-card generation failed');
  }
  try { execFileSync('pnpm', ['slope', 'review'], { cwd, stdio: 'pipe' }); } catch { /* ok */ }
}

function extractSprintNum(cwd: string): number {
  try {
    const output = execFileSync('pnpm', ['slope', 'next'], { cwd, encoding: 'utf8' });
    const match = output.match(/Next sprint: S(\d+)/);
    return parseInt(match?.[1] ?? '0', 10);
  } catch {
    return 0;
  }
}

function evolveGuide(
  sprintId: string,
  ticketResults: TicketResult[],
  config: LoopConfig,
  cwd: string,
  log: Logger,
): void {
  const failed = ticketResults.filter(t => !t.tests_passing);
  const escalatedTickets = ticketResults.filter(t => t.escalated);

  if (failed.length === 0 && escalatedTickets.length === 0) return;

  // Tier 2: Sprint history (full detail)
  const historyPath = join(cwd, config.sprintHistory);
  try {
    let entry = `\n## Sprint ${sprintId} (${new Date().toISOString().split('T')[0]})\n\n`;
    if (escalatedTickets.length > 0) {
      entry += '**Escalated** (local model failed, API attempted):\n';
      for (const t of escalatedTickets) entry += `- ${t.ticket}: ${t.title} [${t.club}]\n`;
      entry += '\n';
    }
    if (failed.length > 0) {
      entry += '**Failed** (investigate patterns):\n';
      for (const t of failed) entry += `- ${t.ticket}: ${t.title}\n`;
      entry += '\n';
    }
    appendFileSync(historyPath, entry);
    log.info('Sprint history updated');
  } catch {
    log.warn('Failed to update sprint history');
  }

  // Tier 1: SKILL.md hazard one-liners
  const guidePath = join(cwd, config.agentGuide);
  if (existsSync(guidePath)) {
    try {
      let content = readFileSync(guidePath, 'utf8');
      const insertBefore = '## Anti-Patterns';
      const lines: string[] = [];

      for (const t of failed) {
        lines.push(`- [${sprintId}] ${t.ticket}: ${t.title} — failed`);
      }
      for (const t of escalatedTickets) {
        lines.push(`- [${sprintId}] ${t.ticket}: escalated from local [${t.club}]`);
      }

      if (content.includes(insertBefore)) {
        content = content.replace(insertBefore, lines.join('\n') + '\n' + insertBefore);
        writeFileSync(guidePath, content);
        log.info('SKILL.md hazards updated');
      }
    } catch {
      log.warn('Failed to update SKILL.md');
    }

    // Word budget check
    const words = readFileSync(guidePath, 'utf8').split(/\s+/).length;
    if (words > config.agentGuideMaxWords) {
      log.warn(`SKILL.md is ${words} words (limit: ${config.agentGuideMaxWords}) — needs synthesis`);
    }
  }

  // Model config auto-regen check
  try {
    const logFiles = readdirSync(join(cwd, config.logDir)).filter(f => f.endsWith('-models.jsonl'));
    let totalLogged = 0;
    for (const f of logFiles) {
      const c = readFileSync(join(cwd, config.logDir, f), 'utf8');
      totalLogged += c.split('\n').filter(Boolean).length;
    }

    const modelConfigPath = join(cwd, 'slope-loop/model-config.json');
    if (existsSync(modelConfigPath)) {
      const mc = JSON.parse(readFileSync(modelConfigPath, 'utf8'));
      const delta = totalLogged - (mc.ticket_count ?? 0);
      if (delta >= config.modelRegenThreshold) {
        log.info(`Auto-regenerating model-config.json (${delta} new tickets)`);
        execSync('npx tsx slope-loop/model-selector.ts', { cwd, stdio: 'pipe' });
      }
    }
  } catch { /* ok */ }
}
