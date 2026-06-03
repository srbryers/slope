import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSourceCheckoutRuntimeWarning } from '../../src/cli/source-runtime.js';
import { SLOPE_BIN_PREAMBLE } from '../../src/core/harness.js';

function makeSourceCheckout(): string {
  const cwd = join(tmpdir(), `slope-source-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({
    name: '@slope-dev/slope',
    version: '9.9.9',
  }));
  return cwd;
}

describe('source checkout runtime warning (#496)', () => {
  it('warns when an installed CLI is used inside the SLOPE source checkout', () => {
    const cwd = makeSourceCheckout();
    try {
      const warning = buildSourceCheckoutRuntimeWarning({
        cwd,
        cliEntryPath: join(tmpdir(), 'global-slope', 'dist', 'cli', 'index.js'),
        args: ['validate', '--sprint=135'],
        env: {},
      });

      expect(warning).toContain('running an installed SLOPE binary outside the current source checkout');
      expect(warning).toContain(cwd);
      expect(warning).toContain('pnpm build && node dist/cli/index.js validate --sprint=135');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('does not warn when the checkout-built CLI is used', () => {
    const cwd = makeSourceCheckout();
    try {
      const warning = buildSourceCheckoutRuntimeWarning({
        cwd,
        cliEntryPath: join(cwd, 'dist', 'cli', 'index.js'),
        args: ['validate', '--sprint=135'],
        env: {},
      });

      expect(warning).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('keeps guard command output machine-clean', () => {
    const cwd = makeSourceCheckout();
    try {
      const warning = buildSourceCheckoutRuntimeWarning({
        cwd,
        cliEntryPath: join(tmpdir(), 'global-slope', 'dist', 'cli', 'index.js'),
        args: ['guard', 'claim-required'],
        env: {},
      });

      expect(warning).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('keeps generic hook dispatchers on source-built SLOPE before global fallback', () => {
    const script = SLOPE_BIN_PREAMBLE.join('\n');

    expect(script).toContain('SLOPE dev dist');
    expect(script).toContain('dist/cli/index.js');
    expect(script).toContain('node "$SLOPE_PROJECT_DIR/dist/cli/index.js" "$@"');
    expect(script.indexOf('node "$SLOPE_PROJECT_DIR/dist/cli/index.js"')).toBeLessThan(
      script.indexOf('command -v slope'),
    );
  });
});
