// SLOPE — Roadmap: Strategic planning types and compute functions
// Course-level methodology — vision → roadmap → review → iteration

import { compareSprintIdKeys, parseSprintId, sprintIdKey } from './sprint-id.js';
import type { SprintId } from './sprint-id.js';

// --- Types ---

/** Club selection for a roadmap ticket (mirrors core ClubSelection) */
export type RoadmapClub = 'driver' | 'long_iron' | 'short_iron' | 'wedge' | 'putter';

/** Canonical values plus bounded aliases retained by pre-schema roadmap history. */
export type RoadmapTicketComplexity =
  | 'trivial'
  | 'small'
  | 'standard'
  | 'moderate'
  | 'multi_package'
  | 'multi-package'
  | 'risky';

/** A single ticket within a sprint */
export interface RoadmapTicket {
  key: string;           // e.g., "S7-1"
  id?: string;           // accepted alias for external roadmap inputs
  title: string;
  club: RoadmapClub;
  complexity: RoadmapTicketComplexity;
  depends_on?: string[]; // ticket keys (intra-sprint or cross-sprint)
  /** New tickets use one issue; legacy history may retain multiple issue links. */
  github_issue?: number | number[];
  note?: string;
}

/** A sprint within the roadmap */
export interface RoadmapSprint {
  id: number;            // sprint number, e.g., 7
  /**
   * Canonical string id, present only when authored as a string to preserve an
   * exact suffix a number cannot hold (e.g. "458.10", distinct from 458.1). When
   * absent, identity derives from `id` via the roadmap-aware helpers. `id` remains
   * the numeric mirror used for ordering arithmetic and the store (GH #635).
   */
  id_key?: string;
  theme: string;         // e.g., "The Yardage Book"
  par: 3 | 4 | 5;
  slope: number;
  type: string;          // e.g., "architecture + methodology"
  tickets: RoadmapTicket[];
  depends_on?: SprintId[]; // canonical sprint IDs this sprint depends on
  status?: string;
  note?: string;
  outcome?: string;
  phase?: string;
  wave?: string;
  artifacts?: string[];
  expected_artifacts?: string[];
  research?: string[];
}

/** A phase grouping sprints */
export interface RoadmapPhase {
  name: string;          // e.g., "Phase 1 — Foundation"
  sprints: number[];     // sprint IDs in this phase (numeric mirror)
  /**
   * Canonical membership keys, present when any member was authored as a string
   * to preserve an exact suffix (e.g. "458.10" alongside "458.1"). When present,
   * this is the authoritative membership; `sprints` is the numeric mirror, which
   * cannot distinguish 458.10 from 458.1 (GH #635).
   */
  sprint_keys?: string[];
  description?: string;
  status?: string;
  note?: string;
}

/** Top-level roadmap definition */
export interface RoadmapDefinition {
  name: string;
  description?: string;
  phases: RoadmapPhase[];
  sprints: RoadmapSprint[];
}

// --- Validation ---

export interface RoadmapValidationError {
  type: 'error';
  sprint?: number;
  ticket?: string;
  message: string;
}

export interface RoadmapValidationWarning {
  type: 'warning';
  sprint?: number;
  ticket?: string;
  message: string;
}

export interface RoadmapValidationResult {
  valid: boolean;
  errors: RoadmapValidationError[];
  warnings: RoadmapValidationWarning[];
}

/** Return true for legacy encoded inserted half-sprint ids like 435 => S43.5.
 *  Decimal roadmap ids such as 75.5 are already explicit and are left as-is.
 *  The encoding is intentionally limited to pre-S100-style three-digit ids
 *  ending in 5 so ordinary post-S100 ids like 105 and 115 stay canonical.
 */
export function isEncodedInsertedSprintId(id: number): boolean {
  return Number.isInteger(id) && id >= 200 && id < 1000 && id % 10 === 5;
}

/** Numeric value used for ordering sprint ids. Encoded inserted ids sort
 *  between their surrounding canonical sprints: 435 sorts as 43.5.
 */
export function sprintOrderValue(id: number): number {
  if (isEncodedInsertedSprintId(id)) {
    return Math.floor(id / 10) + (id % 10) / 10;
  }
  return id;
}

/** Format the numeric portion of a sprint id for human-facing output. */
export function formatSprintNumber(id: number): string {
  if (isEncodedInsertedSprintId(id)) {
    return `${Math.floor(id / 10)}.${id % 10}`;
  }
  return Number.isInteger(id) ? String(id) : String(id);
}

/** Format a full sprint label, e.g. S95 or S43.5. */
export function formatSprintLabel(id: number): string {
  return `S${formatSprintNumber(id)}`;
}

