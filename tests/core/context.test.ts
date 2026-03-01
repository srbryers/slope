import { describe, it, expect } from 'vitest';
import { deduplicateByFile, formatContextForAgent } from '../../src/core/context.js';
import type { ContextResult } from '../../src/core/context.js';

describe('deduplicateByFile', () => {
  it('keeps best-scoring chunk per file', () => {
    const results: ContextResult[] = [
      { filePath: 'a.ts', chunkIndex: 0, snippet: 'chunk0', score: 0.8 },
      { filePath: 'a.ts', chunkIndex: 1, snippet: 'chunk1', score: 0.9 },
      { filePath: 'b.ts', chunkIndex: 0, snippet: 'bchunk', score: 0.7 },
    ];
    const deduped = deduplicateByFile(results);
    expect(deduped).toHaveLength(2);
    expect(deduped[0].filePath).toBe('a.ts');
    expect(deduped[0].score).toBe(0.9);
    expect(deduped[1].filePath).toBe('b.ts');
  });

  it('returns empty for empty input', () => {
    expect(deduplicateByFile([])).toHaveLength(0);
  });

  it('sorts by score descending', () => {
    const results: ContextResult[] = [
      { filePath: 'low.ts', chunkIndex: 0, snippet: 'lo', score: 0.3 },
      { filePath: 'high.ts', chunkIndex: 0, snippet: 'hi', score: 0.95 },
      { filePath: 'mid.ts', chunkIndex: 0, snippet: 'mid', score: 0.6 },
    ];
    const deduped = deduplicateByFile(results);
    expect(deduped.map(r => r.filePath)).toEqual(['high.ts', 'mid.ts', 'low.ts']);
  });
});

describe('formatContextForAgent', () => {
  const results: ContextResult[] = [
    { filePath: 'src/a.ts', chunkIndex: 0, snippet: 'export function a() {}', score: 0.9 },
    { filePath: 'src/b.ts', chunkIndex: 1, snippet: 'export const b = 1;', score: 0.7 },
  ];

  it('formats paths mode', () => {
    const output = formatContextForAgent(results, 'paths');
    expect(output).toBe('src/a.ts\nsrc/b.ts');
  });

  it('formats snippets mode', () => {
    const output = formatContextForAgent(results, 'snippets');
    expect(output).toContain('## src/a.ts (score: 0.900)');
    expect(output).toContain('export function a() {}');
    expect(output).toContain('## src/b.ts (score: 0.700)');
    expect(output).toContain('```');
  });

  it('returns empty string for empty results', () => {
    expect(formatContextForAgent([], 'paths')).toBe('');
    expect(formatContextForAgent([], 'snippets')).toBe('');
    expect(formatContextForAgent([], 'full')).toBe('');
  });
});
