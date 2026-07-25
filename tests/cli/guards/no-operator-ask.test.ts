import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const guardsDir = join(dirname(fileURLToPath(import.meta.url)), '../../../src/cli/guards');

/**
 * Fleet-level invariant for GH #650.
 *
 * `decision: 'ask'` surfaces a host permission prompt to the *operator*. A guard
 * must never do that for a fix the agent can apply itself — every remedy a guard
 * prints (`slope sprint start`, `slope map`, `git checkout -b`) is agent-actionable.
 * The operator-facing choice belongs to `deny` (a hard block the agent reads and
 * self-corrects) or to advisory `context`.
 *
 * claim-required was the only guard that ever emitted `ask`; #650 made it
 * advisory. This test pins that so the pattern cannot silently return in any
 * guard.
 */
describe('no guard prompts the operator with decision: ask (GH #650)', () => {
  const guardFiles = readdirSync(guardsDir)
    .filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'));

  it('finds guard source files to check', () => {
    expect(guardFiles.length).toBeGreaterThan(10);
  });

  it.each(guardFiles)('%s does not emit decision: ask', file => {
    const source = readFileSync(join(guardsDir, file), 'utf8');
    // Match the object-literal decision, tolerant of quote style and whitespace.
    const emitsAsk = /decision\s*:\s*['"]ask['"]/.test(source);
    expect(emitsAsk, `${file} emits decision: 'ask' — route it to deny or advisory context (GH #650)`).toBe(false);
  });
});
