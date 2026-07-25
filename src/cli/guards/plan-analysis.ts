import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Result of finding a plan file */
export interface PlanFile {
  path: string;
  content: string;
}

export interface FindPlanContentOptions {
  includeRepoLocal?: boolean;
  includeGlobal?: boolean;
}

/** Extracted ticket info for specialist selection */
export interface TicketInfo {
  title: string;
  filePatterns: string[];
}

/**
 * Find the most recently modified plan file in .claude/plans/.
 * Searches repo-local first ({cwd}/.claude/plans/), then falls back
 * to global (~/.claude/plans/) since Claude Code writes plans there.
 */
export function findPlanContent(cwd: string, options: FindPlanContentOptions = {}): PlanFile | null {
  const repoLocal = join(cwd, '.claude', 'plans');
  const global = join(homedir(), '.claude', 'plans');
  const includeRepoLocal = options.includeRepoLocal ?? true;
  const includeGlobal = options.includeGlobal ?? true;

  // Deduplicate when cwd is the home directory
  const searchDirs: Array<{ dir: string; relative: boolean }> = [
    ...(includeRepoLocal ? [{ dir: repoLocal, relative: true }] : []),
  ];
  if (includeGlobal && global.replace(/\\/g, '/') !== repoLocal.replace(/\\/g, '/')) {
    searchDirs.push({ dir: global, relative: false });
  }

  for (const { dir: plansDir, relative } of searchDirs) {
    if (!existsSync(plansDir)) continue;

    try {
      const files = readdirSync(plansDir)
        .filter(f => f.endsWith('.md'))
        .map(f => ({
          name: f,
          // Repo-local: relative path (preserves original behavior for review-state storage)
          // Global: absolute path (needed since it's outside the repo)
          path: relative
            ? join('.claude', 'plans', f).replace(/\\/g, '/')
            : join(plansDir, f).replace(/\\/g, '/'),
          fullPath: join(plansDir, f),
          mtime: (() => { try { return statSync(join(plansDir, f)).mtimeMs; } catch { return 0; } })(),
        }))
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length > 0) {
        return { path: files[0].path, content: readFileSync(files[0].fullPath, 'utf8') };
      }
    } catch { /* can't read plans dir */ }
  }

  return null;
}

/**
 * Count tickets in plan content.
 * Matches `### T\d+:` or `### S\d+-\d+:` patterns, then the Markdown
 * ticket table emitted by `slope sprint plan`, then distinct ticket keys
 * anywhere in the document, and finally falls back to all H3 headers.
 */
export function countTickets(content: string): number {
  const ticketHeaders = content.match(/^###\s+(?:T\d+|S\d+-\d+):/gm) ?? [];
  if (ticketHeaders.length > 0) return ticketHeaders.length;

  const ticketTableRows = content.match(/^\|\s*(?:T\d+|S\d+(?:\.\d+)?-\d+)\s*\|/gim) ?? [];
  if (ticketTableRows.length > 0) return ticketTableRows.length;

  // Neither headers nor a table: plans commonly list tickets as bold bullets,
  // e.g. `- **S156-1** (long_iron / multi-package): ...`. Missing those reported
  // 0 tickets and silently downgraded a Standard-tier plan to Skip, waving a
  // schema+API sprint through with no review (GH #634).
  //
  // Counted as a distinct set so dependency back-references (`depends_on:
  // S156-1`) cannot inflate the total. Only reached when the two explicit
  // formats found nothing, so well-formed plans are unaffected.
  const ticketKeys = new Set<string>();
  for (const match of content.matchAll(/\b(?:T\d+|S\d+(?:\.\d+)?-\d+)\b/g)) {
    ticketKeys.add(match[0]);
  }
  if (ticketKeys.size > 0) return ticketKeys.size;

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
