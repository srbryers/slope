/**
 * Shared claim-area matching, used by both claim-required (cross-session overlap)
 * and scope-drift (out-of-scope edits).
 *
 * These two guards each carried their own copy of this logic, and both needed the
 * identical whole-repo fix in #651 — the prefix match built `./`, which no
 * relative path starts with, so a `--target=.` area claim covered nothing. One
 * home means the next change lands once.
 */

/** True for a whole-sprint claim like `sprint:S143.5`, which covers every path. */
export function isWholeSprintClaim(target: string): boolean {
  return /^sprint:S\d+(?:\.\d+)?$/i.test(target);
}

/**
 * True when an area claim covers the whole working tree.
 *
 * `slope claim --target=. --scope=area` is the natural way to say "I am working
 * across this repo" (GH #651).
 */
export function isWholeRepoClaim(target: string): boolean {
  const normalized = normalizeArea(target);
  return normalized === '.' || normalized === '' || normalized === '/';
}

/** Normalize an area target: backslashes to forward slashes, no trailing slash. */
function normalizeArea(target: string): string {
  return target.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * True when `relativePath` falls within the claimed `target` area.
 *
 * Handles the two area-claim special cases (whole sprint, whole repo) and,
 * otherwise, an anchored prefix match: a claim on `src/core` matches `src/core`
 * and `src/core/x.ts` but not `src/core-helpers`.
 */
export function pathWithinClaimedArea(relativePath: string, target: string): boolean {
  if (isWholeSprintClaim(target)) return true;
  if (isWholeRepoClaim(target)) return true;

  const normalizedTarget = normalizeArea(target);
  const normalizedPath = relativePath.replace(/\\/g, '/');
  return normalizedPath === normalizedTarget || normalizedPath.startsWith(`${normalizedTarget}/`);
}
