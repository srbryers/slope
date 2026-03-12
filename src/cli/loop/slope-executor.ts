/**
 * SlopeExecutor — custom agentic tool loop using the Anthropic Messages API.
 *
 * Implements ExecutorAdapter with:
 * - 6 tools: read_file, write_file, edit_file, bash, glob, grep
 * - Token/cost tracking from response.usage
 * - Full transcript recording
 * - Stuck detection (repeated identical tool calls)
 * - Timeout enforcement
 */

import type Anthropic from '@anthropic-ai/sdk';
import { execSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import type {
  ExecutorAdapter,
  ExecutionResult,
  ExecutionContext,
  TranscriptEvent,
  LoopConfig,
} from './types.js';
import type { Logger } from './logger.js';

// ── Constants ───────────────────────────────────────

const MAX_TURNS = 50;
const MAX_REPEATED_CALLS = 3;
const MAX_GUARD_RETRIES = 2;
const MAX_OVERLOAD_RETRIES = 3;
const DEFAULT_MAX_TOKENS = 8192;
const TOOL_BASH_TIMEOUT = 60_000;
const TOOL_OUTPUT_CAP = 50_000;
const FILE_READ_CAP = 100_000;
const TRANSCRIPT_CAP = 2000;
const TRUNCATE_KEEP_RECENT = 20; // keep last 10 turns fully intact

// Approximate cost per million tokens — not intended to be precise
const COST_TABLE: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5': { in: 0.80, out: 4.00 },
  'claude-sonnet-4-5': { in: 3.00, out: 15.00 },
  'claude-sonnet-4-6': { in: 3.00, out: 15.00 },
  'claude-opus-4-6': { in: 15.00, out: 75.00 },
};
const DEFAULT_COST = { in: 1.00, out: 5.00 };

// Destructive command blocklist — [pattern, human-readable reason]
const BLOCKED_COMMANDS: [RegExp, string][] = [
  [/\brm\s+-\w*r\w*\s+\//, 'rm with recursive flag targeting absolute path'],
  [/\bgit\s+push\b/, 'push is handled by the loop, not the executor'],
  [/\bmkfs\b/, 'filesystem format commands are not allowed'],
  [/\bdd\b.*\bof=\//, 'dd write to absolute path is not allowed'],
  [/\b(shutdown|reboot|halt|poweroff)\b/, 'system power commands are not allowed'],
  [/\bcurl\b.*\|\s*(ba)?sh/, 'piping curl to shell is not allowed'],
];

// ── Tool definitions (Anthropic API format) ─────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_file',
    description: 'Read the full contents of a file. Always read a file before editing it.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Relative path from the repo root' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create a new file or completely overwrite an existing one. Use edit_file for targeted changes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Relative path from the repo root' },
        content: { type: 'string', description: 'Complete file content' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Replace an exact string in a file. The old_string must match exactly (including whitespace/indentation). Only the first occurrence is replaced.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Relative path from the repo root' },
        old_string: { type: 'string', description: 'Exact text to find (must be unique enough to match once)' },
        new_string: { type: 'string', description: 'Replacement text' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'bash',
    description: 'Run a shell command. Use for git operations, running tests (pnpm test), type checking (pnpm typecheck), and other CLI tools. Commands time out after 60s.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
      },
      required: ['command'],
    },
  },
  {
    name: 'glob',
    description: 'Find files matching a glob pattern. Returns relative paths, one per line.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g., "src/**/*.ts", "*.json")' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'grep',
    description: 'Search file contents with a regex pattern. Returns matching lines with file paths and line numbers.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Search pattern (regex supported)' },
        path: { type: 'string', description: 'File or directory to search (default: current directory)' },
        include: { type: 'string', description: 'File glob filter (e.g., "*.ts")' },
      },
      required: ['pattern'],
    },
  },
];

// ── Path security ───────────────────────────────────

