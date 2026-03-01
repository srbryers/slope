// SLOPE — Embedding Types & Chunking Logic (pure — no HTTP calls)

export interface EmbeddingConfig {
  endpoint: string;
  model: string;
  dimensions: number;
  apiKey?: string;
}

export interface CodeChunk {
  filePath: string;
  chunkIndex: number;
  content: string;
}

export interface EmbeddingResult {
  filePath: string;
  chunkIndex: number;
  chunkText: string;
  vector: Float32Array;
}

export const MAX_CHUNK_FILE_SIZE = 100 * 1024; // 100KB — skip larger files

export const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf',
  '.eot', '.mp3', '.mp4', '.zip', '.tar', '.gz', '.bin', '.exe', '.dll',
  '.so', '.dylib', '.lock', '.map',
]);

export const SKIP_DIRS = new Set([
  'node_modules', 'dist', '.git', '.slope', 'coverage',
]);

const DEFAULT_MAX_LINES = 200;
const DEFAULT_OVERLAP_LINES = 20;

/**
 * Chunk a file into embeddable code segments.
 * Strategy: split by top-level declarations for TS/JS, fixed-size for others.
 */
export function chunkFile(filePath: string, content: string, maxLines = DEFAULT_MAX_LINES): CodeChunk[] {
  if (content.length > MAX_CHUNK_FILE_SIZE) return [];
  if (content.trim().length === 0) return [];

  const lines = content.split('\n');

  // Small files: single chunk
  if (lines.length <= maxLines) {
    return [{ filePath, chunkIndex: 0, content }];
  }

  const isTS = filePath.endsWith('.ts') || filePath.endsWith('.tsx') ||
               filePath.endsWith('.js') || filePath.endsWith('.jsx');

  if (isTS) {
    return chunkByDeclarations(filePath, content, lines, maxLines);
  }

  return chunkByLines(filePath, lines, maxLines, DEFAULT_OVERLAP_LINES);
}

/**
 * Split TS/JS files by top-level declarations (export, function, class, const, interface, type).
 */
function chunkByDeclarations(filePath: string, _content: string, lines: string[], maxLines: number): CodeChunk[] {
  const declarationPattern = /^(export\s+)?(default\s+)?(async\s+)?(function|class|const|let|var|interface|type|enum|abstract)\s/;
  const breakpoints: number[] = [0];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (declarationPattern.test(line) && i - breakpoints[breakpoints.length - 1] >= 10) {
      breakpoints.push(i);
    }
  }

  // Merge breakpoints into chunks respecting maxLines
  const chunks: CodeChunk[] = [];
  let chunkStart = 0;
  let chunkIndex = 0;

  for (let b = 1; b < breakpoints.length; b++) {
    if (breakpoints[b] - chunkStart > maxLines) {
      const chunkContent = lines.slice(chunkStart, breakpoints[b]).join('\n');
      chunks.push({ filePath, chunkIndex, content: chunkContent });
      chunkIndex++;
      chunkStart = breakpoints[b];
    }
  }

  // Final chunk
  const remaining = lines.slice(chunkStart).join('\n');
  if (remaining.trim().length > 0) {
    chunks.push({ filePath, chunkIndex, content: remaining });
  }

  return chunks;
}

/**
 * Fixed-size line-based chunking with overlap for non-TS files.
 */
function chunkByLines(filePath: string, lines: string[], maxLines: number, overlap: number): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < lines.length) {
    const end = Math.min(start + maxLines, lines.length);
    const chunkContent = lines.slice(start, end).join('\n');
    if (chunkContent.trim().length > 0) {
      chunks.push({ filePath, chunkIndex, content: chunkContent });
      chunkIndex++;
    }
    start = end - overlap;
    if (start >= lines.length - overlap) break;
  }

  // Ensure final lines are included
  if (start < lines.length) {
    const chunkContent = lines.slice(start).join('\n');
    if (chunkContent.trim().length > 0 && (chunks.length === 0 || chunks[chunks.length - 1].content !== chunkContent)) {
      chunks.push({ filePath, chunkIndex, content: chunkContent });
    }
  }

  return chunks;
}

/**
 * Check if a file path should be skipped for embedding.
 */
export function shouldSkipFile(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.'));
  if (SKIP_EXTENSIONS.has(ext)) return true;

  const parts = filePath.split('/');
  for (const part of parts) {
    if (SKIP_DIRS.has(part)) return true;
  }

  return false;
}
