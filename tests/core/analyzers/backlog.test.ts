import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeBacklog } from '../../../src/core/analyzers/backlog.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'slope-backlog-'));
}

describe('analyzeBacklog', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts TODO comments from TypeScript files', async () => {
    mkdirSync(join(tmpDir, 'src/core'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/core/auth.ts'), [
      'export function login() {',
      '  // TODO: add rate limiting',
      '  return true;',
      '}',
    ].join('\n'));

    const result = await analyzeBacklog(tmpDir);
    expect(result.todos).toHaveLength(1);
    expect(result.todos[0].type).toBe('TODO');
    expect(result.todos[0].text).toBe('add rate limiting');
    expect(result.todos[0].file).toBe('src/core/auth.ts');
    expect(result.todos[0].line).toBe(2);
  });

  it('extracts FIXME, HACK, and XXX patterns', async () => {
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/utils.ts'), [
      '// FIXME: broken on Windows',
      '// HACK: workaround for upstream bug',
      '// XXX: temporary solution',
    ].join('\n'));

    const result = await analyzeBacklog(tmpDir);
    expect(result.todos).toHaveLength(3);
    expect(result.todos.map(t => t.type)).toEqual(['FIXME', 'HACK', 'XXX']);
  });

  it('extracts Python-style # comments', async () => {
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/main.py'), [
      '# TODO: implement caching',
      'def main():',
      '    pass',
    ].join('\n'));

    const result = await analyzeBacklog(tmpDir);
    expect(result.todos).toHaveLength(1);
    expect(result.todos[0].type).toBe('TODO');
    expect(result.todos[0].text).toBe('implement caching');
  });

  it('groups todos by module', async () => {
    mkdirSync(join(tmpDir, 'src/core'), { recursive: true });
    mkdirSync(join(tmpDir, 'src/cli'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/core/a.ts'), '// TODO: core task 1');
    writeFileSync(join(tmpDir, 'src/core/b.ts'), '// TODO: core task 2');
    writeFileSync(join(tmpDir, 'src/cli/c.ts'), '// TODO: cli task');

    const result = await analyzeBacklog(tmpDir);
    expect(result.todosByModule['core']).toHaveLength(2);
    expect(result.todosByModule['cli']).toHaveLength(1);
  });

  it('parses CHANGELOG.md unreleased section', async () => {
    writeFileSync(join(tmpDir, 'CHANGELOG.md'), [
      '# Changelog',
      '',
      '## Unreleased',
      '- Add new feature',
      '- Fix login bug',
      '',
      '## 1.0.0',
      '- Initial release',
    ].join('\n'));

    const result = await analyzeBacklog(tmpDir);
    expect(result.changelogUnreleased).toEqual(['Add new feature', 'Fix login bug']);
  });

  it('parses [Unreleased] format in CHANGELOG', async () => {
    writeFileSync(join(tmpDir, 'CHANGELOG.md'), [
      '# Changelog',
      '',
      '## [Unreleased]',
      '- Item one',
      '',
      '## [1.0.0]',
    ].join('\n'));

    const result = await analyzeBacklog(tmpDir);
    expect(result.changelogUnreleased).toEqual(['Item one']);
  });

  it('returns undefined for changelogUnreleased when no CHANGELOG', async () => {
    const result = await analyzeBacklog(tmpDir);
    expect(result.changelogUnreleased).toBeUndefined();
  });

  it('caps at 200 TODOs', async () => {
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    const lines = Array.from({ length: 210 }, (_, i) => `// TODO: item ${i}`);
    writeFileSync(join(tmpDir, 'src/big.ts'), lines.join('\n'));

    const result = await analyzeBacklog(tmpDir);
    expect(result.todos).toHaveLength(200);
  });

  it('handles empty directory', async () => {
    const result = await analyzeBacklog(tmpDir);
    expect(result.todos).toEqual([]);
    expect(result.todosByModule).toEqual({});
  });

  it('ignores non-source files', async () => {
    writeFileSync(join(tmpDir, 'README.md'), '// TODO: not a source file');
    writeFileSync(join(tmpDir, 'data.json'), '{"TODO": "not a comment"}');

    const result = await analyzeBacklog(tmpDir);
    expect(result.todos).toEqual([]);
  });
});
