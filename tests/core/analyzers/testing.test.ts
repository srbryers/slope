import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeTesting } from '../../../src/core/analyzers/testing.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'slope-testing-'));
}

describe('analyzeTesting', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects vitest from config file', async () => {
    writeFileSync(join(tmpDir, 'vitest.config.ts'), 'export default {}');
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));

    const result = await analyzeTesting(tmpDir);
    expect(result.framework).toBe('vitest');
    expect(result.hasTestScript).toBe(true);
  });

  it('detects vitest from package.json dependency', async () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      devDependencies: { vitest: '^1.0.0' },
      scripts: { test: 'vitest' },
    }));

    const result = await analyzeTesting(tmpDir);
    expect(result.framework).toBe('vitest');
  });

  it('detects jest from config file', async () => {
    writeFileSync(join(tmpDir, 'jest.config.js'), 'module.exports = {}');
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));

    const result = await analyzeTesting(tmpDir);
    expect(result.framework).toBe('jest');
  });

  it('detects pytest from pytest.ini', async () => {
    writeFileSync(join(tmpDir, 'pytest.ini'), '[pytest]');

    const result = await analyzeTesting(tmpDir);
    expect(result.framework).toBe('pytest');
  });

  it('detects pytest from pyproject.toml', async () => {
    writeFileSync(join(tmpDir, 'pyproject.toml'), '[tool.pytest.ini_options]\ntestpaths = ["tests"]');

    const result = await analyzeTesting(tmpDir);
    expect(result.framework).toBe('pytest');
  });

  it('detects rspec from .rspec file', async () => {
    writeFileSync(join(tmpDir, '.rspec'), '--format documentation');

    const result = await analyzeTesting(tmpDir);
    expect(result.framework).toBe('rspec');
  });

  it('detects go-test from _test.go files', async () => {
    writeFileSync(join(tmpDir, 'main.go'), 'package main');
    writeFileSync(join(tmpDir, 'main_test.go'), 'package main');

    const result = await analyzeTesting(tmpDir);
    expect(result.framework).toBe('go-test');
  });

  it('finds test directories', async () => {
    mkdirSync(join(tmpDir, 'tests'), { recursive: true });
    mkdirSync(join(tmpDir, '__tests__'), { recursive: true });

    const result = await analyzeTesting(tmpDir);
    expect(result.testDirs).toContain('tests');
    expect(result.testDirs).toContain('__tests__');
  });

  it('counts test files', async () => {
    mkdirSync(join(tmpDir, 'tests'), { recursive: true });
    writeFileSync(join(tmpDir, 'tests/foo.test.ts'), '');
    writeFileSync(join(tmpDir, 'tests/bar.spec.ts'), '');
    writeFileSync(join(tmpDir, 'tests/helpers.ts'), '');

    const result = await analyzeTesting(tmpDir);
    expect(result.testFileCount).toBe(2);
  });

  it('detects coverage config in vitest', async () => {
    writeFileSync(join(tmpDir, 'vitest.config.ts'), 'export default { coverage: { provider: "v8" } }');

    const result = await analyzeTesting(tmpDir);
    expect(result.hasCoverage).toBe(true);
  });

  it('detects coverage from .nycrc', async () => {
    writeFileSync(join(tmpDir, '.nycrc'), '{}');

    const result = await analyzeTesting(tmpDir);
    expect(result.hasCoverage).toBe(true);
  });

  it('handles empty directory', async () => {
    const result = await analyzeTesting(tmpDir);
    expect(result.framework).toBeUndefined();
    expect(result.testFileCount).toBe(0);
    expect(result.hasTestScript).toBe(false);
    expect(result.hasCoverage).toBe(false);
    expect(result.testDirs).toHaveLength(0);
  });
});
