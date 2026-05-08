import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { roadmapEditShippedGuard } from '../../../src/cli/guards/roadmap-edit-shipped.js';
import type { HookInput } from '../../../src/core/index.js';

function makeTmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'slope-guard-'));
  mkdirSync(join(dir, 'docs', 'backlog'), { recursive: true });
  return dir;
}

function writeRoadmap(cwd: string, content: object): string {
  const path = join(cwd, 'docs', 'backlog', 'roadmap.json');
  writeFileSync(path, JSON.stringify(content, null, 2));
  return path;
}

function baseRoadmap() {
  return {
    name: 'Test',
    description: 'test',
    phases: [{ name: 'P1', sprints: [1, 2] }],
    sprints: [
      {
        id: 1,
        theme: 'Shipped sprint',
        par: 4,
        slope: 1,
        type: 'feature',
        status: 'complete',
        tickets: [
          { key: 'S1-1', title: 'Original', club: 'short_iron', complexity: 'standard' },
        ],
      },
      {
        id: 2,
        theme: 'Planned sprint',
        par: 4,
        slope: 1,
        type: 'feature',
        status: 'planned',
        tickets: [
          { key: 'S2-1', title: 'Future', club: 'short_iron', complexity: 'standard' },
        ],
      },
    ],
  };
}

function writeInput(filePath: string, newContent: string): HookInput {
  return {
    session_id: 'test',
    cwd: '/tmp',
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: filePath, new_string: newContent },
    tool_response: {},
  };
}

function editInput(filePath: string, oldString: string, newString: string): HookInput {
  return {
    session_id: 'test',
    cwd: '/tmp',
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: filePath, old_string: oldString, new_string: newString },
    tool_response: {},
  };
}

describe('roadmapEditShippedGuard', () => {
  let cwd: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    cwd = makeTmpRepo();
    originalEnv = process.env.SLOPE_ALLOW_SHIPPED_EDIT;
    delete process.env.SLOPE_ALLOW_SHIPPED_EDIT;
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    if (originalEnv !== undefined) process.env.SLOPE_ALLOW_SHIPPED_EDIT = originalEnv;
    else delete process.env.SLOPE_ALLOW_SHIPPED_EDIT;
  });

  it('allows edits to non-roadmap files', async () => {
    const result = await roadmapEditShippedGuard(
      writeInput(join(cwd, 'src/main.ts'), 'console.log()'),
      cwd,
    );
    expect(result).toEqual({});
  });

  it('allows roadmap edits when no sprint is complete', async () => {
    const roadmap = baseRoadmap();
    roadmap.sprints[0].status = 'planned';
    const path = writeRoadmap(cwd, roadmap);

    const next = JSON.parse(JSON.stringify(roadmap));
    next.sprints[0].theme = 'Updated theme';
    const result = await roadmapEditShippedGuard(writeInput(path, JSON.stringify(next, null, 2)), cwd);
    expect(result).toEqual({});
  });

  it('allows edits that only touch planned sprints', async () => {
    const path = writeRoadmap(cwd, baseRoadmap());
    const next = baseRoadmap();
    next.sprints[1].theme = 'New planned theme'; // S2 is planned
    const result = await roadmapEditShippedGuard(writeInput(path, JSON.stringify(next, null, 2)), cwd);
    expect(result).toEqual({});
  });

  it('blocks adding a ticket to a shipped sprint', async () => {
    const path = writeRoadmap(cwd, baseRoadmap());
    const next = baseRoadmap();
    next.sprints[0].tickets.push({
      key: 'S1-2',
      title: 'New paper-ticket',
      club: 'short_iron',
      complexity: 'standard',
    });
    const result = await roadmapEditShippedGuard(writeInput(path, JSON.stringify(next, null, 2)), cwd);
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('S1');
    expect(result.blockReason).toContain('shipped sprint fields modified');
  });

  it('blocks changing the theme of a shipped sprint', async () => {
    const path = writeRoadmap(cwd, baseRoadmap());
    const next = baseRoadmap();
    next.sprints[0].theme = 'Rewritten history';
    const result = await roadmapEditShippedGuard(writeInput(path, JSON.stringify(next, null, 2)), cwd);
    expect(result.decision).toBe('deny');
  });

  it('blocks reverting status from complete to planned', async () => {
    const path = writeRoadmap(cwd, baseRoadmap());
    const next = baseRoadmap();
    next.sprints[0].status = 'planned';
    const result = await roadmapEditShippedGuard(writeInput(path, JSON.stringify(next, null, 2)), cwd);
    expect(result.decision).toBe('deny');
  });

  it('blocks removing a shipped sprint entirely', async () => {
    const path = writeRoadmap(cwd, baseRoadmap());
    const next = baseRoadmap();
    next.sprints = [next.sprints[1]]; // drop S1
    const result = await roadmapEditShippedGuard(writeInput(path, JSON.stringify(next, null, 2)), cwd);
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('removed');
  });

  it('handles Edit tool input via old_string/new_string delta', async () => {
    const roadmap = baseRoadmap();
    const path = writeRoadmap(cwd, roadmap);
    const oldString = '"title": "Original"';
    const newString = '"title": "Hijacked"';
    const result = await roadmapEditShippedGuard(editInput(path, oldString, newString), cwd);
    expect(result.decision).toBe('deny');
  });

  it('allows Edit when old_string does not match current content', async () => {
    const path = writeRoadmap(cwd, baseRoadmap());
    const result = await roadmapEditShippedGuard(
      editInput(path, 'nonexistent string', 'replacement'),
      cwd,
    );
    expect(result).toEqual({});
  });

  it('allows edits when JSON is malformed', async () => {
    const path = writeRoadmap(cwd, baseRoadmap());
    const result = await roadmapEditShippedGuard(writeInput(path, '{ broken json'), cwd);
    expect(result).toEqual({});
  });

  it('respects SLOPE_ALLOW_SHIPPED_EDIT=1 override', async () => {
    process.env.SLOPE_ALLOW_SHIPPED_EDIT = '1';
    const path = writeRoadmap(cwd, baseRoadmap());
    const next = baseRoadmap();
    next.sprints[0].theme = 'Override allowed';
    const result = await roadmapEditShippedGuard(writeInput(path, JSON.stringify(next, null, 2)), cwd);
    expect(result).toEqual({});
  });

  it('allows adding new (not yet complete) sprints', async () => {
    const path = writeRoadmap(cwd, baseRoadmap());
    const next = baseRoadmap();
    next.sprints.push({
      id: 3,
      theme: 'Brand new',
      par: 4,
      slope: 1,
      type: 'feature',
      status: 'planned',
      tickets: [{ key: 'S3-1', title: 'New', club: 'short_iron', complexity: 'standard' }],
    });
    const result = await roadmapEditShippedGuard(writeInput(path, JSON.stringify(next, null, 2)), cwd);
    expect(result).toEqual({});
  });
});
