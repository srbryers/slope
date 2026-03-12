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
  BacklogTicket,
} from './types.js';
import type { Logger } from './logger.js';
import { loadConfig } from '../../core/config.js';
import type { SlopeConfig } from '../../core/config.js';
import { loadScorecards } from '../../core/loader.js';
import { computeHandicapCard } from '../../core/handicap.js';
import { extractHazardIndex, filterCommonIssues } from '../../core/briefing.js';
import type { CommonIssuesFile } from '../../core/briefing.js';
import type { GolfScorecard } from '../../core/types.js';
import { extractKeywords } from './planner.js';

// ── Constants ───────────────────────────────────────

const MAX_TURNS_DEFAULT = 50;
const MAX_REPEATED_CALLS = 3;
const MAX_GUARD_RETRIES = 2;
const MAX_OVERLOAD_RETRIES = 3;
const MAX_CONSECUTIVE_BASH = 5;

/** Turn budget per club — smaller tickets get fewer turns to prevent flailing */
const CLUB_TURN_LIMITS: Record<string, number> = {
  putter: 20,
  wedge: 30,
  short_iron: 40,
  long_iron: 50,
  driver: 50,
};
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
  [/\bpnpm\s+slope\b|\bslope\s+/, 'use the slope tool instead of running slope via bash'],
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
  {
    name: 'slope',
    description:
      'Run a SLOPE CLI command (read-only). Available: search, context, briefing, card, validate, map, plan, prep, status, next, flows, doctor. Example: slope({ command: "briefing --categories=testing" })',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: {
          type: 'string',
          description:
            'SLOPE subcommand and flags (e.g., "search --query=handicap", "briefing", "map")',
        },
      },
      required: ['command'],
    },
  },
];

/** Allowlisted read-only slope subcommands */
const SLOPE_ALLOWLIST = new Set([
  'search', 'context', 'briefing', 'card', 'validate',
  'map', 'plan', 'prep', 'status', 'next', 'flows',
  'doctor', 'version',
]);

const SLOPE_TOOL_OUTPUT_CAP = 4000;

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

    const maxTurns = CLUB_TURN_LIMITS[ctx.ticket.club] ?? MAX_TURNS_DEFAULT;
    const recentSigs: string[] = [];
    let outcome: ExecutionResult['outcome'] = 'completed';
    let turn = 0;
    let guardRetries = 0;
    let overloadRetries = 0;
    let innerGuardsPassed = false;
    let consecutiveBash = 0;

    // ── Agent loop ──
    while (turn < maxTurns) {
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

      // Bash-loop breaker: if the model runs bash N+ times in a row without
      // reading or editing files, inject a nudge to break the spiral
      const allBash = toolBlocks.every(b => b.name === 'bash');
      consecutiveBash = allBash ? consecutiveBash + 1 : 0;
      if (consecutiveBash >= MAX_CONSECUTIVE_BASH) {
        log.warn(`Bash loop detected (${consecutiveBash} consecutive) — injecting nudge`);
        messages.push({
          role: 'user',
          content: `You have run ${consecutiveBash} consecutive bash commands without reading or editing any files. This is usually a sign you are stuck. Stop and think about what is actually failing. Use read_file to examine the error, or use grep/glob to find the right file to edit. Do not run another bash command until you have read the relevant code.`,
        });
        consecutiveBash = 0;
      }
    }

    if (turn >= maxTurns) {
      log.warn(`Hit max turns (${maxTurns})`);
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
  let guideWordCount = 0;
  const guidePath = join(cwd, config.agentGuide);
  if (existsSync(guidePath)) {
    const raw = readFileSync(guidePath, 'utf8');
    guideWordCount = raw.split(/\s+/).length;
    if (guideWordCount <= config.agentGuideMaxWords) {
      guide = `\n\n## Agent Guide\n${raw}`;
    }
  }

  const modules = ctx.ticket.modules;
  const scopeSection = modules.length > 0
    ? `\n## Allowed Files (scope)\nOnly modify files in or related to these modules:\n${modules.map((m: string) => `- ${m}`).join('\n')}\nYou may create new test files for these modules. Do NOT edit files outside this scope.`
    : '';

  // SLOPE sprint context (Layer 1) — hazards, common issues, handicap
  let slopeContext = '';
  try {
    slopeContext = buildSlopeContext(ctx.ticket, config, cwd, guideWordCount);
    if (slopeContext) slopeContext = '\n\n' + slopeContext;
  } catch { /* non-blocking */ }

  return `You are an autonomous coding agent working on the SLOPE project.
This is a TypeScript monorepo (pnpm, vitest, strict TypeScript).

## Working Directory
${cwd}

## Ticket: ${ctx.ticketKey}
${ctx.ticket.title}
${scopeSection}

## Rules
- ALWAYS read a file before editing it — understand existing patterns first
- Make real, substantive changes — never add only comments or whitespace
- Keep changes minimal and focused on this ticket only
- Do NOT edit files outside the allowed scope above
- After all changes, run: pnpm typecheck && pnpm test
- If tests fail, read the error output carefully before attempting a fix
- If stuck after multiple bash attempts, stop and re-read the relevant source files
- Do NOT run git commit — the system auto-commits after verification

## Tools
- read_file: Read file contents (always do this first)
- edit_file: Surgical string replacement (preferred for changes)
- write_file: Create new files or full rewrites only
- bash: Shell commands (tests, typecheck, git, etc.)
- glob: Find files by pattern
- grep: Search file contents
- slope: Query SLOPE sprint data (briefing, search, card, map, etc.)${guide}${slopeContext}`;
}

