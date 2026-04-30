import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryCommand } from '../../../src/cli/commands/memory.js';
import { searchMemories, addMemory } from '../../../src/core/memory.js';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'slope-memory-cli-'));
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

describe('memory CLI', () => {
  let cwd: string;
  let origCwd: string;

  beforeEach(() => {
    cwd = createTempDir();
    mkdirSync(join(cwd, '.slope'), { recursive: true });
    origCwd = process.cwd();
    process.chdir(cwd);
  });

  afterEach(() => {
    process.chdir(origCwd);
  });

  describe('add', () => {
    it('adds a memory with text', async () => {
      const out = await captureLogs(() => memoryCommand(['add', 'Remember this']));
      expect(out.stdout).toContain('Memory added');
      expect(out.stdout).toContain('Remember this');
      expect(existsSync(join(cwd, '.slope', 'memories.json'))).toBe(true);
    });

    it('adds with category and weight', async () => {
      const out = await captureLogs(() => memoryCommand(['add', 'Workflow tip', '--category=workflow', '--weight=9']));
      expect(out.stdout).toContain('[workflow]');
      expect(out.stdout).toContain('weight:9');
    });

    it('errors without text', async () => {
      const out = await captureLogs(() => memoryCommand(['add']));
      expect(out.exitCode).toBe(1);
      expect(out.stderr).toContain('Usage');
    });
  });

  describe('list', () => {
    it('lists memories', async () => {
      await captureLogs(() => memoryCommand(['add', 'First']));
      await captureLogs(() => memoryCommand(['add', 'Second']));
      const out = await captureLogs(() => memoryCommand(['list']));
      expect(out.stdout).toContain('First');
      expect(out.stdout).toContain('Second');
    });

    it('filters by category', async () => {
      await captureLogs(() => memoryCommand(['add', 'Workflow tip', '--category=workflow']));
      await captureLogs(() => memoryCommand(['add', 'Style note', '--category=style']));
      const out = await captureLogs(() => memoryCommand(['list', '--category=workflow']));
      expect(out.stdout).toContain('Workflow tip');
      expect(out.stdout).not.toContain('Style note');
    });

    it('shows empty message', async () => {
      const out = await captureLogs(() => memoryCommand(['list']));
      expect(out.stdout).toContain('No memories');
    });
  });

  describe('remove', () => {
    it('removes by id', async () => {
      addMemory(process.cwd(), 'To remove');
      const mems = searchMemories(process.cwd());
      expect(mems).toHaveLength(1);

      const out = await captureLogs(() => memoryCommand(['remove', mems[0].id]));
      expect(out.stdout).toContain('Memory removed');
    });

    it('errors on missing id', async () => {
      const out = await captureLogs(() => memoryCommand(['remove', 'nonexistent']));
      expect(out.exitCode).toBe(1);
      expect(out.stdout).toContain('Memory not found');
    });
  });

  describe('edit', () => {
    it('edits memory text', async () => {
      addMemory(process.cwd(), 'Original');
      const mems = searchMemories(process.cwd());
      expect(mems).toHaveLength(1);

      const out = await captureLogs(() => memoryCommand(['edit', mems[0].id, 'Updated text']));
      expect(out.stdout).toContain('Updated text');
    });

    it('errors on missing memory', async () => {
      const out = await captureLogs(() => memoryCommand(['edit', 'bad-id', 'Text']));
      expect(out.exitCode).toBe(1);
    });
  });

  describe('search', () => {
    it('finds matching memories', async () => {
      await captureLogs(() => memoryCommand(['add', 'Alpha workflow']));
      await captureLogs(() => memoryCommand(['add', 'Beta style']));

      const out = await captureLogs(() => memoryCommand(['search', 'alpha']));
      expect(out.stdout).toContain('Alpha workflow');
      expect(out.stdout).not.toContain('Beta style');
    });

    it('respects limit', async () => {
      await captureLogs(() => memoryCommand(['add', 'One']));
      await captureLogs(() => memoryCommand(['add', 'Two']));
      await captureLogs(() => memoryCommand(['add', 'Three']));

      const out = await captureLogs(() => memoryCommand(['search', '--limit=2']));
      // Should show header + 2 results
      const lines = out.stdout.split('\n').filter(l => l.includes(']'));
      expect(lines.length).toBe(2);
    });
  });

  describe('export', () => {
    it('exports memories to file', async () => {
      await captureLogs(() => memoryCommand(['add', 'Export me']));
      const outFile = join(cwd, 'exported.json');

      const out = await captureLogs(() => memoryCommand(['export', outFile]));
      expect(out.stdout).toContain('Exported');
      expect(existsSync(outFile)).toBe(true);

      const exported = JSON.parse(readFileSync(outFile, 'utf8'));
      expect(exported.memories).toHaveLength(1);
      expect(exported.memories[0].text).toBe('Export me');
    });
  });

  describe('import', () => {
    it('imports from array', async () => {
      const inFile = join(cwd, 'import.json');
      writeFileSync(inFile, JSON.stringify([{ text: 'Imported', category: 'project', weight: 7 }]));

      const out = await captureLogs(() => memoryCommand(['import', inFile]));
      expect(out.stdout).toContain('Imported');

      const listOut = await captureLogs(() => memoryCommand(['list']));
      expect(listOut.stdout).toContain('Imported');
    });

    it('imports from memories file format', async () => {
      const inFile = join(cwd, 'import.json');
      writeFileSync(inFile, JSON.stringify({ version: 1, memories: [{ text: 'Wrapped', category: 'hazard', weight: 5, source: 'manual', id: 'x', createdAt: '2024-01-01', updatedAt: '2024-01-01' }] }));

      await captureLogs(() => memoryCommand(['import', inFile]));
      const listOut = await captureLogs(() => memoryCommand(['list']));
      expect(listOut.stdout).toContain('Wrapped');
    });
  });
});
