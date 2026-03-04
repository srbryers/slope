import { spawn, execSync, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveLoopConfig } from './config.js';
import { loadBacklog, selectNextSprint, selectSprintById, releaseLock, needsEnrichment, validateTickets } from './backlog.js';
import { selectModel, selectTimeout, isLocalModel } from './model-selector.js';
import { createWorktree, refreshIndex, enrichBacklog, removeWorktree, getHeadSha, pushBranch } from './worktree.js';
import { runGuards } from './guard-runner.js';
import { checkGhCli, hasCommitsAhead, createPr, runStructuralReview, autoMerge } from './pr-lifecycle.js';
import { createLogger } from './logger.js';
import type { LoopConfig, BacklogSprint, BacklogTicket, TicketResult, SprintResult } from './types.js';
import type { Logger } from './logger.js';

let shuttingDown = false;
const activeChildPids = new Set<number>();

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
    const pidsToKill = [...activeChildPids];
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

    // Create worktree
    const wt = createWorktree(sprint.id, mainRepo, log);
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
        const result = await processTicket(ticket, config, worktreeCwd, log, sprint.strategy);
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

      if (passingCount > 0 && checkGhCli(log)) {
        if (hasCommitsAhead(wt.branch, worktreeCwd)) {
          const pr = createPr(
            wt.branch, sprint.id, sprint.title, sprint.strategy,
            ticketResults, worktreeCwd, log,
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

            const mergeResult = autoMerge(pr.number, findingCount, passingCount, config, worktreeCwd, log);
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
        try { execFileSync('git', ['pull'], { cwd: mainRepo, stdio: 'pipe' }); } catch { /* ok */ }
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

// ── Ticket Processing ──────────────────────────────

async function processTicket(
  ticket: BacklogTicket,
  config: LoopConfig,
  cwd: string,
  log: Logger,
  strategy?: BacklogSprint['strategy'],
): Promise<TicketResult> {
  const tLog = log.child(`ticket:${ticket.key}`);
  tLog.info(`-- ${ticket.key}: ${ticket.title} --`);
  tLog.info(`Club: ${ticket.club} (max_files: ${ticket.max_files}, est_tokens: ${ticket.estimated_tokens ?? 0})`);

  const primaryModel = selectModel(ticket.club, ticket.max_files, ticket.estimated_tokens ?? 0, config, cwd, strategy);
  const timeout = selectTimeout(primaryModel, config);
  tLog.info(`Model: ${primaryModel} (timeout: ${timeout}s)`);

  // Claim ticket
  try { execFileSync('pnpm', ['slope', 'claim', `--target=${ticket.key}`], { cwd, stdio: 'pipe' }); } catch { /* ok */ }

  const prompt = buildPrompt(ticket, primaryModel);
  const preSha = getHeadSha(cwd);
  let finalModel = primaryModel;
  let escalated = false;
  let testsPassing = false;
  let noop = false;

  // Attempt 1: Primary model
  const attempt1 = await runAiderWithGuards(ticket.key, primaryModel, timeout, prompt, ticket, preSha, config, cwd, tLog);

  if (attempt1.passed) {
    testsPassing = true;
    noop = attempt1.noop;
  } else if (attempt1.spawnFailed) {
    tLog.error('Aider failed to start — skipping ticket');
  } else if (config.escalateOnFail && isLocalModel(primaryModel)) {
    // Attempt 2: Escalate to API model
    tLog.info(`Escalating to ${config.modelApi}`);
    finalModel = config.modelApi;
    escalated = true;

    const preEscSha = getHeadSha(cwd);
    const attempt2 = await runAiderWithGuards(
      ticket.key, config.modelApi, config.modelApiTimeout,
      prompt, ticket, preEscSha, config, cwd, tLog,
    );

    if (attempt2.passed) {
      testsPassing = true;
      noop = attempt2.noop;
    } else {
      tLog.warn('Tests still failing after escalation');
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
  };
}

// ── Aider + Guards ─────────────────────────────────

interface AiderGuardResult {
  passed: boolean;
  noop: boolean;
  spawnFailed: boolean;
}

async function runAiderWithGuards(
  ticketKey: string,
  model: string,
  timeout: number,
  prompt: string,
  ticket: BacklogTicket,
  preSha: string,
  config: LoopConfig,
  cwd: string,
  log: Logger,
): Promise<AiderGuardResult> {
  const outcome = await runAider(ticketKey, model, timeout, prompt, ticket, config, cwd, log);

  if (outcome === 'error') {
    return { passed: false, noop: false, spawnFailed: true };
  }

  const postSha = getHeadSha(cwd);
  if (preSha === postSha) {
    log.warn('No code changes produced (no-op)');
    return { passed: true, noop: true, spawnFailed: false };
  }

  const guardResult = runGuards(preSha, config, cwd, log);
  if (guardResult.passed) {
    log.info('Guards passed');
    return { passed: true, noop: false, spawnFailed: false };
  }

  log.warn(`Guard failed: ${guardResult.failedGuard}`);
  return { passed: false, noop: false, spawnFailed: false };
}

type AiderOutcome = 'completed' | 'error' | 'timeout';

async function runAider(
  ticketKey: string,
  model: string,
  timeout: number,
  prompt: string,
  ticket: BacklogTicket,
  config: LoopConfig,
  cwd: string,
  log: Logger,
): Promise<AiderOutcome> {
  const aiderArgs = [
    '--model', model,
    '--message', prompt,
    '--auto-commits',
    '--yes',
  ];

  const local = isLocalModel(model);

  if (local) {
    aiderArgs.push('--no-stream', '--no-show-model-warnings', '--map-tokens', '1024');
  } else {
    aiderArgs.push('--auto-test', '--test-cmd', config.loopTestCmd);
  }

  // Agent guide (API only, within word budget)
  if (!local) {
    const guidePath = join(cwd, config.agentGuide);
    if (existsSync(guidePath)) {
      const words = readFileSync(guidePath, 'utf8').split(/\s+/).length;
      if (words <= config.agentGuideMaxWords) {
        aiderArgs.push('--read', guidePath);
      } else {
        log.warn(`SKILL.md exceeds ${config.agentGuideMaxWords} words — skipping`);
      }
    }
  }

  // Semantic context injection (capture output instead of shell redirect)
  const contextLineLimit = local ? 200 : 1000;
  const contextTop = local ? 4 : 8;
  const contextFile = join(cwd, config.logDir, `${ticketKey}-context.md`);

  try {
    const contextOutput = execFileSync('pnpm', [
      'slope', 'context',
      `--ticket=${ticketKey}`,
      '--format=snippets',
      `--top=${contextTop}`,
    ], { cwd, encoding: 'utf8' });

    if (contextOutput.trim().length === 0) {
      const codemap = join(cwd, 'CODEBASE.md');
      if (existsSync(codemap)) aiderArgs.push('--read', codemap);
    } else {
      const contextLines = contextOutput.split('\n');
      if (contextLines.length <= contextLineLimit) {
        writeFileSync(contextFile, contextOutput);
        aiderArgs.push('--read', contextFile);
        log.info(`Injected semantic context (${contextLines.length} lines)`);
      } else {
        // Truncate to limit instead of discarding — top results are most relevant
        const truncated = contextLines.slice(0, contextLineLimit).join('\n');
        writeFileSync(contextFile, truncated);
        aiderArgs.push('--read', contextFile);
        log.info(`Injected semantic context (${contextLines.length} lines, truncated to ${contextLineLimit})`);
      }
    }
  } catch {
    log.info('slope context failed — falling back to CODEBASE.md');
    const codemap = join(cwd, 'CODEBASE.md');
    if (existsSync(codemap)) aiderArgs.push('--read', codemap);
  }

  // Prep plan injection (capture output instead of shell redirect)
  const prepFile = join(cwd, config.logDir, `${ticketKey}-prep.md`);
  try {
    const prepOutput = execFileSync('pnpm', [
      'slope', 'prep', ticketKey, '--top=5',
    ], { cwd, encoding: 'utf8' });
    writeFileSync(prepFile, prepOutput);

    const words = prepOutput.split(/\s+/).length;
    if (words > 0 && words < 1600) {
      aiderArgs.push('--read', prepFile);
      log.info(`Injected prep plan (~${Math.round(words / 4)} tokens)`);
    } else if (words >= 1600) {
      log.info(`Prep plan too large (~${Math.round(words / 4)} tokens) — skipping`);
    }
  } catch {
    log.info('slope prep failed — continuing without plan');
  }

  // Primary files from enriched ticket as --file flags (editable)
  if (ticket.files?.primary) {
    let fileCount = 0;
    for (const f of ticket.files.primary) {
      if (fileCount >= 5) break;
      if (f && existsSync(join(cwd, f)) && /\.(ts|js|sh)$/.test(f)) {
        aiderArgs.push('--file', f);
        fileCount++;
      }
    }
    if (fileCount > 0) {
      log.info(`Added ${fileCount} primary files to Aider edit context`);
    }
  }

  // Spawn Aider with detached process group for clean shutdown
  const aiderLogPath = join(cwd, config.logDir, `${ticketKey}-${model.split('/').pop()}.log`);
  const env = {
    ...process.env,
    OLLAMA_API_BASE: config.ollamaApiBase,
    OLLAMA_FLASH_ATTENTION: config.ollamaFlashAttention ? '1' : '0',
    OLLAMA_KV_CACHE_TYPE: config.ollamaKvCacheType,
  };

  return new Promise<AiderOutcome>((resolve) => {
    const child = spawn('aider', aiderArgs, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    if (child.pid) {
      activeChildPids.add(child.pid);
    }

    // Stream draining — avoid 64KB buffer deadlock
    const logLines: string[] = [];
    if (child.stdout) {
      const rl = createInterface({ input: child.stdout });
      rl.on('line', (line) => logLines.push(line));
    }
    if (child.stderr) {
      const rl = createInterface({ input: child.stderr });
      rl.on('line', (line) => logLines.push(line));
    }

    // Timeout
    const timer = setTimeout(() => {
      log.warn(`Aider timed out after ${timeout}s`);
      if (child.pid) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { /* ok */ }
      }
      // Don't resolve here — let the 'close' event handle it
    }, timeout * 1000);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (child.pid) activeChildPids.delete(child.pid);
      if (code !== 0) {
        log.warn(`Aider exited with code ${code}`);
      }
      try { writeFileSync(aiderLogPath, logLines.join('\n')); } catch { /* ok */ }
      resolve('completed');
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (child.pid) activeChildPids.delete(child.pid);
      log.error(`Aider spawn error: ${err.message}`);
      resolve('error');
    });
  });
}

// ── Prompt Builder ─────────────────────────────────

export function buildPrompt(ticket: BacklogTicket, model: string): string {
  const acceptance = ticket.acceptance_criteria.join('; ');

  let prompt = `You are working on the SLOPE project (Sprint Lifecycle & Operational Performance Engine).
This is a TypeScript monorepo using pnpm, vitest for tests, and strict TypeScript.

TICKET: ${ticket.title}
DESCRIPTION: ${ticket.description}
ACCEPTANCE CRITERIA: ${acceptance}

RULES:
- Make minimal, focused changes — do not refactor unrelated code
- Read the relevant source files FIRST before making changes
- Run 'pnpm test' to verify your changes
- Run 'pnpm typecheck' to check types
- Commit with a message starting with '${ticket.key}:'
`;

  if (model.includes('minimax') || model.includes('claude')) {
    prompt += `\nAPPROACH: Plan before coding. List files to modify, changes per file, verification steps. Then execute step by step.`;
  } else {
    prompt += `\nAPPROACH: Make the smallest possible change. Focus on a single file at a time. Keep edits minimal.`;
  }

  if (ticket.files?.primary && ticket.files.primary.length > 0) {
    const fileList = ticket.files.primary.slice(0, 5).map(f => `- ${f}`).join('\n');
    prompt += `\n\nFILES TO MODIFY:\n${fileList}`;
  }

  prompt += `\nSTART by reading the relevant source files, then implement the change.`;
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
