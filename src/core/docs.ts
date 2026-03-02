// SLOPE — Documentation Manifest Builder
// Pure functions — no filesystem or git I/O.

import { createHash } from 'node:crypto';
import type { CliCommandMeta } from '../cli/registry.js';
import type { GuardDefinition } from './guard.js';
import type { MetaphorDefinition } from './metaphor.js';
import type { RoleDefinition } from './roles.js';
import { GUARD_DEFINITIONS } from './guard.js';
import { listMetaphors } from './metaphor.js';
import { listRoles } from './roles.js';
import {
  PAR_THRESHOLDS,
  SLOPE_FACTORS,
  SCORE_LABELS,
  HAZARD_SEVERITY_PENALTIES,
} from './constants.js';

// ── Types ──────────────────────────────────────────────────────

export interface ChangelogChange {
  type: 'feat' | 'fix' | 'chore' | 'docs' | 'refactor' | 'test' | 'other';
  scope?: string;
  description: string;
  breaking: boolean;
  hash?: string;
}

export interface ChangelogEntry {
  version: string;       // tag or 'Unreleased'
  date: string;
  changes: ChangelogChange[];
}

export interface ChangelogSection {
  status: 'success' | 'partial' | 'unavailable';
  entries: ChangelogEntry[];
  reason?: string;
}

export interface DocsManifestInput {
  version: string;
  gitSha: string;
  changelog: ChangelogSection;
  commands: readonly CliCommandMeta[];
}

export interface DocsManifest {
  version: string;
  generatedAt: string;
  gitSha: string;
  checksums: Record<string, string>;

  commands: readonly CliCommandMeta[];
  guards: GuardDefinition[];
  metaphors: MetaphorDefinition[];
  roles: RoleDefinition[];
  constants: {
    parThresholds: typeof PAR_THRESHOLDS;
    slopeFactors: typeof SLOPE_FACTORS;
    scoreLabels: typeof SCORE_LABELS;
    hazardPenalties: typeof HAZARD_SEVERITY_PENALTIES;
  };
  changelog: ChangelogSection;
}

// ── Checksum ───────────────────────────────────────────────────

/** Recursively sort object keys for deterministic serialization */
function sortObjectKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortObjectKeys((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

/** Compute a deterministic SHA-256 checksum for a data section */
export function computeSectionChecksum(data: unknown): string {
  const sorted = sortObjectKeys(data);
  const json = JSON.stringify(sorted);
  return createHash('sha256').update(json).digest('hex');
}

// ── Builder ────────────────────────────────────────────────────

/** Build a complete documentation manifest from pre-computed input. Pure function — no I/O. */
export function buildDocsManifest(input: DocsManifestInput): DocsManifest {
  const metaphors = listMetaphors();
  if (metaphors.length === 0) {
    console.warn('Warning: metaphor registry is empty — manifest will have no metaphors');
  }

  const roles = listRoles();
  const guards = [...GUARD_DEFINITIONS];
  const constants = {
    parThresholds: PAR_THRESHOLDS,
    slopeFactors: SLOPE_FACTORS,
    scoreLabels: SCORE_LABELS,
    hazardPenalties: HAZARD_SEVERITY_PENALTIES,
  };

  const sections: Record<string, unknown> = {
    commands: input.commands,
    guards,
    metaphors,
    roles,
    constants,
    changelog: input.changelog,
  };

  const checksums: Record<string, string> = {};
  for (const [key, value] of Object.entries(sections)) {
    checksums[key] = computeSectionChecksum(value);
  }

  return {
    version: input.version,
    generatedAt: new Date().toISOString(),
    gitSha: input.gitSha,
    checksums,
    commands: input.commands,
    guards,
    metaphors,
    roles,
    constants,
    changelog: input.changelog,
  };
}
