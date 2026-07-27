import { createHash } from 'node:crypto';
import {
  ROADMAP_TERMINAL_STATUSES,
  compareRoadmapSprintIds,
  getRoadmapTicketKey,
  validateRoadmap,
  type RoadmapDefinition,
  type RoadmapPhase,
  type RoadmapSprint,
} from './roadmap.js';
import {
  normalizeRoadmapSourcePath,
  serializeRoadmapProjection,
  type RoadmapSourceKind,
} from './roadmap-sources.js';
import { sprintIdKey } from './sprint-id.js';

export type RoadmapMigrationClassification = 'archive' | 'live' | 'history_unverified' | 'backlog';

export const ROADMAP_MIGRATION_DIAGNOSTIC_LIMIT = 100;
export const ROADMAP_MIGRATION_ABSENT = Object.freeze({ $slope_migration: 'absent' as const });

export interface RoadmapMigrationOwnershipMapping {
  phase_index: number;
  phase_name?: string;
}

export interface RoadmapMigrationTicketRepair {
  club?: 'driver' | 'long_iron' | 'short_iron' | 'wedge' | 'putter';
  complexity?: 'trivial' | 'small' | 'standard' | 'moderate' | 'multi_package' | 'risky';
}

export interface RoadmapMigrationMapping {
  version: '1';
  source_sha256: string;
  ownership: Record<string, RoadmapMigrationOwnershipMapping>;
  ticket_repairs: Record<string, RoadmapMigrationTicketRepair>;
  phase_kinds: Record<string, 'phase' | 'backlog'>;
  scorecards: Record<string, string>;
}

export interface RoadmapMigrationScorecardEvidence {
  path: string;
  valid: boolean;
  reason?: string;
}

export interface RoadmapMigrationAuditEntry {
  path: string;
  rule: string;
  before: unknown;
  after: unknown;
}

export interface RoadmapMigrationDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  sprint?: number;
  ticket?: string;
  phase_index?: number;
}

export interface RoadmapMigrationUnresolvedRepair {
  kind: 'ownership' | 'ticket';
  key: string;
  message: string;
  candidates?: number[];
}

export interface RoadmapMigrationSourcePlan {
  phase_index: number;
  phase_name: string;
  classification: RoadmapMigrationClassification;
  kind: RoadmapSourceKind;
  path: string;
  phase: RoadmapPhase;
  sprints: RoadmapSprint[];
  scorecards: Record<string, string>;
  classification_reasons: string[];
}

export interface RoadmapMigrationNonCoreExport {
  path: 'migration/non-core.json';
  fields: Record<string, unknown>;
  sha256: string;
}

export interface RoadmapMigrationMappingTemplate {
  version: '1';
  source_sha256: string;
  ownership: Record<string, RoadmapMigrationOwnershipMapping | null>;
  ticket_repairs: Record<string, RoadmapMigrationTicketRepair>;
  phase_kinds: Record<string, 'phase' | 'backlog'>;
  scorecards: Record<string, string>;
}

export interface RoadmapMigrationPlan {
  version: '1';
  source_sha256: string;
  mapping_sha256?: string;
  plan_sha256: string;
  expected_projection_sha256: string;
  applicable: boolean;
  normalized_roadmap: RoadmapDefinition;
  sources: RoadmapMigrationSourcePlan[];
  audit: RoadmapMigrationAuditEntry[];
  diagnostics: RoadmapMigrationDiagnostic[];
  diagnostics_total: number;
  diagnostics_omitted: number;
  unresolved: RoadmapMigrationUnresolvedRepair[];
  mapping_template: RoadmapMigrationMappingTemplate;
  non_core: RoadmapMigrationNonCoreExport;
}

export interface PlanRoadmapMigrationOptions {
  mapping?: RoadmapMigrationMapping;
  evidence?: Record<string, RoadmapMigrationScorecardEvidence>;
}

export class RoadmapMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoadmapMigrationError';
  }
}

