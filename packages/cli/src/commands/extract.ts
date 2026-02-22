import { readFileSync } from 'node:fs';
import { resolveStore } from '../store.js';
import type { EventType } from '@slope-dev/core';

const VALID_EVENT_TYPES: EventType[] = ['failure', 'dead_end', 'scope_change', 'compaction', 'hazard', 'decision'];

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)=(.+)$/);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

interface RawEvent {
  type: string;
  data?: Record<string, unknown>;
  sprint_number?: number;
  ticket_key?: string;
}

function validateEvent(raw: unknown, index: number): RawEvent {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Event ${index}: must be an object`);
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.type !== 'string' || !VALID_EVENT_TYPES.includes(obj.type as EventType)) {
    throw new Error(`Event ${index}: invalid type "${obj.type}". Must be one of: ${VALID_EVENT_TYPES.join(', ')}`);
  }
  return {
    type: obj.type as string,
    data: (typeof obj.data === 'object' && obj.data !== null ? obj.data : {}) as Record<string, unknown>,
    sprint_number: typeof obj.sprint_number === 'number' ? obj.sprint_number : undefined,
    ticket_key: typeof obj.ticket_key === 'string' ? obj.ticket_key : undefined,
  };
}

function readFromStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);

    // Timeout after 5s if no stdin
    setTimeout(() => {
      if (!data) reject(new Error('No input received on stdin (5s timeout). Provide --file or pipe data.'));
    }, 5000);
  });
}

export async function extractCommand(args: string[]): Promise<void> {
  const opts = parseArgs(args);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  const sessionId = opts['session-id'];
  const filePath = opts['file'];
  const sprintNumber = opts['sprint'] ? parseInt(opts['sprint'], 10) : undefined;

  // Read input (file or stdin)
  let raw: string;
  if (filePath) {
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch (err) {
      console.error(`Error: Could not read file: ${filePath}`);
      process.exit(1);
    }
  } else if (!process.stdin.isTTY) {
    raw = await readFromStdin();
  } else {
    printUsage();
    process.exit(1);
    return;
  }

  // Parse JSON
  let events: unknown[];
  try {
    const parsed = JSON.parse(raw);
    events = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    console.error('Error: Input must be valid JSON (array of events or single event object)');
    process.exit(1);
    return;
  }

  // Validate events
  const validated: RawEvent[] = [];
  for (let i = 0; i < events.length; i++) {
    try {
      validated.push(validateEvent(events[i], i));
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  }

  if (validated.length === 0) {
    console.error('Error: No events to extract');
    process.exit(1);
  }

  // Write to store
  const store = await resolveStore();
  let inserted = 0;

  try {
    for (const event of validated) {
      await store.insertEvent({
        session_id: sessionId,
        type: event.type as EventType,
        data: event.data ?? {},
        sprint_number: event.sprint_number ?? sprintNumber,
        ticket_key: event.ticket_key,
      });
      inserted++;
    }
  } finally {
    store.close();
  }

  // Summary
  const typeCounts: Record<string, number> = {};
  for (const e of validated) {
    typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;
  }
  const breakdown = Object.entries(typeCounts).map(([t, c]) => `${c} ${t}`).join(', ');

  console.log(`\n  Extracted ${inserted} event(s): ${breakdown}`);
  if (sessionId) console.log(`  Session: ${sessionId}`);
  if (sprintNumber) console.log(`  Sprint: ${sprintNumber}`);
  console.log('');
}

function printUsage(): void {
  console.log(`
slope extract — Extract structured events into the SLOPE store

Usage:
  slope extract --file=<path> [--session-id=<id>] [--sprint=<N>]
  echo '[{"type":"failure","data":{"error":"build"}}]' | slope extract [--session-id=<id>]

Options:
  --file=<path>       Read events from a JSON file
  --session-id=<id>   Associate events with a session
  --sprint=<N>        Default sprint number for events without one

Event format (JSON array or single object):
  { "type": "failure|dead_end|scope_change|compaction|hazard|decision",
    "data": { ... },
    "sprint_number": 10,
    "ticket_key": "S10-1" }
`);
}
