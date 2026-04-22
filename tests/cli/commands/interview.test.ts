// SLOPE — Interview CLI Command Tests

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'slope-interview-test-'));
}

function runSlope(cwd: string, args: string[]): string {
  const bin = join(process.cwd(), 'dist/cli/index.js');
  return execSync(`node "${bin}" ${args.join(' ')}`, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
  });
}

describe('slope interview CLI', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = createTempDir();
    mkdirSync(join(cwd, '.slope'), { recursive: true });
    mkdirSync(join(cwd, 'docs', 'retros'), { recursive: true });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('agent mode emits JSON question on startup', () => {
    const result = execSync(
      `node "${join(process.cwd(), 'dist/cli/index.js')}" interview --agent`,
      {
        cwd,
        encoding: 'utf8',
        input: JSON.stringify({ id: 'project-name', value: 'TestProject' }) + '\n' +
               JSON.stringify({ id: 'metaphor', value: 'golf' }) + '\n' +
               JSON.stringify({ id: 'repo-url', value: '' }) + '\n' +
               JSON.stringify({ id: 'sprint-number', value: '1' }) + '\n' +
               JSON.stringify({ id: 'platforms', value: [] }) + '\n' +
               JSON.stringify({ id: 'team-members', value: '' }) + '\n' +
               JSON.stringify({ id: 'vision', value: '' }) + '\n' +
               JSON.stringify({ id: 'deep-analysis', value: false }) + '\n',
      }
    );

    const lines = result.trim().split('\n');
    const first = JSON.parse(lines[0]);
    expect(first.type).toBe('question');
    expect(first.id).toBe('project-name');

    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.type).toBe('complete');
    expect(last.filesCreated).toBeDefined();
  });

  it('agent mode rejects invalid JSON input', () => {
    const result = execSync(
      `node "${join(process.cwd(), 'dist/cli/index.js')}" interview --agent`,
      {
        cwd,
        encoding: 'utf8',
        input: 'not-json\n',
      }
    );

    const last = JSON.parse(result.trim().split('\n').pop()!);
    expect(last.type).toBe('error');
    expect(last.errors[0].message).toContain('Invalid JSON');
  });

  it('agent mode validates answers', () => {
    const result = execSync(
      `node "${join(process.cwd(), 'dist/cli/index.js')}" interview --agent`,
      {
        cwd,
        encoding: 'utf8',
        input: JSON.stringify({ id: 'project-name', value: '' }) + '\n',
      }
    );

    const lines = result.trim().split('\n');
    const first = JSON.parse(lines[0]);
    expect(first.type).toBe('question');
    expect(first.id).toBe('project-name');

    const second = JSON.parse(lines[1]);
    expect(second.type).toBe('error');
    expect(second.errors[0].message).toContain('required');
  });

  it('blocks re-interview without --force when config exists', () => {
    writeFileSync(join(cwd, '.slope', 'config.json'), JSON.stringify({ version: '1' }));

    expect(() => {
      execSync(
        `node "${join(process.cwd(), 'dist/cli/index.js')}" interview --agent`,
        {
          cwd,
          encoding: 'utf8',
          input: '\n',
        }
      );
    }).toThrow();
  });
});