const CLUBS = new Set(['driver', 'long_iron', 'short_iron', 'wedge', 'putter']);
const COMPLEXITIES = new Set(['trivial', 'small', 'standard', 'moderate', 'multi_package', 'risky']);
const CLUB_ALIASES: Record<string, string> = {
  'long iron': 'long_iron',
  'long-iron': 'long_iron',
  'short iron': 'short_iron',
  'short-iron': 'short_iron',
};
const COMPLEXITY_ALIASES: Record<string, string> = {
  medium: 'standard',
  large: 'risky',
  'multi package': 'multi_package',
  'multi-package': 'multi_package',
};
const CLUB_TO_COMPLEXITY: Record<string, string> = {
  putter: 'trivial',
  wedge: 'small',
  short_iron: 'standard',
  long_iron: 'multi_package',
  driver: 'risky',
};
const COMPLEXITY_TO_CLUB: Record<string, string> = {
  trivial: 'putter',
  small: 'wedge',
  standard: 'short_iron',
  moderate: 'long_iron',
  multi_package: 'long_iron',
  risky: 'driver',
};
const CORE_TOP_LEVEL = new Set(['name', 'description', 'phases', 'sprints']);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function computeRoadmapMigrationDigest(value: unknown): string {
  const bytes = typeof value === 'string' ? value : JSON.stringify(canonicalize(value));
  return createHash('sha256').update(bytes).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function pointerPart(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function sprintKey(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function parsePositiveSprintKey(value: string, label: string): number {
  if (!/^\d+(?:\.\d+)?$/.test(value) || Number(value) <= 0) {
    throw new RoadmapMigrationError(`${label} key must be a positive sprint ID: ${value}`);
  }
  return Number(value);
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: Set<string>, label: string): void {
  const unknown = Object.keys(record).filter(key => !allowed.has(key));
  if (unknown.length > 0) throw new RoadmapMigrationError(`${label} contains unknown field: ${unknown[0]}`);
}

export function parseRoadmapMigrationMapping(input: unknown): RoadmapMigrationMapping {
  if (!isRecord(input)) throw new RoadmapMigrationError('migration mapping must be an object');
  rejectUnknownKeys(input, new Set(['version', 'source_sha256', 'ownership', 'ticket_repairs', 'phase_kinds', 'scorecards']), 'migration mapping');
  if (input.version !== 1 && input.version !== '1') throw new RoadmapMigrationError('migration mapping version must be 1');
  if (typeof input.source_sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(input.source_sha256)) {
    throw new RoadmapMigrationError('migration mapping source_sha256 must be a SHA-256 digest');
  }

  const ownership: RoadmapMigrationMapping['ownership'] = {};
  if (input.ownership != null) {
    if (!isRecord(input.ownership)) throw new RoadmapMigrationError('migration mapping ownership must be an object');
    for (const [id, raw] of Object.entries(input.ownership).sort(([a], [b]) => Number(a) - Number(b))) {
      parsePositiveSprintKey(id, 'ownership');
      if (!isRecord(raw)) throw new RoadmapMigrationError(`ownership.${id} must be an object`);
      rejectUnknownKeys(raw, new Set(['phase_index', 'phase_name']), `ownership.${id}`);
      if (!Number.isInteger(raw.phase_index) || Number(raw.phase_index) <= 0) {
        throw new RoadmapMigrationError(`ownership.${id}.phase_index must be a positive 1-based integer`);
      }
      if (raw.phase_name != null && (typeof raw.phase_name !== 'string' || !raw.phase_name.trim())) {
        throw new RoadmapMigrationError(`ownership.${id}.phase_name must be a non-empty string when present`);
      }
      ownership[id] = {
        phase_index: Number(raw.phase_index),
        ...(raw.phase_name ? { phase_name: raw.phase_name.trim() } : {}),
      };
    }
  }

  const ticketRepairs: RoadmapMigrationMapping['ticket_repairs'] = {};
  if (input.ticket_repairs != null) {
    if (!isRecord(input.ticket_repairs)) throw new RoadmapMigrationError('migration mapping ticket_repairs must be an object');
    for (const [ticket, raw] of Object.entries(input.ticket_repairs).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      if (!ticket.trim() || !isRecord(raw)) throw new RoadmapMigrationError(`ticket_repairs.${ticket} must be an object`);
      rejectUnknownKeys(raw, new Set(['club', 'complexity']), `ticket_repairs.${ticket}`);
      if (raw.club != null && !CLUBS.has(String(raw.club))) throw new RoadmapMigrationError(`ticket_repairs.${ticket}.club is invalid`);
      if (raw.complexity != null && !COMPLEXITIES.has(String(raw.complexity))) throw new RoadmapMigrationError(`ticket_repairs.${ticket}.complexity is invalid`);
      if (raw.club == null && raw.complexity == null) throw new RoadmapMigrationError(`ticket_repairs.${ticket} must set club or complexity`);
      ticketRepairs[ticket] = {
        ...(raw.club ? { club: raw.club as RoadmapMigrationTicketRepair['club'] } : {}),
        ...(raw.complexity ? { complexity: raw.complexity as RoadmapMigrationTicketRepair['complexity'] } : {}),
      };
    }
  }

  const phaseKinds: RoadmapMigrationMapping['phase_kinds'] = {};
  if (input.phase_kinds != null) {
    if (!isRecord(input.phase_kinds)) throw new RoadmapMigrationError('migration mapping phase_kinds must be an object');
    for (const [index, kind] of Object.entries(input.phase_kinds).sort(([a], [b]) => Number(a) - Number(b))) {
      if (!/^\d+$/.test(index) || Number(index) <= 0 || (kind !== 'phase' && kind !== 'backlog')) {
        throw new RoadmapMigrationError(`phase_kinds.${index} must be phase or backlog at a positive 1-based index`);
      }
      phaseKinds[index] = kind;
    }
  }

  const scorecards: Record<string, string> = {};
  if (input.scorecards != null) {
    if (!isRecord(input.scorecards)) throw new RoadmapMigrationError('migration mapping scorecards must be an object');
    for (const [id, path] of Object.entries(input.scorecards).sort(([a], [b]) => Number(a) - Number(b))) {
      parsePositiveSprintKey(id, 'scorecards');
      if (typeof path !== 'string' || !path.trim()) throw new RoadmapMigrationError(`scorecards.${id} must be a non-empty path`);
      scorecards[id] = normalizeRoadmapSourcePath(path, `scorecards.${id}`);
    }
  }

  return {
    version: '1',
    source_sha256: input.source_sha256.toLowerCase(),
    ownership,
    ticket_repairs: ticketRepairs,
    phase_kinds: phaseKinds,
    scorecards,
  };
}

function auditChange(
  audit: RoadmapMigrationAuditEntry[],
  path: string,
  rule: string,
  record: Record<string, unknown>,
  field: string,
  after: unknown,
): void {
  const present = Object.prototype.hasOwnProperty.call(record, field);
  const before = present ? record[field] : ROADMAP_MIGRATION_ABSENT;
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  audit.push({ path: `${path}/${pointerPart(field)}`, rule, before: clone(before), after: clone(after) });
  record[field] = after;
}

function targetSchemaError(
  diagnostics: RoadmapMigrationDiagnostic[],
  message: string,
  details: Pick<RoadmapMigrationDiagnostic, 'sprint' | 'ticket' | 'phase_index'> = {},
): void {
  diagnostics.push({ severity: 'error', code: 'target_schema', message, ...details });
}

function validateTargetTicket(
  ticket: Record<string, unknown>,
  sprint: number,
  diagnostics: RoadmapMigrationDiagnostic[],
): boolean {
  const key = getRoadmapTicketKey(ticket) ?? undefined;
  let valid = true;
  const reject = (message: string): void => {
    valid = false;
    targetSchemaError(diagnostics, message, { sprint, ...(key ? { ticket: key } : {}) });
  };
  if (!key) reject(`Sprint S${sprint} has a ticket without a non-empty key or id.`);
  if (typeof ticket.title !== 'string' || !ticket.title.trim()) reject(`${key ?? `Sprint S${sprint} ticket`} title must be a non-empty string.`);
  if (!CLUBS.has(String(ticket.club))) reject(`${key ?? `Sprint S${sprint} ticket`} club must be canonical.`);
  if (!COMPLEXITIES.has(String(ticket.complexity))) reject(`${key ?? `Sprint S${sprint} ticket`} complexity must be canonical.`);
  if (ticket.depends_on != null
    && (!Array.isArray(ticket.depends_on)
      || ticket.depends_on.some(value => typeof value !== 'string' || !value.trim()))) {
    reject(`${key ?? `Sprint S${sprint} ticket`} depends_on must contain non-empty ticket keys.`);
  }
  if (ticket.github_issue != null) {
    const issues = Array.isArray(ticket.github_issue) ? ticket.github_issue : [ticket.github_issue];
    if (issues.length === 0 || issues.some(value => !Number.isSafeInteger(value) || Number(value) <= 0)) {
      reject(`${key ?? `Sprint S${sprint} ticket`} github_issue must be a positive integer or non-empty list of them.`);
    }
  }
  if (ticket.note != null && typeof ticket.note !== 'string') reject(`${key ?? `Sprint S${sprint} ticket`} note must be a string.`);
  return valid;
}

function validateTargetSprint(
  sprint: Record<string, unknown>,
  diagnostics: RoadmapMigrationDiagnostic[],
): boolean {
  const id = sprint.id as number;
  let valid = true;
  const reject = (message: string): void => {
    valid = false;
    targetSchemaError(diagnostics, message, { sprint: id });
  };
  if (typeof sprint.theme !== 'string' || !sprint.theme.trim()) reject(`Sprint S${id} theme must be a non-empty string.`);
  if (![3, 4, 5].includes(sprint.par as number)) reject(`Sprint S${id} par must be 3, 4, or 5.`);
  if (typeof sprint.slope !== 'number' || !Number.isFinite(sprint.slope)) reject(`Sprint S${id} slope must be numeric.`);
  if (typeof sprint.type !== 'string' || !sprint.type.trim()) reject(`Sprint S${id} type must be a non-empty string.`);
  if (sprint.depends_on != null
    && (!Array.isArray(sprint.depends_on)
      || sprint.depends_on.some(value => (
        (typeof value !== 'number' && typeof value !== 'string')
        || sprintIdKey(value) === null
      )))) {
    reject(`Sprint S${id} depends_on must contain valid sprint IDs.`);
  }
  for (const field of ['status', 'note', 'outcome', 'phase', 'wave']) {
    if (sprint[field] != null && typeof sprint[field] !== 'string') reject(`Sprint S${id} ${field} must be a string.`);
  }
  for (const field of ['research', 'artifacts', 'expected_artifacts']) {
    if (sprint[field] != null
      && (!Array.isArray(sprint[field]) || (sprint[field] as unknown[]).some(value => typeof value !== 'string'))) {
      reject(`Sprint S${id} ${field} must contain string paths.`);
    }
  }
  if (!Array.isArray(sprint.tickets)) {
    reject(`Sprint S${id} tickets must be an array.`);
    return false;
  }
  for (const ticket of sprint.tickets) {
    if (!isRecord(ticket)) {
      reject(`Sprint S${id} tickets must contain mappings.`);
    } else if (!validateTargetTicket(ticket, id, diagnostics)) {
      valid = false;
    }
  }
  return valid;
}

function validateTargetPhase(
  phase: Record<string, unknown>,
  index: number,
  diagnostics: RoadmapMigrationDiagnostic[],
): boolean {
  let valid = true;
  for (const field of ['description', 'status', 'note']) {
    if (phase[field] != null && typeof phase[field] !== 'string') {
      valid = false;
      targetSchemaError(diagnostics, `Phase ${index} ${field} must be a string.`, { phase_index: index });
    }
  }
  return valid;
}

function normalizeTicket(
  ticket: Record<string, unknown>,
  path: string,
  mapping: RoadmapMigrationMapping | undefined,
  usedRepairs: Set<string>,
  audit: RoadmapMigrationAuditEntry[],
  diagnostics: RoadmapMigrationDiagnostic[],
  unresolved: RoadmapMigrationUnresolvedRepair[],
  sprint: number,
): void {
  const key = getRoadmapTicketKey(ticket);
  if (!key) {
    diagnostics.push({ severity: 'error', code: 'ticket_key_missing', sprint, message: `Ticket at ${path} has no key or id.` });
    return;
  }

  if (typeof ticket.club === 'string') {
    const alias = CLUB_ALIASES[ticket.club.trim().toLowerCase()];
    if (alias) auditChange(audit, path, 'club_alias', ticket, 'club', alias);
  }
  if (typeof ticket.complexity === 'string') {
    const alias = COMPLEXITY_ALIASES[ticket.complexity.trim().toLowerCase()];
    if (alias) auditChange(audit, path, 'complexity_alias', ticket, 'complexity', alias);
  }

  const repair = mapping?.ticket_repairs[key];
  let needsClub = !CLUBS.has(String(ticket.club));
  let needsComplexity = !COMPLEXITIES.has(String(ticket.complexity));
  if (needsClub && repair?.club) {
    auditChange(audit, path, 'explicit_ticket_repair', ticket, 'club', repair.club);
    usedRepairs.add(key);
    needsClub = false;
  }
  if (needsComplexity && repair?.complexity) {
    auditChange(audit, path, 'explicit_ticket_repair', ticket, 'complexity', repair.complexity);
    usedRepairs.add(key);
    needsComplexity = false;
  }
  if (needsComplexity && !needsClub) {
    auditChange(audit, path, 'derive_complexity_from_club', ticket, 'complexity', CLUB_TO_COMPLEXITY[String(ticket.club)]);
    needsComplexity = false;
  }
  if (needsClub && !needsComplexity) {
    auditChange(audit, path, 'derive_club_from_complexity', ticket, 'club', COMPLEXITY_TO_CLUB[String(ticket.complexity)]);
    needsClub = false;
  }
  if (needsClub || needsComplexity) {
    const fields = [needsClub ? 'club' : '', needsComplexity ? 'complexity' : ''].filter(Boolean).join(' and ');
    diagnostics.push({ severity: 'error', code: 'ticket_repair_required', sprint, ticket: key, message: `${key} requires an explicit ${fields} repair.` });
    unresolved.push({ kind: 'ticket', key, message: `Set canonical ${fields} for ${key}.` });
  }
}

function slugify(value: string): string {
  const slug = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48).replace(/-$/g, '');
  return slug || 'phase';
}

function migrationPath(classification: RoadmapMigrationClassification, index: number, width: number, name: string): string {
  const file = `${String(index).padStart(width, '0')}-${slugify(name)}.yaml`;
  if (classification === 'archive') return `archive/${file}`;
  if (classification === 'backlog') return `backlog/${file}`;
  return `phases/${classification === 'live' ? 'live' : 'history-unverified'}/${file}`;
}

function mappingTemplate(
  sourceSha: string,
  unresolved: RoadmapMigrationUnresolvedRepair[],
): RoadmapMigrationMappingTemplate {
  const ownership: RoadmapMigrationMappingTemplate['ownership'] = {};
  const ticketRepairs: RoadmapMigrationMappingTemplate['ticket_repairs'] = {};
  for (const item of unresolved) {
    if (item.kind === 'ownership') ownership[item.key] = null;
    else ticketRepairs[item.key] = {};
  }
  return { version: '1', source_sha256: sourceSha, ownership, ticket_repairs: ticketRepairs, phase_kinds: {}, scorecards: {} };
}

export function serializeRoadmapMigrationMappingTemplate(plan: RoadmapMigrationPlan): string {
  return `${JSON.stringify(plan.mapping_template, null, 2)}\n`;
}

export function planRoadmapMigration(
  sourceText: string,
  options: PlanRoadmapMigrationOptions = {},
): RoadmapMigrationPlan {
  const sourceSha = computeRoadmapMigrationDigest(sourceText);
  if (options.mapping && options.mapping.source_sha256 !== sourceSha) {
    throw new RoadmapMigrationError(`migration mapping targets ${options.mapping.source_sha256}, but input is ${sourceSha}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(sourceText);
  } catch (error) {
    throw new RoadmapMigrationError(`roadmap is not valid JSON: ${(error as Error).message}`);
  }
  if (!isRecord(parsed) || typeof parsed.name !== 'string' || !parsed.name.trim()) {
    throw new RoadmapMigrationError('roadmap must be an object with a non-empty name');
  }
  if (!Array.isArray(parsed.phases) || !Array.isArray(parsed.sprints)) {
    throw new RoadmapMigrationError('roadmap phases and sprints must be arrays');
  }

  const audit: RoadmapMigrationAuditEntry[] = [];
  const diagnostics: RoadmapMigrationDiagnostic[] = [];
  const unresolved: RoadmapMigrationUnresolvedRepair[] = [];
  const invalidDescription = parsed.description != null && typeof parsed.description !== 'string';
  if (invalidDescription) {
    diagnostics.push({
      severity: 'error',
      code: 'invalid_description',
      message: 'Roadmap description must be a string when present; migration will not drop or coerce it.',
    });
  }
  const phases = clone(parsed.phases) as unknown[];
  const sprints = clone(parsed.sprints) as unknown[];
  const phaseRecords: Record<string, unknown>[] = [];
  const memberships = new Map<number, number[]>();
  let targetShapeValid = !invalidDescription;

  for (const [phaseOffset, value] of phases.entries()) {
    if (!isRecord(value) || typeof value.name !== 'string' || !value.name.trim() || !Array.isArray(value.sprints)) {
      throw new RoadmapMigrationError(`phases[${phaseOffset}] must have a non-empty name and sprint array`);
    }
    const seen = new Set<number>();
    for (const id of value.sprints) {
      if (typeof id !== 'number' || !Number.isFinite(id) || id <= 0) {
        throw new RoadmapMigrationError(`phases[${phaseOffset}].sprints contains an invalid sprint ID`);
      }
      if (!seen.has(id)) {
        const owners = memberships.get(id) ?? [];
        owners.push(phaseOffset + 1);
        memberships.set(id, owners);
        seen.add(id);
      }
    }
    if (seen.size !== value.sprints.length) {
      auditChange(audit, `/phases/${phaseOffset}`, 'deduplicate_local_membership', value, 'sprints', [...seen]);
    }
    if (!validateTargetPhase(value, phaseOffset + 1, diagnostics)) targetShapeValid = false;
    phaseRecords.push(value);
  }

  const sprintRecords: Record<string, unknown>[] = [];
  const definitions = new Map<number, Record<string, unknown>>();
  const originalSprintIndex = new Map<number, number>();
  const usedTicketRepairs = new Set<string>();
  const ticketKeys = new Set<string>();
  for (const [sprintOffset, value] of sprints.entries()) {
    if (!isRecord(value) || typeof value.id !== 'number' || !Number.isFinite(value.id) || value.id <= 0) {
      throw new RoadmapMigrationError(`sprints[${sprintOffset}] must be an object with a positive numeric id`);
    }
    const id = value.id;
    if (definitions.has(id)) {
      diagnostics.push({ severity: 'error', code: 'duplicate_sprint_definition', sprint: id, message: `Sprint S${id} is defined more than once.` });
      continue;
    }
    definitions.set(id, value);
    originalSprintIndex.set(id, sprintOffset);
    for (const field of ['phase', 'wave']) {
      if (typeof value[field] === 'number' && Number.isFinite(value[field])) {
        auditChange(audit, `/sprints/${sprintOffset}`, 'numeric_label_to_string', value, field, String(value[field]));
      }
    }
    for (const field of ['research', 'artifacts', 'expected_artifacts']) {
      if (typeof value[field] === 'string') {
        auditChange(audit, `/sprints/${sprintOffset}`, 'scalar_path_to_list', value, field, [value[field]]);
      } else if (value[field] != null && (!Array.isArray(value[field]) || (value[field] as unknown[]).some(item => typeof item !== 'string'))) {
        diagnostics.push({ severity: 'error', code: 'invalid_path_list', sprint: id, message: `Sprint S${id} ${field} must be a string or string array.` });
      }
    }
    if (Array.isArray(value.depends_on)) {
      const canonicalDependencies = value.depends_on.map(dependency => (
        typeof dependency === 'number' || typeof dependency === 'string'
          ? sprintIdKey(dependency)
          : null
      ));
      if (canonicalDependencies.every((dependency): dependency is string => dependency !== null)) {
        auditChange(
          audit,
          `/sprints/${sprintOffset}`,
          'canonicalize_sprint_dependencies',
          value,
          'depends_on',
          canonicalDependencies,
        );
      }
    }
    if (value.tickets === null) auditChange(audit, `/sprints/${sprintOffset}`, 'null_tickets_to_empty', value, 'tickets', []);
    if (!Array.isArray(value.tickets)) {
      diagnostics.push({ severity: 'error', code: 'invalid_ticket_collection', sprint: id, message: `Sprint S${id} tickets must be an array or null.` });
    } else {
      for (const [ticketOffset, ticketValue] of value.tickets.entries()) {
        if (!isRecord(ticketValue)) {
          diagnostics.push({ severity: 'error', code: 'invalid_ticket', sprint: id, message: `Sprint S${id} ticket ${ticketOffset + 1} must be an object.` });
          continue;
        }
        normalizeTicket(ticketValue, `/sprints/${sprintOffset}/tickets/${ticketOffset}`, options.mapping, usedTicketRepairs, audit, diagnostics, unresolved, id);
        const key = getRoadmapTicketKey(ticketValue);
        if (key && ticketKeys.has(key)) diagnostics.push({ severity: 'error', code: 'duplicate_ticket', sprint: id, ticket: key, message: `Ticket ${key} is defined more than once.` });
        if (key) ticketKeys.add(key);
      }
    }
    if (!validateTargetSprint(value, diagnostics)) targetShapeValid = false;
    sprintRecords.push(value);
  }

  for (const [id, owners] of [...memberships.entries()].sort(([a], [b]) => a - b)) {
    if (!definitions.has(id)) diagnostics.push({ severity: 'error', code: 'missing_sprint_definition', sprint: id, message: `Phase membership S${id} has no sprint definition.` });
  }

  const ownerBySprint = new Map<number, number>();
  const usedOwnership = new Set<string>();
  const orderedDefinitionIds = [...definitions.keys()].sort((a, b) => a - b);
  for (const id of orderedDefinitionIds) {
    const key = sprintKey(id);
    const owners = memberships.get(id) ?? [];
    if (owners.length === 1) {
      ownerBySprint.set(id, owners[0]);
      if (options.mapping?.ownership[key]) {
        diagnostics.push({ severity: 'error', code: 'unused_ownership_mapping', sprint: id, message: `S${id} already has exactly one phase owner.` });
      }
      continue;
    }
    const selected = options.mapping?.ownership[key];
    if (!selected) {
      const reason = owners.length === 0 ? 'has no phase owner' : `has multiple phase owners (${owners.join(', ')})`;
      diagnostics.push({ severity: 'error', code: owners.length === 0 ? 'orphan_sprint_definition' : 'multiple_phase_membership', sprint: id, message: `Sprint S${id} ${reason}; explicit ownership is required.` });
      unresolved.push({ kind: 'ownership', key, message: `Select one 1-based phase index for S${id}.`, ...(owners.length ? { candidates: owners } : {}) });
      continue;
    }
    if (selected.phase_index > phaseRecords.length) {
      diagnostics.push({ severity: 'error', code: 'invalid_ownership_mapping', sprint: id, message: `S${id} maps to missing phase index ${selected.phase_index}.` });
      continue;
    }
    const selectedName = String(phaseRecords[selected.phase_index - 1].name);
    if (selected.phase_name && selected.phase_name !== selectedName) {
      diagnostics.push({ severity: 'error', code: 'ownership_phase_mismatch', sprint: id, message: `S${id} expected phase "${selected.phase_name}" at index ${selected.phase_index}, found "${selectedName}".` });
      continue;
    }
    if (owners.length > 1 && !owners.includes(selected.phase_index)) {
      diagnostics.push({ severity: 'error', code: 'invalid_ownership_mapping', sprint: id, message: `S${id} duplicate ownership must select one existing candidate (${owners.join(', ')}).` });
      continue;
    }
    ownerBySprint.set(id, selected.phase_index);
    usedOwnership.add(key);
  }

  for (const [id] of Object.entries(options.mapping?.ownership ?? {}).sort(([a], [b]) => Number(a) - Number(b))) {
    if (!definitions.has(Number(id))) diagnostics.push({ severity: 'error', code: 'stale_ownership_mapping', sprint: Number(id), message: `Ownership mapping references undefined Sprint S${id}.` });
    else if (!usedOwnership.has(id) && (memberships.get(Number(id))?.length ?? 0) !== 1) {
      diagnostics.push({ severity: 'error', code: 'unused_ownership_mapping', sprint: Number(id), message: `Ownership mapping for S${id} could not be applied.` });
    }
  }
  for (const ticket of Object.keys(options.mapping?.ticket_repairs ?? {}).sort((a, b) => a < b ? -1 : a > b ? 1 : 0)) {
    if (!ticketKeys.has(ticket)) diagnostics.push({ severity: 'error', code: 'stale_ticket_repair', ticket, message: `Ticket repair references undefined ticket ${ticket}.` });
    else if (!usedTicketRepairs.has(ticket)) diagnostics.push({ severity: 'error', code: 'unused_ticket_repair', ticket, message: `Ticket repair for ${ticket} was not needed.` });
  }
  for (const index of Object.keys(options.mapping?.phase_kinds ?? {}).sort((a, b) => Number(a) - Number(b))) {
    if (Number(index) > phaseRecords.length) diagnostics.push({ severity: 'error', code: 'stale_phase_kind', phase_index: Number(index), message: `Phase kind references missing phase index ${index}.` });
  }

  for (const [phaseOffset, phase] of phaseRecords.entries()) {
    const before = [...(phase.sprints as number[])];
    const retained = before.filter(id => ownerBySprint.get(id) === phaseOffset + 1);
    for (const id of orderedDefinitionIds) {
      if (ownerBySprint.get(id) === phaseOffset + 1 && !retained.includes(id)) retained.push(id);
    }
    auditChange(audit, `/phases/${phaseOffset}`, 'repair_phase_ownership', phase, 'sprints', retained);
  }

  const preliminary: RoadmapDefinition = {
    name: parsed.name,
    ...(typeof parsed.description === 'string' ? { description: parsed.description } : {}),
    phases: phaseRecords as unknown as RoadmapPhase[],
    sprints: sprintRecords as unknown as RoadmapSprint[],
  };
  const originalOrder = preliminary.sprints.map(sprint => sprint.id);
  const canResolveEncodedIdentity = preliminary.sprints.every(sprint => Array.isArray(sprint.tickets));
  preliminary.sprints.sort((a, b) => canResolveEncodedIdentity
    ? compareRoadmapSprintIds(preliminary, a.id, b.id)
    : a.id - b.id);
  const sortedOrder = preliminary.sprints.map(sprint => sprint.id);
  if (JSON.stringify(originalOrder) !== JSON.stringify(sortedOrder)) {
    audit.push({ path: '/sprints', rule: 'compiler_sprint_order', before: originalOrder, after: sortedOrder });
  }
  if (targetShapeValid) {
    const validation = validateRoadmap(preliminary);
    for (const issue of validation.errors) {
      diagnostics.push({
        severity: 'error',
        code: 'target_roadmap_validation',
        message: issue.message,
        ...(issue.sprint != null ? { sprint: issue.sprint } : {}),
        ...(issue.ticket ? { ticket: issue.ticket } : {}),
      });
    }
    for (const issue of validation.warnings) {
      diagnostics.push({
        severity: 'warning',
        code: 'target_roadmap_validation',
        message: issue.message,
        ...(issue.sprint != null ? { sprint: issue.sprint } : {}),
        ...(issue.ticket ? { ticket: issue.ticket } : {}),
      });
    }
  }

  const evidence = { ...(options.evidence ?? {}) };
  for (const [id, path] of Object.entries(options.mapping?.scorecards ?? {}).sort(([a], [b]) => Number(a) - Number(b))) {
    const sprint = definitions.get(Number(id));
    const card = evidence[id];
    if (!sprint) {
      diagnostics.push({ severity: 'error', code: 'stale_scorecard_mapping', sprint: Number(id), message: `Scorecard mapping references undefined Sprint S${id}.` });
    } else if (sprint.status !== 'complete') {
      diagnostics.push({ severity: 'error', code: 'unused_scorecard_mapping', sprint: Number(id), message: `Scorecard mapping for S${id} is unused because the sprint is not complete.` });
    } else if (!card) {
      diagnostics.push({ severity: 'error', code: 'unverified_scorecard_mapping', sprint: Number(id), message: `Scorecard mapping for S${id} has no verified filesystem evidence.` });
    } else if (card.path.replace(/\\/g, '/') !== path) {
      diagnostics.push({ severity: 'error', code: 'scorecard_mapping_mismatch', sprint: Number(id), message: `Scorecard mapping for S${id} does not match verified evidence path ${card.path.replace(/\\/g, '/')}.` });
    } else if (!card.valid) {
      diagnostics.push({ severity: 'error', code: 'invalid_scorecard_mapping', sprint: Number(id), message: `Scorecard mapping for S${id} failed evidence validation${card.reason ? `: ${card.reason}` : '.'}` });
    }
  }
  const width = Math.max(3, String(phaseRecords.length).length);
  const sources: RoadmapMigrationSourcePlan[] = phaseRecords.map((phase, offset) => {
    const index = offset + 1;
    const owned = preliminary.sprints.filter(sprint => ownerBySprint.get(sprint.id) === index);
    const reasons: string[] = [];
    const phaseTerminal = ROADMAP_TERMINAL_STATUSES.has(String(phase.status ?? ''));
    if (!phaseTerminal) reasons.push(`phase status "${String(phase.status ?? 'unset')}" is not terminal`);
    const nonterminal = owned.filter(sprint => !ROADMAP_TERMINAL_STATUSES.has(sprint.status ?? ''));
    if (nonterminal.length > 0) reasons.push(`nonterminal sprints: ${nonterminal.map(sprint => `S${sprint.id}`).join(', ')}`);
    const unverified = owned.filter(sprint => sprint.status === 'complete' && !evidence[sprintKey(sprint.id)]?.valid);
    if (unverified.length > 0) reasons.push(`complete sprints without valid scorecard evidence: ${unverified.map(sprint => `S${sprint.id}`).join(', ')}`);
    const override = options.mapping?.phase_kinds[String(index)];
    let classification: RoadmapMigrationClassification;
    if (override === 'backlog') classification = 'backlog';
    else if (override === 'phase') {
      reasons.push('explicit phase mapping prevents archive classification');
      classification = nonterminal.length > 0 ? 'live' : 'history_unverified';
    }
    else if (phaseTerminal && nonterminal.length === 0 && unverified.length === 0) classification = 'archive';
    else if (owned.some(sprint => !ROADMAP_TERMINAL_STATUSES.has(sprint.status ?? ''))) classification = 'live';
    else classification = 'history_unverified';
    const scorecards: Record<string, string> = {};
    for (const sprint of owned) {
      const card = evidence[sprintKey(sprint.id)];
      if (sprint.status === 'complete' && card?.valid) scorecards[sprintKey(sprint.id)] = card.path.replace(/\\/g, '/');
    }
    return {
      phase_index: index,
      phase_name: String(phase.name),
      classification,
      kind: classification === 'archive' ? 'archive' : classification === 'backlog' ? 'backlog' : 'phase',
      path: migrationPath(classification, index, width, String(phase.name)),
      phase: phase as unknown as RoadmapPhase,
      sprints: owned,
      scorecards,
      classification_reasons: classification === 'archive' ? ['terminal status and scorecard evidence verified'] : reasons,
    };
  });

  const nonCoreFields = Object.fromEntries(Object.entries(parsed).filter(([key]) => !CORE_TOP_LEVEL.has(key)));
  const nonCore: RoadmapMigrationNonCoreExport = {
    path: 'migration/non-core.json',
    fields: clone(nonCoreFields),
    sha256: computeRoadmapMigrationDigest(nonCoreFields),
  };
  const template = mappingTemplate(sourceSha, unresolved);
  const mappingSha = options.mapping ? computeRoadmapMigrationDigest(options.mapping) : undefined;
  const boundedDiagnostics = diagnostics.slice(0, ROADMAP_MIGRATION_DIAGNOSTIC_LIMIT);
  const expectedProjectionSha = computeRoadmapMigrationDigest(serializeRoadmapProjection(preliminary));
  const base = {
    version: '1' as const,
    source_sha256: sourceSha,
    ...(mappingSha ? { mapping_sha256: mappingSha } : {}),
    expected_projection_sha256: expectedProjectionSha,
    applicable: diagnostics.every(diagnostic => diagnostic.severity !== 'error'),
    normalized_roadmap: preliminary,
    sources,
    audit,
    diagnostics: boundedDiagnostics,
    diagnostics_total: diagnostics.length,
    diagnostics_omitted: diagnostics.length - boundedDiagnostics.length,
    unresolved,
    mapping_template: template,
    non_core: nonCore,
  };
  return { ...base, plan_sha256: computeRoadmapMigrationDigest(base) };
}
