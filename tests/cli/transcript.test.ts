import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { appendTurn } from '../../src/core/transcript.js';
import type { TranscriptLine } from '../../src/core/types.js';

const TEST_DIR = join(process.cwd(), '.test-cli-transcripts');
const TRANSCRIPTS_DIR = join(TEST_DIR, '.slope', 'transcripts');

vi.mock('../../src/cli/config.js', () => ({
  loadConfig: () => ({ transcriptsPath: '.slope/transcripts' }),
}));

// Mock process.cwd to point to our test directory
const originalCwd = process.cwd;

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  process.cwd = () => TEST_DIR;
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  process.cwd = originalCwd;
});

// Helper to create sample JSONL data
function writeSampleTranscript(sessionId: string, turns: TranscriptLine[]): void {
  for (const turn of turns) {
    appendTurn(TRANSCRIPTS_DIR, sessionId, turn);
  }
}

const sampleTurns: TranscriptLine[] = [
  {
    role: 'tool_result',
    timestamp: '2026-02-26T14:30:01Z',
    tool_calls: [{ tool: 'Read', params_summary: 'file: src/index.ts', success: true }],
    outcome: 'success',
  },
  {
    role: 'tool_result',
    timestamp: '2026-02-26T14:30:05Z',
    tool_calls: [{ tool: 'Grep', params_summary: 'pattern: TODO', success: true }],
    outcome: 'success',
  },
  {
    role: 'tool_result',
    timestamp: '2026-02-26T14:30:10Z',
    tool_calls: [{ tool: 'Edit', params_summary: 'file: src/app.ts', success: false }],
    outcome: 'failure',
    outcome_note: 'file not found',
  },
  {
    role: 'tool_result',
    timestamp: '2026-02-26T14:30:12Z',
    tool_calls: [{ tool: 'Read', params_summary: 'file: src/app.ts', success: true }],
    outcome: 'success',
  },
];

describe('transcriptCommand', () => {
  // Import after mocks are set up
  let transcriptCommand: (args: string[]) => Promise<void>;

  beforeEach(async () => {
    const mod = await import('../../src/cli/commands/transcript.js');
    transcriptCommand = mod.transcriptCommand;
  });

  describe('list', () => {
    it('shows "No transcripts found" for empty directory', async () => {
      const spy = vi.spyOn(console, 'log');
      await transcriptCommand(['list']);
      const calls = spy.mock.calls;
      spy.mockRestore();

      expect(calls.some(c => String(c[0]).includes('No transcripts found'))).toBe(true);
    });

    it('lists transcripts with turn counts', async () => {
      writeSampleTranscript('sess-abc-123', sampleTurns);
      writeSampleTranscript('sess-xyz-789', sampleTurns.slice(0, 2));

      const spy = vi.spyOn(console, 'log');
      await transcriptCommand(['list']);
      const output = spy.mock.calls.map(c => String(c[0])).join('\n');
      spy.mockRestore();

      expect(output).toContain('sess-abc-123');
      expect(output).toContain('sess-xyz-789');
      expect(output).toContain('4'); // 4 turns
      expect(output).toContain('2'); // 2 turns
    });
  });

  describe('show', () => {
    it('renders turn-by-turn summary', async () => {
      writeSampleTranscript('sess-abc-123', sampleTurns);

      const spy = vi.spyOn(console, 'log');
      await transcriptCommand(['show', 'sess-abc-123']);
      const output = spy.mock.calls.map(c => String(c[0])).join('\n');
      spy.mockRestore();

      expect(output).toContain('sess-abc-123');
      expect(output).toContain('4 turns');
      expect(output).toContain('Read');
      expect(output).toContain('Grep');
      expect(output).toContain('Edit');
      expect(output).toContain('failure');
      expect(output).toContain('success');
    });

    it('exits with error for missing session', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
      const errSpy = vi.spyOn(console, 'error');

      await expect(transcriptCommand(['show', 'non-existent'])).rejects.toThrow('exit');

      const errOutput = errSpy.mock.calls.map(c => String(c[0])).join('\n');
      exitSpy.mockRestore();
      errSpy.mockRestore();

      expect(errOutput).toContain('No transcript found');
    });

    it('exits with error when no session-id given', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
      const errSpy = vi.spyOn(console, 'error');

      await expect(transcriptCommand(['show'])).rejects.toThrow('exit');

      const errOutput = errSpy.mock.calls.map(c => String(c[0])).join('\n');
      exitSpy.mockRestore();
      errSpy.mockRestore();

      expect(errOutput).toContain('Usage');
    });
  });

  describe('stats', () => {
    it('shows stats for a single session', async () => {
      writeSampleTranscript('sess-abc-123', sampleTurns);

      const spy = vi.spyOn(console, 'log');
      await transcriptCommand(['stats', 'sess-abc-123']);
      const output = spy.mock.calls.map(c => String(c[0])).join('\n');
      spy.mockRestore();

      expect(output).toContain('sess-abc-123');
      expect(output).toContain('Turns: 4');
      expect(output).toContain('Read=2');
      expect(output).toContain('Success rate: 75%');
      expect(output).toContain('3/4');
    });

    it('aggregates stats across all sessions', async () => {
      writeSampleTranscript('sess-a', sampleTurns);
      writeSampleTranscript('sess-b', sampleTurns.slice(0, 2));

      const spy = vi.spyOn(console, 'log');
      await transcriptCommand(['stats']);
      const output = spy.mock.calls.map(c => String(c[0])).join('\n');
      spy.mockRestore();

      expect(output).toContain('2 sessions');
      expect(output).toContain('Turns: 6');
    });

    it('shows "No transcripts found" when empty', async () => {
      const spy = vi.spyOn(console, 'log');
      await transcriptCommand(['stats']);
      const calls = spy.mock.calls;
      spy.mockRestore();

      expect(calls.some(c => String(c[0]).includes('No transcripts found'))).toBe(true);
    });

    it('exits with error for missing session in stats', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
      const errSpy = vi.spyOn(console, 'error');

      await expect(transcriptCommand(['stats', 'non-existent'])).rejects.toThrow('exit');

      const errOutput = errSpy.mock.calls.map(c => String(c[0])).join('\n');
      exitSpy.mockRestore();
      errSpy.mockRestore();

      expect(errOutput).toContain('No transcript found');
    });
  });

  describe('help', () => {
    it('shows usage when no subcommand given', async () => {
      const spy = vi.spyOn(console, 'log');
      await transcriptCommand([]);
      const output = spy.mock.calls.map(c => String(c[0])).join('\n');
      spy.mockRestore();

      expect(output).toContain('slope transcript');
      expect(output).toContain('list');
      expect(output).toContain('show');
      expect(output).toContain('stats');
    });
  });
});
