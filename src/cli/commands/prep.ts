// slope prep — Generate execution plan for a ticket
// Usage: slope prep <ticket-id> [--json] [--top=5]

import { loadConfig } from '../../core/config.js';
import { hasEmbeddingSupport } from '../../core/embedding-store.js';
import { loadScorecards } from '../../core/loader.js';
import { generatePrepPlan, formatPrepPlan } from '../../core/prep.js';
import type { EmbeddingConfig } from '../../core/embedding.js';
import { SqliteSlopeStore } from '../../store/index.js';

function parseArgs(args: string[]): {
  ticketId: string | null;
  json: boolean;
  top: number;
} {
  let ticketId: string | null = null;
  let json = false;
  let top = 5;

  for (const arg of args) {
    if (arg === '--json') {
      json = true;
    } else if (arg.startsWith('--top=')) {
      top = parseInt(arg.slice('--top='.length), 10) || 5;
    } else if (!arg.startsWith('-')) {
      ticketId = arg;
    }
  }

  return { ticketId, json, top };
}

export async function prepCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  const flags = parseArgs(args);

  if (!flags.ticketId) {
    console.error('Error: Provide a ticket ID. Usage: slope prep <ticket-id>');
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

    const stats = await store.getEmbeddingStats();
    if (stats.chunkCount === 0) {
      throw new Error('Semantic index is empty. Run `slope index` first.');
    }

    const scorecards = loadScorecards(config, cwd);

    const plan = await generatePrepPlan({
      ticketId: flags.ticketId,
      store,
      embeddingConfig: embConfig,
      scorecards,
      cwd,
      roadmapPath: config.roadmapPath,
      topK: flags.top,
    });

    if (flags.json) {
      console.log(JSON.stringify(plan, null, 2));
    } else {
      console.log(formatPrepPlan(plan));
    }
  } finally {
    store.close();
  }
}

function printUsage(): void {
  console.log(`
slope prep — Generate execution plan for a ticket

Usage:
  slope prep <ticket-id>              Generate execution plan
  slope prep <ticket-id> --json       Output as JSON
  slope prep <ticket-id> --top=5      Max context files (default: 5)

Requires a built semantic index. Run \`slope index\` first.
Looks up ticket in roadmap.json and slope-loop/backlog.json.
`);
}
