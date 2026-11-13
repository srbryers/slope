import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { standupCommand } from '../../../src/cli/commands/standup.js';
import { createStore } from '../../../src/store/index.js';
import { TICKET_DONE_KIND } from '../../../src/core/ticket-completion.js';

let tmpDir: string;
let originalCwd: string;

function writeConfig(): void {
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({
    store_path: '.slope/slope.db',
    currentSprint: 1,
  }, null, 2));
}

async function captureLog(fn: () => Promise<void>): Promise<string> {
  const logs: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...args) => {
    logs.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await fn();
  } finally {
    vi.restoreAllMocks();
  }
  return logs.join('\n');
}

describe('slope standup ticket_done (#714)', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slope-standup-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    writeConfig();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('renders ledger completions as ticket key plus commit, not Decision made', async () => {
    const store = createStore({ storePath: '.slope/slope.db', cwd: tmpDir });
    await store.registerSession({
      session_id: 'sess-1',
      role: 'primary',
      ide: 'test',
    });
    // Mirror `slope ticket done`: a decision with kind=ticket_done and no
    // session_id. Completions live on the sprint ledger, not the session.
    await store.insertEvent({
      type: 'decision',
      sprint_number: 1,
      ticket_key: 'S1-1',
      data: { kind: TICKET_DONE_KIND, player: 'alice', commit: 'abc1234' },
    });
    await store.insertEvent({
      type: 'decision',
      sprint_number: 1,
      ticket_key: 'S1-2',
      data: { kind: TICKET_DONE_KIND, player: 'alice', commit: 'def5678' },
    });
    store.close();

    const output = await captureLog(() => standupCommand(['--session=sess-1']));

    expect(output).not.toContain('Decision made');
    expect(output).toContain('S1-1 @ abc1234');
    expect(output).toContain('S1-2 @ def5678');
    expect(output).toContain('[DONE]');
    expect(output).toContain('**Status:** complete');
  });
});
