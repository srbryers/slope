/**
 * Surgical text-level patching for modular roadmap YAML sources.
 *
 * Roadmap reconciliation must not reserialize an authored bundle: a one-field
 * status change that rewrites quoting, indentation, and line wrapping obscures
 * review and inflates diffs (#615, #617). These helpers patch only the lines
 * that belong to the targeted sprint entry and leave every other byte of the
 * source untouched. Callers verify the result semantically before writing.
 */

export interface RoadmapSourceSprintTextPatch {
  /** New status value for the sprint entry, e.g. "complete". */
  status: string;
  /** Scorecards map key to upsert (the stored sprint id as a string). */
  scorecardKey?: string;
  /** Repo-relative scorecard path recorded under the key. */
  scorecardPath?: string;
}

interface SprintEntryLocation {
  /** Index of the `- id:` line. */
  entryLine: number;
  /** Exclusive end of the entry block. */
  blockEnd: number;
  /** Whitespace prefix of sibling property lines inside the entry. */
  propertyIndent: string;
}

const ENTRY_ID_PATTERN = /^(\s*)- id:\s*([0-9][0-9.]*)\s*(#.*)?$/;

/**
 * Patch a sprint's status (and optionally its scorecards entry) in raw YAML
 * source text without reformatting anything else. Returns null when the
 * document's shape prevents a confidently surgical edit (flow-style entries,
 * mixed line endings, a missing or duplicated block-style `- id:` line) so the
 * caller can fall back to a full rewrite explicitly.
 */
export function patchRoadmapSourceSprintText(
  source: string,
  sprintId: number,
  patch: RoadmapSourceSprintTextPatch,
): string | null {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  // A lossless round-trip is required before we can claim the edit is
  // surgical; mixed line endings would be silently normalized otherwise.
  if (lines.join(eol) !== source) return null;

  const section = findTopLevelSection(lines, 'sprints');
  if (!section) return null;
  const location = locateSprintEntry(lines, section, sprintId);
  if (!location) return null;

  patchStatusLine(lines, location, patch.status);
  if (patch.scorecardKey && patch.scorecardPath) {
    upsertScorecardEntry(lines, patch.scorecardKey, patch.scorecardPath);
  }
  return lines.join(eol);
}

function findTopLevelSection(lines: string[], key: string): { start: number; end: number } | null {
  const start = lines.findIndex(line => new RegExp(`^${key}:\\s*(#.*)?$`).test(line));
  if (start < 0) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index++) {
    if (/^\S/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return { start, end };
}

function locateSprintEntry(
  lines: string[],
  section: { start: number; end: number },
  sprintId: number,
): SprintEntryLocation | null {
  let entryIndent: string | null = null;
  const matches: number[] = [];
  for (let index = section.start + 1; index < section.end; index++) {
    const listItem = /^(\s+)- /.exec(lines[index]);
    if (!listItem) continue;
    entryIndent ??= listItem[1];
    if (listItem[1] !== entryIndent) continue;
    const idMatch = ENTRY_ID_PATTERN.exec(lines[index]);
    if (idMatch && idMatch[1] === entryIndent && Number(idMatch[2]) === sprintId) {
      matches.push(index);
    }
  }
  if (entryIndent == null || matches.length !== 1) return null;

  const entryLine = matches[0];
  let blockEnd = section.end;
  for (let index = entryLine + 1; index < section.end; index++) {
    const line = lines[index];
    if (line.startsWith(`${entryIndent}- `)) {
      blockEnd = index;
      break;
    }
    if (line.trim() !== '' && !line.startsWith(entryIndent)) {
      blockEnd = index;
      break;
    }
  }

  let propertyIndent = `${entryIndent}  `;
  for (let index = entryLine + 1; index < blockEnd; index++) {
    const property = /^(\s+)[A-Za-z_][\w-]*:/.exec(lines[index]);
    if (property && property[1].length > entryIndent.length) {
      propertyIndent = property[1];
      break;
    }
  }
  return { entryLine, blockEnd, propertyIndent };
}

function patchStatusLine(lines: string[], location: SprintEntryLocation, status: string): void {
  for (let index = location.entryLine + 1; index < location.blockEnd; index++) {
    const match = new RegExp(`^(${location.propertyIndent}status:\\s*)([^#]*?)(\\s*#.*)?$`).exec(lines[index]);
    if (match) {
      lines[index] = `${match[1]}${status}${match[3] ?? ''}`;
      return;
    }
  }
  lines.splice(location.entryLine + 1, 0, `${location.propertyIndent}status: ${status}`);
  location.blockEnd += 1;
}

function upsertScorecardEntry(lines: string[], key: string, path: string): void {
  const section = findTopLevelSection(lines, 'scorecards');
  if (!section) {
    let insertAt = lines.length;
    while (insertAt > 0 && lines[insertAt - 1].trim() === '') insertAt -= 1;
    lines.splice(insertAt, 0, 'scorecards:', `  "${key}": ${path}`);
    return;
  }

  const escapedKey = key.replace(/\./g, '\\.');
  let entryIndent = '  ';
  let lastEntry = section.start;
  for (let index = section.start + 1; index < section.end; index++) {
    const entry = /^(\s+)(['"]?)([0-9][0-9.]*)\2:\s*/.exec(lines[index]);
    if (!entry) continue;
    entryIndent = entry[1];
    lastEntry = index;
    if (new RegExp(`^(\\s+)(['"]?)${escapedKey}\\2:`).test(lines[index])) {
      lines[index] = `${entry[1]}${entry[2]}${key}${entry[2]}: ${path}`;
      return;
    }
  }
  lines.splice(lastEntry + 1, 0, `${entryIndent}"${key}": ${path}`);
}
