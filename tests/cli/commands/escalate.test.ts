import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { escalateCommand } from '../../../src/cli/commands/escalate.js';
import { resolveStore } from '../../../src/cli/store.js';

describe('slope escalate sprint identity', () => {
  let cwd: string;
  let originalCwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'slope-escalate-'));
    originalCwd = process.cwd();
    process.chdir(cwd);
    mkdirSync(join(cwd, '.slope'), { recursive: true });
    writeFileSync(
      join(cwd, '.slope', 'config.json'),
      JSON.stringify({ store_path: '.slope/slope.db' }),
    );
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    rmSync(cwd, { recursive: true, force: true });
  });

  it('logs 458.1 and 458.10 as distinct escalation events', async () => {
    await escalateCommand([
      '--reason=first',
      '--session-id=session-1',
      '--sprint=458.1',
    ]);
    await escalateCommand([
      '--reason=tenth',
      '--session-id=session-10',
      '--sprint=458.10',
    ]);

    const store = await resolveStore(cwd);
    try {
      expect((await store.getEventsBySprint('458.1')).map(event => event.sprint_number))
        .toEqual(['458.1']);
      expect((await store.getEventsBySprint('458.10')).map(event => event.sprint_number))
        .toEqual(['458.10']);
    } finally {
      store.close();
    }
  });
});