export function safePath(relPath: string, cwd: string): string {
  const abs = resolve(cwd, relPath);
  if (!abs.startsWith(resolve(cwd))) {
    throw new Error(`Path traversal blocked: ${relPath}`);
  }
  return abs;
}

// ── Model ID resolution ─────────────────────────────

export function resolveModelId(model: string): string {
  return model
    .replace(/^openrouter\/anthropic\//, '')
    .replace(/^anthropic\//, '');
}

export function lookupCost(modelId: string): { in: number; out: number } {
  for (const [key, cost] of Object.entries(COST_TABLE)) {
    if (modelId.includes(key)) return cost;
  }
  return DEFAULT_COST;
}

// ── Executor ────────────────────────────────────────

export const slopeExecutor: ExecutorAdapter = {
  id: 'slope',

  async execute(
    ctx: ExecutionContext,
    config: LoopConfig,
    cwd: string,
    log: Logger,
  ): Promise<ExecutionResult> {
    const start = Date.now();
    const transcript: TranscriptEvent[] = [];
    let totalIn = 0;
    let totalOut = 0;

    let client: Anthropic;
    try {
      const { default: AnthropicSDK } = await import('@anthropic-ai/sdk');
      // Supports ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL from env
      const baseURL = process.env.ANTHROPIC_BASE_URL;
      client = new AnthropicSDK(baseURL ? { baseURL } : undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const hint = msg.includes('Cannot find') || msg.includes('MODULE_NOT_FOUND')
        ? 'Install: pnpm add @anthropic-ai/sdk'
        : 'Is ANTHROPIC_API_KEY set?';
      log.error(`Anthropic client init failed (${hint}): ${msg}`);
      return errorResult(transcript, start);
    }

    const modelId = resolveModelId(ctx.model);
    const costRate = lookupCost(modelId);
    const deadline = start + ctx.timeout * 1000;
    const systemPrompt = buildSystemPrompt(ctx, config, cwd);

    // Message history for the agentic loop
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: ctx.prompt },
    ];

    const recentSigs: string[] = [];
    let outcome: ExecutionResult['outcome'] = 'completed';
    let turn = 0;
    let guardRetries = 0;
    let overloadRetries = 0;
    let innerGuardsPassed = false;

    // ── Agent loop ──
    while (turn < MAX_TURNS) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        log.warn(`Timed out after ${ctx.timeout}s`);
        outcome = 'timeout';
        break;
      }

      turn++;

      // Truncate old tool results to stay within context limits
      truncateOldMessages(messages);

      // AbortSignal for per-call timeout
      const controller = new AbortController();
      const callTimeout = setTimeout(() => controller.abort(), remaining);

      let response: Anthropic.Message;
      try {
        response = await client.messages.create(
          {
            model: modelId,
            max_tokens: DEFAULT_MAX_TOKENS,
            system: systemPrompt,
            tools: TOOLS,
            messages,
          },
          { signal: controller.signal },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (controller.signal.aborted) {
          log.warn(`API call aborted (deadline reached)`);
          outcome = 'timeout';
          break;
        }
        log.error(`API error (turn ${turn}): ${msg}`);
        if (msg.includes('overloaded') && overloadRetries < MAX_OVERLOAD_RETRIES) {
          overloadRetries++;
          await sleep(5000 * overloadRetries);
          continue;
        }
        outcome = 'error';
        break;
      } finally {
        clearTimeout(callTimeout);
      }

      // Accumulate usage
      if (response.usage) {
        totalIn += response.usage.input_tokens;
        totalOut += response.usage.output_tokens;
      }

      // Model thinks it's done — run inner guards before accepting
      if (response.stop_reason === 'end_turn') {
        messages.push({ role: 'assistant', content: response.content });

        // Skip inner guards if we've exhausted retries or are past deadline
        if (guardRetries >= MAX_GUARD_RETRIES || Date.now() > deadline) {
          break;
        }

        const guardFailure = runInnerGuards(config, cwd, log);
        if (!guardFailure) {
          log.info('Inner guards passed');
          innerGuardsPassed = true;
          break;
        }

        // Feed the error back so the model can self-correct
        guardRetries++;
        log.warn(`Inner guard failed (attempt ${guardRetries}/${MAX_GUARD_RETRIES}): ${guardFailure.guard}`);
        messages.push({
          role: 'user',
          content: `Your changes have an issue that must be fixed before this ticket is complete.\n\n## ${guardFailure.guard} failed\n\`\`\`\n${guardFailure.output}\n\`\`\`\n\nPlease fix the issue and verify again.`,
        });
        continue;
      }

      if (response.stop_reason !== 'tool_use') {
        log.warn(`Unexpected stop_reason: ${response.stop_reason}`);
        break;
      }

      // Extract tool_use blocks
      const toolBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );

      // Stuck detection — same tool calls N times in a row
      const sig = toolBlocks.map(b => `${b.name}:${JSON.stringify(b.input)}`).join('|');
      recentSigs.push(sig);
      if (recentSigs.length > MAX_REPEATED_CALLS) recentSigs.shift();
      if (
        recentSigs.length === MAX_REPEATED_CALLS &&
        recentSigs.every(s => s === sig)
      ) {
        log.warn('Stuck: identical tool calls repeated — stopping');
        outcome = 'stuck';
        break;
      }

      // Execute each tool
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolBlocks) {
        const toolStart = Date.now();
        const res = runTool(block.name, block.input as Record<string, unknown>, cwd, log);
        const duration_ms = Date.now() - toolStart;

        transcript.push({
          timestamp: new Date().toISOString(),
          tool: block.name,
          input: block.input as Record<string, unknown>,
          output: res.output.slice(0, TRANSCRIPT_CAP),
          duration_ms,
        });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: res.output,
          ...(res.isError ? { is_error: true } : {}),
        });
      }

      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });
      log.info(`Turn ${turn}: ${toolBlocks.map(b => b.name).join(', ')}`);
    }

    if (turn >= MAX_TURNS) {
      log.warn(`Hit max turns (${MAX_TURNS})`);
      if (outcome === 'completed') outcome = 'stuck';
    }

    // Commit any uncommitted changes
    const filesChanged = gitCommit(ctx.ticketKey, ctx.ticket.title, cwd, log);

    const duration_s = Math.round((Date.now() - start) / 1000);
    const cost_usd = (totalIn * costRate.in + totalOut * costRate.out) / 1_000_000;

    return {
      outcome,
      noop: false, // caller checks SHA diff
      tokens_in: totalIn,
      tokens_out: totalOut,
      cost_usd: Math.round(cost_usd * 10000) / 10000,
      duration_s,
      transcript,
      files_changed: filesChanged,
      innerGuardsPassed: innerGuardsPassed && filesChanged.length === 0,
    };
  },
};

