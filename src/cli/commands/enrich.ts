// slope enrich — Batch-enrich backlog with file context
// Usage: slope enrich [backlog-path] [--output=path] [--with-plans] [--top=5]

import { existsSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../../core/config.js';
import { hasEmbeddingSupport } from '../../core/embedding-store.js';
import { loadScorecards } from '../../core/loader.js';
import { enrichBacklog } from '../../core/enrich.js';
import { generatePrepPlan, formatPrepPlan } from '../../core/prep.js';
import type { EmbeddingConfig } from '../../core/embedding.js';
import { SqliteSlopeStore } from '../../store/index.js';

function parseArgs(args: string[]): {
  backlogPath: string | null;
  output: string | null;
  withPlans: boolean;
  top: number;
} {
  let backlogPath: string | null = null;
  let output: string | null = null;
  let withPlans = false;
  let top = 5;

  for (const arg of args) {
    if (arg === '--with-plans') {
      withPlans = true;
    } else if (arg.startsWith('--output=')) {
      output = arg.slice('--output='.length);
    } else if (arg.startsWith('--top=')) {
      top = parseInt(arg.slice('--top='.length), 10) || 5;
    } else if (!arg.startsWith('-')) {
      backlogPath = arg;
    }
  }

  return { backlogPath, output, withPlans, top };
}

export async function enrichCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  const flags = parseArgs(args);

  const backlogPath = flags.backlogPath
    ? (flags.backlogPath.startsWith('/') ? flags.backlogPath : join(cwd, flags.backlogPath))
    : join(cwd, 'slope-loop/backlog.json');

  if (!existsSync(backlogPath)) {
    console.error(`Error: Backlog not found at ${backlogPath}`);
    process.exit(1);
  }

  const outputPath = flags.output
    ? (flags.output.startsWith('/') ? flags.output : join(cwd, flags.output))
    : backlogPath;

  // Embedding config
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

    const enriched = await enrichBacklog({
      backlogPath,
      store,
      embeddingConfig: embConfig,
      scorecards,
      cwd,
      topK: flags.top,
    });

    // Atomic write: tmp file then rename
    const tmpPath = `${outputPath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(enriched, null, 2));
    renameSync(tmpPath, outputPath);

    // Generate plans if requested
    if (flags.withPlans) {
      const plansDir = join(cwd, 'slope-loop/plans');
      mkdirSync(plansDir, { recursive: true });

      for (const sprint of enriched.sprints) {
        for (const ticket of sprint.tickets) {
          try {
            const plan = await generatePrepPlan({
              ticketId: ticket.key,
              store,
              embeddingConfig: embConfig,
              scorecards,
              cwd,
              topK: flags.top,
            });
            writeFileSync(join(plansDir, `${ticket.key}.md`), formatPrepPlan(plan));
          } catch (err) {
            console.error(`Warning: Could not generate plan for ${ticket.key}: ${(err as Error).message}`);
          }
        }
      }
    }

    // Summary
    let totalTickets = 0;
    let totalTokens = 0;
    for (const sprint of enriched.sprints) {
      totalTickets += sprint.tickets.length;
      for (const ticket of sprint.tickets) {
        totalTokens += ticket.estimated_tokens;
      }
    }
    const avgTokens = totalTickets > 0 ? Math.round(totalTokens / totalTickets) : 0;

    console.log(`Enriched ${enriched.sprints.length} sprints, ${totalTickets} tickets. Avg tokens: ${avgTokens}`);
    if (flags.withPlans) {
      console.log(`Plans written to slope-loop/plans/`);
    }
  } finally {
    store.close();
  }
}

function printUsage(): void {
  console.log(`
slope enrich — Batch-enrich backlog with file context

Usage:
  slope enrich [backlog-path]             Enrich tickets (default: slope-loop/backlog.json)
  slope enrich --output=<path>            Write to different file (default: overwrite)
  slope enrich --with-plans               Also generate prep plans to slope-loop/plans/
  slope enrich --top=5                    Max files per ticket (default: 5)

Requires a built semantic index. Run \`slope index\` first.
`);
}
