import type { SlopeStore } from '../core/store.js';
import type { SprintIdInput } from '../core/index.js';

/**
 * Ticket completion, read from the durable events table.
 *
 * S267.6-1 asked whether a dedicated completion table was needed. It is not.
 * The `events` table is present in both the SQLite and PostgreSQL backends,
 * indexes `ticket_key`, and its `sprint_number` column was migrated to TEXT
 * alongside canonical sprint identity, so it stores `"267.10"` without
 * collapsing it to `267.1`. `slope ticket done` already writes there. What was
 * missing is a single reader, so the surfaces that decide what to do next stop
 * disagreeing (#697).
 *
 * Before this, `agent` read these events, `slope now` looked only at active
 * claims, and compact roadmap status recommended `tickets[0]` unconditionally.
 * Three answers to one question.
 */

/** Marker written into an event's `data` by `slope ticket done`. */
export const TICKET_DONE_KIND = 'ticket_done';

export interface TicketCompletion {
  ticketKey: string;
  /** Commit the completion was recorded against, when one was resolved. */
  commit?: string;
  notes?: string;
  /** When the completion was recorded, ISO-8601. */
  at?: string;
}

/** True when an event records a ticket completion. */
function isTicketDone(event: { type?: string; ticket_key?: string | null; data?: unknown }): boolean {
  return event.type === 'decision'
    && !!event.ticket_key
    && (event.data as { kind?: string } | undefined)?.kind === TICKET_DONE_KIND;
}

/**
 * Completions recorded for a sprint, keyed by ticket.
 *
 * A ticket completed more than once keeps the latest record, because the
 * repair path (#698) rewrites bad commit evidence by recording a corrected
 * completion rather than mutating history.
 *
 * Returns an empty map rather than throwing when the store has no events
 * table, so a caller on an older store degrades to its previous behaviour.
 */
export async function readTicketCompletions(
  store: SlopeStore,
  sprint: SprintIdInput,
): Promise<Map<string, TicketCompletion>> {
  const completions = new Map<string, TicketCompletion>();
  let events;
  try {
    events = await store.getEventsBySprint(sprint);
  } catch {
    return completions;
  }
  for (const event of events) {
    if (!isTicketDone(event)) continue;
    const key = event.ticket_key as string;
    const data = (event.data ?? {}) as { commit?: string; notes?: string };
    // Both store backends order by timestamp with no tiebreak, so compare
    // explicitly rather than trusting the returned order to decide which
    // record wins. On an exact tie the later row wins, matching insert order.
    const existing = completions.get(key);
    if (existing?.at && event.timestamp && existing.at > event.timestamp) continue;
    completions.set(key, {
      ticketKey: key,
      ...(data.commit ? { commit: data.commit } : {}),
      ...(data.notes ? { notes: data.notes } : {}),
      ...(event.timestamp ? { at: event.timestamp } : {}),
    });
  }
  return completions;
}

/** Ticket keys completed in a sprint. The shape most callers want. */
export async function readCompletedTicketKeys(
  store: SlopeStore,
  sprint: SprintIdInput,
): Promise<Set<string>> {
  return new Set((await readTicketCompletions(store, sprint)).keys());
}
