// SLOPE — Roadmap: Strategic planning types and compute functions
// Course-level methodology — vision → roadmap → review → iteration

// --- Types ---

/** Club selection for a roadmap ticket (mirrors core ClubSelection) */
export type RoadmapClub = 'driver' | 'long_iron' | 'short_iron' | 'wedge' | 'putter';

/** A single ticket within a sprint */
export interface RoadmapTicket {
  key: string;           // e.g., "S7-1"
  id?: string;           // accepted alias for external roadmap inputs
  title: string;
  club: RoadmapClub;
  complexity: 'trivial' | 'small' | 'standard' | 'moderate';
  depends_on?: string[]; // ticket keys (intra-sprint or cross-sprint)
}

/** A sprint within the roadmap */
export interface RoadmapSprint {
  id: number;            // sprint number, e.g., 7
  theme: string;         // e.g., "The Yardage Book"
  par: 3 | 4 | 5;
  slope: number;
  type: string;          // e.g., "architecture + methodology"
  tickets: RoadmapTicket[];
  depends_on?: number[]; // sprint IDs this sprint depends on
}

/** A phase grouping sprints */
export interface RoadmapPhase {
  name: string;          // e.g., "Phase 1 — Foundation"
  sprints: number[];     // sprint IDs in this phase
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

/** Return true when a roadmap sprint should still be considered selectable work. */
export function isRoadmapSprintPending(sprint: RoadmapSprint): boolean {
  const status = (sprint as RoadmapSprint & { status?: string }).status;
  return status !== 'complete' && status !== 'superseded';
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

/** Validate a roadmap definition for structural correctness.
 *  Optionally cross-check sprint status against scorecards and/or shipped
 *  sprint commits on main when provided. Caller is responsible for collecting
 *  scorecards (via loadScorecards) and shipped IDs (via findShippedSprintsOnMain).
 */
export function validateRoadmap(
  roadmap: RoadmapDefinition,
  scorecards?: { sprint_number: number }[],
  shippedSprintIds?: Set<number>,
): RoadmapValidationResult {
  const errors: RoadmapValidationError[] = [];
  const warnings: RoadmapValidationWarning[] = [];
  const sprintIds = new Set(roadmap.sprints.map(s => s.id));

  // Context-aware encoding guard. The pure helper isEncodedInsertedSprintId
  // treats every 3-digit id >=200 ending in 5 as a legacy half-sprint
  // (435 => S43.5). That is ambiguous against ordinary sprint numbers
  // (S205..S995 also end in 5). Within a roadmap we have context: an id is a
  // real canonical sprint — not an inserted half-sprint — when it sits next to
  // integer neighbours (S204/S206 present). Only decode as a half-sprint when
  // no such neighbours exist (the genuine 43/435/44 insertion case). This keeps
  // the context-free helpers' default behaviour for callers without a roadmap
  // while preventing real S205..S995 sprints from being mis-sorted/mis-labelled.
  const decodesAsHalf = (id: number): boolean =>
    isEncodedInsertedSprintId(id) && !sprintIds.has(id - 1) && !sprintIds.has(id + 1);
  const orderOf = (id: number): number => (decodesAsHalf(id) ? sprintOrderValue(id) : id);
  const labelOf = (id: number): string => (decodesAsHalf(id) ? formatSprintLabel(id) : `S${id}`);

  // Check: at least one sprint
  if (roadmap.sprints.length === 0) {
    errors.push({ type: 'error', message: 'Roadmap has no sprints' });
    return { valid: false, errors, warnings };
  }

  // Check: sprint numbering continuity
  const sortedIds = [...sprintIds].sort((a, b) => orderOf(a) - orderOf(b));
  for (let i = 1; i < sortedIds.length; i++) {
    const prev = orderOf(sortedIds[i - 1]);
    const current = orderOf(sortedIds[i]);
    const allowedInsertedStep = current > prev && current <= Math.floor(prev) + 1;
    if (!allowedInsertedStep && current !== prev + 1) {
      errors.push({
        type: 'error',
        message: `Sprint numbering gap: ${labelOf(sortedIds[i - 1])} → ${labelOf(sortedIds[i])}`,
      });
    }
  }

  // Check: duplicate sprint IDs
  if (sprintIds.size !== roadmap.sprints.length) {
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
      const expected = `${labelOf(sprint.id)}-`;
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
          message: `Ticket ${ticketKey} does not match sprint ${labelOf(sprint.id)} (expected prefix ${expected})`,
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
      if (!sprintIds.has(dep)) {
        errors.push({
          type: 'error',
          sprint: sprint.id,
          message: `${labelOf(sprint.id)} depends on ${labelOf(dep)} which does not exist in the roadmap`,
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
    for (const sid of phase.sprints) {
      if (!sprintIds.has(sid)) {
        errors.push({
          type: 'error',
          message: `Phase "${phase.name}" references ${labelOf(sid)} which does not exist`,
        });
      }
    }
  }

  // Cross-validate sprint status against scorecards when provided
  if (scorecards) {
    const scorecardSprintIds = new Set(scorecards.map(s => s.sprint_number));

    for (const sprint of roadmap.sprints) {
      const hasScorecard = scorecardSprintIds.has(sprint.id);
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
    const TERMINAL_NOT_COMPLETE = new Set(['skipped', 'cancelled', 'cancelled-absorbed', 'absorbed']);
    for (const sprint of roadmap.sprints) {
      const status = (sprint as RoadmapSprint & { status?: string }).status;
      const isShipped = shippedSprintIds.has(sprint.id);

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
function detectCycle(sprints: RoadmapSprint[]): number[] | null {
  const visited = new Set<number>();
  const inStack = new Set<number>();
  const parent = new Map<number, number>();

  function dfs(id: number): number[] | null {
    visited.add(id);
    inStack.add(id);

    const sprint = sprints.find(s => s.id === id);
    for (const dep of sprint?.depends_on ?? []) {
      if (!visited.has(dep)) {
        parent.set(dep, id);
        const result = dfs(dep);
        if (result) return result;
      } else if (inStack.has(dep)) {
        // Build cycle path
        const cycle: number[] = [dep];
        let current = id;
        while (current !== dep) {
          cycle.push(current);
          current = parent.get(current)!;
        }
        cycle.push(dep);
        return cycle.reverse();
      }
    }

    inStack.delete(id);
    return null;
  }

  for (const sprint of sprints) {
    if (!visited.has(sprint.id)) {
      const result = dfs(sprint.id);
      if (result) return result;
    }
  }
  return null;
}

// --- Critical Path ---

export interface CriticalPathResult {
  path: number[];          // sprint IDs in order
  length: number;          // number of sprints
  totalPar: number;        // sum of par values on the path
}

/** Compute the critical path (longest dependency chain) through the roadmap */
export function computeCriticalPath(roadmap: RoadmapDefinition): CriticalPathResult {
  const sprintMap = new Map(roadmap.sprints.map(s => [s.id, s]));

  // Compute longest path ending at each sprint via topological order
  const longestTo = new Map<number, { length: number; path: number[] }>();

  // Topological sort
  const sorted = topologicalSort(roadmap.sprints);

  for (const id of sorted) {
    const sprint = sprintMap.get(id)!;
    const deps = sprint.depends_on ?? [];

    if (deps.length === 0) {
      longestTo.set(id, { length: 1, path: [id] });
    } else {
      let best = { length: 0, path: [] as number[] };
      for (const dep of deps) {
        const depPath = longestTo.get(dep);
        if (depPath && depPath.length > best.length) {
          best = depPath;
        }
      }
      longestTo.set(id, { length: best.length + 1, path: [...best.path, id] });
    }
  }

  // Find the overall longest path
  let criticalPath = { length: 0, path: [] as number[] };
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
function topologicalSort(sprints: RoadmapSprint[]): number[] {
  const inDegree = new Map<number, number>();
  const adjacency = new Map<number, number[]>();

  for (const sprint of sprints) {
    inDegree.set(sprint.id, 0);
    adjacency.set(sprint.id, []);
  }

  for (const sprint of sprints) {
    for (const dep of sprint.depends_on ?? []) {
      adjacency.get(dep)?.push(sprint.id);
      inDegree.set(sprint.id, (inDegree.get(sprint.id) ?? 0) + 1);
    }
  }

  const queue: number[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: number[] = [];
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
  sprints: number[];       // sprint IDs that can run concurrently
  reason: string;
}

/** Find sprints that can run in parallel (no mutual dependencies) */
export function findParallelOpportunities(roadmap: RoadmapDefinition): ParallelGroup[] {
  const groups: ParallelGroup[] = [];

  // Group sprints by their dependency depth (level in the DAG)
  const depthMap = computeDepthMap(roadmap.sprints);
  const byDepth = new Map<number, number[]>();

  for (const [id, depth] of depthMap) {
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    byDepth.get(depth)!.push(id);
  }

  for (const [depth, ids] of byDepth) {
    if (ids.length > 1) {
      groups.push({
        sprints: ids.sort((a, b) => a - b),
        reason: `Same dependency depth (${depth}) — no mutual dependencies`,
      });
    }
  }

  return groups;
}

/** Compute the depth (longest path from a root) of each sprint */
function computeDepthMap(sprints: RoadmapSprint[]): Map<number, number> {
  const depthMap = new Map<number, number>();
  const sprintMap = new Map(sprints.map(s => [s.id, s]));

  function getDepth(id: number): number {
    if (depthMap.has(id)) return depthMap.get(id)!;
    const sprint = sprintMap.get(id);
    const deps = sprint?.depends_on ?? [];
    const depth = deps.length === 0 ? 0 : Math.max(...deps.map(getDepth)) + 1;
    depthMap.set(id, depth);
    return depth;
  }

  for (const sprint of sprints) {
    getDepth(sprint.id);
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
    const phaseSprintIds = phase.sprints;
    const phaseSprints = roadmap.sprints.filter(s => phaseSprintIds.includes(s.id));
    lines.push(`## ${phase.name}`);
    lines.push('');
    for (const sprint of phaseSprints) {
      const deps = sprint.depends_on?.length
        ? ` (depends on: ${sprint.depends_on.map(formatSprintLabel).join(', ')})`
        : ' (no dependencies)';
      lines.push(`- **${formatSprintLabel(sprint.id)}** — ${sprint.theme} | Par ${sprint.par} | ${sprint.tickets.length} tickets${deps}`);
    }
    lines.push('');
  }

  // Critical path
  lines.push('## Critical Path');
  lines.push('');
  lines.push(`${criticalPath.path.map(formatSprintLabel).join(' → ')} (${criticalPath.length} sprints, par ${criticalPath.totalPar})`);
  lines.push('');

  // Parallel opportunities
  if (parallelGroups.length > 0) {
    lines.push('## Parallel Opportunities');
    lines.push('');
    for (const group of parallelGroups) {
      lines.push(`- ${group.sprints.map(formatSprintLabel).join(', ')}: ${group.reason}`);
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
  currentSprint: number,
): string | null {
  const sprint = roadmap.sprints.find(s => s.id === currentSprint);
  if (!sprint) return null;

  const criticalPath = computeCriticalPath(roadmap);
  const onCriticalPath = criticalPath.path.includes(currentSprint);
  const totalSprints = roadmap.sprints.length;
  const sprintIndex = roadmap.sprints.findIndex(s => s.id === currentSprint) + 1;

  // Find which phase this sprint belongs to
  const phase = roadmap.phases.find(p => p.sprints.includes(currentSprint));

  // Find what depends on this sprint
  const dependents = roadmap.sprints
    .filter(s => s.depends_on?.includes(currentSprint))
    .map(s => formatSprintLabel(s.id));

  const lines: string[] = [];
  lines.push(`Sprint ${sprintIndex} of ${totalSprints} — ${formatSprintLabel(currentSprint)}: ${sprint.theme}`);

  if (phase) {
    lines.push(`Phase: ${phase.name}`);
  }

  if (onCriticalPath) {
    lines.push(`On critical path: ${criticalPath.path.map(formatSprintLabel).join(' → ')}`);
  }

  if (dependents.length > 0) {
    lines.push(`Feeds into: ${dependents.join(', ')}`);
  }

  // Next planned sprint (dependency-resolved) — see GH #290
  const next = findNextPlannedSprint(roadmap, currentSprint);
  if (next) {
    const blockers = (next.depends_on ?? [])
      .filter(d => {
        const dep = roadmap.sprints.find(s => s.id === d);
        return !dep || (dep as RoadmapSprint & { status?: string }).status !== 'complete';
      });
    const status = blockers.length === 0
      ? 'ready'
      : `blocked by ${blockers.map(formatSprintLabel).join(', ')}`;
    lines.push(`Next: ${formatSprintLabel(next.id)}: ${next.theme} (${status})`);
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
  currentSprint: number,
): RoadmapSprint | null {
  const currentOrder = sprintOrderValue(currentSprint);
  const candidates = roadmap.sprints
    .filter(s => {
      return isRoadmapSprintPending(s) && sprintOrderValue(s.id) > currentOrder;
    })
    .sort((a, b) => compareSprintIds(a.id, b.id));

  if (candidates.length === 0) return null;

  const completedIds = new Set(
    roadmap.sprints
      .filter(s => (s as RoadmapSprint & { status?: string }).status === 'complete')
      .map(s => s.id),
  );

  // Prefer the lowest-id candidate whose dependencies are all complete
  const ready = candidates.find(s => (s.depends_on ?? []).every(d => completedIds.has(d)));
  return ready ?? candidates[0];
}
