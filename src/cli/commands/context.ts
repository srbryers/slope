// slope context — Semantic context search for agents
// Usage: slope context "query" | --ticket=KEY | --file=PATH

import { readFileSync, existsSync } from 'node:fs';
import { loadConfig } from '../../core/config.js';
import { embed } from '../../core/embedding-client.js';
import { hasEmbeddingSupport } from '../../core/embedding-store.js';
import { deduplicateByFile, formatContextForAgent } from '../../core/context.js';
import type { ContextResult } from '../../core/context.js';
import type { EmbeddingConfig } from '../../core/embedding.js';
import { SqliteSlopeStore } from '../../store/index.js';

function parseArgs(args: string[]): {
  query: string | null;
  ticket: string | null;
  file: string | null;
  top: number;
  format: 'paths' | 'snippets' | 'full';
  minScore: number;
} {
  let query: string | null = null;
  let ticket: string | null = null;
  let file: string | null = null;
  let top = 5;
  let format: 'paths' | 'snippets' | 'full' = 'snippets';
  let minScore = 0.0;

  for (const arg of args) {
    if (arg.startsWith('--ticket=')) {
      ticket = arg.slice('--ticket='.length);
    } else if (arg.startsWith('--file=')) {
      file = arg.slice('--file='.length);
    } else if (arg.startsWith('--top=')) {
      top = parseInt(arg.slice('--top='.length), 10) || 5;
    } else if (arg.startsWith('--min-score=')) {
      minScore = parseFloat(arg.slice('--min-score='.length)) || 0;
    } else if (arg.startsWith('--format=')) {
      const f = arg.slice('--format='.length);
      if (f === 'paths' || f === 'snippets' || f === 'full') {
        format = f;
      }
    } else if (!arg.startsWith('-')) {
      query = arg;
    }
  }

  return { query, ticket, file, top, format, minScore };
}

function resolveTicketQuery(ticketKey: string, cwd: string, config: ReturnType<typeof loadConfig>): string {
  // Try roadmap first
  const roadmapPath = `${cwd}/${config.roadmapPath ?? 'docs/backlog/roadmap.json'}`;
  if (existsSync(roadmapPath)) {
    try {
      const roadmap = JSON.parse(readFileSync(roadmapPath, 'utf8'));
      for (const sprint of roadmap.sprints ?? []) {
        for (const ticket of sprint.tickets ?? []) {
          if (ticket.key === ticketKey || ticket.id === ticketKey) {
            const parts = [ticket.title ?? '', ticket.description ?? ''];
            if (ticket.modules) parts.push(ticket.modules.join(' '));
            return parts.filter(Boolean).join(' ');
          }
        }
      }
    } catch {
      // Fall through
    }
  }

  // Try slope-loop backlog
  const backlogPath = `${cwd}/slope-loop/backlog.json`;
  if (existsSync(backlogPath)) {
    try {
      const backlog = JSON.parse(readFileSync(backlogPath, 'utf8'));
      for (const sprint of backlog.sprints ?? []) {
        for (const ticket of sprint.tickets ?? []) {
          if (ticket.key === ticketKey || ticket.id === ticketKey) {
            const parts = [ticket.title ?? '', ticket.description ?? ''];
            if (ticket.modules) parts.push(ticket.modules.join(' '));
            return parts.filter(Boolean).join(' ');
          }
        }
      }
    } catch {
      // Fall through
    }
  }

  // Fall back to ticket key as query
  return ticketKey;
}

function resolveFileQuery(filePath: string, cwd: string): string {
  const fullPath = `${cwd}/${filePath}`;
  if (existsSync(fullPath)) {
    try {
      const content = readFileSync(fullPath, 'utf8');
      // Use first 500 chars as query
      return content.slice(0, 500);
    } catch {
      return filePath;
    }
  }
  return filePath;
}

export async function contextCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  const flags = parseArgs(args);

  // Determine query text
  let queryText: string;
  if (flags.ticket) {
    queryText = resolveTicketQuery(flags.ticket, cwd, config);
  } else if (flags.file) {
    queryText = resolveFileQuery(flags.file, cwd);
  } else if (flags.query) {
    queryText = flags.query;
  } else {
    console.error('Error: Provide a search query, --ticket=KEY, or --file=PATH');
    process.exit(1);
  }

  // Resolve embedding config
  const emb = config.embedding;
  if (!emb) {
    console.error('Error: No embedding config in .slope/config.json. Run `slope index` first.');
    process.exit(1);
  }

  const embConfig: EmbeddingConfig = {
    endpoint: emb.endpoint,
    model: emb.model,
    dimensions: emb.dimensions,
    apiKey: emb.apiKey,
  };

  // Open store
  const storePath = config.store_path ?? '.slope/slope.db';
  const store = new SqliteSlopeStore(`${cwd}/${storePath}`);

  try {
    if (!hasEmbeddingSupport(store)) {
      throw new Error('Store does not support embeddings. Run `slope index` first.');
    }

    // Check if index exists
    const stats = await store.getEmbeddingStats();
    if (stats.chunkCount === 0) {
      throw new Error('Semantic index is empty. Run `slope index` first.');
    }

    // Embed the query
    const [queryVector] = await embed([queryText], embConfig);

    // Search — fetch more than topK to allow dedup
    const rawResults = await store.searchEmbeddings(queryVector, flags.top * 3);

    // Map to ContextResult
    const contextResults: ContextResult[] = rawResults.map(r => ({
      filePath: r.filePath,
      chunkIndex: r.chunkIndex,
      snippet: r.chunkText,
      score: r.score,
    }));

    // Deduplicate by file, filter by min score, and limit
    const threshold = flags.minScore > 0 ? flags.minScore : 0.4;
    const deduped = deduplicateByFile(contextResults)
      .filter(r => r.score >= threshold)
      .slice(0, flags.top);

    if (deduped.length === 0) {
      // Output nothing — caller checks for empty
      return;
    }

    // Format and output
    const output = formatContextForAgent(deduped, flags.format, cwd);
    console.log(output);
  } finally {
    store.close();
  }
}

function printUsage(): void {
  console.log(`
slope context — Semantic context search

Usage:
  slope context "search query"              Free-text semantic search
  slope context --ticket=S46-1              Use ticket title as query
  slope context --file=src/core/store.ts    Find files related to a given file
  slope context --top=10                    Limit results (default: 5)
  slope context --format=paths              Output file paths only
  slope context --format=snippets           Output code snippets (default)
  slope context --format=full               Output full file contents of matches

Requires a built semantic index. Run \`slope index\` first.
`);
}
