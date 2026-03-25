/**
 * slope transcript — View session transcript data
 *
 * Subcommands:
 *   slope transcript list                   List available transcripts
 *   slope transcript show <session-id>      Show turn-by-turn summary
 *   slope transcript stats [session-id]     Aggregate metrics
 */

import { join } from 'node:path';
import { readTranscript, listTranscripts } from '../../core/transcript.js';
import type { TranscriptTurn } from '../../core/types.js';
import { loadConfig } from '../config.js';

function resolveTranscriptsDir(): string {
  const cwd = process.cwd();
  const config = loadConfig();
  return join(cwd, config.transcriptsPath ?? '.slope/transcripts');
}

/**
 * slope transcript list — list available transcripts
 */
function listCommand(): void {
  const dir = resolveTranscriptsDir();
  const ids = listTranscripts(dir);

  if (ids.length === 0) {
    console.log('No transcripts found.');
    return;
  }

  // Print header
  console.log('');
  console.log(`${'Session ID'.padEnd(40)} ${'Turns'.padStart(6)}  ${'Created'.padEnd(22)} ${'Last Turn'}`);

  for (const id of ids) {
    const turns = readTranscript(dir, id);
    const turnCount = turns.length;
    const created = turns.length > 0 ? turns[0].timestamp : '—';
    const lastTurn = turns.length > 0 ? turns[turns.length - 1].timestamp : '—';
    console.log(`${id.padEnd(40)} ${String(turnCount).padStart(6)}  ${created.padEnd(22)} ${lastTurn}`);
  }
  console.log('');
}

/**
 * slope transcript show <session-id> [--tool=X] [--errors] — render turn-by-turn summary
 */
function showCommand(sessionId: string, flags: Record<string, string>): void {
  const dir = resolveTranscriptsDir();
  let turns = readTranscript(dir, sessionId);

  if (turns.length === 0) {
    console.error(`No transcript found for session: ${sessionId}`);
    process.exit(1);
  }

  // Filter by tool name
  const toolFilter = flags.tool;
  if (toolFilter) {
    turns = turns.filter(t => t.tool_calls?.some(tc => tc.tool.toLowerCase() === toolFilter.toLowerCase()));
  }

  // Filter to errors only
  if (flags.errors === 'true') {
    turns = turns.filter(t => t.outcome === 'failure' || t.tool_calls?.some(tc => !tc.success));
  }

  const red = '\x1b[31m';
  const reset = '\x1b[0m';

  console.log(`\nSession: ${sessionId} (${turns.length} turns${toolFilter ? `, tool=${toolFilter}` : ''}${flags.errors === 'true' ? ', errors only' : ''})\n`);
  console.log(`  ${'#'.padStart(3)}  ${'Tool'.padEnd(15)} ${'Outcome'.padEnd(9)} ${'Time'.padEnd(12)} ${'ms'.padEnd(6)} Note`);

  for (const turn of turns) {
    const tool = turn.tool_calls?.[0]?.tool ?? turn.role;
    const outcome = turn.outcome ?? '—';
    const ts = turn.timestamp.split('T')[1]?.slice(0, 8) ?? turn.timestamp;
    const durationMs = turn.tool_calls?.[0]?.duration_ms;
    const duration = durationMs !== undefined ? String(durationMs) : '—';
    const note = turn.outcome === 'failure' && turn.outcome_note ? `"${turn.outcome_note}"` : '';
    const failNote = !note && turn.tool_calls?.[0]?.success === false && turn.tool_calls[0].params_summary
      ? turn.tool_calls[0].params_summary
      : note;
    const isError = outcome === 'failure' || turn.tool_calls?.[0]?.success === false;
    const prefix = isError ? red : '';
    const suffix = isError ? reset : '';
    console.log(`  ${prefix}${String(turn.turn_number).padStart(3)}  ${tool.padEnd(15)} ${outcome.padEnd(9)} ${ts.padEnd(12)} ${duration.padEnd(6)} ${failNote}${suffix}`);
  }
  console.log('');
}

/**
 * slope transcript summary <session-id> [--json] — auto-generate session narrative
 */
