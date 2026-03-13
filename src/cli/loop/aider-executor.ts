/**
 * AiderExecutor — wraps existing Aider logic as an ExecutorAdapter.
 *
 * This is a pure extraction from executor.ts. Zero behavior change.
 * The Aider process is spawned per ticket with --message and --auto-commits.
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ExecutorAdapter,
  ExecutionResult,
  ExecutionContext,
  TranscriptEvent,
  LoopConfig,
} from './types.js';
import type { Logger } from './logger.js';
import { isLocalModel } from './model-selector.js';

// Context budget constants — cap injected context to avoid token overflow
const MAX_PRIMARY_FILES = 3;
const CONTEXT_LINE_LIMIT_LOCAL = 200;
const CONTEXT_LINE_LIMIT_API = 750;

const activeChildPids = new Set<number>();

export function getActiveChildPids(): Set<number> {
  return activeChildPids;
}

export const aiderExecutor: ExecutorAdapter = {
  id: 'aider',

  async execute(
    ctx: ExecutionContext,
    config: LoopConfig,
    cwd: string,
    log: Logger,
  ): Promise<ExecutionResult> {
    const start = Date.now();
    const transcript: TranscriptEvent[] = [];

    const outcome = await runAider(
      ctx.ticketKey,
      ctx.model,
      ctx.timeout,
      ctx.prompt,
      ctx.ticket,
      config,
      cwd,
      log,
    );

    const duration_s = Math.round((Date.now() - start) / 1000);

    if (outcome.type === 'error') {
      return {
        outcome: 'error',
        noop: false,
        tokens_in: 0,
        tokens_out: 0,
        cost_usd: 0,
        duration_s,
        transcript,
        files_changed: [],
      };
    }

    // Parse token usage from Aider log if available
    const { tokens_in, tokens_out } = outcome.parsedTokens;

    return {
      outcome: outcome.type === 'timeout' ? 'timeout' : 'completed',
      noop: false, // caller checks SHA diff for noop
      tokens_in,
      tokens_out,
      cost_usd: 0, // Aider doesn't give us cost — leave for future
      duration_s,
      transcript,
      files_changed: outcome.filesChanged,
    };
  },
};

// ── Aider internals (extracted from executor.ts) ──────────────────

interface AiderOutcome {
  type: 'completed' | 'error' | 'timeout' | 'stuck';
  parsedTokens: { tokens_in: number; tokens_out: number };
  filesChanged: string[];
}

async function runAider(
  ticketKey: string,
  model: string,
  timeout: number,
  prompt: string,
  ticket: { files?: { primary?: string[] } },
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

  // Semantic context injection
  const contextLineLimit = local ? CONTEXT_LINE_LIMIT_LOCAL : CONTEXT_LINE_LIMIT_API;
  const contextTop = local ? 4 : 8;
  const contextFile = join(cwd, config.logDir, `${ticketKey}-context.md`);

  try {
    const { execFileSync } = await import('node:child_process');
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

  // Primary files from enriched ticket as --file flags (editable)
  if (ticket.files?.primary) {
    let fileCount = 0;
    for (const f of ticket.files.primary) {
      if (fileCount >= MAX_PRIMARY_FILES) break;
      if (f && existsSync(join(cwd, f)) && /\.(ts|js|sh)$/.test(f) && !f.includes('.test.')) {
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

    let timedOut = false;
    let stuck = false;

    // Analysis paralysis timeout: check for file changes at 50% of timeout
    const CHECKPOINT_PERCENT = 0.5;
    const checkpointMs = timeout * 1000 * CHECKPOINT_PERCENT;
    let checkpointChecked = false;

    // Timeout
    const timer = setTimeout(() => {
      timedOut = true;
      log.warn(`Aider timed out after ${timeout}s`);
      if (child.pid) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { /* ok */ }
      }
    }, timeout * 1000);

    // Checkpoint polling: if no file changes by 50% timeout, kill early as "stuck"
    const checkpointTimer = setTimeout(() => {
      if (checkpointChecked) return; // already resolved
      checkpointChecked = true;

      const currentFiles = parseAiderFiles(logLines);
      if (currentFiles.length === 0) {
        stuck = true;
        log.warn(`Analysis paralysis detected: no file changes at ${CHECKPOINT_PERCENT * 100}% of timeout (${Math.round(timeout * CHECKPOINT_PERCENT)}s)`);
        if (child.pid) {
          try { process.kill(-child.pid, 'SIGTERM'); } catch { /* ok */ }
        }
      } else {
        log.info(`Checkpoint passed: ${currentFiles.length} file(s) changed`);
      }
    }, checkpointMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      clearTimeout(checkpointTimer);
      if (child.pid) activeChildPids.delete(child.pid);
      if (code !== 0 && !stuck) {
        log.warn(`Aider exited with code ${code}`);
      }
      try { writeFileSync(aiderLogPath, logLines.join('\n')); } catch { /* ok */ }

      // Parse token usage from Aider output
      const parsedTokens = parseAiderTokens(logLines);

      // Parse changed files from Aider output
      const filesChanged = parseAiderFiles(logLines);

      resolve({
        type: stuck ? 'stuck' : (timedOut ? 'timeout' : 'completed'),
        parsedTokens,
        filesChanged,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (child.pid) activeChildPids.delete(child.pid);
      log.error(`Aider spawn error: ${err.message}`);
      resolve({
        type: 'error',
        parsedTokens: { tokens_in: 0, tokens_out: 0 },
        filesChanged: [],
      });
    });
  });
}

/**
 * Parse token counts from Aider log output.
 * Aider prints lines like: "Tokens: 12.3k sent, 4.5k received"
 */
function parseAiderTokens(lines: string[]): { tokens_in: number; tokens_out: number } {
  let tokens_in = 0;
  let tokens_out = 0;
  for (const line of lines) {
    const match = line.match(/Tokens:\s*([\d.]+)k?\s*sent,\s*([\d.]+)k?\s*received/i);
    if (match) {
      const sent = parseFloat(match[1]);
      const received = parseFloat(match[2]);
      // Aider uses 'k' suffix for thousands
      tokens_in += line.includes('k sent') ? sent * 1000 : sent;
      tokens_out += line.includes('k received') ? received * 1000 : received;
    }
  }
  return { tokens_in: Math.round(tokens_in), tokens_out: Math.round(tokens_out) };
}

/**
 * Parse changed files from Aider log output.
 * Aider prints lines like: "Applied edit to src/foo.ts"
 */
function parseAiderFiles(lines: string[]): string[] {
  const files = new Set<string>();
  for (const line of lines) {
    const match = line.match(/Applied edit to\s+(.+)/);
    if (match) files.add(match[1].trim());
  }
  return [...files];
}
