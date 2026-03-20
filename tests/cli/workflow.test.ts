import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { workflowCommand } from '../../src/cli/commands/workflow.js';

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-wfcli-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  // Create minimal .slope/config.json so loadConfig doesn't fail
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({ currentSprint: 1 }));
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('slope workflow list', () => {
  it('lists built-in workflows', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await workflowCommand(['list']);

    spy.mockRestore();
    const output = logs.join('\n');
    expect(output).toContain('sprint-standard');
    expect(output).toContain('built-in');
  });

  it('lists project workflows', async () => {
    const wfDir = join(tmpDir, '.slope', 'workflows');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, 'custom.yaml'), `
name: my-custom
version: "1"
description: Custom workflow
phases:
  - id: p
    steps:
      - id: s
        type: command
        command: echo test
`);

    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await workflowCommand(['list']);

    spy.mockRestore();
    const output = logs.join('\n');
    expect(output).toContain('my-custom');
    expect(output).toContain('project');
  });
});

describe('slope workflow validate', () => {
  it('validates a built-in workflow successfully', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await workflowCommand(['validate', 'sprint-standard']);

    spy.mockRestore();
    const output = logs.join('\n');
    expect(output).toContain('sprint-standard');
    expect(output).toContain('Valid');
  });
});

describe('slope workflow show', () => {
  it('shows workflow structure', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await workflowCommand(['show', 'sprint-standard']);

    spy.mockRestore();
    const output = logs.join('\n');
    expect(output).toContain('sprint-standard');
    expect(output).toContain('Phases');
    expect(output).toContain('pre_hole');
    expect(output).toContain('per_ticket');
    expect(output).toContain('post_hole');
  });
});

describe('slope workflow (no subcommand)', () => {
  it('shows help text', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await workflowCommand([]);

    spy.mockRestore();
    const output = logs.join('\n');
    expect(output).toContain('slope workflow');
    expect(output).toContain('validate');
    expect(output).toContain('list');
    expect(output).toContain('show');
  });
});
