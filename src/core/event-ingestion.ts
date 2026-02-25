// SLOPE — Real-Time Event Ingestion
// Validate and batch-insert events from external sources.

import type { SlopeStore } from './store.js';
import type { SlopeEvent, EventType } from './types.js';

const VALID_EVENT_TYPES: ReadonlySet<string> = new Set<EventType>([
  'failure', 'dead_end', 'scope_change', 'compaction', 'hazard', 'decision', 'standup',
]);

const MAX_BATCH_SIZE = 1000;

export interface EventIngestionResult {
  inserted: SlopeEvent[];
  duplicates: number;
  errors: Array<{ index: number; message: string }>;
}

/**
 * Validate a single event payload.
 * Checks that required fields exist and types are valid.
 */
export function validateEventPayload(data: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (typeof data !== 'object' || data === null) {
    return { valid: false, errors: ['Event must be a non-null object'] };
  }

  const obj = data as Record<string, unknown>;

  if (!obj.type || typeof obj.type !== 'string') {
    errors.push('Event must have a "type" field (string)');
  } else if (!VALID_EVENT_TYPES.has(obj.type)) {
    errors.push(`Invalid event type "${obj.type}". Valid types: ${[...VALID_EVENT_TYPES].join(', ')}`);
  }

  if (obj.data !== undefined && (typeof obj.data !== 'object' || obj.data === null)) {
    errors.push('"data" field must be an object if provided');
  }

  if (obj.session_id !== undefined && typeof obj.session_id !== 'string') {
    errors.push('"session_id" must be a string if provided');
  }

  if (obj.sprint_number !== undefined && typeof obj.sprint_number !== 'number') {
    errors.push('"sprint_number" must be a number if provided');
  }

  if (obj.ticket_key !== undefined && typeof obj.ticket_key !== 'string') {
    errors.push('"ticket_key" must be a string if provided');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Ingest a batch of events into the store.
 * Validates each event, inserts valid ones, catches duplicate ID conflicts.
 */
export async function ingestEvents(
  store: SlopeStore,
  events: unknown[],
): Promise<EventIngestionResult> {
  if (events.length > MAX_BATCH_SIZE) {
    throw new Error(`Batch size ${events.length} exceeds maximum of ${MAX_BATCH_SIZE}`);
  }

  const inserted: SlopeEvent[] = [];
  let duplicates = 0;
  const errors: Array<{ index: number; message: string }> = [];

  for (let i = 0; i < events.length; i++) {
    const raw = events[i];
    const validation = validateEventPayload(raw);

    if (!validation.valid) {
      errors.push({ index: i, message: validation.errors.join('; ') });
      continue;
    }

    const obj = raw as Record<string, unknown>;

    try {
      const event = await store.insertEvent({
        type: obj.type as EventType,
        data: (obj.data as Record<string, unknown>) ?? {},
        session_id: obj.session_id as string | undefined,
        sprint_number: obj.sprint_number as number | undefined,
        ticket_key: obj.ticket_key as string | undefined,
      });
      inserted.push(event);
    } catch (err) {
      // Detect duplicate key / unique constraint violations
      if (err instanceof Error &&
          (err.message.includes('UNIQUE constraint') ||
           err.message.includes('duplicate key') ||
           err.message.includes('unique constraint'))) {
        duplicates++;
      } else {
        errors.push({ index: i, message: (err as Error).message });
      }
    }
  }

  return { inserted, duplicates, errors };
}

/**
 * Create a framework-agnostic HTTP event handler.
 * Returns a function that accepts { body } and returns { status, body }.
 */
export function createEventHandler(
  store: SlopeStore,
): (req: { body: unknown }) => Promise<{ status: number; body: unknown }> {
  return async (req) => {
    const { body } = req;

    // Accept single event or array of events
    const events = Array.isArray(body) ? body : [body];

    if (events.length > MAX_BATCH_SIZE) {
      return {
        status: 413,
        body: { error: `Batch size ${events.length} exceeds maximum of ${MAX_BATCH_SIZE}` },
      };
    }

    try {
      const result = await ingestEvents(store, events);

      return {
        status: result.errors.length > 0 ? 207 : 200,
        body: {
          inserted: result.inserted.length,
          duplicates: result.duplicates,
          errors: result.errors,
        },
      };
    } catch (err) {
      return {
        status: 500,
        body: { error: (err as Error).message },
      };
    }
  };
}
