import type { SlopeStore } from './store.js';
import type { SprintIdInput } from './sprint-id.js';
import type { SlopeEvent } from './types.js';

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
  /** Sprint the completion was recorded against. */
  sprint?: string;
  /** Commit the completion was recorded against, when one was resolved. */
  commit?: string;
  notes?: string;
  /** Who recorded it. Carried forward by repair so a correction does not
   *  reattribute the work to whoever ran the correction. */
  player?: string;
  /** True when this record superseded an earlier one via `ticket repair`. */
  repaired?: boolean;
  /** Who ran the repair, when one was run. Distinct from `player`, which
   *  stays with whoever did the work. */
  repairedBy?: string;
  /** When the completion was recorded, ISO-8601. */
  at?: string;
}

interface TicketDoneData {
  kind?: string;
  commit?: string;
  notes?: string;
  player?: string;
  repaired?: boolean;
  repaired_by?: string;
}

/** True when an event records a ticket completion. */
function isTicketDone(event: { type?: string; ticket_key?: string | null; data?: unknown }): boolean {
  return event.type === 'decision'
    && !!event.ticket_key
    && (event.data as TicketDoneData | undefined)?.kind === TICKET_DONE_KIND;
}

function toCompletion(event: SlopeEvent): TicketCompletion {
  const data = (event.data ?? {}) as TicketDoneData;
  return {
    ticketKey: event.ticket_key as string,
    ...(event.sprint_number ? { sprint: String(event.sprint_number) } : {}),
    ...(data.commit ? { commit: data.commit } : {}),
    ...(data.notes ? { notes: data.notes } : {}),
    ...(data.player ? { player: data.player } : {}),
    ...(data.repaired ? { repaired: true } : {}),
    ...(data.repaired_by ? { repairedBy: data.repaired_by } : {}),
    ...(event.timestamp ? { at: event.timestamp } : {}),
  };
}

/**
 * True when `candidate` should replace `existing` as the winning record.
 *
 * Both backends select `ORDER BY timestamp` with no secondary key, so rows
 * sharing a millisecond come back in an order neither engine guarantees.
 * Comparing the ISO-8601 timestamps directly is sound because that format
 * sorts lexicographically, and it makes the result independent of row order
 * for every case except an exact tie, where whichever row arrives last wins.
 */
function supersedes(existing: TicketCompletion | undefined, candidate: TicketCompletion): boolean {
  if (!existing) return true;
  // A record without a timestamp cannot be shown to be newer, so it loses to
  // one that has it. Both backends declare `timestamp TEXT NOT NULL` and
  // `insertEvent` always sets it, so this is defensive rather than reachable.
  if (!candidate.at) return false;
  if (!existing.at) return true;
  return candidate.at >= existing.at;
}

/** Raised when the ledger cannot be read. Callers decide whether to degrade. */
export class TicketCompletionReadError extends Error {
  constructor(readonly cause: unknown) {
    super(`could not read ticket completions: ${(cause as Error)?.message ?? String(cause)}`);
    this.name = 'TicketCompletionReadError';
  }
}

/**
 * Completions recorded for a sprint, keyed by ticket.
 *
 * A ticket completed more than once keeps the latest record, because the
 * repair path (#698) records a corrected completion rather than mutating
 * history.
 *
 * Throws `TicketCompletionReadError` when the store cannot answer. An earlier
 * cut swallowed that into an empty map, which is the exact failure mode this
 * sprint removed from the write side: every surface would then report the
 * ticket unfinished and recommend it again, with no diagnostic anywhere.
 */
export async function readTicketCompletions(
  store: SlopeStore,
  sprint: SprintIdInput,
): Promise<Map<string, TicketCompletion>> {
  let events: SlopeEvent[];
  try {
    events = await store.getEventsBySprint(sprint);
  } catch (error) {
    throw new TicketCompletionReadError(error);
  }
  const completions = new Map<string, TicketCompletion>();
  for (const event of events) {
    if (!isTicketDone(event)) continue;
    const candidate = toCompletion(event);
    if (supersedes(completions.get(candidate.ticketKey), candidate)) {
      completions.set(candidate.ticketKey, candidate);
    }
  }
  return completions;
}

