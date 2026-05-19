import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import type { HookInput } from '../../../src/core/index.js';

// Ensure adapters are registered
import '../../../src/core/adapters/claude-code.js';
import '../../../src/core/adapters/cursor.js';
import '../../../src/core/adapters/windsurf.js';
import '../../../src/core/adapters/generic.js';

import { guardCommand, guardManageCommand, shouldSuppressGuardInAdhoc } from '../../../src/cli/commands/guard.js';
import { loadSessionState, setSessionMode } from '../../../src/cli/session-state.js';
import { createSprintState, saveSprintState } from '../../../src/cli/sprint-state.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `slope-guard-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeMinimalSlopeConfig(cwd: string): void {
  mkdirSync(join(cwd, '.slope'), { recursive: true });
  writeFileSync(join(cwd, '.slope', 'config.json'), JSON.stringify({
    scorecardDir: 'docs/retros',
    metaphor: 'golf',
  }));
}

function makeHookInput(cwd: string, overrides: Partial<HookInput> = {}): HookInput {
  return {
    session_id: 'test-session',
    cwd,
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { file_path: join(cwd, 'src/example.ts') },
    ...overrides,
  };
}

async function runGuardCommandWithInput(args: string[], input: HookInput): Promise<string> {
  const stdin = new PassThrough();
  const originalStdin = process.stdin;
  let output = '';
  const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  });

  Object.defineProperty(process, 'stdin', { value: stdin, configurable: true });
  try {
    const command = guardCommand(args);
    stdin.end(JSON.stringify(input));
    await command;
    return output;
  } finally {
    writeSpy.mockRestore();
    Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
  }
}

describe('slope guard recommend (S65-3)', () => {
  let cwd: string;
  let origCwd: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    cwd = makeTmpDir();
    origCwd = process.cwd();
    process.chdir(cwd);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    writeMinimalSlopeConfig(cwd);
    writeFileSync(join(cwd, '.slope', 'hooks.json'), JSON.stringify({ installed: {} }));
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(cwd, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('shows missing guards with relevance', async () => {
    await guardManageCommand(['recommend']);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Missing guards:');
    expect(output).toContain('Guard');
    expect(output).toContain('Relevant');
  });

  it('detects sprint-workflow profile', async () => {
    // Create roadmap + retros to trigger sprint-workflow
    mkdirSync(join(cwd, 'docs', 'retros'), { recursive: true });
    mkdirSync(join(cwd, 'docs', 'backlog'), { recursive: true });
    writeFileSync(join(cwd, 'docs', 'backlog', 'roadmap.json'), JSON.stringify({ sprints: [] }));

    await guardManageCommand(['recommend']);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('sprint-workflow');
  });

  it('detects monorepo profile', async () => {
    mkdirSync(join(cwd, 'packages'), { recursive: true });

    await guardManageCommand(['recommend']);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('monorepo');
  });

  it('detects has-flows profile', async () => {
    writeFileSync(join(cwd, '.slope', 'flows.json'), JSON.stringify([{ id: 'test', title: 'Test flow' }]));

    await guardManageCommand(['recommend']);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('has-flows');
  });

  it('marks always-relevant guards as YES', async () => {
    await guardManageCommand(['recommend']);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    // Guards with when:'always' should show YES
    expect(output).toContain('YES');
  });
});

describe('guardCommand dispatcher path', () => {
  let cwd: string;
  let origCwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
    origCwd = process.cwd();
    process.chdir(cwd);
    writeMinimalSlopeConfig(cwd);
    setSessionMode(cwd, 'test-session', 'adhoc');
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(cwd, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('emits ask output for claim-required on adhoc implementation writes with no sprint state', async () => {
    const output = await runGuardCommandWithInput(['claim-required'], makeHookInput(cwd));
    const parsed = JSON.parse(output);

    expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('ask');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('no active sprint state');

    const metrics = readFileSync(join(cwd, '.slope', 'guard-metrics.jsonl'), 'utf8');
    expect(metrics).toContain('"guard":"claim-required"');
    expect(metrics).toContain('"decision":"ask"');
  });

  it('records suppressed metrics for adhoc workflow guards that do not run', async () => {
    const output = await runGuardCommandWithInput(['workflow-step-gate'], makeHookInput(cwd));

    expect(output).toBe('');
    const metrics = readFileSync(join(cwd, '.slope', 'guard-metrics.jsonl'), 'utf8');
    expect(metrics).toContain('"guard":"workflow-step-gate"');
    expect(metrics).toContain('"decision":"suppressed"');
    expect(metrics).toContain('"reason":"adhoc-session"');
  });

  it('keeps claim-required effective when batched with suppressed write guards', async () => {
    const output = await runGuardCommandWithInput(
      ['__batch', 'workflow-step-gate', 'claim-required'],
      makeHookInput(cwd),
    );
    const parsed = JSON.parse(output);

    expect(parsed.hookSpecificOutput.permissionDecision).toBe('ask');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('slope claim');

    const metrics = readFileSync(join(cwd, '.slope', 'guard-metrics.jsonl'), 'utf8');
    expect(metrics).toContain('"guard":"workflow-step-gate"');
    expect(metrics).toContain('"decision":"suppressed"');
    expect(metrics).toContain('"guard":"claim-required"');
    expect(metrics).toContain('"decision":"ask"');
  });
});

describe('adhoc guard suppression', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
    writeMinimalSlopeConfig(cwd);
    setSessionMode(cwd, 'test-session', 'adhoc');
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('keeps most sprint workflow guards suppressed in adhoc sessions', () => {
    expect(shouldSuppressGuardInAdhoc('workflow-step-gate', cwd, 'test-session')).toBe(true);
  });

  it('promotes adhoc sessions when live sprint-state appears', () => {
    saveSprintState(cwd, createSprintState(74, 'planning'));

    expect(shouldSuppressGuardInAdhoc('workflow-step-gate', cwd, 'test-session')).toBe(false);
    expect(loadSessionState(cwd).session_mode).toBe('sprint');
  });

  it('allows claim-required to run in adhoc sessions', () => {
    expect(shouldSuppressGuardInAdhoc('claim-required', cwd, 'test-session')).toBe(false);
  });
});