// ── System prompt ───────────────────────────────────

export function buildSystemPrompt(
  ctx: ExecutionContext,
  config: LoopConfig,
  cwd: string,
): string {
  let guide = '';
  const guidePath = join(cwd, config.agentGuide);
  if (existsSync(guidePath)) {
    const raw = readFileSync(guidePath, 'utf8');
    if (raw.split(/\s+/).length <= config.agentGuideMaxWords) {
      guide = `\n\n## Agent Guide\n${raw}`;
    }
  }

  return `You are an autonomous coding agent working on the SLOPE project.
This is a TypeScript monorepo (pnpm, vitest, strict TypeScript).

## Working Directory
${cwd}

## Rules
- ALWAYS read a file before editing it — understand existing patterns first
- Make real, substantive changes — never add only comments or whitespace
- Keep changes minimal and focused on this ticket only
- After all changes, run: pnpm typecheck && pnpm test
- If tests fail, read the error and fix the issue
- Do NOT run git commit — the system auto-commits after verification
- You are working on ticket: ${ctx.ticketKey}

## Tools
- read_file: Read file contents (always do this first)
- edit_file: Surgical string replacement (preferred for changes)
- write_file: Create new files or full rewrites only
- bash: Shell commands (tests, typecheck, git, etc.)
- glob: Find files by pattern
- grep: Search file contents${guide}`;
}

