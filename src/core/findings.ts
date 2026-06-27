import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { CodificationCost, CodificationStatus, ReviewFinding } from './types.js';

export const FINDINGS_FILE = '.slope/review-findings.json';

export interface FindingsFile {
  sprints: Record<number, ReviewFinding[]>;
}

export function loadFindings(cwd: string): FindingsFile | null {
  const filePath = join(cwd, FINDINGS_FILE);
  if (!existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as {
      sprint_number?: number;
      findings?: ReviewFinding[];
      sprints?: Record<number, ReviewFinding[]>;
    };
    if (raw.sprints) return { sprints: raw.sprints };
    if (raw.sprint_number != null && raw.findings) {
      return { sprints: { [raw.sprint_number]: raw.findings } };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveFindings(cwd: string, data: FindingsFile): void {
  const dir = join(cwd, '.slope');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(cwd, FINDINGS_FILE), JSON.stringify(data, null, 2) + '\n');
}

export function createFindingId(): string {
  return randomUUID();
}

export function displayFindingId(finding: ReviewFinding, sprint: number, index: number): string {
  return finding.id ? finding.id.slice(0, 8) : `S${sprint}:${index + 1}`;
}

export function matchesFindingId(finding: ReviewFinding, sprint: number, index: number, id: string): boolean {
  const fallbackId = `S${sprint}:${index + 1}`;
  return finding.id === id || Boolean(finding.id?.startsWith(id)) || fallbackId === id;
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
