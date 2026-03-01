// SLOPE — Backlog Enrichment
// Batch-enriches tickets with file context, token estimates, and hazards.

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { EmbeddingConfig } from './embedding.js';
import type { EmbeddingStore } from './embedding-store.js';
import type { GolfScorecard } from './types.js';
import { embed } from './embedding-client.js';
import { deduplicateByFile } from './context.js';
import type { ContextResult } from './context.js';
import {
  buildQueryText,
  collectTestFiles,
  findSimilarTickets,
  extractHazards,
} from './prep.js';

// --- Types ---

export interface EnrichedTicket {
  // Original fields preserved
  key: string;
  title: string;
  club: string;
  description: string;
  acceptance_criteria: string[];
  modules: string[];
  max_files: number;
  // Enriched fields
  files: {
    primary: string[];
    test: string[];
    related: string[];
  };
  estimated_tokens: number;
  similar_tickets: Array<{ key: string; title: string; result: string; sprint: number }>;
  hazards: string[];
}

export interface EnrichedBacklog {
  sprints: Array<{
    id: string;
    title?: string;
    strategy?: string;
    tickets: EnrichedTicket[];
    [key: string]: unknown;
  }>;
  _enrichMeta: {
    version: 1;
    enrichedAt: string;
    topK: number;
  };
  [key: string]: unknown;
}

// --- Functions ---

/**
 * Estimate token count for a list of files.
 * Uses bytes/4 with 1.2x safety factor (TypeScript averages ~3.3 bytes/token).
 */
export function estimateTokens(filePaths: string[], cwd: string): number {
  let totalBytes = 0;
  for (const fp of filePaths) {
    try { totalBytes += statSync(join(cwd, fp)).size; } catch { /* skip missing */ }
  }
  return Math.ceil((totalBytes / 4) * 1.2);
}

/**
 * Enrich a single ticket with file context and metadata.
 */
export async function enrichTicket(opts: {
  ticket: {
    key: string;
    title: string;
    description: string;
    modules: string[];
    acceptance_criteria: string[];
    club: string;
    max_files: number;
  };
  store: EmbeddingStore;
  embeddingConfig: EmbeddingConfig;
  scorecards: GolfScorecard[];
  cwd: string;
  topK?: number;
}): Promise<EnrichedTicket> {
  const { ticket, store, embeddingConfig, scorecards, cwd, topK = 5 } = opts;

  // Build query and search
  const queryText = buildQueryText(ticket);
  const [queryVector] = await embed([queryText], embeddingConfig);
  const rawResults = await store.searchEmbeddings(queryVector, topK * 3);

  const contextResults: ContextResult[] = rawResults.map(r => ({
    filePath: r.filePath,
    chunkIndex: r.chunkIndex,
    snippet: r.chunkText,
    score: r.score,
  }));

  const deduped = deduplicateByFile(contextResults);

  // Split into primary (>= 0.55) and related (>= 0.4)
  const primary = deduped.filter(r => r.score >= 0.55).slice(0, topK);
  const related = deduped.filter(r => r.score >= 0.4 && r.score < 0.55).slice(0, topK);

  const primaryPaths = primary.map(r => r.filePath);
  const relatedPaths = related.map(r => r.filePath);

  // Test files
  const testFiles = collectTestFiles(primaryPaths, cwd);

  // Token estimate (all files — routing metric)
  const allPaths = [...primaryPaths, ...testFiles, ...relatedPaths];
  const estimated_tokens = estimateTokens(allPaths, cwd);

  // Similar tickets
  const similar_tickets = findSimilarTickets(ticket.title, scorecards);

  // Hazards
  const hazards = extractHazards(ticket.modules, scorecards);

  return {
    key: ticket.key,
    title: ticket.title,
    club: ticket.club,
    description: ticket.description,
    acceptance_criteria: ticket.acceptance_criteria,
    modules: ticket.modules,
    max_files: ticket.max_files,
    files: {
      primary: primaryPaths,
      test: testFiles,
      related: relatedPaths,
    },
    estimated_tokens,
    similar_tickets,
    hazards,
  };
}

/**
 * Enrich all tickets in a backlog.
 */
export async function enrichBacklog(opts: {
  backlogPath: string;
  store: EmbeddingStore;
  embeddingConfig: EmbeddingConfig;
  scorecards: GolfScorecard[];
  cwd: string;
  topK?: number;
}): Promise<EnrichedBacklog> {
  const { backlogPath, store, embeddingConfig, scorecards, cwd, topK = 5 } = opts;

  const raw = JSON.parse(readFileSync(backlogPath, 'utf8'));
  const sprints = raw.sprints ?? [];

  const enrichedSprints: EnrichedBacklog['sprints'] = [];

  for (const sprint of sprints) {
    const enrichedTickets: EnrichedTicket[] = [];
    for (const ticket of sprint.tickets ?? []) {
      const enriched = await enrichTicket({
        ticket: {
          key: ticket.key ?? ticket.id ?? '',
          title: ticket.title ?? '',
          description: ticket.description ?? '',
          modules: ticket.modules ?? [],
          acceptance_criteria: ticket.acceptance_criteria ?? [],
          club: ticket.club ?? 'short_iron',
          max_files: ticket.max_files ?? 1,
        },
        store,
        embeddingConfig,
        scorecards,
        cwd,
        topK,
      });
      enrichedTickets.push(enriched);
    }

    enrichedSprints.push({
      ...sprint,
      tickets: enrichedTickets,
    });
  }

  return {
    ...raw,
    sprints: enrichedSprints,
    _enrichMeta: {
      version: 1,
      enrichedAt: new Date().toISOString(),
      topK,
    },
  };
}
