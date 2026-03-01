// SLOPE — Structured Execution Plan Generator
// Generates per-ticket execution plans for agent injection.

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, basename as pathBasename, extname } from 'node:path';
import type { EmbeddingConfig } from './embedding.js';
import type { EmbeddingStore } from './embedding-store.js';
import type { GolfScorecard } from './types.js';
import { embed } from './embedding-client.js';
import { deduplicateByFile } from './context.js';
import type { ContextResult } from './context.js';

// --- Types ---

export interface PrepPlan {
  ticket: string;
  title: string;
  club: string;
  description: string;

  files: {
    modify: Array<{ path: string; relevance: number; snippet: string }>;
    test: string[];
  };

  similarTickets: Array<{
    key: string;
    title: string;
    result: string;
    sprint: number;
  }>;

  hazards: string[];
  constraints: string[];
  verification: string[];

  metadata: {
    version: 1;
    generatedAt: string;
    estimatedTokens: number;
    queryText: string;
  };
}

export interface TicketData {
  key: string;
  title: string;
  description: string;
  modules: string[];
  acceptance_criteria: string[];
  club: string;
  max_files: number;
}

// --- Stop words for keyword matching ---

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those',
  'it', 'its', 'as', 'if', 'not', 'no', 'so', 'up', 'out', 'all',
]);

// --- Helpers (exported for reuse by enrich.ts) ---

function extractTicketData(ticket: Record<string, unknown>, fallbackKey: string): TicketData {
  return {
    key: (ticket.key as string) ?? (ticket.id as string) ?? fallbackKey,
    title: (ticket.title as string) ?? '',
    description: (ticket.description as string) ?? '',
    modules: (ticket.modules as string[]) ?? [],
    acceptance_criteria: (ticket.acceptance_criteria as string[]) ?? [],
    club: (ticket.club as string) ?? 'short_iron',
    max_files: (ticket.max_files as number) ?? 1,
  };
}

/**
 * Resolve full ticket data from backlog or roadmap.
 */
export function resolveTicket(
  ticketId: string,
  cwd: string,
  backlogPath?: string,
  roadmapPath?: string,
): TicketData | null {
  // Try roadmap first
  const rPath = roadmapPath
    ? (roadmapPath.startsWith('/') ? roadmapPath : join(cwd, roadmapPath))
    : join(cwd, 'docs/backlog/roadmap.json');

  if (existsSync(rPath)) {
    try {
      const roadmap = JSON.parse(readFileSync(rPath, 'utf8'));
      for (const sprint of roadmap.sprints ?? []) {
        for (const ticket of sprint.tickets ?? []) {
          if (ticket.key === ticketId || ticket.id === ticketId) {
            return extractTicketData(ticket, ticketId);
          }
        }
      }
    } catch { /* fall through */ }
  }

  // Try backlog
  const bPath = backlogPath
    ? (backlogPath.startsWith('/') ? backlogPath : join(cwd, backlogPath))
    : join(cwd, 'slope-loop/backlog.json');

  if (existsSync(bPath)) {
    try {
      const backlog = JSON.parse(readFileSync(bPath, 'utf8'));
      for (const sprint of backlog.sprints ?? []) {
        for (const ticket of sprint.tickets ?? []) {
          if (ticket.key === ticketId || ticket.id === ticketId) {
            return extractTicketData(ticket, ticketId);
          }
        }
      }
    } catch { /* fall through */ }
  }

  return null;
}

/**
 * Build embedding query text from ticket fields.
 */
export function buildQueryText(ticket: { title: string; description: string; modules: string[] }): string {
  const parts = [ticket.title, ticket.description];
  if (ticket.modules.length > 0) parts.push(ticket.modules.join(' '));
  return parts.filter(Boolean).join(' ');
}

/**
 * Walk a directory recursively and return all file paths.
 */
