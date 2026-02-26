import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeStructure } from '../../../src/core/analyzers/structure.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'slope-struct-'));
}

describe('analyzeStructure', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('counts source and test files', async () => {
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/index.ts'), 'export const x = 1;');
    writeFileSync(join(tmpDir, 'src/utils.ts'), 'export const y = 2;');
    writeFileSync(join(tmpDir, 'src/index.test.ts'), 'test("x", () => {})');

    const result = await analyzeStructure(tmpDir);
    expect(result.sourceFiles).toBe(2);
    expect(result.testFiles).toBe(1);
    expect(result.totalFiles).toBeGreaterThanOrEqual(3);
  });

  it('computes max depth', async () => {
    mkdirSync(join(tmpDir, 'a/b/c/d'), { recursive: true });
    writeFileSync(join(tmpDir, 'a/b/c/d/deep.ts'), '');

    const result = await analyzeStructure(tmpDir);
    expect(result.maxDepth).toBeGreaterThanOrEqual(3);
  });

  it('detects monorepo from multiple package.json', async () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'root' }));
    mkdirSync(join(tmpDir, 'packages/core'), { recursive: true });
    writeFileSync(join(tmpDir, 'packages/core/package.json'), JSON.stringify({ name: 'core' }));

    const result = await analyzeStructure(tmpDir);
    expect(result.isMonorepo).toBe(true);
  });

  it('detects monorepo from workspaces field', async () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      name: 'root',
      workspaces: ['packages/*'],
    }));

    const result = await analyzeStructure(tmpDir);
    expect(result.isMonorepo).toBe(true);
  });

  it('detects monorepo from pnpm-workspace.yaml', async () => {
    writeFileSync(join(tmpDir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*');

    const result = await analyzeStructure(tmpDir);
    expect(result.isMonorepo).toBe(true);
  });

  it('detects flat project as non-monorepo', async () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'flat' }));
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/index.ts'), '');

    const result = await analyzeStructure(tmpDir);
    expect(result.isMonorepo).toBe(false);
  });

  it('identifies modules under src/', async () => {
    mkdirSync(join(tmpDir, 'src/core'), { recursive: true });
    for (let i = 0; i < 6; i++) {
      writeFileSync(join(tmpDir, `src/core/file${i}.ts`), '');
    }
    mkdirSync(join(tmpDir, 'src/cli'), { recursive: true });
    for (let i = 0; i < 6; i++) {
      writeFileSync(join(tmpDir, `src/cli/cmd${i}.ts`), '');
    }

    const result = await analyzeStructure(tmpDir);
    expect(result.modules.length).toBe(2);
    const names = result.modules.map(m => m.name);
    expect(names).toContain('core');
    expect(names).toContain('cli');
  });

  it('flags large files', async () => {
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    const bigContent = Array.from({ length: 1100 }, (_, i) => `const line${i} = ${i};`).join('\n');
    writeFileSync(join(tmpDir, 'src/big.ts'), bigContent);
    writeFileSync(join(tmpDir, 'src/small.ts'), 'const x = 1;');

    const result = await analyzeStructure(tmpDir);
    expect(result.largeFiles.length).toBe(1);
    expect(result.largeFiles[0].path).toBe('src/big.ts');
    expect(result.largeFiles[0].lines).toBeGreaterThan(1000);
  });

  it('handles empty directory', async () => {
    const result = await analyzeStructure(tmpDir);
    expect(result.totalFiles).toBe(0);
    expect(result.sourceFiles).toBe(0);
    expect(result.isMonorepo).toBe(false);
  });
});
