import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeDocs } from '../../../src/core/analyzers/docs.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'slope-docs-'));
}

describe('analyzeDocs', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects README.md and extracts summary', () => {
    writeFileSync(join(tmpDir, 'README.md'), [
      '# My Project',
      '',
      'A powerful tool for building things fast.',
      '',
      '## Installation',
    ].join('\n'));

    const result = analyzeDocs(tmpDir);
    expect(result.hasReadme).toBe(true);
    expect(result.readmeSummary).toBe('A powerful tool for building things fast.');
  });

  it('skips badges and HTML in README summary', () => {
    writeFileSync(join(tmpDir, 'README.md'), [
      '# My Project',
      '![badge](https://img.shields.io/badge)',
      '<p align="center">',
      '',
      'The actual description starts here.',
    ].join('\n'));

    const result = analyzeDocs(tmpDir);
    expect(result.readmeSummary).toBe('The actual description starts here.');
  });

  it('truncates long README summaries to 200 chars', () => {
    const longLine = 'A'.repeat(250);
    writeFileSync(join(tmpDir, 'README.md'), `# Title\n\n${longLine}`);

    const result = analyzeDocs(tmpDir);
    expect(result.readmeSummary!.length).toBeLessThanOrEqual(203); // 200 + '...'
    expect(result.readmeSummary!.endsWith('...')).toBe(true);
  });

  it('detects CONTRIBUTING.md', () => {
    writeFileSync(join(tmpDir, 'CONTRIBUTING.md'), '# Contributing\n');

    const result = analyzeDocs(tmpDir);
    expect(result.hasContributing).toBe(true);
  });

  it('detects CHANGELOG.md', () => {
    writeFileSync(join(tmpDir, 'CHANGELOG.md'), '# Changelog\n');

    const result = analyzeDocs(tmpDir);
    expect(result.hasChangelog).toBe(true);
  });

  it('detects ADR directory at docs/adr/', () => {
    mkdirSync(join(tmpDir, 'docs/adr'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs/adr/0001-use-typescript.md'), '# ADR 1');

    const result = analyzeDocs(tmpDir);
    expect(result.hasAdr).toBe(true);
  });

  it('detects ADR directory at docs/decisions/', () => {
    mkdirSync(join(tmpDir, 'docs/decisions'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs/decisions/001.md'), '# Decision 1');

    const result = analyzeDocs(tmpDir);
    expect(result.hasAdr).toBe(true);
  });

  it('detects API docs directory', () => {
    mkdirSync(join(tmpDir, 'docs/api'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs/api/index.html'), '<html></html>');

    const result = analyzeDocs(tmpDir);
    expect(result.hasApiDocs).toBe(true);
  });

  it('detects openapi.json as API docs', () => {
    writeFileSync(join(tmpDir, 'openapi.json'), '{}');

    const result = analyzeDocs(tmpDir);
    expect(result.hasApiDocs).toBe(true);
  });

  it('returns all false for empty directory', () => {
    const result = analyzeDocs(tmpDir);
    expect(result.hasReadme).toBe(false);
    expect(result.readmeSummary).toBeUndefined();
    expect(result.hasContributing).toBe(false);
    expect(result.hasChangelog).toBe(false);
    expect(result.hasAdr).toBe(false);
    expect(result.hasApiDocs).toBe(false);
  });
});
