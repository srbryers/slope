import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { nowCommand } from '../../../src/cli/commands/now.js';
import { createStore } from '../../../src/store/index.js';
import type { RoadmapDefinition } from '../../../src/core/index.js';
import { createSprintState, saveSprintState } from '../../../src/cli/sprint-state.js';

let tmpDir: string;
let originalCwd: string;

function writeConfig(): void {
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({
    store_path: '.slope/slope.db',
  }, null, 2));
}

function writeRoadmap(): void {
  const roadmap: RoadmapDefinition = {
    name: 'Test Roadmap',
    phases: [{ name: 'Human Surface', sprints: [150, 151] }],
    sprints: [
      {
        id: 150,
        theme: 'Command Audience Metadata',
        par: 4,
        slope: 2,
        type: 'cli surface',
        tickets: [
          { key: 'S150-1', title: 'Done', club: 'short_iron', complexity: 'standard' },
          { key: 'S150-2', title: 'Done too', club: 'short_iron', complexity: 'standard' },
          { key: 'S150-3', title: 'Done three', club: 'wedge', complexity: 'small' },
        ],
      } as RoadmapDefinition['sprints'][number] & { status: string },
      {
        id: 151,
        theme: 'Skill-First Human Cockpit',
        par: 4,
        slope: 3,
        type: 'workflow + cli surface',
        depends_on: [150],
        tickets: [
          { key: 'S151-1', title: 'Implement slope now', club: 'long_iron', complexity: 'moderate' },
          { key: 'S151-2', title: 'Implement slope start', club: 'long_iron', complexity: 'moderate' },
          { key: 'S151-3', title: 'Update skills', club: 'short_iron', complexity: 'standard' },
        ],
      } as RoadmapDefinition['sprints'][number] & { status: string },
    ],
  };
  (roadmap.sprints[0] as RoadmapDefinition['sprints'][number] & { status: string }).status = 'complete';
  (roadmap.sprints[1] as RoadmapDefinition['sprints'][number] & { status: string }).status = 'active';
  mkdirSync(join(tmpDir, 'docs', 'backlog'), { recursive: true });
  writeFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), JSON.stringify(roadmap, null, 2));
}

async function captureLog(fn: () => Promise<void>): Promise<string> {
  const logs: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...args) => {
    logs.push(args.map(String).join(' '));
  });
  try {
    await fn();
  } finally {
    vi.restoreAllMocks();
  }
  return logs.join('\n');
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-now-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  writeConfig();
  writeRoadmap();
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('slope now', () => {
  it('prints a compact human cockpit with current sprint and next action', async () => {
    saveSprintState(tmpDir, createSprintState(151, 'implementing'));
    const store = createStore({ storePath: '.slope/slope.db', cwd: tmpDir });
    await store.claim({ sprint_number: 151, player: 'test', target: 'S151-1', scope: 'ticket' });
    store.close();

    const output = await captureLog(() => nowCommand([]));

    expect(output).toContain('SLOPE Now');
    expect(output).toContain('Current: S151 - Skill-First Human Cockpit');
    expect(output).toContain('Phase: Human Surface (1/2)');
    expect(output).toContain('Sprint state: implementing');
    expect(output).toContain('Claims: 1 active, 1 ticket');
    expect(output).toContain('Next: Start S151-2: Implement slope start');
    expect(output).toContain('Start: slope start --ticket=S151-2');
    expect(output.split('\n').length).toBeLessThanOrEqual(14);
  });

  it('supports JSON output for agent consumers', async () => {
    const output = await captureLog(() => nowCommand(['--json']));
    const parsed = JSON.parse(output);

    expect(parsed.sprint).toBe(151);
    expect(parsed.roadmap.theme).toBe('Skill-First Human Cockpit');
    expect(parsed.nextTicket.key).toBe('S151-1');
  });
});
