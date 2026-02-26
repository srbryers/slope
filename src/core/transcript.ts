// SLOPE — Session Transcript Tracking (JSONL)
// Metadata-only tool call transcripts: append-only JSONL files per session.

import { readFileSync, appendFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { TranscriptTurn, TranscriptLine } from './types.js';

/**
 * Resolve the JSONL file path for a session transcript.
 * Creates the transcripts directory if it doesn't exist.
 */
export function getTranscriptPath(transcriptsDir: string, sessionId: string): string {
  if (!existsSync(transcriptsDir)) {
    mkdirSync(transcriptsDir, { recursive: true });
  }
  return join(transcriptsDir, `${sessionId}.jsonl`);
}

/**
 * Append a single turn to a session transcript (sync, append-only).
 * Creates the file and directory if they don't exist.
 */
export function appendTurn(transcriptsDir: string, sessionId: string, line: TranscriptLine): void {
  const filePath = getTranscriptPath(transcriptsDir, sessionId);
  appendFileSync(filePath, JSON.stringify(line) + '\n');
}

/**
 * Read all turns from a session transcript.
 * Assigns turn_number from line index (1-indexed).
 * Returns empty array if file doesn't exist or is empty.
 */
export function readTranscript(transcriptsDir: string, sessionId: string): TranscriptTurn[] {
  const filePath = join(transcriptsDir, `${sessionId}.jsonl`);
  if (!existsSync(filePath)) return [];

  const content = readFileSync(filePath, 'utf8').trim();
  if (!content) return [];

  return content.split('\n').map((line, index) => {
    const parsed: TranscriptLine = JSON.parse(line);
    return { turn_number: index + 1, ...parsed };
  });
}

/**
 * List all session IDs that have transcripts.
 * Returns session IDs sorted by file modification time (newest first).
 */
export function listTranscripts(transcriptsDir: string): string[] {
  if (!existsSync(transcriptsDir)) return [];

  const files = readdirSync(transcriptsDir).filter(f => f.endsWith('.jsonl'));
  // Sort by mtime descending (newest first)
  return files
    .map(f => ({
      name: f.replace('.jsonl', ''),
      mtime: statSync(join(transcriptsDir, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime)
    .map(f => f.name);
}
