import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('package metadata', () => {
  it('keeps npm bin paths publish-clean (#517)', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      bin?: Record<string, string>;
    };

    expect(pkg.bin).toEqual({
      slope: 'dist/cli/index.js',
      'mcp-slope-tools': 'dist/mcp/index.js',
    });

    for (const target of Object.values(pkg.bin ?? {})) {
      expect(target).not.toMatch(/^\.\//);
      expect(target).toMatch(/^dist\//);
    }
  });
});