// ── SLOPE Context Injection (Layer 1) ───────────────

/**
 * Build SLOPE sprint context for injection into the system prompt.
 * Each section is independently wrapped in try/catch for graceful degradation.
 */
export function buildSlopeContext(
  ticket: BacklogTicket,
  config: LoopConfig,
  cwd: string,
  guideWordCount: number = 0,
): string {
  const wordBudget = Math.min(2000, config.agentGuideMaxWords - guideWordCount - 500);
  if (wordBudget <= 0) return '';

  const sections: string[] = [];
  const keywords = extractKeywords(
    `${ticket.title} ${ticket.description} ${ticket.modules.join(' ')}`,
    5,
  );

  let slopeConfig: SlopeConfig;
  try {
    slopeConfig = loadConfig(cwd);
  } catch {
    return '';
  }

  let scorecards: GolfScorecard[];
  try {
    scorecards = loadScorecards(slopeConfig, cwd);
  } catch {
    scorecards = [];
  }

  // Section 1: Hazard briefing
  try {
    if (scorecards.length > 0) {
      const hazards = extractHazardIndex(scorecards);
      const recentHazards = hazards.shot_hazards
        .filter(h => keywords.some(kw => h.description.toLowerCase().includes(kw)))
        .slice(0, 5);
      if (recentHazards.length > 0) {
        sections.push('### Hazard Warnings');
        for (const h of recentHazards) {
          sections.push(`- [S${h.sprint}] ${h.type}: ${h.description}`);
        }
      }
    }
  } catch { /* skip section */ }

  // Section 2: Common issues
  try {
    const issuesPath = join(cwd, slopeConfig.commonIssuesPath);
    if (existsSync(issuesPath)) {
      const issues: CommonIssuesFile = JSON.parse(readFileSync(issuesPath, 'utf8'));
      const filtered = filterCommonIssues(issues, { keywords });
      if (filtered.length > 0) {
        sections.push('### Known Gotchas');
        for (const p of filtered.slice(0, 5)) {
          sections.push(`- [${p.category}] ${p.title}`);
          sections.push(`  Prevention: ${p.prevention.slice(0, 120)}`);
        }
      }
    }
  } catch { /* skip section */ }

  // Section 3: Codebase map section
  try {
    const mapPath = join(cwd, 'CODEBASE.md');
    if (existsSync(mapPath)) {
      const mapContent = readFileSync(mapPath, 'utf8');
      const relevantSection = extractMapSection(mapContent, ticket.modules);
      if (relevantSection) {
        sections.push('### Codebase Context');
        sections.push(relevantSection);
      }
    }
  } catch { /* skip section */ }

  // Section 4: Handicap snapshot
  try {
    if (scorecards.length > 0) {
      const card = computeHandicapCard(scorecards);
      const last5 = card.last_5;
      sections.push('### Handicap Snapshot (last 5)');
      sections.push(`- Handicap: +${last5.handicap.toFixed(1)}`);
      sections.push(`- GIR: ${last5.gir_pct.toFixed(1)}%`);
      sections.push(`- Avg Putts: ${last5.avg_putts.toFixed(1)}`);
      sections.push(`- Penalties: ${last5.penalties_per_round.toFixed(1)}/round`);
      const mp = last5.miss_pattern;
      const totalMisses = mp.long + mp.short + mp.left + mp.right;
      if (totalMisses > 0) {
        const dirs = (['long', 'short', 'left', 'right'] as const)
          .filter(d => mp[d] > 0)
          .map(d => `${d}:${mp[d]}`);
        sections.push(`- Miss pattern: ${dirs.join(' ')}`);
      }
    }
  } catch { /* skip section */ }

  if (sections.length === 0) return '';

  let result = '## Sprint Context\n\n' + sections.join('\n');
  const words = result.split(/\s+/);
  if (words.length > wordBudget) {
    result = words.slice(0, wordBudget).join(' ') + '\n...(truncated)';
  }
  return result;
}