/**
 * Describe why a written sprint id cannot round-trip, or null when it is fine.
 *
 * Sprint ids are stored as JSON/YAML numbers, so a decimal whose fraction ends in
 * a zero loses that zero and silently becomes a different — usually existing —
 * sprint: `458.10` reads back as `458.1`, and `458.0` as `458`. That corrupts
 * dependencies, focused context, evidence lookup and scorecard identity, and it is
 * why a phase had to be renumbered to whole sprints (GH #635).
 *
 * Takes a **string** deliberately. By the time such an id has been parsed into a
 * number the trailing zero is already gone, so the ambiguity is only detectable in
 * the text as written.
 *
 * Rejecting these is a stopgap; the durable fix is canonical string ids.
 */
export function describeSprintIdAmbiguity(written: string): string | null {
  const trimmed = written.trim();
  const body = trimmed[0]?.toLowerCase() === 's' ? trimmed.slice(1) : trimmed;
  const dot = body.indexOf('.');
  if (dot < 0) return null;

  const fraction = body.slice(dot + 1);
  if (!/^\d+$/.test(fraction) || !fraction.endsWith('0')) return null;

  const collapsed = String(Number(body));
  const suggestion = fraction.replace(/0+$/, '');
  return `sprint id ${body} cannot round-trip as a number: it reads back as `
    + `${collapsed} and would alias that sprint. Quote it to preserve the exact id `
    + `(id: "${body}"), or use a fraction with no trailing zero `
    + `(for example ${body.slice(0, dot)}.${suggestion || '1'}1) or a whole sprint id.`;
}

/** Parse human-entered sprint ids such as "114", "114.5", or "S114.5". */
export function parseSprintNumber(value: string | number): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  const trimmed = value.trim();
  const body = trimmed[0]?.toLowerCase() === 's' ? trimmed.slice(1) : trimmed;
  if (!body || body === '.' || body.startsWith('.') || body.endsWith('.')) return null;

  let seenDot = false;
  for (const char of body) {
    const code = char.charCodeAt(0);
    if (code >= 48 && code <= 57) continue;
    if (char === '.' && !seenDot) {
      seenDot = true;
      continue;
    }
    return null;
  }

  // A trailing zero in the fraction cannot round-trip through a number, so the id
  // would silently alias an existing sprint. Reject rather than corrupt (GH #635).
  if (typeof value === 'string' && describeSprintIdAmbiguity(body)) return null;

  const parsed = Number(body);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function compareSprintIds(a: number, b: number): number {
  return sprintOrderValue(a) - sprintOrderValue(b);
}

/** Return the next canonical sprint id after a completed sprint/inserted sprint. */
export function nextCanonicalSprintId(id: number): number {
  if (isEncodedInsertedSprintId(id)) {
    return Math.floor(id / 10) + 1;
  }
  if (!Number.isInteger(id)) {
    return Math.floor(id) + 1;
  }
  return id + 1;
}

export const ROADMAP_TERMINAL_STATUSES = new Set([
  'complete',
  'superseded',
  'skipped',
  'cancelled',
  'cancelled-absorbed',
  'absorbed',
]);

/**
 * Statuses that are not durably terminal but are intentionally not offered as
 * the next sprint to work on. A deferred sprint is postponed by choice — it is
 * neither done (so not terminal) nor queued work (so not selectable). It becomes
 * selectable again once its status is edited back to planned/active (GH #660).
 */
export const ROADMAP_DEFERRED_STATUSES = new Set(['deferred']);

/** Return true when a roadmap sprint has a durable terminal disposition. */
export function isRoadmapSprintTerminal(sprint: RoadmapSprint): boolean {
  return ROADMAP_TERMINAL_STATUSES.has(sprint.status ?? '');
}

/**
 * Return true when a roadmap sprint should still be considered selectable work —
 * the pool the "next sprint" pickers, rollover target, and current-sprint
 * inference draw from. Excludes both terminal statuses and deferred (a
 * deliberately postponed sprint must not be surfaced as the next thing to do).
 */
export function isRoadmapSprintPending(sprint: RoadmapSprint): boolean {
  return !isRoadmapSprintTerminal(sprint)
    && !ROADMAP_DEFERRED_STATUSES.has(sprint.status ?? '');
}

type RoadmapTicketInput = Partial<RoadmapTicket> & { id?: unknown; key?: unknown };

export function getRoadmapTicketKey(ticket: RoadmapTicketInput): string | null {
  const key = ticket.key;
  if (typeof key === 'string' && key.trim()) return key.trim();

  const id = ticket.id;
  if (typeof id === 'string' && id.trim()) return id.trim();

  return null;
}

