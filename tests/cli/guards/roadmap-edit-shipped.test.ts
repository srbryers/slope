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

function modularSource(status: 'complete' | 'planned', title = 'Original'): string {
  return `version: 1
phase:
  name: Phase 1
  status: ${status}
  sprints: [1]
sprints:
  - id: 1
    theme: Sprint 1
    par: 3
    slope: 1
    type: feature
    status: ${status}
    tickets:
      - {key: S1-1, title: ${title}, club: wedge, complexity: small}
`;
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

function applyPatchInput(filePath: string, oldLine: string, newLine: string): HookInput {
  return {
    session_id: 'test',
    cwd: '/tmp',
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      command: [
        '*** Begin Patch',
        `*** Update File: ${filePath}`,
        '@@',
        `-${oldLine}`,
        `+${newLine}`,
        '*** End Patch',
      ].join('\n'),
    },
    tool_response: {},
  };
}

function multiApplyPatchInput(changes: Array<{ filePath: string; oldLine: string; newLine: string }>): HookInput {
  const lines = ['*** Begin Patch'];
  for (const change of changes) {
    lines.push(
      `*** Update File: ${change.filePath}`,
      '@@',
      `-${change.oldLine}`,
      `+${change.newLine}`,
    );
  }
  lines.push('*** End Patch');
  return {
    session_id: 'test',
    cwd: '/tmp',
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { command: lines.join('\n') },
    tool_response: {},
  };
}

