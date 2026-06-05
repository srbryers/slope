import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import {
  normalizeTouchedPath,
  parseApplyPatchTouchedPaths,
  resolveTouchedPaths,
  toAbsoluteTouchedPath,
} from '../../../src/cli/guards/hook-input.js';
import type { HookInput } from '../../../src/core/index.js';

function makeInput(toolInput: Record<string, unknown>): HookInput {
  return {
    session_id: 'test-session',
    cwd: '/repo',
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: toolInput,
  };
}

describe('hook input path helpers', () => {
  it('resolves direct file_path and path payloads', () => {
    expect(resolveTouchedPaths(makeInput({
      file_path: '/repo/src/a.ts',
      path: '/repo/src/b.ts',
    }))).toEqual(['/repo/src/a.ts', '/repo/src/b.ts']);
  });

  it('parses Codex apply_patch command text', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: /repo/src/a.ts',
      '@@',
      '-old',
      '+new',
      '*** Add File: src/b.ts',
      '+new file',
      '*** Delete File: src/c.ts',
      '*** Move to: src/d.ts',
      '*** End Patch',
    ].join('\n');

    expect(parseApplyPatchTouchedPaths(patch)).toEqual([
      '/repo/src/a.ts',
      'src/b.ts',
      'src/c.ts',
      'src/d.ts',
    ]);
    expect(resolveTouchedPaths(makeInput({ command: patch }))).toEqual([
      '/repo/src/a.ts',
      'src/b.ts',
      'src/c.ts',
      'src/d.ts',
    ]);
  });

  it('normalizes absolute and relative touched paths against cwd', () => {
    expect(normalizeTouchedPath('/repo/src/a.ts', '/repo')).toBe('src/a.ts');
    expect(normalizeTouchedPath('./src/a.ts', '/repo')).toBe('src/a.ts');
    expect(toAbsoluteTouchedPath('src/a.ts', '/repo')).toBe(resolve('/repo', 'src/a.ts'));
  });
});
