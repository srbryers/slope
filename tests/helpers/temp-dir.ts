import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A temporary directory whose path is already canonical.
 *
 * `os.tmpdir()` does not always return the canonical form of the directory it
 * names, and SLOPE resolves paths through `realpathSync` before comparing
 * them, so a fixture built from the raw value never matches what the code
 * under test produces:
 *
 * - On the GitHub Windows runner, `tmpdir()` returns the 8.3 short form,
 *   `C:\Users\RUNNER~1\AppData\Local\Temp`, while `realpathSync` expands it to
 *   `C:\Users\runneradmin\...`. Seventeen tests failed on that difference the
 *   first time a Windows job ran (#712).
 * - On macOS, `/var` is a symlink to `/private/var`, which is the same problem
 *   with different spelling.
 *
 * Canonicalising the root before creating the directory means every path
 * derived from it is already in the form the product will compare against.
 *
 * Use this instead of `mkdtempSync(join(tmpdir(), prefix))` in any test that
 * compares a path, stores one, or passes a cwd into SLOPE.
 */
export function makeTempDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(realpathSync(tmpdir()), prefix)));
}

/** The canonical temp root, for tests that build sibling paths themselves. */
export function canonicalTmpdir(): string {
  return realpathSync(tmpdir());
}
