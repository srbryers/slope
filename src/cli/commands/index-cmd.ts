// slope index — Semantic embedding index management
// Subcommands: (default) incremental, --full, --status, --prune

import { execSync, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../../core/config.js';
import { chunkFile, shouldSkipFile } from '../../core/embedding.js';
import { embedBatch } from '../../core/embedding-client.js';
import { hasEmbeddingSupport } from '../../core/embedding-store.js';
import type { EmbeddingConfig, CodeChunk } from '../../core/embedding.js';
import { SqliteSlopeStore } from '../../store/index.js';

function exec(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', timeout: 30000 }).trim();
  } catch {
    return '';
  }
}

function parseArgs(args: string[]): { full: boolean; status: boolean; prune: boolean; json: boolean } {
  return {
    full: args.includes('--full'),
    status: args.includes('--status'),
    prune: args.includes('--prune'),
    json: args.includes('--json'),
  };
}

function resolveEmbeddingConfig(config: ReturnType<typeof loadConfig>): EmbeddingConfig {
  const emb = config.embedding;
  if (!emb) {
    throw new Error(
      'No embedding config found in .slope/config.json.\n' +
      'Add an "embedding" section with endpoint, model, and dimensions.\n' +
      'Example:\n  "embedding": {\n    "endpoint": "http://localhost:11434/v1/embeddings",\n    "model": "nomic-embed-text",\n    "dimensions": 768\n  }',
    );
  }
  return {
    endpoint: emb.endpoint,
    model: emb.model,
    dimensions: emb.dimensions,
    apiKey: emb.apiKey,
  };
}

function getSourceFiles(cwd: string): string[] {
  const output = exec('git ls-files', cwd);
  if (!output) return [];
  return output.split('\n').filter(f => !shouldSkipFile(f));
}

function getChangedFiles(lastSha: string, cwd: string): string[] {
  // Validate SHA to prevent shell injection (use execFileSync for safety)
  if (!/^[0-9a-f]{4,40}$/i.test(lastSha)) return [];
  try {
    const output = execFileSync('git', ['diff', '--name-only', `${lastSha}..HEAD`], {
      cwd, encoding: 'utf8', timeout: 30000,
    }).trim();
    if (!output) return [];
    return output.split('\n').filter(f => !shouldSkipFile(f));
  } catch {
    return [];
  }
}

function getHeadSha(cwd: string): string {
  return exec('git rev-parse HEAD', cwd);
}

export async function indexCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const flags = parseArgs(args);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  // Resolve store
  const storePath = config.store_path ?? '.slope/slope.db';
  const store = new SqliteSlopeStore(`${cwd}/${storePath}`);

  try {
    if (!hasEmbeddingSupport(store)) {
      console.error('Error: Store does not support embeddings.');
      process.exit(1);
    }

    if (flags.status) {
      await showStatus(store, flags.json);
      return;
    }

    const embConfig = resolveEmbeddingConfig(config);

    if (flags.prune) {
      await pruneIndex(store, cwd);
      return;
    }

    if (flags.full) {
      await fullIndex(store, embConfig, cwd);
    } else {
      await incrementalIndex(store, embConfig, cwd);
    }
  } finally {
    store.close();
  }
}

async function showStatus(store: { getEmbeddingStats(): Promise<import('../../core/embedding-store.js').EmbeddingStats> }, json: boolean): Promise<void> {
  const stats = await store.getEmbeddingStats();

  if (json) {
    console.log(JSON.stringify({
      fileCount: stats.fileCount,
      chunkCount: stats.chunkCount,
      model: stats.model,
      dimensions: stats.dimensions,
      lastIndexedAt: stats.lastIndexedAt,
      lastSha: stats.lastIndexedSha,
    }));
    return;
  }

  if (stats.chunkCount === 0) {
    console.log('\nSemantic index: empty');
    console.log('  Run `slope index` to build the index.\n');
    return;
  }

  console.log('\nSemantic Index Status');
  console.log(`  Files:      ${stats.fileCount}`);
  console.log(`  Chunks:     ${stats.chunkCount}`);
  console.log(`  Model:      ${stats.model ?? 'unknown'}`);
  console.log(`  Dimensions: ${stats.dimensions ?? 'unknown'}`);
  console.log(`  Last SHA:   ${stats.lastIndexedSha ?? 'unknown'}`);
  console.log(`  Indexed at: ${stats.lastIndexedAt ?? 'unknown'}`);
  console.log('');
}