function summaryCommand(sessionId: string, json: boolean): void {
  const dir = resolveTranscriptsDir();
  const turns = readTranscript(dir, sessionId);

  if (turns.length === 0) {
    console.error(`No transcript found for session: ${sessionId}`);
    process.exit(1);
  }

  const stats = computeStats(turns);

  // Compute most-used tool
  const sortedTools = Object.entries(stats.toolCounts).sort((a, b) => b[1] - a[1]);
  const topTool = sortedTools[0]?.[0] ?? 'unknown';
  const topToolPct = sortedTools[0] ? Math.round((sortedTools[0][1] / stats.turnCount) * 100) : 0;

  // Compute most-active area from params
  const areaCounts: Record<string, number> = {};
  for (const turn of turns) {
    for (const tc of turn.tool_calls ?? []) {
      const pathMatch = tc.params_summary?.match(/(?:src|packages|tests)\/[\w/-]+/);
      if (pathMatch) {
        const area = pathMatch[0].split('/').slice(0, 3).join('/');
        areaCounts[area] = (areaCounts[area] ?? 0) + 1;
      }
    }
  }
  const topArea = Object.entries(areaCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';

  const summary = {
    session_id: sessionId,
    turns: stats.turnCount,
    duration_min: stats.durationMin,
    tools_used: Object.keys(stats.toolCounts).length,
    top_tool: topTool,
    top_tool_pct: topToolPct,
    errors: stats.failureCount,
    retries: stats.retryCount,
    most_active_area: topArea,
    tool_breakdown: sortedTools.map(([tool, count]) => ({
      tool,
      count,
      pct: Math.round((count / stats.turnCount) * 100),
    })),
  };

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const narrative = [
    `Session ${sessionId} ran ${stats.turnCount} turns over ${stats.durationMin}m.`,
    `Used ${Object.keys(stats.toolCounts).length} tools — ${topTool} (${topToolPct}%)${sortedTools.length > 1 ? `, ${sortedTools[1][0]} (${Math.round((sortedTools[1][1] / stats.turnCount) * 100)}%)` : ''}.`,
    stats.failureCount > 0 ? `${stats.failureCount} error${stats.failureCount > 1 ? 's' : ''}.` : 'No errors.',
    `Most active area: ${topArea}.`,
  ].join(' ');

  console.log(`\n=== Session Summary ===\n`);
  console.log(`  ${narrative}\n`);

  console.log('  Tool breakdown:');
  for (const [tool, count] of sortedTools) {
    const pct = Math.round((count / stats.turnCount) * 100);
    console.log(`    ${tool.padEnd(15)} ${String(count).padStart(4)} (${pct}%)`);
  }
  console.log('');
}

/**
 * Compute stats from a set of turns.
 */
interface ToolStats {
  count: number;
  success: number;
  failure: number;
}

interface TranscriptStats {
  turnCount: number;
  durationMin: number;
  toolCounts: Record<string, number>;
  toolStats: Record<string, ToolStats>;
  successCount: number;
  failureCount: number;
  retryCount: number;
  hasTokenData: boolean;
}

function computeStats(turns: TranscriptTurn[]): TranscriptStats {
  const toolCounts: Record<string, number> = {};
  const toolStats: Record<string, ToolStats> = {};
  let successCount = 0;
  let failureCount = 0;
  let retryCount = 0;
  let hasTokenData = false;

  for (const turn of turns) {
    if (turn.input_tokens || turn.output_tokens) hasTokenData = true;
    if (turn.tool_calls) {
      for (const tc of turn.tool_calls) {
        toolCounts[tc.tool] = (toolCounts[tc.tool] ?? 0) + 1;
        if (!toolStats[tc.tool]) toolStats[tc.tool] = { count: 0, success: 0, failure: 0 };
        toolStats[tc.tool].count++;
        if (tc.success) {
          successCount++;
          toolStats[tc.tool].success++;
        } else {
          failureCount++;
          toolStats[tc.tool].failure++;
        }
      }
    }
    if (turn.outcome === 'retry') retryCount++;
  }

  let durationMin = 0;
  if (turns.length >= 2) {
    const first = new Date(turns[0].timestamp).getTime();
    const last = new Date(turns[turns.length - 1].timestamp).getTime();
    durationMin = Math.round((last - first) / 60000);
  }

  return { turnCount: turns.length, durationMin, toolCounts, toolStats, successCount, failureCount, retryCount, hasTokenData };
}

function formatStats(label: string, stats: TranscriptStats): void {
  const total = stats.successCount + stats.failureCount;
  const successRate = total > 0 ? Math.round((stats.successCount / total) * 100) : 0;
  const retryPct = total > 0 ? Math.round((stats.retryCount / total) * 100) : 0;

  console.log(`${label}`);
  console.log(`Turns: ${stats.turnCount} | Duration: ${stats.durationMin}m`);

  // Tool breakdown sorted by count descending
  const sorted = Object.entries(stats.toolCounts).sort((a, b) => b[1] - a[1]);
  const toolStr = sorted.map(([name, count]) => `${name}=${count}`).join(', ');
  console.log(`Tools: ${toolStr}`);

  console.log(`Success rate: ${successRate}% (${stats.successCount}/${total})`);
  console.log(`Retries: ${stats.retryCount} (${retryPct}%)`);

  // Per-tool success rates (only show tools with failures)
  const failingTools = Object.entries(stats.toolStats)
    .filter(([, s]) => s.failure > 0)
    .sort((a, b) => b[1].failure - a[1].failure);
  if (failingTools.length > 0) {
    console.log('Failures by tool:');
    for (const [name, s] of failingTools) {
      const rate = Math.round((s.success / s.count) * 100);
      console.log(`  ${name}: ${rate}% success (${s.failure} failed of ${s.count})`);
    }
  }

  if (!stats.hasTokenData) {
    console.log('Note: Token counts unavailable (not yet exposed by HookInput)');
  }
}

/**
 * slope transcript stats [session-id] — aggregate metrics
 */
function statsCommand(sessionId?: string): void {
  const dir = resolveTranscriptsDir();

  if (sessionId) {
    const turns = readTranscript(dir, sessionId);
    if (turns.length === 0) {
      console.error(`No transcript found for session: ${sessionId}`);
      process.exit(1);
    }
    console.log('');
    formatStats(`Session: ${sessionId}`, computeStats(turns));
    console.log('');
    return;
  }

  // Aggregate across all transcripts
  const ids = listTranscripts(dir);
  if (ids.length === 0) {
    console.log('No transcripts found.');
    return;
  }

  const allTurns: TranscriptTurn[] = [];
  for (const id of ids) {
    allTurns.push(...readTranscript(dir, id));
  }

  console.log('');
  formatStats(`All transcripts (${ids.length} sessions)`, computeStats(allTurns));
  console.log('');
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)(?:=(.+))?$/);
    if (match) flags[match[1]] = match[2] ?? 'true';
  }
  return flags;
}

export async function transcriptCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const flags = parseFlags(args.slice(1));

  switch (sub) {
    case 'list':
      listCommand();
      break;
    case 'show': {
      const sessionId = args[1];
      if (!sessionId || sessionId.startsWith('--')) {
        console.error('Usage: slope transcript show <session-id> [--tool=X] [--errors]');
        process.exit(1);
      }
      showCommand(sessionId, parseFlags(args.slice(2)));
      break;
    }
    case 'summary': {
      const sessionId = args[1];
      if (!sessionId || sessionId.startsWith('--')) {
        console.error('Usage: slope transcript summary <session-id> [--json]');
        process.exit(1);
      }
      summaryCommand(sessionId, parseFlags(args.slice(2)).json === 'true');
      break;
    }
    case 'stats':
      statsCommand(args[1]);
      break;
    default:
      console.log(`
slope transcript — View session transcript data

Usage:
  slope transcript list                          List available transcripts
  slope transcript show <id> [--tool=X] [--errors]  Turn-by-turn summary with filters
  slope transcript summary <id> [--json]         Auto-generated session narrative
  slope transcript stats [id]                    Aggregate metrics (all if no id)
`);
      if (sub) process.exit(1);
  }
}
