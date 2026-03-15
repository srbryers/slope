import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseImports, buildImportGraph, blastRadius } from '../../src/core/imports.js';

const tmpDir = join(import.meta.dirname ?? __dirname, '.tmp-imports-test');

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeTs(relativePath: string, content: string): void {
  const fullPath = join(tmpDir, relativePath);
  const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content);
}

describe('parseImports', () => {
  it('parses named imports', () => {
    writeTs('src/foo.ts', 'export const x = 1;');
    const content = `import { x } from './foo.js';`;
    const result = parseImports(content, join(tmpDir, 'src/bar.ts'), tmpDir);
    expect(result).toEqual(['src/foo.ts']);
  });

  it('parses default imports', () => {
    writeTs('src/foo.ts', 'export default 1;');
    const content = `import foo from './foo.js';`;
    const result = parseImports(content, join(tmpDir, 'src/bar.ts'), tmpDir);
    expect(result).toEqual(['src/foo.ts']);
  });

  it('parses side-effect imports', () => {
    writeTs('src/init.ts', '// side effect');
    const content = `import './init.js';`;
    const result = parseImports(content, join(tmpDir, 'src/bar.ts'), tmpDir);
    expect(result).toEqual(['src/init.ts']);
  });

  it('parses type imports', () => {
    writeTs('src/types.ts', 'export type X = string;');
    const content = `import type { X } from './types.js';`;
    const result = parseImports(content, join(tmpDir, 'src/bar.ts'), tmpDir);
    expect(result).toEqual(['src/types.ts']);
  });

  it('parses re-exports', () => {
    writeTs('src/a.ts', 'export const a = 1;');
    const content = `export { a } from './a.js';`;
    const result = parseImports(content, join(tmpDir, 'src/index.ts'), tmpDir);
    expect(result).toEqual(['src/a.ts']);
  });

  it('parses star re-exports', () => {
    writeTs('src/mod.ts', 'export const m = 1;');
    const content = `export * from './mod.js';`;
    const result = parseImports(content, join(tmpDir, 'src/index.ts'), tmpDir);
    expect(result).toEqual(['src/mod.ts']);
  });

  it('skips node: builtins', () => {
    const content = `import { readFileSync } from 'node:fs';`;
    const result = parseImports(content, join(tmpDir, 'src/bar.ts'), tmpDir);
    expect(result).toEqual([]);
  });

  it('skips bare specifiers (npm packages)', () => {
    const content = `import express from 'express';`;
    const result = parseImports(content, join(tmpDir, 'src/bar.ts'), tmpDir);
    expect(result).toEqual([]);
  });

  it('deduplicates imports', () => {
    writeTs('src/foo.ts', 'export const x = 1; export type Y = string;');
    const content = `import { x } from './foo.js';\nimport type { Y } from './foo.js';`;
    const result = parseImports(content, join(tmpDir, 'src/bar.ts'), tmpDir);
    expect(result).toEqual(['src/foo.ts']);
  });

  it('resolves extensionless imports to .ts', () => {
    writeTs('src/utils.ts', 'export const u = 1;');
    const content = `import { u } from './utils';`;
    const result = parseImports(content, join(tmpDir, 'src/bar.ts'), tmpDir);
    expect(result).toEqual(['src/utils.ts']);
  });
});

describe('buildImportGraph', () => {
  it('builds graph from directory', () => {
    writeTs('src/a.ts', `import { b } from './b.js';`);
    writeTs('src/b.ts', `export const b = 1;`);
    writeTs('src/c.ts', `import { b } from './b.js';\nimport { a } from './a.js';`);

    const graph = buildImportGraph(tmpDir);
    expect(graph.get('src/a.ts')).toEqual(['src/b.ts']);
    expect(graph.get('src/b.ts')).toEqual([]);
    expect(graph.get('src/c.ts')).toEqual(expect.arrayContaining(['src/b.ts', 'src/a.ts']));
  });

  it('skips node_modules and dist', () => {
    writeTs('src/a.ts', 'export const a = 1;');
    writeTs('node_modules/pkg/index.ts', 'export const p = 1;');
    writeTs('dist/a.ts', 'export const a = 1;');

    const graph = buildImportGraph(tmpDir);
    expect(graph.has('src/a.ts')).toBe(true);
    expect(graph.has('node_modules/pkg/index.ts')).toBe(false);
    expect(graph.has('dist/a.ts')).toBe(false);
  });

  it('skips .d.ts files', () => {
    writeTs('src/a.d.ts', 'export type A = string;');
    writeTs('src/b.ts', 'export const b = 1;');

    const graph = buildImportGraph(tmpDir);
    expect(graph.has('src/a.d.ts')).toBe(false);
    expect(graph.has('src/b.ts')).toBe(true);
  });
});

describe('blastRadius', () => {
  it('returns direct dependents', () => {
    writeTs('src/core.ts', 'export const core = 1;');
    writeTs('src/a.ts', `import { core } from './core.js';`);
    writeTs('src/b.ts', `import { core } from './core.js';`);

    const graph = buildImportGraph(tmpDir);
    const result = blastRadius(graph, 'src/core.ts');
    expect(result).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('returns transitive dependents', () => {
    writeTs('src/base.ts', 'export const base = 1;');
    writeTs('src/mid.ts', `import { base } from './base.js';`);
    writeTs('src/top.ts', `import { mid } from './mid.js';`);

    const graph = buildImportGraph(tmpDir);
    const result = blastRadius(graph, 'src/base.ts');
    expect(result).toEqual(['src/mid.ts', 'src/top.ts']);
  });

  it('handles circular imports without infinite loop', () => {
    writeTs('src/a.ts', `import { b } from './b.js';\nexport const a = 1;`);
    writeTs('src/b.ts', `import { a } from './a.js';\nexport const b = 1;`);

    const graph = buildImportGraph(tmpDir);
    // Should not hang — visited set prevents infinite BFS
    const result = blastRadius(graph, 'src/a.ts');
    expect(result).toContain('src/b.ts');
  });

  it('returns empty array for leaf file', () => {
    writeTs('src/leaf.ts', 'export const leaf = 1;');
    writeTs('src/other.ts', 'export const other = 1;');

    const graph = buildImportGraph(tmpDir);
    const result = blastRadius(graph, 'src/leaf.ts');
    expect(result).toEqual([]);
  });

  it('does not include the target file itself', () => {
    writeTs('src/a.ts', 'export const a = 1;');
    writeTs('src/b.ts', `import { a } from './a.js';`);

    const graph = buildImportGraph(tmpDir);
    const result = blastRadius(graph, 'src/a.ts');
    expect(result).not.toContain('src/a.ts');
  });

  it('returns sorted results', () => {
    writeTs('src/z.ts', 'export const z = 1;');
    writeTs('src/b.ts', `import { z } from './z.js';`);
    writeTs('src/a.ts', `import { z } from './z.js';`);

    const graph = buildImportGraph(tmpDir);
    const result = blastRadius(graph, 'src/z.ts');
    expect(result).toEqual(['src/a.ts', 'src/b.ts']);
  });
});
