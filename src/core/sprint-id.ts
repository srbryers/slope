// Canonical sprint identity.
//
// Sprint ids like 458.1 are stored as JavaScript numbers, so 458.10 collapses to
// 458.1 and 458.0 to 458 — distinct planned sprints silently alias existing ones
// (GH #635). This module represents a sprint id as a canonical STRING that
// preserves the exact authored suffix, so 458.10 and 458.1 stay distinct, plus a
// structured form for correct ordering.
//
// Authoring note: a trailing-zero decimal (458.10) cannot survive a YAML/JSON
// number, so it must be authored as a quoted string. Whole sprints and
// non-trailing-zero decimals may still be authored as numbers.
//
// The number path here is deliberately literal — String(number) — and does NOT
// apply the legacy 435 => S43.5 encoding. That decode needs roadmap evidence (a
// plain 245 could be S245 or S24.5) and lives in the roadmap layer
// (isEncodedInsertedSprintInRoadmap / formatRoadmapSprintLabel).

/** Canonical sprint identity used by persisted records and public outputs. */
export type SprintId = string;

/** Compatibility input accepted only at documented read boundaries. */
export type SprintIdInput = SprintId | number;

export interface SprintIdParts {
  /** Whole-sprint base, e.g. 458. */
  base: number;
  /** Inserted-sprint suffix as an integer (10 for ".10"), or null for a whole sprint. */
  insert: number | null;
  /** Exact fractional digits as authored ("10", "5"), or null. Preserves 458.10 vs 458.1. */
  insertDigits: string | null;
  /** Canonical string key: "458", "458.10", "143.5". */
  key: SprintId;
}

/**
 * Canonical string key for a sprint id, or null when the value is not a valid id.
 *
 * A string is preserved exactly (after stripping a leading `S` and whitespace),
 * so trailing zeros survive. A number is rendered literally.
 */
export function sprintIdKey(value: SprintIdInput): SprintId | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    return String(value);
  }

  const trimmed = value.trim();
  const body = trimmed[0]?.toLowerCase() === 's' ? trimmed.slice(1) : trimmed;
  if (!/^\d+(?:\.\d+)?$/.test(body)) return null;
  if (Number(body) <= 0) return null;
  return body;
}

/** Parse an authored sprint id (string or number) into canonical parts, or null. */
export function parseSprintId(value: SprintIdInput): SprintIdParts | null {
  const key = sprintIdKey(value);
  if (key === null) return null;

  const dot = key.indexOf('.');
  if (dot < 0) {
    return { base: Number(key), insert: null, insertDigits: null, key };
  }

  const insertDigits = key.slice(dot + 1);
  return {
    base: Number(key.slice(0, dot)),
    insert: Number(insertDigits),
    insertDigits,
    key,
  };
}

/**
 * Order two canonical keys. A whole sprint sorts before its inserts; inserts sort
 * by their integer value, so .9 precedes .10 (not the reverse a string sort would
 * give). Distinct keys with the same numeric value (.5 vs .05) break the tie by
 * their digit string so ordering stays total.
 */
export function compareSprintIdKeys(a: SprintIdInput, b: SprintIdInput): number {
  const pa = parseSprintId(a);
  const pb = parseSprintId(b);
  if (!pa || !pb) return a < b ? -1 : a > b ? 1 : 0;

  if (pa.base !== pb.base) return pa.base - pb.base;

  const ia = pa.insert;
  const ib = pb.insert;
  if (ia === null && ib === null) return 0;
  if (ia === null) return -1; // whole sprint before its inserts
  if (ib === null) return 1;
  if (ia !== ib) return ia - ib;

  // Same insert value but different digit strings (e.g. "5" vs "05").
  return pa.insertDigits! < pb.insertDigits! ? -1 : pa.insertDigits! > pb.insertDigits! ? 1 : 0;
}

/** True when two authored ids denote the same sprint (exact canonical match). */
export function sprintIdsEqual(a: SprintIdInput, b: SprintIdInput): boolean {
  const ka = sprintIdKey(a);
  const kb = sprintIdKey(b);
  return ka !== null && ka === kb;
}

/** Return the greatest valid canonical key, or the supplied fallback. */
export function latestSprintIdKey(values: SprintIdInput[], fallback: SprintId = '0'): SprintId {
  const keys = values
    .map(sprintIdKey)
    .filter((key): key is string => key !== null)
    .sort(compareSprintIdKeys);
  return keys.at(-1) ?? fallback;
}

/** Convert to the legacy numeric mirror only when the canonical key round-trips. */
export function sprintIdToNumber(value: SprintIdInput): number | null {
  const key = sprintIdKey(value);
  if (key === null) return null;
  const numeric = Number(key);
  return String(numeric) === key ? numeric : null;
}
