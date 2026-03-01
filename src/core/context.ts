// SLOPE — Semantic Context Retrieval
// Query the embedding index and format results for agent consumption.

import { readFileSync } from 'node:fs';

export interface ContextQuery {
  text: string;
  topK?: number;      // default 5
  minScore?: number;   // filter threshold
}

export interface ContextResult {
  filePath: string;
  chunkIndex: number;
  snippet: string;
  score: number;       // 0-1 similarity
}

/**
 * Deduplicate results by file — keep the best-scoring chunk per file.
 */
export function deduplicateByFile(results: ContextResult[]): ContextResult[] {
  const best = new Map<string, ContextResult>();
  for (const r of results) {
    const existing = best.get(r.filePath);
    if (!existing || r.score > existing.score) {
      best.set(r.filePath, r);
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

/**
 * Format context results for agent injection.
 */
export function formatContextForAgent(
  results: ContextResult[],
  format: 'paths' | 'snippets' | 'full',
  cwd?: string,
): string {
  if (results.length === 0) return '';

  const lines: string[] = [];

  switch (format) {
    case 'paths':
      for (const r of results) {
        lines.push(r.filePath);
      }
      break;

    case 'snippets':
      for (const r of results) {
        lines.push(`## ${r.filePath} (score: ${r.score.toFixed(3)})`);
        lines.push('```');
        lines.push(r.snippet);
        lines.push('```');
        lines.push('');
      }
      break;

    case 'full': {
      const basePath = cwd ?? process.cwd();
      for (const r of results) {
        lines.push(`## ${r.filePath}`);
        lines.push('```');
        try {
          const content = readFileSync(`${basePath}/${r.filePath}`, 'utf8');
          lines.push(content);
        } catch {
          lines.push(`[Error reading file: ${r.filePath}]`);
        }
        lines.push('```');
        lines.push('');
      }
      break;
    }
  }

  return lines.join('\n');
}