async function fullIndex(store: SqliteSlopeStore, embConfig: EmbeddingConfig, cwd: string): Promise<void> {
  console.log('Rebuilding semantic index (full)...');
  console.log(`  Model: ${embConfig.model} (${embConfig.dimensions} dims)`);

  // Drop and recreate vec table with configured dimensions
  store.clearAllEmbeddings();
  store.recreateVecTable(embConfig.dimensions);

  const files = getSourceFiles(cwd);
  console.log(`  Source files: ${files.length}`);

  const allChunks: CodeChunk[] = [];
  for (const file of files) {
    try {
      const content = readFileSync(`${cwd}/${file}`, 'utf8');
      const chunks = chunkFile(file, content);
      allChunks.push(...chunks);
    } catch {
      // Skip unreadable files
    }
  }

  console.log(`  Total chunks: ${allChunks.length}`);

  if (allChunks.length === 0) {
    console.log('  No chunks to index.\n');
    return;
  }

  const headSha = getHeadSha(cwd);
  const start = Date.now();

  // Embed in batches with progress
  const batchSize = 32;
  let indexed = 0;
  for (let i = 0; i < allChunks.length; i += batchSize) {
    const batch = allChunks.slice(i, i + batchSize);
    const results = await embedBatch(batch, embConfig, batchSize);

    const entries = results.map(r => ({
      filePath: r.filePath,
      chunkIndex: r.chunkIndex,
      chunkText: r.chunkText,
      gitSha: headSha,
      model: embConfig.model,
      vector: r.vector,
    }));

    await store.saveEmbeddings(entries);
    indexed += batch.length;

    const pct = Math.round((indexed / allChunks.length) * 100);
    process.stdout.write(`\r  Indexing... ${indexed}/${allChunks.length} chunks (${pct}%)`);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n  \u2713 Index rebuilt (${files.length} files, ${allChunks.length} chunks, ${elapsed}s)`);

  await store.setIndexMeta(headSha, embConfig.model, embConfig.dimensions);
  console.log('');
}

async function incrementalIndex(store: SqliteSlopeStore, embConfig: EmbeddingConfig, cwd: string): Promise<void> {
  const meta = await store.getIndexMeta();
  const headSha = getHeadSha(cwd);

  // First-time: do full index
  if (!meta) {
    await fullIndex(store, embConfig, cwd);
    return;
  }

  // Dimension mismatch check
  if (meta.dimensions !== embConfig.dimensions) {
    console.error(
      `Error: Index built with ${meta.dimensions} dims but config specifies ${embConfig.dimensions}. ` +
      'Run: slope index --full',
    );
    process.exit(1);
  }

  // Already up to date
  if (meta.sha === headSha) {
    console.log('Semantic index is up to date.\n');
    return;
  }

  console.log('Updating semantic index...');
  console.log(`  Model: ${embConfig.model} (${embConfig.dimensions} dims)`);

  // Find changed files
  const changedFiles = getChangedFiles(meta.sha, cwd);
  if (changedFiles.length === 0) {
    console.log('  No file changes detected.');
    await store.setIndexMeta(headSha, embConfig.model, embConfig.dimensions);
    console.log(`  \u2713 Index updated (SHA: ${headSha.slice(0, 8)})\n`);
    return;
  }

  // Detect deleted files
  const currentFiles = new Set(getSourceFiles(cwd));
  const indexedFiles = await store.getIndexedFiles();
  const deletedFiles = indexedFiles
    .map(f => f.filePath)
    .filter(f => !currentFiles.has(f));

  // Remove deleted files
  for (const file of deletedFiles) {
    await store.deleteEmbeddingsByFile(file);
  }

  // Chunk changed files
  const allChunks: CodeChunk[] = [];
  const validChangedFiles = changedFiles.filter(f => currentFiles.has(f));

  for (const file of validChangedFiles) {
    // Remove old embeddings for this file
    await store.deleteEmbeddingsByFile(file);
    try {
      const content = readFileSync(`${cwd}/${file}`, 'utf8');
      const chunks = chunkFile(file, content);
      allChunks.push(...chunks);
    } catch {
      // Skip unreadable files
    }
  }

  console.log(`  Changed files: ${validChangedFiles.length} (${allChunks.length} chunks)`);
  if (deletedFiles.length > 0) {
    console.log(`  Deleted files: ${deletedFiles.length}`);
  }

  if (allChunks.length > 0) {
    const start = Date.now();
    const results = await embedBatch(allChunks, embConfig);
    const entries = results.map(r => ({
      filePath: r.filePath,
      chunkIndex: r.chunkIndex,
      chunkText: r.chunkText,
      gitSha: headSha,
      model: embConfig.model,
      vector: r.vector,
    }));
    await store.saveEmbeddings(entries);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  \u2713 Index updated (${validChangedFiles.length} files, ${allChunks.length} chunks, ${elapsed}s)`);
  } else {
    console.log('  \u2713 Index updated (removals only)');
  }

  await store.setIndexMeta(headSha, embConfig.model, embConfig.dimensions);
  console.log('');
}

async function pruneIndex(store: SqliteSlopeStore, cwd: string): Promise<void> {
  console.log('Pruning semantic index...');

  const currentFiles = new Set(getSourceFiles(cwd));
  const indexedFiles = await store.getIndexedFiles();

  const orphans = indexedFiles
    .map(f => f.filePath)
    .filter(f => !currentFiles.has(f));

  // Deduplicate
  const uniqueOrphans = [...new Set(orphans)];

  if (uniqueOrphans.length === 0) {
    console.log('  No orphaned embeddings found.\n');
    return;
  }

  for (const file of uniqueOrphans) {
    await store.deleteEmbeddingsByFile(file);
  }

  console.log(`  \u2713 Pruned ${uniqueOrphans.length} file(s)\n`);
}

function printUsage(): void {
  console.log(`
slope index — Semantic embedding index management

Usage:
  slope index                   Incremental index (changed files only)
  slope index --full            Full reindex (drop + rebuild)
  slope index --status          Show index stats
  slope index --status --json   Show index stats as JSON
  slope index --prune           Remove embeddings for deleted files

Requires "embedding" section in .slope/config.json:
  {
    "embedding": {
      "endpoint": "http://localhost:11434/v1/embeddings",
      "model": "nomic-embed-text",
      "dimensions": 768
    }
  }
`);
}
