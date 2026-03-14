// SLOPE — Deferred Findings Registry
// File-based storage for cross-sprint review findings that need future attention.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// --- Types ---

export type DeferredSeverity = 'low' | 'medium' | 'high' | 'critical';
export type DeferredStatus = 'open' | 'resolved' | 'wontfix';

export interface DeferredFinding {
  id: string;
  source_sprint: number;
  target_sprint: number | null;
  severity: DeferredSeverity;
  description: string;
  category?: string;
  status: DeferredStatus;
  created_at: string;
  resolved_at?: string;
}

export interface DeferredFindingsFile {
  findings: DeferredFinding[];
}

// --- Constants ---

const DEFAULT_PATH = '.slope/deferred-findings.json';

// --- Core Functions ---

/** Resolve the deferred findings file path from cwd. */
export function deferredPath(cwd: string): string {
  return join(cwd, DEFAULT_PATH);
}

/** Load all deferred findings. Returns empty array if file missing. */
export function loadDeferred(cwd: string): DeferredFinding[] {
  const filePath = deferredPath(cwd);
  if (!existsSync(filePath)) return [];
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as DeferredFindingsFile;
    return Array.isArray(raw.findings) ? raw.findings : [];
  } catch {
    return [];
  }
}

/** Save deferred findings to disk. Creates parent directory if needed. */
export function saveDeferred(cwd: string, findings: DeferredFinding[]): void {
  const filePath = deferredPath(cwd);
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const data: DeferredFindingsFile = { findings };
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

/** Create a new deferred finding and persist it. Returns the created finding. */
export function createDeferred(
  cwd: string,
  opts: {
    source_sprint: number;
    target_sprint?: number | null;
    severity: DeferredSeverity;
    description: string;
    category?: string;
  },
): DeferredFinding {
  const findings = loadDeferred(cwd);

  const finding: DeferredFinding = {
    id: randomUUID(),
    source_sprint: opts.source_sprint,
    target_sprint: opts.target_sprint ?? null,
    severity: opts.severity,
    description: opts.description,
    category: opts.category,
    status: 'open',
    created_at: new Date().toISOString(),
  };

  findings.push(finding);
  saveDeferred(cwd, findings);
  return finding;
}

/** Resolve a deferred finding by ID. Returns the finding or null if not found. */
export function resolveDeferred(
  cwd: string,
  id: string,
  status: 'resolved' | 'wontfix' = 'resolved',
): DeferredFinding | null {
  const findings = loadDeferred(cwd);
  const finding = findings.find(f => f.id === id || f.id.startsWith(id));
  if (!finding) return null;
  if (finding.status !== 'open') return finding; // Already resolved

  finding.status = status;
  finding.resolved_at = new Date().toISOString();
  saveDeferred(cwd, findings);
  return finding;
}

/** List deferred findings with optional filters. */
export function listDeferred(
  cwd: string,
  opts?: {
    sprint?: number;
    status?: DeferredStatus;
    severity?: DeferredSeverity;
  },
): DeferredFinding[] {
  let findings = loadDeferred(cwd);

  if (opts?.sprint != null) {
    findings = findings.filter(f => f.target_sprint === opts.sprint);
  }

  if (opts?.status) {
    findings = findings.filter(f => f.status === opts.status);
  }

  if (opts?.severity) {
    findings = findings.filter(f => f.severity === opts.severity);
  }

  return findings;
}

/** Format deferred findings for briefing output. */
export function formatDeferredForBriefing(
  findings: DeferredFinding[],
  sprint: number,
): string[] {
  const targeted = findings.filter(
    f => f.status === 'open' && f.target_sprint === sprint,
  );

  if (targeted.length === 0) return [];

  const lines: string[] = [];
  lines.push(`DEFERRED FINDINGS (${targeted.length} open for Sprint ${sprint}):`);

  for (const f of targeted) {
    const cat = f.category ? ` (${f.category})` : '';
    lines.push(
      `  - [${f.severity.toUpperCase()}] S${f.source_sprint} → S${sprint}: ${f.description}${cat}`,
    );
  }

  return lines;
}