function deletePatchInput(filePath: string): HookInput {
  return {
    session_id: 'test',
    cwd: '/tmp',
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      command: [
        '*** Begin Patch',
        `*** Delete File: ${filePath}`,
        '*** End Patch',
      ].join('\n'),
    },
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

  it('blocks direct edits to a generated modular roadmap projection', async () => {
    const roadmap = baseRoadmap();
    roadmap.sprints[0].status = 'planned';
    const path = writeRoadmap(cwd, roadmap);
    mkdirSync(join(cwd, 'docs', 'roadmap'), { recursive: true });
    writeFileSync(join(cwd, 'docs', 'roadmap', 'project.yaml'), 'version: 1\n');

    const next = JSON.parse(JSON.stringify(roadmap));
    next.sprints[1].theme = 'Direct generated edit';
    const result = await roadmapEditShippedGuard(writeInput(path, JSON.stringify(next, null, 2)), cwd);

    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('generated modular-roadmap projection');
    expect(result.blockReason).toContain('roadmap compile');
  });

  it('blocks shipped history edits in authoritative modular source YAML', async () => {
    mkdirSync(join(cwd, 'docs', 'roadmap', 'phases'), { recursive: true });
    writeFileSync(join(cwd, 'docs', 'roadmap', 'project.yaml'), 'version: 1\n');
    const sourcePath = join(cwd, 'docs', 'roadmap', 'phases', 'phase-01.yaml');
    writeFileSync(sourcePath, modularSource('complete'));

    const result = await roadmapEditShippedGuard(writeInput(sourcePath, modularSource('complete', 'Rewritten')), cwd);

    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('shipped sprints in modular roadmap sources');
    expect(result.blockReason).toContain('S1');
  });

  it('blocks deleting authoritative modular source YAML with terminal history', async () => {
    mkdirSync(join(cwd, 'docs', 'roadmap', 'phases'), { recursive: true });
    writeFileSync(join(cwd, 'docs', 'roadmap', 'project.yaml'), 'version: 1\n');
    const sourcePath = join(cwd, 'docs', 'roadmap', 'phases', 'phase-01.yaml');
    writeFileSync(sourcePath, modularSource('complete'));

    const result = await roadmapEditShippedGuard(deletePatchInput(sourcePath), cwd);

    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('Cannot delete or replace terminal modular roadmap history');
    expect(result.blockReason).toContain('S1');
  });

  it('blocks replacing authoritative terminal source YAML with malformed content', async () => {
    mkdirSync(join(cwd, 'docs', 'roadmap', 'phases'), { recursive: true });
    writeFileSync(join(cwd, 'docs', 'roadmap', 'project.yaml'), 'version: 1\n');
    const sourcePath = join(cwd, 'docs', 'roadmap', 'phases', 'phase-01.yaml');
    writeFileSync(sourcePath, modularSource('complete'));

    const result = await roadmapEditShippedGuard(writeInput(sourcePath, 'not: [valid'), cwd);

    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('Cannot delete or replace terminal modular roadmap history');
    expect(result.blockReason).toContain('S1');
  });

  it('allows planned sprint edits in authoritative modular source YAML', async () => {
    mkdirSync(join(cwd, 'docs', 'roadmap', 'phases'), { recursive: true });
    writeFileSync(join(cwd, 'docs', 'roadmap', 'project.yaml'), 'version: 1\n');
    const sourcePath = join(cwd, 'docs', 'roadmap', 'phases', 'phase-01.yaml');
    writeFileSync(sourcePath, modularSource('planned'));

    const result = await roadmapEditShippedGuard(writeInput(sourcePath, modularSource('planned', 'Updated')), cwd);

    expect(result).toEqual({});
  });

  it('checks every source touched by a multi-file patch', async () => {
    mkdirSync(join(cwd, 'docs', 'roadmap', 'phases'), { recursive: true });
    writeFileSync(join(cwd, 'docs', 'roadmap', 'project.yaml'), 'version: 1\n');
    const plannedPath = join(cwd, 'docs', 'roadmap', 'phases', 'planned.yaml');
    const completePath = join(cwd, 'docs', 'roadmap', 'phases', 'complete.yaml');
    writeFileSync(plannedPath, modularSource('planned'));
    writeFileSync(completePath, modularSource('complete'));
    const oldLine = '      - {key: S1-1, title: Original, club: wedge, complexity: small}';

    const result = await roadmapEditShippedGuard(multiApplyPatchInput([
      { filePath: plannedPath, oldLine, newLine: oldLine.replace('Original', 'Planned update') },
      { filePath: completePath, oldLine, newLine: oldLine.replace('Original', 'Shipped rewrite') },
    ]), cwd);

    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('S1');
  });

  it('blocks manifest changes that remove or repoint completed history', async () => {
    mkdirSync(join(cwd, 'docs', 'roadmap', 'phases'), { recursive: true });
    const completedPath = join(cwd, 'docs', 'roadmap', 'phases', 'complete.yaml');
    const plannedPath = join(cwd, 'docs', 'roadmap', 'phases', 'planned.yaml');
    writeFileSync(completedPath, modularSource('complete'));
    writeFileSync(plannedPath, modularSource('planned'));
    const manifestPath = join(cwd, 'docs', 'roadmap', 'project.yaml');
    const manifest = `version: 1
name: Test
output: ../backlog/roadmap.json
sources:
  - {path: phases/complete.yaml, kind: phase}
  - {path: phases/planned.yaml, kind: phase}
`;
    writeFileSync(manifestPath, manifest);
    const next = manifest.replace('  - {path: phases/complete.yaml, kind: phase}\n', '');

    const result = await roadmapEditShippedGuard(writeInput(manifestPath, next), cwd);

    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('remove or repoint shipped history');
    expect(result.blockReason).toContain('phases/complete.yaml');
  });

  it('allows edits that only touch planned sprints', async () => {
    const path = writeRoadmap(cwd, baseRoadmap());
    const next = baseRoadmap();
    next.sprints[1].theme = 'New planned theme'; // S2 is planned
    const result = await roadmapEditShippedGuard(writeInput(path, JSON.stringify(next, null, 2)), cwd);
    expect(result).toEqual({});
  });

  it('indexes coexisting decimal rows by canonical sprint key', async () => {
    const roadmap = {
      name: 'Canonical roadmap',
      phases: [{
        name: 'Decimal phase',
        sprints: [458.1, 458.1],
        sprint_keys: ['458.1', '458.10'],
      }],
      sprints: [
        {
          id: 458.1,
          id_key: '458.1',
          theme: 'Shipped first insert',
          par: 3,
          slope: 1,
          type: 'feature',
          status: 'complete',
          tickets: [{ key: 'S458.1-1', title: 'Shipped', club: 'wedge', complexity: 'small' }],
        },
        {
          id: 458.1,
          id_key: '458.10',
          theme: 'Planned tenth insert',
          par: 3,
          slope: 1,
          type: 'feature',
          status: 'planned',
          tickets: [{ key: 'S458.10-1', title: 'Planned', club: 'wedge', complexity: 'small' }],
        },
      ],
    };
    const path = writeRoadmap(cwd, roadmap);
    const plannedEdit = JSON.parse(JSON.stringify(roadmap));
    plannedEdit.sprints[1].theme = 'Updated tenth insert';

    expect(await roadmapEditShippedGuard(
      writeInput(path, JSON.stringify(plannedEdit, null, 2)),
      cwd,
    )).toEqual({});

    const shippedEdit = JSON.parse(JSON.stringify(roadmap));
    shippedEdit.sprints[0].theme = 'Rewritten first insert';
    const denied = await roadmapEditShippedGuard(
      writeInput(path, JSON.stringify(shippedEdit, null, 2)),
      cwd,
    );
    expect(denied.decision).toBe('deny');
    expect(denied.blockReason).toContain('S458.1');
    expect(denied.blockReason).not.toContain('S458.10: shipped sprint fields modified');
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

  it('blocks Codex apply_patch edits to shipped sprint fields', async () => {
    const path = writeRoadmap(cwd, baseRoadmap());
    const result = await roadmapEditShippedGuard(
      applyPatchInput(
        path,
        '      "theme": "Shipped sprint",',
        '      "theme": "Rewritten history",',
      ),
      cwd,
    );
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('S1');
    expect(result.blockReason).toContain('shipped sprint fields modified');
  });

  it('blocks Codex apply_patch deleting a roadmap with shipped sprints', async () => {
    const path = writeRoadmap(cwd, baseRoadmap());
    const result = await roadmapEditShippedGuard(deletePatchInput(path), cwd);
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('removed');
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
