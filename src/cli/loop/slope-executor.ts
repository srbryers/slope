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

import Anthropic from '@anthropic-ai/sdk';
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
const DEFAULT_MAX_TOKENS = 8192;
const TOOL_BASH_TIMEOUT = 60_000;
const TOOL_OUTPUT_CAP = 50_000;
const FILE_READ_CAP = 100_000;
const TRANSCRIPT_CAP = 2000;

// Approximate cost per million tokens — not intended to be precise
const COST_TABLE: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5': { in: 0.80, out: 4.00 },
  'claude-sonnet-4-5': { in: 3.00, out: 15.00 },
  'claude-sonnet-4-6': { in: 3.00, out: 15.00 },
  'claude-opus-4-6': { in: 15.00, out: 75.00 },
};
const DEFAULT_COST = { in: 1.00, out: 5.00 };

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

function safePath(relPath: string, cwd: string): string {
  const abs = resolve(cwd, relPath);
  if (!abs.startsWith(resolve(cwd))) {
    throw new Error(`Path traversal blocked: ${relPath}`);
  }
  return abs;
}

// ── Model ID resolution ─────────────────────────────

function resolveModelId(model: string): string {
  return model
    .replace(/^openrouter\/anthropic\//, '')
    .replace(/^anthropic\//, '');
}

function lookupCost(modelId: string): { in: number; out: number } {
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
      client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
    } catch (err) {
      log.error(`Anthropic client init failed (is ANTHROPIC_API_KEY set?): ${err instanceof Error ? err.message : err}`);
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

    // ── Agent loop ──
    while (turn < MAX_TURNS) {
      if (Date.now() > deadline) {
        log.warn(`Timed out after ${ctx.timeout}s`);
        outcome = 'timeout';
        break;
      }

      turn++;

      let response: Anthropic.Message;
      try {
        response = await client.messages.create({
          model: modelId,
          max_tokens: DEFAULT_MAX_TOKENS,
          system: systemPrompt,
          tools: TOOLS,
          messages,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`API error (turn ${turn}): ${msg}`);
        if (msg.includes('overloaded') && turn < MAX_TURNS) {
          await sleep(5000);
          continue;
        }
        outcome = 'error';
        break;
      }

      // Accumulate usage
      if (response.usage) {
        totalIn += response.usage.input_tokens;
        totalOut += response.usage.output_tokens;
      }

      // Model is done
      if (response.stop_reason === 'end_turn') {
        messages.push({ role: 'assistant', content: response.content });
        break;
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
    };
  },
};

// ── System prompt ───────────────────────────────────

function buildSystemPrompt(
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
- Commit with: git add <files> && git commit -m '${ctx.ticketKey}: <summary>'

## Tools
- read_file: Read file contents (always do this first)
- edit_file: Surgical string replacement (preferred for changes)
- write_file: Create new files or full rewrites only
- bash: Shell commands (tests, typecheck, git, etc.)
- glob: Find files by pattern
- grep: Search file contents${guide}`;
}

// ── Tool runner ─────────────────────────────────────

interface ToolResult {
  output: string;
  isError: boolean;
}

function runTool(
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
  // Block destructive commands
  if (/\brm\s+-rf\s+\/(?!\w)/.test(cmd)) {
    return { output: 'Blocked: rm -rf / is not allowed', isError: true };
  }
  if (/\bgit\s+push\b.*--force/.test(cmd)) {
    return { output: 'Blocked: force push is not allowed', isError: true };
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
      args.push('--include=*.ts', '--include=*.js', '--include=*.json', '--include=*.md');
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
