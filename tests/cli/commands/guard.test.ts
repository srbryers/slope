import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Ensure adapters are registered
import '../../../src/core/adapters/claude-code.js';
import '../../../src/core/adapters/cursor.js';
import '../../../src/core/adapters/windsurf.js';
import '../../../src/core/adapters/generic.js';

import { guardManageCommand } from '../../../src/cli/commands/guard.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `slope-guard-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
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

    // Minimal .slope setup
    mkdirSync(join(cwd, '.slope'), { recursive: true });
    writeFileSync(join(cwd, '.slope', 'config.json'), JSON.stringify({
      scorecardDir: 'docs/retros',
      metaphor: 'golf',
    }));
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
