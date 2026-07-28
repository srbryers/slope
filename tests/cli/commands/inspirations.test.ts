import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspirationsCommand } from '../../../src/cli/commands/inspirations.js';

describe('slope inspirations sprint identity', () => {
  let cwd: string;
  let originalCwd: string;
  let inspirationsPath: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'slope-inspirations-'));
    originalCwd = process.cwd();
    process.chdir(cwd);
    inspirationsPath = join(cwd, '.slope', 'inspirations.json');
    mkdirSync(join(cwd, '.slope'), { recursive: true });
    writeFileSync(
      join(cwd, '.slope', 'config.json'),
      JSON.stringify({ inspirationsPath: '.slope/inspirations.json' }),
    );
    writeFileSync(inspirationsPath, JSON.stringify({
      version: '1',
      last_updated: '2026-07-27T00:00:00.000Z',
      inspirations: [{
        id: 'buzz',
        source_url: 'https://github.com/block/buzz',
        project_name: 'Buzz',
        ideas: ['multi-agent collaboration'],
        status: 'planned',
        linked_sprints: [],
        added_at: '2026-07-27T00:00:00.000Z',
      }],
    }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    rmSync(cwd, { recursive: true, force: true });
  });

  it('links 458.1 and 458.10 without aliasing them', async () => {
    await inspirationsCommand(['link', '--id=buzz', '--sprint=458.10']);
    await inspirationsCommand(['link', '--id=buzz', '--sprint=458.1']);

    const file = JSON.parse(readFileSync(inspirationsPath, 'utf8'));
    expect(file.inspirations[0].linked_sprints).toEqual(['458.1', '458.10']);
  });
});
