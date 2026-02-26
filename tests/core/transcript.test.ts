import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getTranscriptPath,
  appendTurn,
  readTranscript,
  listTranscripts,
} from '../../src/core/transcript.js';
import type { TranscriptLine } from '../../src/core/types.js';

const TEST_DIR = join(process.cwd(), '.test-transcripts');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('getTranscriptPath', () => {
  it('creates directory and returns .jsonl path', () => {
    const path = getTranscriptPath(TEST_DIR, 'sess-abc-123');
    expect(path).toBe(join(TEST_DIR, 'sess-abc-123.jsonl'));
    expect(existsSync(TEST_DIR)).toBe(true);
  });

  it('handles nested directory creation', () => {
    const nested = join(TEST_DIR, 'deep', 'nested');
    const path = getTranscriptPath(nested, 'sess-1');
    expect(path).toBe(join(nested, 'sess-1.jsonl'));
    expect(existsSync(nested)).toBe(true);
  });
});

describe('appendTurn', () => {
  it('creates file and appends a single turn', () => {
    const line: TranscriptLine = {
      role: 'tool_result',
      timestamp: '2026-02-26T14:30:00Z',
      tool_calls: [{ tool: 'Read', params_summary: 'file: src/index.ts', success: true }],
      outcome: 'success',
    };

    appendTurn(TEST_DIR, 'sess-1', line);

    const content = readFileSync(join(TEST_DIR, 'sess-1.jsonl'), 'utf8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.role).toBe('tool_result');
    expect(parsed.tool_calls[0].tool).toBe('Read');
    expect(parsed.turn_number).toBeUndefined(); // NOT written to JSONL
  });

  it('appends multiple turns as separate lines', () => {
    const line1: TranscriptLine = {
      role: 'tool_result',
      timestamp: '2026-02-26T14:30:00Z',
      tool_calls: [{ tool: 'Read', params_summary: 'file: a.ts', success: true }],
    };
    const line2: TranscriptLine = {
      role: 'tool_result',
      timestamp: '2026-02-26T14:30:05Z',
      tool_calls: [{ tool: 'Edit', params_summary: 'file: b.ts', success: false, duration_ms: 150 }],
      outcome: 'failure',
      outcome_note: 'file not found',
    };

    appendTurn(TEST_DIR, 'sess-1', line1);
    appendTurn(TEST_DIR, 'sess-1', line2);

    const lines = readFileSync(join(TEST_DIR, 'sess-1.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).tool_calls[0].tool).toBe('Read');
    expect(JSON.parse(lines[1]).tool_calls[0].tool).toBe('Edit');
    expect(JSON.parse(lines[1]).outcome).toBe('failure');
  });
});

describe('readTranscript', () => {
  it('returns empty array for non-existent file', () => {
    const turns = readTranscript(TEST_DIR, 'non-existent');
    expect(turns).toEqual([]);
  });

  it('returns empty array for empty file', () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const fs = require('node:fs');
    fs.writeFileSync(join(TEST_DIR, 'empty.jsonl'), '');
    const turns = readTranscript(TEST_DIR, 'empty');
    expect(turns).toEqual([]);
  });

  it('skips malformed lines without crashing', () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const fs = require('node:fs');
    const validLine = JSON.stringify({ role: 'tool_result', timestamp: '2026-02-26T14:30:00Z' });
    fs.writeFileSync(join(TEST_DIR, 'corrupt.jsonl'), `${validLine}\n{truncated\n${validLine}\n`);
    const turns = readTranscript(TEST_DIR, 'corrupt');
    expect(turns).toHaveLength(2);
    expect(turns[0].turn_number).toBe(1);
    expect(turns[1].turn_number).toBe(3); // line 2 was skipped
  });

  it('assigns 1-indexed turn_number from line position', () => {
    const line1: TranscriptLine = {
      role: 'tool_result',
      timestamp: '2026-02-26T14:30:00Z',
      tool_calls: [{ tool: 'Read', params_summary: 'file: a.ts', success: true }],
    };
    const line2: TranscriptLine = {
      role: 'tool_result',
      timestamp: '2026-02-26T14:30:05Z',
      tool_calls: [{ tool: 'Grep', params_summary: 'pattern: foo', success: true }],
    };

    appendTurn(TEST_DIR, 'sess-1', line1);
    appendTurn(TEST_DIR, 'sess-1', line2);

    const turns = readTranscript(TEST_DIR, 'sess-1');
    expect(turns).toHaveLength(2);
    expect(turns[0].turn_number).toBe(1);
    expect(turns[0].tool_calls![0].tool).toBe('Read');
    expect(turns[1].turn_number).toBe(2);
    expect(turns[1].tool_calls![0].tool).toBe('Grep');
  });

  it('round-trips all TranscriptLine fields', () => {
    const line: TranscriptLine = {
      role: 'tool_result',
      timestamp: '2026-02-26T14:30:00Z',
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_tokens: 200,
      tool_calls: [{ tool: 'Bash', params_summary: 'cmd: pnpm test', success: true, duration_ms: 3000 }],
      outcome: 'success',
      outcome_note: 'all tests passed',
      context_used_pct: 45.2,
      compacted: false,
    };

    appendTurn(TEST_DIR, 'sess-1', line);
    const [turn] = readTranscript(TEST_DIR, 'sess-1');

    expect(turn.turn_number).toBe(1);
    expect(turn.role).toBe('tool_result');
    expect(turn.input_tokens).toBe(1000);
    expect(turn.output_tokens).toBe(500);
    expect(turn.cache_read_tokens).toBe(200);
    expect(turn.tool_calls![0].duration_ms).toBe(3000);
    expect(turn.outcome).toBe('success');
    expect(turn.outcome_note).toBe('all tests passed');
    expect(turn.context_used_pct).toBe(45.2);
    expect(turn.compacted).toBe(false);
  });
});

describe('listTranscripts', () => {
  it('returns empty array for non-existent directory', () => {
    const ids = listTranscripts(join(TEST_DIR, 'nope'));
    expect(ids).toEqual([]);
  });

  it('lists session IDs from .jsonl filenames', () => {
    appendTurn(TEST_DIR, 'sess-aaa', {
      role: 'tool_result',
      timestamp: '2026-02-26T10:00:00Z',
    });
    appendTurn(TEST_DIR, 'sess-bbb', {
      role: 'tool_result',
      timestamp: '2026-02-26T11:00:00Z',
    });

    const ids = listTranscripts(TEST_DIR);
    expect(ids).toHaveLength(2);
    expect(ids).toContain('sess-aaa');
    expect(ids).toContain('sess-bbb');
  });

  it('sorts by modification time (newest first)', () => {
    // Write first file, then second — second should be newer
    appendTurn(TEST_DIR, 'sess-old', {
      role: 'tool_result',
      timestamp: '2026-02-26T10:00:00Z',
    });
    // Touch to ensure different mtime
    appendTurn(TEST_DIR, 'sess-new', {
      role: 'tool_result',
      timestamp: '2026-02-26T11:00:00Z',
    });

    const ids = listTranscripts(TEST_DIR);
    expect(ids[0]).toBe('sess-new');
    expect(ids[1]).toBe('sess-old');
  });

  it('ignores non-jsonl files', () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const fs = require('node:fs');
    fs.writeFileSync(join(TEST_DIR, 'readme.txt'), 'hello');
    appendTurn(TEST_DIR, 'sess-1', {
      role: 'tool_result',
      timestamp: '2026-02-26T10:00:00Z',
    });

    const ids = listTranscripts(TEST_DIR);
    expect(ids).toEqual(['sess-1']);
  });
});
