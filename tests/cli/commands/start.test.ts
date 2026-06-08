import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sprintCommand } from '../../../src/cli/commands/sprint.js';
import { briefingCommand } from '../../../src/cli/commands/briefing.js';
import { startCommand } from '../../../src/cli/commands/start.js';

vi.mock('../../../src/cli/commands/sprint.js', () => ({
  sprintCommand: vi.fn(async () => {}),
}));

vi.mock('../../../src/cli/commands/briefing.js', () => ({
  briefingCommand: vi.fn(async () => {}),
}));

let tmpDir: string;
let originalCwd: string;

function writeConfig(): void {
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({
    currentSprint: 151,
    store_path: '.slope/slope.db',
  }, null, 2));
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-start-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  writeConfig();
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('slope start', () => {
  it('starts sprint state and compact briefing when no ticket is supplied', async () => {
    await startCommand([]);

    expect(sprintCommand).toHaveBeenCalledWith(['start', '--number=151', '--phase=implementing']);
    expect(briefingCommand).toHaveBeenCalledWith(['--sprint=151', '--compact']);
  });

  it('delegates ticket starts to the bundled sprint begin flow', async () => {
    await startCommand(['--ticket=S151-1']);

    expect(sprintCommand).toHaveBeenCalledWith(['begin', '--sprint=151', '--ticket=S151-1']);
    expect(briefingCommand).not.toHaveBeenCalled();
  });

  it('preserves explicit sprint overrides', async () => {
    await startCommand(['--sprint=151.5', '--ticket=S151.5-1']);

    expect(sprintCommand).toHaveBeenCalledWith(['begin', '--sprint=151.5', '--ticket=S151.5-1']);
  });
});
