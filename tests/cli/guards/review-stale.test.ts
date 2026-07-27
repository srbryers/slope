import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { reviewStaleGuard } from '../../../src/cli/guards/review-stale.js';
import type { HookInput } from '../../../src/core/index.js';

const roots: string[] = [];

function makeRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'slope-review-stale-'));
  roots.push(cwd);
  mkdirSync(join(cwd, '.slope'), { recursive: true });
  mkdirSync(join(cwd, 'docs', 'retros'), { recursive: true });
  writeFileSync(join(cwd, '.slope', 'config.json'), JSON.stringify({
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
  }));
  return cwd;
}

function input(cwd: string): HookInput {
  return {
    session_id: 'test',
    cwd,
    hook_event_name: 'Stop',
    tool_name: 'Stop',
    tool_input: {},
    tool_response: {},
  };
}

afterEach(() => {
  for (const cwd of roots.splice(0)) {
    if (existsSync(cwd)) rmSync(cwd, { recursive: true, force: true });
  }
});

describe('reviewStaleGuard', () => {
  it('keeps trailing-zero sprint review artifacts distinct and ordered', async () => {
    const cwd = makeRepo();
    const retros = join(cwd, 'docs', 'retros');
    writeFileSync(join(retros, 'sprint-458.10.json'), '{}');
    writeFileSync(join(retros, 'sprint-458.1.json'), '{}');
    writeFileSync(join(retros, 'sprint-458.1-review.md'), '# Review\n');
    writeFileSync(join(retros, 'sprint-458.9.json'), '{}');

    const result = await reviewStaleGuard(input(cwd), cwd);

    expect(result.suggestion?.context).toContain('S458.9, S458.10');
    expect(result.suggestion?.context).not.toContain('S458.1,');
    expect(result.suggestion?.options.map(option => option.command)).toEqual([
      'slope review docs/retros/sprint-458.9.json',
      'slope review docs/retros/sprint-458.10.json',
    ]);
  });
});