// ── Tool runner ─────────────────────────────────────

export interface ToolResult {
  output: string;
  isError: boolean;
}

export function runTool(
  name: string,
  input: Record<string, unknown>,
  cwd: string,
  log: Logger,
): ToolResult {
  try {
    switch (name) {
      case 'read_file': return toolReadFile(input, cwd);
      case 'write_file': return toolWriteFile(input, cwd);
      case 'edit_file': return toolEditFile(input, cwd);
      case 'bash': return toolBash(input, cwd);
      case 'glob': return toolGlob(input, cwd);
      case 'grep': return toolGrep(input, cwd);
      default: return { output: `Unknown tool: ${name}`, isError: true };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`Tool ${name} error: ${msg}`);
    return { output: msg, isError: true };
  }
}

function toolReadFile(input: Record<string, unknown>, cwd: string): ToolResult {
  const abs = safePath(input.path as string, cwd);
  if (!existsSync(abs)) return { output: `File not found: ${input.path}`, isError: true };
  let content = readFileSync(abs, 'utf8');
  if (content.length > FILE_READ_CAP) {
    content = content.slice(0, FILE_READ_CAP) + '\n... (truncated at 100KB)';
  }
  return { output: content, isError: false };
}

function toolWriteFile(input: Record<string, unknown>, cwd: string): ToolResult {
  const abs = safePath(input.path as string, cwd);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, input.content as string);
  return { output: `Written: ${input.path}`, isError: false };
}

function toolEditFile(input: Record<string, unknown>, cwd: string): ToolResult {
  const abs = safePath(input.path as string, cwd);
  if (!existsSync(abs)) return { output: `File not found: ${input.path}`, isError: true };
  const content = readFileSync(abs, 'utf8');
  const oldStr = input.old_string as string;
  if (!content.includes(oldStr)) {
    return {
      output: `old_string not found in ${input.path}. Ensure exact match including whitespace and indentation.`,
      isError: true,
    };
  }
  writeFileSync(abs, content.replace(oldStr, input.new_string as string));
  return { output: `Edited: ${input.path}`, isError: false };
}

function toolBash(input: Record<string, unknown>, cwd: string): ToolResult {
  const cmd = input.command as string;
  // Block destructive commands — the model should not push (loop handles it),
  // delete broad filesystem paths, or run system-level commands
  const blocked = BLOCKED_COMMANDS.find(([re]) => re.test(cmd));
  if (blocked) {
    return { output: `Blocked: ${blocked[1]}`, isError: true };
  }
  try {
    const output = execSync(cmd, {
      cwd,
      encoding: 'utf8',
      timeout: TOOL_BASH_TIMEOUT,
      maxBuffer: 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return {
      output: (output.length > TOOL_OUTPUT_CAP
        ? output.slice(0, TOOL_OUTPUT_CAP) + '\n... (truncated)'
        : output) || '(no output)',
      isError: false,
    };
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    const out = (e.stderr || '') + (e.stdout || '') || e.message || 'Command failed';
    return {
      output: typeof out === 'string' ? out.slice(0, TOOL_OUTPUT_CAP) : 'Command failed',
      isError: true,
    };
  }
}

function toolGlob(input: Record<string, unknown>, cwd: string): ToolResult {
  const pattern = input.pattern as string;
  try {
    const output = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '--', pattern],
      { cwd, encoding: 'utf8', timeout: 10_000 },
    );
    const files = output.split('\n').filter(Boolean);
    if (files.length === 0) return { output: '(no matches)', isError: false };
    return { output: files.slice(0, 200).join('\n'), isError: false };
  } catch {
    return { output: '(no matches)', isError: false };
  }
}

