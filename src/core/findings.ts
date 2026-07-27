import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { CodificationCost, CodificationStatus, ReviewFinding } from './types.js';
import {
  compareSprintIdKeys,
  sprintIdKey,
  sprintIdsEqual,
  type SprintId,
} from './sprint-id.js';

export const FINDINGS_FILE = '.slope/review-findings.json';

export interface FindingsFile {
  sprints: Record<string, ReviewFinding[]>;
}

function normalizeSprintFindings(
  sprints: Record<string, ReviewFinding[]>,
): Record<string, ReviewFinding[]> {
  const normalized: Record<string, ReviewFinding[]> = {};
  for (const [writtenSprint, findings] of Object.entries(sprints)) {
    const sprint = sprintIdKey(writtenSprint);
    if (!sprint || !Array.isArray(findings)) continue;
    normalized[sprint] = [...(normalized[sprint] ?? []), ...findings];
  }
  return normalized;
}

export function findingSprintKeys(data: FindingsFile): string[] {
  return Object.keys(data.sprints)
    .map(sprintIdKey)
    .filter((sprint): sprint is string => sprint !== null)
    .sort(compareSprintIdKeys);
}

export function loadFindings(cwd: string): FindingsFile | null {
  const filePath = join(cwd, FINDINGS_FILE);
  if (!existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as {
      sprint_number?: SprintId;
      findings?: ReviewFinding[];
      sprints?: Record<string, ReviewFinding[]>;
    };
    if (raw.sprints) return { sprints: normalizeSprintFindings(raw.sprints) };
    if (raw.sprint_number != null && raw.findings) {
      const sprint = sprintIdKey(raw.sprint_number);
      return sprint ? { sprints: { [sprint]: raw.findings } } : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveFindings(cwd: string, data: FindingsFile): void {
  const dir = join(cwd, '.slope');
  mkdirSync(dir, { recursive: true });
  const normalized = { sprints: normalizeSprintFindings(data.sprints) };
  writeFileSync(join(cwd, FINDINGS_FILE), JSON.stringify(normalized, null, 2) + '\n');
}

export function createFindingId(): string {
  return randomUUID();
}

export function displayFindingId(finding: ReviewFinding, sprint: SprintId, index: number): string {
  const sprintKey = sprintIdKey(sprint) ?? String(sprint);
  return finding.id ? finding.id.slice(0, 8) : `S${sprintKey}:${index + 1}`;
}

export function matchesFindingId(finding: ReviewFinding, sprint: SprintId, index: number, id: string): boolean {
  const fallbackMatch = id.match(/^S(.+):([1-9]\d*)$/i);
  const matchesFallback = fallbackMatch !== null
    && Number(fallbackMatch[2]) === index + 1
    && sprintIdsEqual(fallbackMatch[1], sprint);
  return finding.id === id || Boolean(finding.id?.startsWith(id)) || matchesFallback;
}

export function isCodificationCandidate(finding: ReviewFinding): boolean {
  return finding.review_type === 'workaround' && finding.recurs === true;
}

export function isOpenCodificationCandidate(finding: ReviewFinding): boolean {
  return isCodificationCandidate(finding)
    && finding.resolved !== true
    && (finding.codification_status ?? 'open') === 'open';
}

export function formatCodificationMetadata(finding: ReviewFinding): string {
  if (!isCodificationCandidate(finding)) return '';
  const status: CodificationStatus = finding.codification_status ?? 'open';
  const cost: CodificationCost | undefined = finding.cost;
  return `codification=${status}${cost ? ` cost=${cost}` : ''}`;
}

export function collectOpenCodificationCandidates(data: FindingsFile | null): Array<{
  sprint: string;
  index: number;
  finding: ReviewFinding;
}> {
  if (!data) return [];

  const candidates: Array<{ sprint: string; index: number; finding: ReviewFinding }> = [];
  for (const sprint of findingSprintKeys(data)) {
    const findings = data.sprints[sprint] ?? [];
    for (const [index, finding] of findings.entries()) {
      if (isOpenCodificationCandidate(finding)) {
        candidates.push({ sprint, index, finding });
      }
    }
  }
  return candidates;
}

export function formatCodificationCandidatesForBriefing(data: FindingsFile | null): string[] {
  const candidates = collectOpenCodificationCandidates(data);
  if (candidates.length === 0) return [];

  const structural = candidates.filter(({ finding }) => isCodificationCandidate(finding)).length;
  const lines = [`CODIFICATION CANDIDATES: ${candidates.length} open (${structural} structural)`];

  for (const { sprint, index, finding } of candidates.slice(0, 5)) {
    const id = displayFindingId(finding, sprint, index);
    const severity = finding.severity.toUpperCase();
    const cost = finding.cost ? ` cost=${finding.cost}` : '';
    const codifyNow = finding.cost === 's' ? ' [codify now]' : '';
    lines.push(`  - ${id} S${sprint} [${severity}${cost}]: ${finding.description}${codifyNow}`);
  }

  const omitted = candidates.length - 5;
  if (omitted > 0) {
    lines.push(`  ... ${omitted} more open candidate${omitted === 1 ? '' : 's'} omitted`);
  }

  return lines;
}
