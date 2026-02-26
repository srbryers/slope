import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { transcriptGuard } from '../../../src/cli/guards/transcript.js';
import type { HookInput } from '../../../src/core/guard.js';

const TEST_DIR = join(process.cwd(), '.test-guard-transcripts');
const TRANSCRIPTS_DIR = join(TEST_DIR, '.slope', 'transcripts');

vi.mock('../../../src/cli/config.js', () => ({
  loadConfig: () => ({ transcriptsPath: '.slope/transcripts' }),
}));

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

function makeInput(overrides: Partial<HookInput> = {}): HookInput {
  return {
    session_id: 'test-sess-1',
    cwd: TEST_DIR,
    hook_event_name: 'PostToolUse',
    tool_name: 'Read',
    tool_input: { file_path: 'src/index.ts' },
    tool_response: {},
    ...overrides,
  };
}

describe('transcriptGuard', () => {
  it('appends a turn for a successful tool call', async () => {
    const result = await transcriptGuard(makeInput(), TEST_DIR);

    // Guard is silent
    expect(result).toEqual({});

    // Check JSONL was written
    const filePath = join(TRANSCRIPTS_DIR, 'test-sess-1.jsonl');
    expect(existsSync(filePath)).toBe(true);

    const line = JSON.parse(readFileSync(filePath, 'utf8').trim());
    expect(line.role).toBe('tool_result');
    expect(line.tool_calls).toHaveLength(1);
    expect(line.tool_calls[0].tool).toBe('Read');
    expect(line.tool_calls[0].params_summary).toBe('file: src/index.ts');
    expect(line.tool_calls[0].success).toBe(true);
    expect(line.outcome).toBe('success');
    expect(line.turn_number).toBeUndefined();
  });

  it('detects failure from tool_response.error', async () => {
    const input = makeInput({
      tool_name: 'Edit',
      tool_input: { file_path: 'missing.ts' },
      tool_response: { error: 'File not found' },
    });

    await transcriptGuard(input, TEST_DIR);

    const filePath = join(TRANSCRIPTS_DIR, 'test-sess-1.jsonl');
    const line = JSON.parse(readFileSync(filePath, 'utf8').trim());
    expect(line.tool_calls[0].success).toBe(false);
    expect(line.outcome).toBe('failure');
  });

  it('detects failure from tool_response.stderr', async () => {
    const input = makeInput({
      tool_name: 'Bash',
      tool_input: { command: 'pnpm test' },
      tool_response: { stderr: 'Error: test failed' },
    });

    await transcriptGuard(input, TEST_DIR);

    const filePath = join(TRANSCRIPTS_DIR, 'test-sess-1.jsonl');
    const line = JSON.parse(readFileSync(filePath, 'utf8').trim());
    expect(line.tool_calls[0].success).toBe(false);
  });

  it('detects failure from tool_response.is_error', async () => {
    const input = makeInput({
      tool_response: { is_error: true },
    });

    await transcriptGuard(input, TEST_DIR);

    const filePath = join(TRANSCRIPTS_DIR, 'test-sess-1.jsonl');
    const line = JSON.parse(readFileSync(filePath, 'utf8').trim());
    expect(line.tool_calls[0].success).toBe(false);
  });

  it('skips silently when session_id is missing', async () => {
    const input = makeInput({ session_id: '' });
    const result = await transcriptGuard(input, TEST_DIR);

    expect(result).toEqual({});
    expect(existsSync(TRANSCRIPTS_DIR)).toBe(false);
  });

  it('summarizes Read params', async () => {
    await transcriptGuard(makeInput({
      tool_name: 'Read',
      tool_input: { file_path: '/home/user/src/core/types.ts' },
    }), TEST_DIR);

    const line = JSON.parse(readFileSync(join(TRANSCRIPTS_DIR, 'test-sess-1.jsonl'), 'utf8').trim());
    expect(line.tool_calls[0].params_summary).toBe('file: /home/user/src/core/types.ts');
  });

  it('summarizes Bash params (truncated)', async () => {
    const longCmd = 'a'.repeat(200);
    await transcriptGuard(makeInput({
      tool_name: 'Bash',
      tool_input: { command: longCmd },
    }), TEST_DIR);

    const line = JSON.parse(readFileSync(join(TRANSCRIPTS_DIR, 'test-sess-1.jsonl'), 'utf8').trim());
    expect(line.tool_calls[0].params_summary).toBe(`cmd: ${'a'.repeat(80)}`);
  });

  it('summarizes Grep params', async () => {
    await transcriptGuard(makeInput({
      tool_name: 'Grep',
      tool_input: { pattern: 'TODO', path: 'src/' },
    }), TEST_DIR);

    const line = JSON.parse(readFileSync(join(TRANSCRIPTS_DIR, 'test-sess-1.jsonl'), 'utf8').trim());
    expect(line.tool_calls[0].params_summary).toBe('pattern: TODO, path: src/');
  });

  it('summarizes Glob params', async () => {
    await transcriptGuard(makeInput({
      tool_name: 'Glob',
      tool_input: { pattern: '**/*.ts' },
    }), TEST_DIR);

    const line = JSON.parse(readFileSync(join(TRANSCRIPTS_DIR, 'test-sess-1.jsonl'), 'utf8').trim());
    expect(line.tool_calls[0].params_summary).toBe('pattern: **/*.ts');
  });

  it('summarizes Task params', async () => {
    await transcriptGuard(makeInput({
      tool_name: 'Task',
      tool_input: { subagent_type: 'Explore', prompt: 'Find all guards' },
    }), TEST_DIR);

    const line = JSON.parse(readFileSync(join(TRANSCRIPTS_DIR, 'test-sess-1.jsonl'), 'utf8').trim());
    expect(line.tool_calls[0].params_summary).toBe('type: Explore');
  });

  it('summarizes Write params', async () => {
    await transcriptGuard(makeInput({
      tool_name: 'Write',
      tool_input: { file_path: 'new-file.ts', content: 'export {}' },
    }), TEST_DIR);

    const line = JSON.parse(readFileSync(join(TRANSCRIPTS_DIR, 'test-sess-1.jsonl'), 'utf8').trim());
    expect(line.tool_calls[0].params_summary).toBe('file: new-file.ts');
  });

  it('summarizes unknown tool params with JSON fallback', async () => {
    await transcriptGuard(makeInput({
      tool_name: 'CustomTool',
      tool_input: { key: 'value' },
    }), TEST_DIR);

    const line = JSON.parse(readFileSync(join(TRANSCRIPTS_DIR, 'test-sess-1.jsonl'), 'utf8').trim());
    expect(line.tool_calls[0].params_summary).toBe('{"key":"value"}');
  });

  it('writes valid JSONL (multiple turns)', async () => {
    await transcriptGuard(makeInput({ tool_name: 'Read' }), TEST_DIR);
    await transcriptGuard(makeInput({ tool_name: 'Edit', tool_input: { file_path: 'b.ts' } }), TEST_DIR);

    const content = readFileSync(join(TRANSCRIPTS_DIR, 'test-sess-1.jsonl'), 'utf8').trim();
    const lines = content.split('\n');
    expect(lines).toHaveLength(2);
    // Each line is valid JSON
    for (const l of lines) {
      expect(() => JSON.parse(l)).not.toThrow();
    }
  });
});
