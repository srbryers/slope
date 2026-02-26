import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeStack } from '../../../src/core/analyzers/stack.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'slope-stack-'));
}

describe('analyzeStack', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects Node/TypeScript project', async () => {
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { express: '^4.0.0' },
      devDependencies: { vitest: '^1.0.0' },
      engines: { node: '>=18' },
    }));
    writeFileSync(join(tmpDir, 'tsconfig.json'), '{}');
    writeFileSync(join(tmpDir, 'pnpm-lock.yaml'), '');
    writeFileSync(join(tmpDir, 'src/index.ts'), 'export const x = 1;');
    writeFileSync(join(tmpDir, 'src/app.ts'), 'export const y = 2;');

    const result = await analyzeStack(tmpDir);
    expect(result.primaryLanguage).toBe('TypeScript');
    expect(result.languages.TypeScript).toBe(2);
    expect(result.frameworks).toContain('express');
    expect(result.frameworks).toContain('vitest');
    expect(result.packageManager).toBe('pnpm');
    expect(result.runtime).toMatch(/Node/);
    expect(result.buildTool).toBe('tsc');
  });

  it('detects Python project from pyproject.toml', async () => {
    writeFileSync(join(tmpDir, 'pyproject.toml'), '[project]\nname = "myapp"');
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/main.py'), 'print("hello")');
    writeFileSync(join(tmpDir, 'src/utils.py'), 'x = 1');

    const result = await analyzeStack(tmpDir);
    expect(result.primaryLanguage).toBe('Python');
    expect(result.languages.Python).toBe(2);
  });

  it('detects Go project from go.mod', async () => {
    writeFileSync(join(tmpDir, 'go.mod'), 'module example.com/myapp');
    writeFileSync(join(tmpDir, 'main.go'), 'package main');

    const result = await analyzeStack(tmpDir);
    expect(result.primaryLanguage).toBe('Go');
    expect(result.runtime).toBe('Go');
  });

  it('detects Rust project from Cargo.toml', async () => {
    writeFileSync(join(tmpDir, 'Cargo.toml'), '[package]\nname = "myapp"');
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/main.rs'), 'fn main() {}');

    const result = await analyzeStack(tmpDir);
    expect(result.primaryLanguage).toBe('Rust');
    expect(result.buildTool).toBe('cargo');
  });

  it('detects framework from dependencies', async () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { react: '^18.0.0', next: '^14.0.0' },
    }));
    writeFileSync(join(tmpDir, 'app.tsx'), 'export default function App() {}');

    const result = await analyzeStack(tmpDir);
    expect(result.frameworks).toContain('react');
    expect(result.frameworks).toContain('next');
  });

  it('detects package manager from lock files', async () => {
    writeFileSync(join(tmpDir, 'yarn.lock'), '');
    writeFileSync(join(tmpDir, 'index.js'), '');

    const result = await analyzeStack(tmpDir);
    expect(result.packageManager).toBe('yarn');
  });

  it('handles empty directory', async () => {
    const result = await analyzeStack(tmpDir);
    expect(result.primaryLanguage).toBe('');
    expect(Object.keys(result.languages)).toHaveLength(0);
    expect(result.frameworks).toHaveLength(0);
  });

  it('detects runtime from .nvmrc', async () => {
    writeFileSync(join(tmpDir, '.nvmrc'), 'v22.1.0');
    writeFileSync(join(tmpDir, 'index.js'), '');

    const result = await analyzeStack(tmpDir);
    expect(result.runtime).toBe('Node 22.1.0');
  });
});