function toolGrep(input: Record<string, unknown>, cwd: string): ToolResult {
  const pattern = input.pattern as string;
  const searchPath = (input.path as string) || '.';
  const include = input.include as string | undefined;
  try {
    const args = ['-rn', '--color=never'];
    if (include) {
      args.push(`--include=${include}`);
    } else {
      args.push('--include=*.ts', '--include=*.js', '--include=*.json', '--include=*.md', '--include=*.sh');
    }
    args.push('--', pattern, searchPath);
    const output = execFileSync('grep', args, {
      cwd,
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 512 * 1024,
    });
    const lines = output.split('\n').filter(Boolean);
    if (lines.length === 0) return { output: '(no matches)', isError: false };
    return { output: lines.slice(0, 100).join('\n'), isError: false };
  } catch {
    // grep exit code 1 = no matches
    return { output: '(no matches)', isError: false };
  }
}

// ── Git helpers ─────────────────────────────────────

function gitCommit(
  ticketKey: string,
  title: string,
  cwd: string,
  log: Logger,
): string[] {
  try {
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf8',
    }).trim();
    if (!status) return [];

    const files = status.split('\n').map(l => l.slice(3).trim()).filter(Boolean);
    execFileSync('git', ['add', '-A'], { cwd, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', `${ticketKey}: ${title}`], {
      cwd,
      stdio: 'pipe',
    });
    log.info(`Committed: ${ticketKey}: ${title} (${files.length} files)`);
    return files;
  } catch (err) {
    log.warn(`Commit helper failed: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

// ── Inner guards ────────────────────────────────────

interface GuardFailure {
  guard: 'typecheck' | 'tests';
  output: string;
}

/**
 * Run typecheck + tests inside the executor loop, giving the model
 * a chance to self-correct before the outer guards revert everything.
 * Returns null on success, or the failure details.
 */
function runInnerGuards(
  config: LoopConfig,
  cwd: string,
  log: Logger,
): GuardFailure | null {
  // Guard 1: Typecheck
  try {
    execSync('pnpm typecheck', { cwd, stdio: 'pipe', timeout: 120_000 });
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string };
    const output = ((e.stderr || '') + (e.stdout || '')).slice(0, 3000) || 'typecheck failed';
    return { guard: 'typecheck', output };
  }

  // Guard 2: Tests
  try {
    execSync(config.loopTestCmd, { cwd, stdio: 'pipe', timeout: 300_000 });
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string };
    const output = ((e.stderr || '') + (e.stdout || '')).slice(0, 3000) || 'tests failed';
    return { guard: 'tests', output };
  }

  return null;
}

// ── Message truncation ──────────────────────────────

/**
 * Truncate old tool result contents to prevent context window overflow.
 * Keeps the first message (task prompt) and recent turns fully intact.
 * Older tool results are shrunk to 200 chars.
 */
function truncateOldMessages(messages: Anthropic.MessageParam[]): void {
  if (messages.length <= TRUNCATE_KEEP_RECENT + 2) return;

  for (let i = 2; i < messages.length - TRUNCATE_KEEP_RECENT; i++) {
    const msg = messages[i];
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      for (const block of msg.content as Array<{ type: string; content?: string }>) {
        if (
          block.type === 'tool_result' &&
          typeof block.content === 'string' &&
          block.content.length > 200
        ) {
          block.content = block.content.slice(0, 200) + '\n[truncated]';
        }
      }
    }
  }
}

// ── Utilities ───────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function errorResult(transcript: TranscriptEvent[], start: number): ExecutionResult {
  return {
    outcome: 'error',
    noop: false,
    tokens_in: 0,
    tokens_out: 0,
    cost_usd: 0,
    duration_s: Math.round((Date.now() - start) / 1000),
    transcript,
    files_changed: [],
  };
}
