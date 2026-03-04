import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Result of finding a plan file */
export interface PlanFile {
  path: string;
  content: string;
}

/** Extracted ticket info for specialist selection */
export interface TicketInfo {
  title: string;
  filePatterns: string[];
}

/**
 * Find the most recently modified plan file in .claude/plans/.
 */
export function findPlanContent(cwd: string): PlanFile | null {
  const plansDir = join(cwd, '.claude', 'plans');
  if (!existsSync(plansDir)) return null;

  try {
    const files = readdirSync(plansDir)
      .filter(f => f.endsWith('.md'))
      .map(f => ({
        name: f,
        path: join('.claude', 'plans', f),
        fullPath: join(plansDir, f),
        mtime: (() => { try { return statSync(join(plansDir, f)).mtimeMs; } catch { return 0; } })(),
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length > 0) {
      return { path: files[0].path, content: readFileSync(files[0].fullPath, 'utf8') };
    }
  } catch { /* can't read plans dir */ }

  return null;
}

/**
 * Count tickets in plan content.
 * Matches `### T\d+:` or `### S\d+-\d+:` patterns, falls back to all H3 headers.
 */
export function countTickets(content: string): number {
  const ticketHeaders = content.match(/^###\s+(?:T\d+|S\d+-\d+):/gm) ?? [];
  if (ticketHeaders.length > 0) return ticketHeaders.length;

  // Fallback: count ### level headers that look like tickets
  const h3Headers = content.match(/^###\s+/gm) ?? [];
  return h3Headers.length;
}

/**
 * Count distinct packages/ references in plan content.
 */
export function countPackageRefs(content: string): number {
  const refs = new Set<string>();
  const matches = content.matchAll(/packages\/(\w[\w-]*)/g);
  for (const m of matches) refs.add(m[1]);
  return refs.size;
}

/**
 * Extract backtick-wrapped file paths from plan content.
 */
export function extractFilePatterns(content: string): string[] {
  const patterns: string[] = [];
  const matches = content.matchAll(/`([^`]+\.[a-z]+)`/g);
  for (const m of matches) patterns.push(m[1]);
  return patterns;
}

/**
 * Extract ticket titles and their associated file references for specialist selection.
 */
export function extractTicketInfo(content: string): TicketInfo[] {
  const tickets: TicketInfo[] = [];
  // Split on ticket headers (### T\d+: or ### S\d+-\d+:)
  const headerPattern = /^###\s+(?:T\d+|S\d+-\d+):\s*(.+)$/gm;
  const headers: Array<{ title: string; index: number }> = [];

  let match;
  while ((match = headerPattern.exec(content)) !== null) {
    headers.push({ title: match[1].trim(), index: match.index });
  }

  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].index;
    const end = i + 1 < headers.length ? headers[i + 1].index : content.length;
    const section = content.slice(start, end);
    const filePatterns = extractFilePatterns(section);
    tickets.push({ title: headers[i].title, filePatterns });
  }

  return tickets;
}
