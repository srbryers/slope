import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOTS = ['src/cli', 'src/mcp', 'src/core'];

function walk(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walk(full));
    } else if (entry.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

function isGeneratedShellTemplate(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  return normalized.startsWith('src/core/adapters/') || normalized === 'src/core/harness.ts';
}

describe('portable Node command execution', () => {
  it('does not use POSIX /dev/null redirection in Node-executed source', () => {
    const cwd = process.cwd();
    const offenders = SOURCE_ROOTS
      .flatMap(root => walk(join(cwd, root)))
      .map(path => relative(cwd, path).replace(/\\/g, '/'))
      .filter(path => !isGeneratedShellTemplate(path))
      .filter(path => readFileSync(join(cwd, path), 'utf8').includes('2>/dev/null'));

    expect(offenders).toEqual([]);
  });
});
