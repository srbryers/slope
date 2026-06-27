import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { retroCommand } from '../../../src/cli/commands/retro.js';
import { memoryCommand } from '../../../src/cli/commands/memory.js';
import { searchMemories } from '../../../src/core/memory.js';

function createTempDir(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'slope-retro-cli-'));
  mkdirSync(join(cwd, '.slope'), { recursive: true });
  return cwd;
}

async function captureLogs(fn: () => void | Promise<void>): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode = 0;

  const origLog = console.log;
  const origError = console.error;
  const origExit = process.exit;

  console.log = (...args: unknown[]) => stdout.push(args.join(' '));
  console.error = (...args: unknown[]) => stderr.push(args.join(' '));
  process.exit = ((code?: number) => { exitCode = code ?? 0; throw new Error(`EXIT:${code}`); }) as typeof process.exit;

  try {
    await fn();
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith('EXIT:')) throw err;
  } finally {
    console.log = origLog;
    console.error = origError;
    process.exit = origExit;
  }

  return { stdout: stdout.join('\n'), stderr: stderr.join('\n'), exitCode };
}

describe('retro post-merge CLI', () => {
  let cwd: string;
  let origCwd: string;

  beforeEach(() => {
    cwd = createTempDir();
    origCwd = process.cwd();
    process.chdir(cwd);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(cwd, { recursive: true, force: true });
  });

  it('documents the accepted learning prefix syntax in post-merge help', async () => {
    const out = await captureLogs(() => retroCommand(['post-merge', '--help']));

    expect(out.stdout).toContain('Categories: workflow, style, project, hazard, other');
    expect(out.stdout).toContain('Alias: process -> workflow');
    expect(out.stdout).toContain('Weight: 1-10');
    expect(out.stdout).toContain('Unsupported category prefixes are rejected');
  });

  it('writes a post-merge retro record and persists durable memories', async () => {
    const out = await captureLogs(() => retroCommand([
      'post-merge',
      '--sprint=137',
      '--pr=512',
      '--summary=merged cleanly after review',
      '--learning=project:8:Use auto-retro memory source for post-merge learnings',
      '--hazard=help flags can mutate workflow state',
      '--follow-up=add skill guidance for closeout retros',
    ]));

    const path = join(cwd, '.slope', 'retros', 'post-merge', 'sprint-137-pr-512.json');
    expect(out.stdout).toContain('S137 PR #512: wrote');
    expect(existsSync(path)).toBe(true);

    const record = JSON.parse(readFileSync(path, 'utf8'));
    expect(record.retro.sprint).toBe(137);
    expect(record.retro.pr).toBe(512);
    expect(record.retro.outcome).toBe('follow_up');
    expect(record.memory.planned).toBe(4);
    expect(record.memory.added).toHaveLength(4);

    const memories = searchMemories(cwd, { source: 'auto-retro' });
    expect(memories).toHaveLength(4);
    expect(memories.some(m => m.category === 'project' && m.weight === 8 && m.text.includes('auto-retro'))).toBe(true);
    expect(memories.some(m => m.category === 'hazard' && m.text.includes('help flags'))).toBe(true);
  });

  it('parses non-project category and weight prefixes without persisting prefix text', async () => {
    await captureLogs(() => retroCommand([
      'post-merge',
      '--sprint=137',
      '--pr=512',
      '--learning=process:6:Custom reviewer agents should stay lane-specific',
    ]));

    const path = join(cwd, '.slope', 'retros', 'post-merge', 'sprint-137-pr-512.json');
    const record = JSON.parse(readFileSync(path, 'utf8'));
    expect(record.retro.learnings).toContainEqual({
      text: 'Custom reviewer agents should stay lane-specific',
      category: 'workflow',
      weight: 6,
    });

    const memories = searchMemories(cwd, { source: 'auto-retro' });
    expect(memories.some(m =>
      m.category === 'workflow' &&
      m.weight === 6 &&
      m.text.includes('Custom reviewer agents should stay lane-specific') &&
      !m.text.includes('process:6:')
    )).toBe(true);
  });

  it('rejects unsupported learning category prefixes instead of persisting noisy text', async () => {
    const out = await captureLogs(() => retroCommand([
      'post-merge',
      '--sprint=137',
      '--learning=unknown:6:Do not persist this prefix',
    ]));

    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain('Unsupported --learning category prefix "unknown"');
    expect(out.stderr).toContain('workflow, style, project, hazard, other');
    expect(searchMemories(cwd, { source: 'auto-retro' })).toHaveLength(0);
  });

  it('accepts decimal sprint ids for inserted release-sprint retros (#529)', async () => {
    const out = await captureLogs(() => retroCommand([
      'post-merge',
      '--sprint=146.1',
      '--pr=527',
      '--summary=release shipped',
      '--learning=project:8:Decimal release sprints need retro memory support',
    ]));

    const path = join(cwd, '.slope', 'retros', 'post-merge', 'sprint-146.1-pr-527.json');
    expect(out.stdout).toContain('S146.1 PR #527: wrote');
    expect(existsSync(path)).toBe(true);

    const record = JSON.parse(readFileSync(path, 'utf8'));
    expect(record.retro.sprint).toBe(146.1);
    expect(record.retro.pr).toBe(527);

    const memories = searchMemories(cwd, { source: 'auto-retro' });
    expect(memories.some(m => m.text.includes('S146.1 PR #527 retro learning'))).toBe(true);
  });

  it('supports dry-run without writing memories or a retro record', async () => {
    const out = await captureLogs(() => retroCommand([
      'post-merge',
      '--sprint=137',
      '--summary=preview only',
      '--learning=Do not write this',
      '--dry-run',
    ]));

    expect(out.stdout).toContain('[dry-run]');
    expect(existsSync(join(cwd, '.slope', 'retros', 'post-merge', 'sprint-137.json'))).toBe(false);
    expect(searchMemories(cwd, { source: 'auto-retro' })).toHaveLength(0);
  });

  it('outputs JSON and skips duplicate auto-retro memories idempotently', async () => {
    const args = [
      'post-merge',
      '--sprint=137',
      '--summary=duplicate-safe retro',
      '--learning=Keep post-merge learnings durable',
      '--json',
    ];

    const first = JSON.parse((await captureLogs(() => retroCommand(args))).stdout);
    const second = JSON.parse((await captureLogs(() => retroCommand(args))).stdout);

    expect(first.memory.added).toHaveLength(2);
    expect(first.memory.skipped).toBe(0);
    expect(second.memory.added).toHaveLength(0);
    expect(second.memory.skipped).toBe(2);
    expect(second.path).toContain('sprint-137.json');
    expect(searchMemories(cwd, { source: 'auto-retro' })).toHaveLength(2);
  });

  it('makes retro learnings visible through memory search', async () => {
    await captureLogs(() => retroCommand([
      'post-merge',
      '--sprint=137',
      '--summary=memory-search integration',
      '--learning=Briefing should inherit post-merge retro lessons',
    ]));

    const out = await captureLogs(() => memoryCommand(['search', 'post-merge retro lessons']));
    expect(out.stdout).toContain('Search Results');
    expect(out.stdout).toContain('post-merge retro lessons');
  });

  it('reports suspected secrets instead of persisting them', async () => {
    const out = await captureLogs(() => retroCommand([
      'post-merge',
      '--sprint=137',
      '--learning=Token value sk-abcdefghijklmnopqrstuvwxyz123456 should not persist',
    ]));

    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain('secret pattern');
    expect(searchMemories(cwd, { source: 'auto-retro' })).toHaveLength(0);
  });

  it('requires a sprint number', async () => {
    const out = await captureLogs(() => retroCommand(['post-merge', '--summary=missing sprint']));
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain('Usage: slope retro post-merge --sprint=N');
  });
});