/**
 * Extract the relevant section from CODEBASE.md based on module paths.
 */
export function extractMapSection(mapContent: string, modules: string[]): string | null {
  if (modules.length === 0) return null;

  const lines = mapContent.split('\n');
  const matchedLines: string[] = [];
  let capturing = false;
  let captureDepth = 0;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const depth = headingMatch[1].length;
      const title = headingMatch[2].toLowerCase();
      const matches = modules.some(mod => {
        const parts = mod.split('/').filter(p => p.length > 2 && !p.includes('.'));
        return parts.some(part => title.includes(part.toLowerCase()));
      });
      if (matches && !capturing) {
        capturing = true;
        captureDepth = depth;
        matchedLines.push(line);
      } else if (capturing && depth <= captureDepth) {
        capturing = false;
        if (matches) {
          capturing = true;
          captureDepth = depth;
          matchedLines.push(line);
        }
      } else if (capturing) {
        matchedLines.push(line);
      }
    } else if (capturing) {
      matchedLines.push(line);
    }
  }

  const result = matchedLines.join('\n').trim();
  return result.length > 0 ? result : null;
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
      case 'slope': return toolSlope(input, cwd);
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

function toolSlope(input: Record<string, unknown>, cwd: string): ToolResult {
  const command = (input.command as string ?? '').trim();
  const parts = command.split(/\s+/);
  const subcommand = parts[0];

  if (!subcommand || !SLOPE_ALLOWLIST.has(subcommand)) {
    return {
      output: `Command "${subcommand ?? ''}" not in allowlist. Use one of: ${[...SLOPE_ALLOWLIST].join(', ')}`,
      isError: true,
    };
  }

  try {
    const output = execFileSync('pnpm', ['slope', ...parts], {
      cwd,
      encoding: 'utf8',
      timeout: 30_000,
    });

    if (output.length > SLOPE_TOOL_OUTPUT_CAP) {
      return { output: output.slice(0, SLOPE_TOOL_OUTPUT_CAP) + '\n...(output truncated)', isError: false };
    }
    return { output: output || '(no output)', isError: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { output: `slope ${command} failed: ${msg.slice(0, 200)}`, isError: true };
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
