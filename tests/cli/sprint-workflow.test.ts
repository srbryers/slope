import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sprintCommand } from '../../src/cli/commands/sprint.js';

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-sprint-wf-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  // Create minimal .slope/config.json
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({ currentSprint: 1 }));
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('slope sprint run --workflow', () => {
  it('starts a workflow execution and prints first step', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await sprintCommand(['run', 'S99', '--workflow=sprint-standard', '--var=tickets=T1,T2']);

    spy.mockRestore();
    const output = logs.join('\n');
    expect(output).toContain('sprint-standard');
    expect(output).toContain('started');
    expect(output).toContain('pre_hole');
    expect(output).toContain('briefing');
  });
});

describe('slope sprint status (workflow)', () => {
  it('shows active workflow executions', async () => {
    // Start a workflow first
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await sprintCommand(['run', 'S88', '--workflow=sprint-standard', '--var=tickets=T1']);
    vi.restoreAllMocks();

    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await sprintCommand(['status', 'S88']);

    spy.mockRestore();
    const output = logs.join('\n');
    expect(output).toContain('sprint-standard');
    expect(output).toContain('running');
  });
});

describe('slope sprint resume', () => {
  it('shows next step for existing execution', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await sprintCommand(['run', 'S77', '--workflow=sprint-standard', '--var=tickets=T1']);
    vi.restoreAllMocks();

    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await sprintCommand(['resume', 'S77']);

    spy.mockRestore();
    const output = logs.join('\n');
    expect(output).toContain('Resuming');
    expect(output).toContain('briefing');
  });
});

describe('slope sprint help', () => {
  it('shows help with workflow commands', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await sprintCommand([]);

    spy.mockRestore();
    const output = logs.join('\n');
    expect(output).toContain('--workflow');
    expect(output).toContain('resume');
    expect(output).toContain('skip');
  });
});