function normalizeRoadmapTicket(ticket: RoadmapTicket): RoadmapTicket {
  const key = getRoadmapTicketKey(ticket);
  return key ? { ...ticket, key } : ticket;
}

function normalizeRoadmap(roadmap: RoadmapDefinition): RoadmapDefinition {
  return {
    ...roadmap,
    sprints: (roadmap.sprints ?? []).map(sprint => ({
      ...sprint,
      tickets: (sprint.tickets ?? []).map(normalizeRoadmapTicket),
    })),
  };
}

/** Resolve legacy encoded half-sprint IDs using evidence from one roadmap. */
export function isEncodedInsertedSprintInRoadmap(roadmap: RoadmapDefinition, id: number): boolean {
  if (!isEncodedInsertedSprintId(id)) return false;

  const sprintIds = new Set(roadmap.sprints.map(sprint => sprint.id));
  const sprint = roadmap.sprints.find(candidate => candidate.id === id);
  const canonicalPrefix = `S${id}-`;
  const encodedPrefix = `${formatSprintLabel(id)}-`;
  const ticketKeys = sprint?.tickets.map(getRoadmapTicketKey).filter((key): key is string => key !== null) ?? [];

  if (ticketKeys.some(key => key.startsWith(canonicalPrefix))) return false;
  if (ticketKeys.some(key => key.startsWith(encodedPrefix))) return true;
  if (sprintIds.has(id - 1) || sprintIds.has(id + 1)) return false;

  const base = Math.floor(id / 10);
  return sprintIds.has(base) || sprintIds.has(base + 1);
}

export function roadmapSprintOrderValue(roadmap: RoadmapDefinition, id: SprintId): number {
  const key = roadmapSprintKeyFromId(roadmap, id);
  const parsed = key ? parseSprintId(key) : null;
  if (!parsed) return typeof id === 'number' ? id : Number(id);
  if (parsed.insert === null) return parsed.base;
  return parsed.base + parsed.insert / (10 ** parsed.insertDigits!.length);
}

export function compareRoadmapSprintIds(roadmap: RoadmapDefinition, a: SprintId, b: SprintId): number {
  const ka = roadmapSprintKeyFromId(roadmap, a) ?? String(a);
  const kb = roadmapSprintKeyFromId(roadmap, b) ?? String(b);
  return compareSprintIdKeys(ka, kb);
}

export function formatRoadmapSprintLabel(roadmap: RoadmapDefinition, id: SprintId): string {
  return `S${roadmapSprintKeyFromId(roadmap, id) ?? id}`;
}

/**
 * Canonical string identity for a sprint: the authored `id_key` when present
 * (preserving an exact suffix), else derived from the numeric `id` with the same
 * roadmap-aware legacy decode as the label. This is THE identity for a sprint —
 * use it wherever `458.10` must stay distinct from `458.1` (GH #635).
 */
export function roadmapSprintKey(roadmap: RoadmapDefinition, sprint: RoadmapSprint): string {
  if (sprint.id_key) return sprint.id_key;
  return isEncodedInsertedSprintInRoadmap(roadmap, sprint.id)
    ? formatSprintNumber(sprint.id)
    : String(sprint.id);
}

/** Resolve a canonical sprint key from either a key or a legacy numeric mirror. */
export function roadmapSprintKeyFromId(roadmap: RoadmapDefinition, id: SprintId): string | null {
  const inputKey = sprintIdKey(id);
  if (inputKey === null) return null;

  const canonical = roadmap.sprints.find(sprint => roadmapSprintKey(roadmap, sprint) === inputKey);
  if (canonical) return roadmapSprintKey(roadmap, canonical);

  const mirror = roadmap.sprints.find(sprint => sprint.id === Number(inputKey));
  return mirror ? roadmapSprintKey(roadmap, mirror) : inputKey;
}

/** Find one roadmap sprint by canonical key, with numeric mirrors as legacy input. */
export function findRoadmapSprint(
  roadmap: RoadmapDefinition,
  id: SprintId,
): RoadmapSprint | undefined {
  const key = roadmapSprintKeyFromId(roadmap, id);
  return key == null
    ? undefined
    : roadmap.sprints.find(sprint => roadmapSprintKey(roadmap, sprint) === key);
}

/** Validate a roadmap definition for structural correctness.
 *  Optionally cross-check sprint status against scorecards and/or shipped
 *  sprint commits on main when provided. Caller is responsible for collecting
 *  scorecards (via loadScorecards) and shipped IDs (via findShippedSprintsOnMain).
 */
