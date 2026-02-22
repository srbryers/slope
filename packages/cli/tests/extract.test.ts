import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractCommand } from '../src/commands/extract.js';

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-extract-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);

  // Create .slope/config.json
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  writeFileSync(
    join(tmpDir, '.slope', 'config.json'),
    JSON.stringify({ scorecardDir: 'docs/retros' }, null, 2)
  );
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('slope extract --file', () => {
  it('extracts a single event from file', async () => {
    const eventsFile = join(tmpDir, 'events.json');
    writeFileSync(eventsFile, JSON.stringify({
      type: 'failure',
      data: { error: 'build failed', file: 'index.ts' },
      sprint_number: 5,
      ticket_key: 'S5-1',
    }));

    const consoleSpy = vi.spyOn(console, 'log');
    await extractCommand(['--file=' + eventsFile]);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('1 event(s)'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('1 failure'));
    consoleSpy.mockRestore();
  });

  it('extracts multiple events from file', async () => {
    const eventsFile = join(tmpDir, 'events.json');
    writeFileSync(eventsFile, JSON.stringify([
      { type: 'failure', data: { error: 'build' } },
      { type: 'dead_end', data: { approach: 'api v1' } },
      { type: 'decision', data: { choice: 'refactor' } },
    ]));

    const consoleSpy = vi.spyOn(console, 'log');
    await extractCommand(['--file=' + eventsFile]);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('3 event(s)'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('1 failure'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('1 dead_end'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('1 decision'));
    consoleSpy.mockRestore();
  });

  it('associates events with session-id', async () => {
    const eventsFile = join(tmpDir, 'events.json');
    writeFileSync(eventsFile, JSON.stringify([
      { type: 'hazard', data: { desc: 'flaky test' } },
    ]));

    const consoleSpy = vi.spyOn(console, 'log');
    await extractCommand(['--file=' + eventsFile, '--session-id=sess-42']);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Session: sess-42'));
    consoleSpy.mockRestore();
  });

  it('applies default sprint number from --sprint flag', async () => {
    const eventsFile = join(tmpDir, 'events.json');
    writeFileSync(eventsFile, JSON.stringify([
      { type: 'compaction', data: { tokens: 50000 } },
    ]));

    const consoleSpy = vi.spyOn(console, 'log');
    await extractCommand(['--file=' + eventsFile, '--sprint=10']);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Sprint: 10'));
    consoleSpy.mockRestore();
  });

  it('rejects invalid event type', async () => {
    const eventsFile = join(tmpDir, 'events.json');
    writeFileSync(eventsFile, JSON.stringify({ type: 'invalid_type', data: {} }));

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const errorSpy = vi.spyOn(console, 'error');

    await expect(extractCommand(['--file=' + eventsFile])).rejects.toThrow('exit');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('invalid type'));
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('rejects non-JSON input', async () => {
    const eventsFile = join(tmpDir, 'events.json');
    writeFileSync(eventsFile, 'not json');

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const errorSpy = vi.spyOn(console, 'error');

    await expect(extractCommand(['--file=' + eventsFile])).rejects.toThrow('exit');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('valid JSON'));
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('handles all event types', async () => {
    const eventsFile = join(tmpDir, 'events.json');
    writeFileSync(eventsFile, JSON.stringify([
      { type: 'failure', data: {} },
      { type: 'dead_end', data: {} },
      { type: 'scope_change', data: {} },
      { type: 'compaction', data: {} },
      { type: 'hazard', data: {} },
      { type: 'decision', data: {} },
    ]));

    const consoleSpy = vi.spyOn(console, 'log');
    await extractCommand(['--file=' + eventsFile]);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('6 event(s)'));
    consoleSpy.mockRestore();
  });

  it('handles events with missing optional fields', async () => {
    const eventsFile = join(tmpDir, 'events.json');
    writeFileSync(eventsFile, JSON.stringify({ type: 'decision' }));

    const consoleSpy = vi.spyOn(console, 'log');
    await extractCommand(['--file=' + eventsFile]);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('1 event(s)'));
    consoleSpy.mockRestore();
  });
});

describe('slope extract --help', () => {
  it('prints usage', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    await extractCommand(['--help']);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('slope extract'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('--file'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('--session-id'));
    consoleSpy.mockRestore();
  });
});
