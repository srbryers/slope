import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { splitTopLevelCommaList, visionCommand } from '../../../src/cli/commands/vision.js';

let cwd: string;
let previousCwd: string;

function readVision(): { priorities: string[]; nonGoals?: string[] } {
  return JSON.parse(readFileSync(join(cwd, '.slope', 'vision.json'), 'utf8')) as {
    priorities: string[];
    nonGoals?: string[];
  };
}

describe('vision list parsing', () => {
  beforeEach(() => {
    previousCwd = process.cwd();
    cwd = mkdtempSync(join(tmpdir(), 'slope-vision-list-'));
    process.chdir(cwd);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(previousCwd);
    rmSync(cwd, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('splits only on top-level commas', () => {
    expect(splitTopLevelCommaList('Guests (find info, share moments live), Admin (manage X, Y, Z)')).toEqual([
      'Guests (find info, share moments live)',
      'Admin (manage X, Y, Z)',
    ]);
  });

  it('preserves parenthesized commas in vision create priorities and non-goals', async () => {
    await visionCommand([
      'create',
      '--purpose=Test vision',
      '--priorities=Guests on the day-of (find info, share moments live),Us as admin (manage X, Y, Z)',
      '--non-goals=Reports (CSV, PDF),Billing',
    ]);

    expect(readVision()).toMatchObject({
      priorities: [
        'Guests on the day-of (find info, share moments live)',
        'Us as admin (manage X, Y, Z)',
      ],
      nonGoals: ['Reports (CSV, PDF)', 'Billing'],
    });
  });

  it('preserves parenthesized commas in vision update priorities and non-goals', async () => {
    await visionCommand([
      'create',
      '--purpose=Test vision',
      '--priorities=Initial',
    ]);

    await visionCommand([
      'update',
      '--priorities=Guests (find info, share moments live),Admins (manage X, Y, Z)',
      '--non-goals=Exports (CSV, PDF),Billing',
    ]);

    expect(readVision()).toMatchObject({
      priorities: [
        'Guests (find info, share moments live)',
        'Admins (manage X, Y, Z)',
      ],
      nonGoals: ['Exports (CSV, PDF)', 'Billing'],
    });
  });
});