export function validateRoadmap(
  roadmap: RoadmapDefinition,
  scorecards?: { sprint_number: SprintId }[],
  shippedSprintIds?: ReadonlySet<SprintId>,
): RoadmapValidationResult {
  const errors: RoadmapValidationError[] = [];
  const warnings: RoadmapValidationWarning[] = [];
  const sprintIds = new Set(roadmap.sprints.map(s => roadmapSprintKey(roadmap, s)));

  const orderOf = (id: SprintId): number => roadmapSprintOrderValue(roadmap, id);
  const labelOf = (id: SprintId): string => formatRoadmapSprintLabel(roadmap, id);
  // Canonical identity so 458.10 and 458.1 are distinct sprints with distinct
  // ticket-key prefixes (GH #635).
  const keyLabelOf = (sprint: RoadmapSprint): string => `S${roadmapSprintKey(roadmap, sprint)}`;

  // Check: at least one sprint
  if (roadmap.sprints.length === 0) {
    errors.push({ type: 'error', message: 'Roadmap has no sprints' });
    return { valid: false, errors, warnings };
  }

  // Check: sprint numbering continuity
  const sortedIds = [...sprintIds].sort((a, b) => compareSprintIdKeys(a, b));
  for (let i = 1; i < sortedIds.length; i++) {
    const prev = orderOf(sortedIds[i - 1]);
    const current = orderOf(sortedIds[i]);
    const allowedInsertedStep = current > prev && current <= Math.floor(prev) + 1;
    if (!allowedInsertedStep && current !== prev + 1) {
      // A long-lived roadmap legitimately skips numbers as sprints are
      // absorbed, cancelled, or renumbered, so a numbering discontinuity is
      // informational rather than a structural error. Genuinely-structural
      // problems (duplicate ids, dangling deps, cycles, bad par, ticket/phase
      // mismatches) remain hard errors below.
      warnings.push({
        type: 'warning',
        message: `Sprint numbering gap: ${labelOf(sortedIds[i - 1])} → ${labelOf(sortedIds[i])}`,
      });
    }
  }

  // Check: duplicate sprint IDs — by canonical key, so 458.10 and 458.1 are not
  // reported as duplicates even though their numeric mirror collides (GH #635).
  const canonicalKeys = new Set(roadmap.sprints.map(s => roadmapSprintKey(roadmap, s)));
  if (canonicalKeys.size !== roadmap.sprints.length) {
    errors.push({ type: 'error', message: 'Duplicate sprint IDs detected' });
  }

  // Build a set of all ticket keys across all sprints for cross-sprint dependency validation
  const allTicketKeys = new Set(
    roadmap.sprints.flatMap(s =>
      s.tickets.map(getRoadmapTicketKey).filter((key): key is string => key !== null),
    ),
  );

  for (const sprint of roadmap.sprints) {
    // Check: ticket count (3-4 per sprint)
    if (sprint.tickets.length < 3) {
      warnings.push({
        type: 'warning',
        sprint: sprint.id,
        message: `${labelOf(sprint.id)} has ${sprint.tickets.length} tickets (recommended 3-4)`,
      });
    }
    if (sprint.tickets.length > 4) {
      warnings.push({
        type: 'warning',
        sprint: sprint.id,
        message: `${labelOf(sprint.id)} has ${sprint.tickets.length} tickets (recommended 3-4)`,
      });
    }

    // Check: ticket key format matches sprint
    for (const ticket of sprint.tickets) {
      const expected = `${keyLabelOf(sprint)}-`;
      const ticketKey = getRoadmapTicketKey(ticket);
      if (!ticketKey) {
        errors.push({
          type: 'error',
          sprint: sprint.id,
          message: `Ticket in ${labelOf(sprint.id)} is missing key/id`,
        });
        continue;
      }

      if (!ticketKey.startsWith(expected)) {
        errors.push({
          type: 'error',
          sprint: sprint.id,
          ticket: ticketKey,
          message: `Ticket ${ticketKey} does not match sprint ${keyLabelOf(sprint)} (expected prefix ${expected})`,
        });
      }
    }

    // Check: ticket dependencies exist (intra-sprint or cross-sprint)
    for (const ticket of sprint.tickets) {
      const ticketKey = getRoadmapTicketKey(ticket);
      if (!ticketKey) continue;

      for (const dep of ticket.depends_on ?? []) {
        if (!allTicketKeys.has(dep)) {
          errors.push({
            type: 'error',
            sprint: sprint.id,
            ticket: ticketKey,
            message: `Ticket ${ticketKey} depends on ${dep} which does not exist in the roadmap`,
          });
        }
      }
    }

    // Check: sprint dependencies exist
    for (const dep of sprint.depends_on ?? []) {
      const depKey = roadmapSprintKeyFromId(roadmap, dep);
      if (depKey === null || !sprintIds.has(depKey)) {
        errors.push({
          type: 'error',
          sprint: sprint.id,
          message: `${labelOf(roadmapSprintKey(roadmap, sprint))} depends on ${labelOf(dep)} which does not exist in the roadmap`,
        });
      }
    }

    // Check: par range
    if (sprint.par < 3 || sprint.par > 5) {
      errors.push({
        type: 'error',
        sprint: sprint.id,
        message: `${labelOf(sprint.id)} has invalid par ${sprint.par} (must be 3, 4, or 5)`,
      });
    }
  }

  // Check: dependency cycles across sprints
  const cycle = detectCycle(roadmap.sprints);
  if (cycle) {
    errors.push({
      type: 'error',
      message: `Dependency cycle detected: ${cycle.map(labelOf).join(' → ')}`,
    });
  }

  // Check: phases reference valid sprint IDs
  for (const phase of roadmap.phases) {
    const phaseSprintIds: SprintId[] = phase.sprint_keys ?? phase.sprints;
    for (const sid of phaseSprintIds) {
      const sidKey = roadmapSprintKeyFromId(roadmap, sid);
      if (sidKey === null || !sprintIds.has(sidKey)) {
        errors.push({
          type: 'error',
          message: `Phase "${phase.name}" references ${labelOf(sid)} which does not exist`,
        });
      }
    }
  }

  // Cross-validate sprint status against scorecards when provided
  if (scorecards) {
    const scorecardSprintIds = new Set(
      scorecards.map(s => roadmapSprintKeyFromId(roadmap, s.sprint_number)),
    );

    for (const sprint of roadmap.sprints) {
      const hasScorecard = scorecardSprintIds.has(roadmapSprintKey(roadmap, sprint));
      const status = (sprint as RoadmapSprint & { status?: string }).status;

      if (hasScorecard && status !== 'complete') {
        warnings.push({
          type: 'warning',
          sprint: sprint.id,
          message: `${labelOf(sprint.id)} has a scorecard but roadmap status is "${status ?? 'planned'}" — expected "complete"`,
        });
      }

      if (!hasScorecard && status === 'complete') {
        warnings.push({
          type: 'warning',
          sprint: sprint.id,
          message: `${labelOf(sprint.id)} is marked "complete" in roadmap but no scorecard exists (phantom sprint)`,
        });
      }
    }
  }

  // Cross-validate sprint status against shipped commits on main when provided
  if (shippedSprintIds) {
    // A sprint can legitimately be skipped or cancelled/absorbed yet still be
    // *mentioned* in commit subjects (e.g. "feat: add S72 sprint" — roadmap
    // bookkeeping, not a feature ship). Treat those terminal-but-not-complete
    // statuses as final rather than demanding "complete".
    const TERMINAL_NOT_COMPLETE = new Set(['superseded', 'skipped', 'cancelled', 'cancelled-absorbed', 'absorbed']);
    for (const sprint of roadmap.sprints) {
      const status = (sprint as RoadmapSprint & { status?: string }).status;
      const key = roadmapSprintKey(roadmap, sprint);
      const isShipped = shippedSprintIds.has(key) || shippedSprintIds.has(sprint.id);

      if (isShipped && status !== 'complete' && !TERMINAL_NOT_COMPLETE.has(status ?? '')) {
        errors.push({
          type: 'error',
          sprint: sprint.id,
          message: `${labelOf(sprint.id)} has shipped commits on main but status is "${status ?? 'planned'}" — expected "complete"`,
        });
      }

      if (!isShipped && status === 'complete') {
        warnings.push({
          type: 'warning',
          sprint: sprint.id,
          message: `${labelOf(sprint.id)} is marked "complete" but no shipped commits found on main`,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// --- Dependency Graph ---

/** Detect cycles in sprint dependency graph. Returns cycle path or null. */
function detectCycle(sprints: RoadmapSprint[]): string[] | null {
  const roadmap = { name: '', phases: [], sprints };
  const sprintMap = new Map(sprints.map(sprint => [roadmapSprintKey(roadmap, sprint), sprint]));
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const parent = new Map<string, string>();

  function dfs(id: string): string[] | null {
    visited.add(id);
    inStack.add(id);

    const sprint = sprintMap.get(id);
    for (const dep of sprint?.depends_on ?? []) {
      const depKey = roadmapSprintKeyFromId(roadmap, dep);
      if (depKey === null) continue;
      if (!visited.has(depKey)) {
        parent.set(depKey, id);
        const result = dfs(depKey);
        if (result) return result;
      } else if (inStack.has(depKey)) {
        // Build cycle path
        const cycle: string[] = [depKey];
        let current = id;
        while (current !== depKey) {
          cycle.push(current);
          current = parent.get(current)!;
        }
        cycle.push(depKey);
        return cycle.reverse();
      }
    }

    inStack.delete(id);
    return null;
  }

  for (const sprint of sprints) {
    const key = roadmapSprintKey(roadmap, sprint);
    if (!visited.has(key)) {
      const result = dfs(key);
      if (result) return result;
    }
  }
  return null;
}

// --- Critical Path ---

export interface CriticalPathResult {
  path: string[];          // canonical sprint IDs in order
  length: number;          // number of sprints
  totalPar: number;        // sum of par values on the path
}

/** Compute the critical path (longest dependency chain) through the roadmap */
export function computeCriticalPath(roadmap: RoadmapDefinition): CriticalPathResult {
  const sprintMap = new Map(roadmap.sprints.map(s => [roadmapSprintKey(roadmap, s), s]));

  // Compute longest path ending at each sprint via topological order
  const longestTo = new Map<string, { length: number; path: string[] }>();

  // Topological sort
  const sorted = topologicalSort(roadmap.sprints);

  for (const id of sorted) {
    const sprint = sprintMap.get(id)!;
    const deps = sprint.depends_on ?? [];

    if (deps.length === 0) {
      longestTo.set(id, { length: 1, path: [id] });
    } else {
      let best = { length: 0, path: [] as string[] };
      for (const dep of deps) {
        const depKey = roadmapSprintKeyFromId(roadmap, dep);
        const depPath = depKey ? longestTo.get(depKey) : undefined;
        if (depPath && depPath.length > best.length) {
          best = depPath;
        }
      }
      longestTo.set(id, { length: best.length + 1, path: [...best.path, id] });
    }
  }

  // Find the overall longest path
  let criticalPath = { length: 0, path: [] as string[] };
  for (const entry of longestTo.values()) {
    if (entry.length > criticalPath.length) {
      criticalPath = entry;
    }
  }

  const totalPar = criticalPath.path.reduce((sum, id) => {
    const sprint = sprintMap.get(id);
    return sum + (sprint?.par ?? 0);
  }, 0);

  return {
    path: criticalPath.path,
    length: criticalPath.length,
    totalPar,
  };
}

/** Topological sort of sprints by dependency order */
function topologicalSort(sprints: RoadmapSprint[]): string[] {
  const roadmap = { name: '', phases: [], sprints };
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const sprint of sprints) {
    const key = roadmapSprintKey(roadmap, sprint);
    inDegree.set(key, 0);
    adjacency.set(key, []);
  }

  for (const sprint of sprints) {
    const key = roadmapSprintKey(roadmap, sprint);
    for (const dep of sprint.depends_on ?? []) {
      const depKey = roadmapSprintKeyFromId(roadmap, dep);
      if (depKey === null) continue;
      adjacency.get(depKey)?.push(key);
      inDegree.set(key, (inDegree.get(key) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);
    for (const neighbor of adjacency.get(id) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  return sorted;
}

// --- Parallel Opportunities ---

export interface ParallelGroup {
  sprints: string[];       // canonical sprint IDs that can run concurrently
  reason: string;
}

/** Find sprints that can run in parallel (no mutual dependencies) */
export function findParallelOpportunities(roadmap: RoadmapDefinition): ParallelGroup[] {
  const groups: ParallelGroup[] = [];

  // Group sprints by their dependency depth (level in the DAG)
  const depthMap = computeDepthMap(roadmap.sprints);
  const byDepth = new Map<number, string[]>();

  for (const [id, depth] of depthMap) {
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    byDepth.get(depth)!.push(id);
  }

  for (const [depth, ids] of byDepth) {
    if (ids.length > 1) {
      groups.push({
        sprints: ids.sort(compareSprintIdKeys),
        reason: `Same dependency depth (${depth}) — no mutual dependencies`,
      });
    }
  }

  return groups;
}

/** Compute the depth (longest path from a root) of each sprint */
function computeDepthMap(sprints: RoadmapSprint[]): Map<string, number> {
  const roadmap = { name: '', phases: [], sprints };
  const depthMap = new Map<string, number>();
  const sprintMap = new Map(sprints.map(s => [roadmapSprintKey(roadmap, s), s]));

  function getDepth(id: string): number {
    if (depthMap.has(id)) return depthMap.get(id)!;
    const sprint = sprintMap.get(id);
    const deps = sprint?.depends_on ?? [];
    const depKeys = deps
      .map(dep => roadmapSprintKeyFromId(roadmap, dep))
      .filter((dep): dep is string => dep !== null);
    const depth = depKeys.length === 0 ? 0 : Math.max(...depKeys.map(getDepth)) + 1;
    depthMap.set(id, depth);
    return depth;
  }

  for (const sprint of sprints) {
    getDepth(roadmapSprintKey(roadmap, sprint));
  }

  return depthMap;
}

// --- Parse ---

/** Cast a raw JSON object to RoadmapDefinition if minimally structurally valid.
 *  Unlike parseRoadmap, this does not run full validation — useful when callers
 *  want to flag validation issues against a structurally-cast roadmap (e.g.
 *  drift detection should still run when ticket counts or numbering are off).
 */
export function castRoadmapStructure(json: unknown): RoadmapDefinition | null {
  if (!json || typeof json !== 'object') return null;
  const obj = json as Record<string, unknown>;
  if (typeof obj.name !== 'string') return null;
  if (!Array.isArray(obj.sprints)) return null;
  if (!Array.isArray(obj.phases)) return null;
  return normalizeRoadmap(obj as unknown as RoadmapDefinition);
}

/** Parse and validate a roadmap from a JSON object */
export function parseRoadmap(json: unknown): { roadmap: RoadmapDefinition | null; validation: RoadmapValidationResult } {
  // Type guard: check minimal structure with explicit per-field error messages
  if (!json || typeof json !== 'object') {
    return {
      roadmap: null,
      validation: { valid: false, errors: [{ type: 'error', message: 'Input is not an object' }], warnings: [] },
    };
  }
  const obj = json as Record<string, unknown>;
  if (typeof obj.name !== 'string') {
    return {
      roadmap: null,
      validation: { valid: false, errors: [{ type: 'error', message: 'Missing required field: name' }], warnings: [] },
    };
  }
  if (!Array.isArray(obj.sprints)) {
    return {
      roadmap: null,
      validation: { valid: false, errors: [{ type: 'error', message: 'Missing required field: sprints (must be an array)' }], warnings: [] },
    };
  }
  if (!Array.isArray(obj.phases)) {
    return {
      roadmap: null,
      validation: { valid: false, errors: [{ type: 'error', message: 'Missing required field: phases (must be an array)' }], warnings: [] },
    };
  }

  const roadmap = normalizeRoadmap(obj as unknown as RoadmapDefinition);
  const validation = validateRoadmap(roadmap);
  return { roadmap: validation.valid ? roadmap : null, validation };
}

// --- Format ---

/** Format a roadmap summary as markdown */
export function formatRoadmapSummary(roadmap: RoadmapDefinition): string {
  const lines: string[] = [];
  const criticalPath = computeCriticalPath(roadmap);
  const parallelGroups = findParallelOpportunities(roadmap);
  const totalTickets = roadmap.sprints.reduce((sum, s) => sum + s.tickets.length, 0);
  const totalPar = roadmap.sprints.reduce((sum, s) => sum + s.par, 0);

  lines.push(`# ${roadmap.name}`);
  if (roadmap.description) lines.push('', roadmap.description);
  lines.push('');

  // Phases
  for (const phase of roadmap.phases) {
    const phaseSprintIds: SprintId[] = phase.sprint_keys ?? phase.sprints;
    const phaseSprintKeys = new Set(
      phaseSprintIds.map(id => roadmapSprintKeyFromId(roadmap, id)),
    );
    const phaseSprints = roadmap.sprints.filter(
      sprint => phaseSprintKeys.has(roadmapSprintKey(roadmap, sprint)),
    );
    lines.push(`## ${phase.name}`);
    lines.push('');
    for (const sprint of phaseSprints) {
      const deps = sprint.depends_on?.length
        ? ` (depends on: ${sprint.depends_on.map(id => formatRoadmapSprintLabel(roadmap, id)).join(', ')})`
        : ' (no dependencies)';
      lines.push(`- **${formatRoadmapSprintLabel(roadmap, roadmapSprintKey(roadmap, sprint))}** — ${sprint.theme} | Par ${sprint.par} | ${sprint.tickets.length} tickets${deps}`);
    }
    lines.push('');
  }

  // Critical path
  lines.push('## Critical Path');
  lines.push('');
  lines.push(`${criticalPath.path.map(id => formatRoadmapSprintLabel(roadmap, id)).join(' → ')} (${criticalPath.length} sprints, par ${criticalPath.totalPar})`);
  lines.push('');

  // Parallel opportunities
  if (parallelGroups.length > 0) {
    lines.push('## Parallel Opportunities');
    lines.push('');
    for (const group of parallelGroups) {
      lines.push(`- ${group.sprints.map(id => formatRoadmapSprintLabel(roadmap, id)).join(', ')}: ${group.reason}`);
    }
    lines.push('');
  }

  // Summary
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Sprints | Tickets | Total Par |`);
  lines.push(`|---------|---------|-----------|`);
  lines.push(`| ${roadmap.sprints.length} | ${totalTickets} | ${totalPar} |`);
  lines.push('');

  return lines.join('\n');
}

/** Format strategic context for briefings — concise 3-5 line summary */
export function formatStrategicContext(
  roadmap: RoadmapDefinition,
  currentSprint: SprintId,
): string | null {
  const sprint = findRoadmapSprint(roadmap, currentSprint);
  if (!sprint) return null;
  const resolvedSprint = roadmapSprintKey(roadmap, sprint);

  const criticalPath = computeCriticalPath(roadmap);
  const onCriticalPath = criticalPath.path.includes(resolvedSprint);
  const totalSprints = roadmap.sprints.length;
  const sprintIndex = roadmap.sprints.findIndex(s => roadmapSprintKey(roadmap, s) === resolvedSprint) + 1;

  // Find which phase this sprint belongs to
  const phase = roadmap.phases.find(p => {
    const keys: SprintId[] = p.sprint_keys ?? p.sprints;
    return keys.some(id => roadmapSprintKeyFromId(roadmap, id) === resolvedSprint);
  });

  // Find what depends on this sprint
  const dependents = roadmap.sprints
    .filter(s => s.depends_on?.some(id => roadmapSprintKeyFromId(roadmap, id) === resolvedSprint))
    .map(s => formatRoadmapSprintLabel(roadmap, roadmapSprintKey(roadmap, s)));

  const lines: string[] = [];
  lines.push(`Sprint ${sprintIndex} of ${totalSprints} — ${formatRoadmapSprintLabel(roadmap, resolvedSprint)}: ${sprint.theme}`);

  if (phase) {
    lines.push(`Phase: ${phase.name}`);
  }

  if (onCriticalPath) {
    lines.push(`On critical path: ${criticalPath.path.map(id => formatRoadmapSprintLabel(roadmap, id)).join(' → ')}`);
  }

  if (dependents.length > 0) {
    lines.push(`Feeds into: ${dependents.join(', ')}`);
  }

  // Next planned sprint (dependency-resolved) — see GH #290
  const next = findNextPlannedSprint(roadmap, resolvedSprint);
  if (next) {
    const blockers = (next.depends_on ?? [])
      .filter(d => {
        const depOrder = roadmapSprintOrderValue(roadmap, d);
        const dep = roadmap.sprints.find(s => roadmapSprintOrderValue(roadmap, s.id) === depOrder);
        return !dep || (dep as RoadmapSprint & { status?: string }).status !== 'complete';
      });
    const status = blockers.length === 0
      ? 'ready'
      : `blocked by ${blockers.map(id => formatRoadmapSprintLabel(roadmap, id)).join(', ')}`;
    lines.push(`Next: ${formatRoadmapSprintLabel(roadmap, next.id)}: ${next.theme} (${status})`);
  }

  return lines.join('\n');
}

/** Find the next planned sprint after currentSprint.
 *  Prefers a sprint with all dependencies satisfied (status:complete);
 *  falls back to the lowest-id non-complete sprint when nothing is unblocked.
 *  Returns null if no candidate found.
 */
export function findNextPlannedSprint(
  roadmap: RoadmapDefinition,
  currentSprint: SprintId,
): RoadmapSprint | null {
  const currentKey = roadmapSprintKeyFromId(roadmap, currentSprint);
  if (currentKey === null) return null;
  const candidates = roadmap.sprints
    .filter(s => {
      return isRoadmapSprintPending(s)
        && compareSprintIdKeys(roadmapSprintKey(roadmap, s), currentKey) > 0;
    })
    .sort((a, b) => compareSprintIdKeys(
      roadmapSprintKey(roadmap, a),
      roadmapSprintKey(roadmap, b),
    ));

  if (candidates.length === 0) return null;

  const completedIds = new Set(
    roadmap.sprints
      .filter(s => (s as RoadmapSprint & { status?: string }).status === 'complete')
      .map(s => roadmapSprintKey(roadmap, s)),
  );

  // Prefer the lowest-id candidate whose dependencies are all complete
  const ready = candidates.find(s =>
    (s.depends_on ?? []).every(d => {
      const key = roadmapSprintKeyFromId(roadmap, d);
      return key !== null && completedIds.has(key);
    }));
  return ready ?? candidates[0];
}
