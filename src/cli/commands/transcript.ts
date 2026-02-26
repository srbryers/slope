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
  const transcriptsPath = (config as Record<string, unknown>).transcriptsPath as string | undefined;
  return transcriptsPath ? join(cwd, transcriptsPath) : join(cwd, '.slope', 'transcripts');
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
 * slope transcript show <session-id> — render turn-by-turn summary
 */
function showCommand(sessionId: string): void {
  const dir = resolveTranscriptsDir();
  const turns = readTranscript(dir, sessionId);

  if (turns.length === 0) {
    console.error(`No transcript found for session: ${sessionId}`);
    process.exit(1);
  }

  console.log(`\nSession: ${sessionId} (${turns.length} turns)\n`);
  console.log(`  ${'#'.padStart(3)}  ${'Tool'.padEnd(15)} ${'Outcome'.padEnd(9)} ${'Timestamp'.padEnd(12)} Note`);

  for (const turn of turns) {
    const tool = turn.tool_calls?.[0]?.tool ?? turn.role;
    const outcome = turn.outcome ?? '—';
    const ts = turn.timestamp.split('T')[1]?.slice(0, 8) ?? turn.timestamp;
    const note = turn.outcome === 'failure' && turn.outcome_note ? `"${turn.outcome_note}"` : '';
    const failNote = !note && turn.tool_calls?.[0]?.success === false && turn.tool_calls[0].params_summary
      ? turn.tool_calls[0].params_summary
      : note;
    console.log(`  ${String(turn.turn_number).padStart(3)}  ${tool.padEnd(15)} ${outcome.padEnd(9)} ${ts.padEnd(12)} ${failNote}`);
  }
  console.log('');
}

/**
 * Compute stats from a set of turns.
 */
interface TranscriptStats {
  turnCount: number;
  durationMin: number;
  toolCounts: Record<string, number>;
  successCount: number;
  failureCount: number;
  retryCount: number;
}

function computeStats(turns: TranscriptTurn[]): TranscriptStats {
  const toolCounts: Record<string, number> = {};
  let successCount = 0;
  let failureCount = 0;
  let retryCount = 0;

  for (const turn of turns) {
    if (turn.tool_calls) {
      for (const tc of turn.tool_calls) {
        toolCounts[tc.tool] = (toolCounts[tc.tool] ?? 0) + 1;
        if (tc.success) successCount++;
        else failureCount++;
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

  return { turnCount: turns.length, durationMin, toolCounts, successCount, failureCount, retryCount };
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

export async function transcriptCommand(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case 'list':
      listCommand();
      break;
    case 'show': {
      const sessionId = args[1];
      if (!sessionId) {
        console.error('Usage: slope transcript show <session-id>');
        process.exit(1);
      }
      showCommand(sessionId);
      break;
    }
    case 'stats':
      statsCommand(args[1]);
      break;
    default:
      console.log(`
slope transcript — View session transcript data

Usage:
  slope transcript list                   List available transcripts
  slope transcript show <session-id>      Show turn-by-turn summary
  slope transcript stats [session-id]     Aggregate metrics (all if no id)
`);
      if (sub) process.exit(1);
  }
}