function walkDir(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

/**
 * Find test files matching source file stems.
 */
export function collectTestFiles(primaryPaths: string[], cwd: string): string[] {
  const testsDir = join(cwd, 'tests');
  if (!existsSync(testsDir)) return [];

  const allTestFiles = walkDir(testsDir)
    .filter(f => f.endsWith('.test.ts') || f.endsWith('.test.js'))
    .map(f => f.slice(cwd.length + 1)); // relative to cwd

  const matched = new Set<string>();

  for (const primaryPath of primaryPaths) {
    const base = pathBasename(primaryPath);
    const stem = base.replace(extname(base), '');

    for (const testFile of allTestFiles) {
      const testBase = pathBasename(testFile);
      const testStem = testBase.replace(/\.test\.(ts|js)$/, '');

      // Exact stem match
      if (testStem === stem) {
        matched.add(testFile);
      }
      // Fuzzy match (stem must be >= 3 chars to avoid false positives)
      else if (stem.length >= 3 && testStem.includes(stem)) {
        matched.add(testFile);
      }
    }
  }

  return [...matched];
}

/**
 * Tokenize text for keyword matching.
 */
function tokenize(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Find similar past tickets from scorecards by keyword overlap.
 */
export function findSimilarTickets(
  title: string,
  scorecards: GolfScorecard[],
  maxResults = 3,
): Array<{ key: string; title: string; result: string; sprint: number }> {
  const titleTokens = new Set(tokenize(title));
  if (titleTokens.size === 0) return [];

  const scored: Array<{ key: string; title: string; result: string; sprint: number; overlap: number }> = [];

  for (const card of scorecards) {
    for (const shot of card.shots) {
      const shotTokens = tokenize(shot.title);
      const overlap = shotTokens.filter(t => titleTokens.has(t)).length;
      if (overlap > 0) {
        scored.push({
          key: shot.ticket_key,
          title: shot.title,
          result: shot.result,
          sprint: card.sprint_number,
          overlap,
        });
      }
    }
  }

  return scored
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, maxResults)
    .map(({ key, title: t, result, sprint }) => ({ key, title: t, result, sprint }));
}

/**
 * Extract hazards from recent scorecards' bunker_locations.
 */
export function extractHazards(
  modules: string[],
  scorecards: GolfScorecard[],
  recentCount = 5,
): string[] {
  const recent = scorecards.slice(-recentCount);
  const seen = new Set<string>();
  const hazards: string[] = [];

  for (const card of recent) {
    for (const location of card.bunker_locations) {
      const matches = modules.length === 0 || modules.some(m =>
        location.toLowerCase().includes(m.toLowerCase()),
      );
      if (matches && !seen.has(location)) {
        seen.add(location);
        hazards.push(`${location} (S${card.sprint_number})`);
      }
    }
  }

  return hazards;
}

// --- Main functions ---

/**
 * Generate a structured execution plan for a ticket.
 */
export async function generatePrepPlan(opts: {
  ticketId: string;
  store: EmbeddingStore;
  embeddingConfig: EmbeddingConfig;
  scorecards: GolfScorecard[];
  cwd: string;
  backlogPath?: string;
  roadmapPath?: string;
  topK?: number;
}): Promise<PrepPlan> {
  const { ticketId, store, embeddingConfig, scorecards, cwd, topK = 5 } = opts;

  // 1. Resolve ticket
  const ticket = resolveTicket(ticketId, cwd, opts.backlogPath, opts.roadmapPath);
  if (!ticket) {
    throw new Error(`Ticket not found: ${ticketId}`);
  }

  // 2. Embedding search
  const queryText = buildQueryText(ticket);
  const [queryVector] = await embed([queryText], embeddingConfig);
  const rawResults = await store.searchEmbeddings(queryVector, topK * 3);

  const contextResults: ContextResult[] = rawResults.map(r => ({
    filePath: r.filePath,
    chunkIndex: r.chunkIndex,
    snippet: r.chunkText,
    score: r.score,
  }));

  const deduped = deduplicateByFile(contextResults)
    .filter(r => r.score >= 0.4)
    .slice(0, topK);

  // 3. Test files
  const primaryPaths = deduped.map(r => r.filePath);
  const testFiles = collectTestFiles(primaryPaths, cwd);

  // 4. Similar tickets
  const similarTickets = findSimilarTickets(ticket.title, scorecards);

  // 5. Hazards
  const hazards = extractHazards(ticket.modules, scorecards);

  // 6. Token estimate (primary files only — display metric)
  let totalBytes = 0;
  for (const fp of primaryPaths) {
    try { totalBytes += statSync(join(cwd, fp)).size; } catch { /* skip */ }
  }
  const estimatedTokens = Math.ceil((totalBytes / 4) * 1.2);

  // 7. Constraints (deduplicate defaults against acceptance_criteria)
  const defaults = ['pnpm test passes', 'pnpm typecheck passes'];
  const constraints = [
    ...(ticket.acceptance_criteria || []),
    ...defaults.filter(d => !(ticket.acceptance_criteria || []).includes(d)),
  ];

  return {
    ticket: ticket.key,
    title: ticket.title,
    club: ticket.club,
    description: ticket.description,
    files: {
      modify: deduped.map(r => ({
        path: r.filePath,
        relevance: r.score,
        snippet: r.snippet,
      })),
      test: testFiles,
    },
    similarTickets,
    hazards,
    constraints,
    verification: ['pnpm test', 'pnpm typecheck'],
    metadata: {
      version: 1,
      generatedAt: new Date().toISOString(),
      estimatedTokens,
      queryText,
    },
  };
}

/**
 * Format a PrepPlan as markdown for Aider --read injection.
 */
export function formatPrepPlan(plan: PrepPlan): string {
  const lines: string[] = [];

  lines.push(`# Execution Plan: ${plan.ticket}`);
  lines.push(`## ${plan.title}`);
  lines.push(`Club: ${plan.club} | Est. tokens: ${plan.metadata.estimatedTokens}`);
  lines.push('');

  lines.push('## Files to Modify');
  for (const f of plan.files.modify) {
    lines.push(`- ${f.path} (relevance: ${f.relevance.toFixed(2)})`);
    if (f.snippet) {
      lines.push('  ```');
      const snippetLines = f.snippet.split('\n').slice(0, 10);
      for (const sl of snippetLines) {
        lines.push(`  ${sl}`);
      }
      if (f.snippet.split('\n').length > 10) {
        lines.push('  ...');
      }
      lines.push('  ```');
    }
  }
  for (const t of plan.files.test) {
    lines.push(`- ${t} (test file)`);
  }
  lines.push('');

  if (plan.similarTickets.length > 0) {
    lines.push('## Similar Past Tickets');
    for (const st of plan.similarTickets) {
      lines.push(`- ${st.key}: "${st.title}" \u2192 ${st.result} (sprint ${st.sprint})`);
    }
    lines.push('');
  }

  if (plan.hazards.length > 0) {
    lines.push('## Hazards');
    for (const h of plan.hazards) {
      lines.push(`- ${h}`);
    }
    lines.push('');
  }

  lines.push('## Constraints');
  for (const c of plan.constraints) {
    lines.push(`- ${c}`);
  }
  lines.push('');

  lines.push('## Verification');
  for (const v of plan.verification) {
    lines.push(`- ${v}`);
  }

  return lines.join('\n');
}