/**
 * The winning completion for one ticket, found by ticket key rather than by
 * sprint.
 *
 * `ticket show` and `ticket repair` act on a ticket, not on the sprint that
 * happens to be current. Resolving through sprint state made both of them
 * report a real completion as absent the moment state advanced, which is
 * exactly when someone audits evidence. `ticket_key` is indexed in both
 * backends, so this is the cheaper read as well as the correct one.
 */
export async function readTicketCompletion(
  store: SlopeStore,
  ticketKey: string,
): Promise<TicketCompletion | undefined> {
  let events: SlopeEvent[];
  try {
    events = await store.getEventsByTicket(ticketKey);
  } catch (error) {
    throw new TicketCompletionReadError(error);
  }
  let winner: TicketCompletion | undefined;
  for (const event of events) {
    if (!isTicketDone(event)) continue;
    const candidate = toCompletion(event);
    if (supersedes(winner, candidate)) winner = candidate;
  }
  return winner;
}

/** Ticket keys completed in a sprint. The shape most callers want. */
export async function readCompletedTicketKeys(
  store: SlopeStore,
  sprint: SprintIdInput,
): Promise<Set<string>> {
  return new Set((await readTicketCompletions(store, sprint)).keys());
}

export interface NextTicketInput {
  /** Ticket keys in roadmap order. */
  tickets: readonly string[];
  /** Keys with a recorded completion. */
  completed: ReadonlySet<string>;
  /** Keys claimed by the asking actor. Their own work in flight. */
  claimedBySelf?: ReadonlySet<string>;
  /** Keys claimed by anyone else. */
  claimedByOthers?: ReadonlySet<string>;
}

export type NextTicketReason =
  | 'in_flight'
  | 'available'
  | 'all_claimed'
  | 'all_complete'
  | 'no_tickets';

export interface NextTicketResult {
  ticketKey?: string;
  reason: NextTicketReason;
}

/**
 * The one rule for "which ticket next", shared by every surface that answers it.
 *
 * The three surfaces converged on completions but kept three different claim
 * policies: `slope now` skipped every claimed ticket, `agent status` preferred
 * a claimed one (in-flight, #342) while matching claims from any player, and
 * compact roadmap status ignored claims entirely. So with a claim open they
 * still gave two different answers, which is the #697 symptom.
 *
 * Order, in full:
 *  1. Your own unfinished claim. Resuming beats starting something new, and
 *     scoping it to the asking actor stops a second agent being pointed at the
 *     ticket the first one holds.
 *  2. The first unfinished ticket nobody has claimed.
 *  3. Nothing to start. `all_claimed` means work remains but others hold it;
 *     `all_complete` means the sprint is ready for closeout. Callers need the
 *     difference: recommending "close out" on work someone else is mid-way
 *     through would be wrong.
 */
export function selectNextTicket(input: NextTicketInput): NextTicketResult {
  const { tickets, completed } = input;
  const self = input.claimedBySelf ?? new Set<string>();
  const others = input.claimedByOthers ?? new Set<string>();
  if (tickets.length === 0) return { reason: 'no_tickets' };

  const mine = tickets.find(key => self.has(key) && !completed.has(key));
  if (mine) return { ticketKey: mine, reason: 'in_flight' };

  const free = tickets.find(key => !completed.has(key) && !self.has(key) && !others.has(key));
  if (free) return { ticketKey: free, reason: 'available' };

  const unfinished = tickets.some(key => !completed.has(key));
  return { reason: unfinished ? 'all_claimed' : 'all_complete' };
}

/**
 * Completed ticket keys, or an empty set when the ledger cannot be read.
 *
 * For read-only reports that should still render without it. The caller gets
 * the error so it can say so, rather than presenting "nothing recorded" as
 * fact.
 */
export async function readCompletedTicketKeysOrEmpty(
  store: SlopeStore,
  sprint: SprintIdInput,
): Promise<{ keys: Set<string>; error?: TicketCompletionReadError }> {
  try {
    return { keys: await readCompletedTicketKeys(store, sprint) };
  } catch (error) {
    if (error instanceof TicketCompletionReadError) return { keys: new Set(), error };
    throw error;
  }
}
