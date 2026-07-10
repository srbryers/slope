import { existsSync, readFileSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import type { HookInput, GuardResult } from '../../core/index.js';
import { loadConfig, parseRoadmapSourceDocument } from '../../core/index.js';
import { getApplyPatchText, resolveTouchedPaths, toAbsoluteTouchedPath } from './hook-input.js';

const DEFAULT_ROADMAP_PATH = 'docs/backlog/roadmap.json';

/**
 * roadmap-edit-shipped guard: PreToolUse on Edit|Write.
 * Blocks edits to roadmap.json that modify any sprint with status:"complete".
 * Shipped sprints are historical record — adding tickets, changing fields,
 * or removing entries retroactively creates "paper-tickets" against frozen
 * sprints (see GH #320 / commit 9255ee8).
 *
 * Override: set SLOPE_ALLOW_SHIPPED_EDIT=1 in the shell to bypass.
 */
export async function roadmapEditShippedGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  let roadmapAbs: string;
  try {
    const config = loadConfig(cwd);
    roadmapAbs = resolve(cwd, config.roadmapPath ?? DEFAULT_ROADMAP_PATH);
  } catch {
    roadmapAbs = resolve(cwd, DEFAULT_ROADMAP_PATH);
  }

  const touched = resolveTouchedPaths(input).map(filePath => toAbsoluteTouchedPath(filePath, cwd));
  const touchesRoadmap = touched.includes(roadmapAbs);
  const sourceRoot = resolve(cwd, 'docs/roadmap');
  const modular = existsSync(resolve(sourceRoot, 'project.yaml'));

  if (modular) {
    if (touchesRoadmap) {
      return {
        decision: 'deny',
        blockReason: [
          'SLOPE: This roadmap.json is a generated modular-roadmap projection.',
          'Edit docs/roadmap YAML sources, then run `slope roadmap compile`.',
          'Direct projection edits create source drift and are not authoritative.',
        ].join('\n'),
      };
    }
    if (process.env.SLOPE_ALLOW_SHIPPED_EDIT === '1') return {};
    const sourcePath = touched.find(path => {
      const rel = relative(sourceRoot, path);
      return rel !== 'project.yaml'
        && rel !== '..'
        && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
        && ['.yaml', '.yml'].includes(extname(path).toLowerCase());
    });
    if (sourcePath) return protectModularSource(input, sourcePath, cwd);
  }

  if (process.env.SLOPE_ALLOW_SHIPPED_EDIT === '1') return {};
  if (!touchesRoadmap) return {};

  let currentContent: string;
  try {
    currentContent = readFileSync(roadmapAbs, 'utf8');
  } catch {
    return {}; // file doesn't exist yet — nothing to protect
  }

  const wouldBeContent = resolveWouldBeContent(input, roadmapAbs, currentContent, cwd);
  if (wouldBeContent === null) return {};

  let current: { sprints?: unknown[] };
  let next: { sprints?: unknown[] };
  try {
    current = JSON.parse(currentContent);
    next = JSON.parse(wouldBeContent);
  } catch {
    return {}; // malformed JSON on either side — let other tools surface that
  }

  if (!Array.isArray(current.sprints) || !Array.isArray(next.sprints)) return {};

  const nextById = new Map<number, unknown>();
  for (const s of next.sprints) {
    const id = (s as { id?: unknown })?.id;
    if (typeof id === 'number') nextById.set(id, s);
  }

  const violations: string[] = [];
  for (const cur of current.sprints) {
    const c = cur as { id?: unknown; status?: unknown };
    if (c?.status !== 'complete') continue;
    const id = c.id;
    if (typeof id !== 'number') continue;

    const nxt = nextById.get(id);
    if (nxt === undefined) {
      violations.push(`S${id}: removed (was status:complete)`);
      continue;
    }
    if (!deepEqual(cur, nxt)) {
      violations.push(`S${id}: shipped sprint fields modified`);
    }
  }

  if (violations.length === 0) return {};

  return {
    decision: 'deny',
    blockReason: [
      'SLOPE: Cannot edit shipped sprints (status:complete).',
      '',
      'Violations:',
      ...violations.map(v => `  • ${v}`),
      '',
      'Shipped sprints are historical record. Modifying their tickets, status,',
      'or theme creates "paper-tickets" against frozen sprints (GH #320).',
      'File the work as a NEW sprint instead.',
      '',
      'Override: set SLOPE_ALLOW_SHIPPED_EDIT=1 if you genuinely need to',
      'correct shipped-sprint history.',
    ].join('\n'),
  };
}

function protectModularSource(input: HookInput, sourcePath: string, cwd: string): GuardResult {
  let currentContent: string;
  try {
    currentContent = readFileSync(sourcePath, 'utf8');
  } catch {
    return {};
  }
  const wouldBeContent = resolveWouldBeContent(input, sourcePath, currentContent, cwd);
  if (wouldBeContent === null) return {};

  try {
    const current = parseRoadmapSourceDocument(currentContent, sourcePath);
    const next = parseRoadmapSourceDocument(wouldBeContent, sourcePath);
    const nextById = new Map(next.sprints.map(sprint => [sprint.id, sprint]));
    const violations = current.sprints
      .filter(sprint => sprint.status === 'complete')
      .filter(sprint => !deepEqual(sprint, nextById.get(sprint.id)))
      .map(sprint => `S${sprint.id}: shipped source fields modified or removed`);
    if (violations.length === 0) return {};
    return {
      decision: 'deny',
      blockReason: [
        'SLOPE: Cannot edit shipped sprints in modular roadmap sources.',
        '',
        ...violations.map(violation => `  • ${violation}`),
        '',
        'Add new work to a new sprint source. Use SLOPE_ALLOW_SHIPPED_EDIT=1 only for a deliberate historical correction.',
      ].join('\n'),
    };
  } catch {
    return {};
  }
}

function resolveWouldBeContent(
  input: HookInput,
  roadmapAbs: string,
  currentContent: string,
  cwd: string,
): string | null {
  const newString = input.tool_input?.new_string as string | undefined;
  const oldString = input.tool_input?.old_string as string | undefined;
  if (newString !== undefined) {
    if (oldString !== undefined) {
      if (!currentContent.includes(oldString)) return null; // Edit will fail with its own error
      return currentContent.replace(oldString, newString);
    }
    return newString;
  }

  const patchText = getApplyPatchText(input);
  if (!patchText) return null;
  return applyPatchToFileContent(patchText, roadmapAbs, currentContent, cwd);
}

function applyPatchToFileContent(
  patchText: string,
  targetAbs: string,
  currentContent: string,
  cwd: string,
): string | null {
  let nextContent = currentContent;
  let inTargetFile = false;
  let operation: 'add' | 'update' | 'delete' | null = null;
  let currentHunk: string[] = [];
  const addedFileLines: string[] = [];
  let touchedTarget = false;

  const flushHunk = (): boolean => {
    if (!inTargetFile || operation !== 'update' || currentHunk.length === 0) {
      currentHunk = [];
      return true;
    }

    const replacement = applyHunk(nextContent, currentHunk);
    currentHunk = [];
    if (replacement === null) return false;
    nextContent = replacement;
    return true;
  };

  for (const line of patchText.split(/\r?\n/)) {
    const fileMatch = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/);
    if (fileMatch) {
      if (!flushHunk()) return null;

      operation = fileMatch[1].toLowerCase() as 'add' | 'update' | 'delete';
      inTargetFile = toAbsoluteTouchedPath(fileMatch[2], cwd) === targetAbs;
      if (inTargetFile) {
        touchedTarget = true;
        if (operation === 'delete') nextContent = JSON.stringify({ sprints: [] });
        addedFileLines.length = 0;
      }
      continue;
    }

    if (!inTargetFile) continue;
    if (line === '*** End Patch') break;
    if (line.startsWith('*** ')) continue;

    if (operation === 'add') {
      if (line.startsWith('+')) addedFileLines.push(line.slice(1));
      continue;
    }

    if (operation !== 'update') continue;
    if (line.startsWith('@@')) {
      if (!flushHunk()) return null;
      continue;
    }
    currentHunk.push(line);
  }

  if (!flushHunk()) return null;
  if (operation === 'add' && inTargetFile) nextContent = addedFileLines.join('\n');

  return touchedTarget ? nextContent : null;
}

function applyHunk(content: string, hunkLines: string[]): string | null {
  const oldLines: string[] = [];
  const newLines: string[] = [];

  for (const line of hunkLines) {
    if (line === '\\ No newline at end of file') continue;
    const marker = line[0];
    const text = line.slice(1);
    if (marker === ' ') {
      oldLines.push(text);
      newLines.push(text);
    } else if (marker === '-') {
      oldLines.push(text);
    } else if (marker === '+') {
      newLines.push(text);
    }
  }

  const oldBlock = oldLines.join('\n');
  const newBlock = newLines.join('\n');
  if (!oldBlock) return null;
  if (!content.includes(oldBlock)) return null;

  return content.replace(oldBlock, newBlock);
}

/** Detect built-in object types that need special equality handling.
 *  Plain objects fall through to recursive key comparison. */
function isNonPlainObject(v: unknown): boolean {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto !== Object.prototype && proto !== null && !Array.isArray(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  // Non-plain objects (Date, RegExp, Map, Set, etc.) — compare via JSON
  // serialization as a conservative fallback. roadmap.json never contains
  // these in practice, but guarding here prevents future schema additions
  // from triggering infinite recursion or incorrect equality.
  if (isNonPlainObject(a) || isNonPlainObject(b)) {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false; // circular references → conservatively flag as unequal
    }
  }

  const ka = Object.keys(a as Record<string, unknown>).sort();
  const kb = Object.keys(b as Record<string, unknown>).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return false;
    if (!deepEqual((a as Record<string, unknown>)[ka[i]], (b as Record<string, unknown>)[kb[i]])) return false;
  }
  return true;
}
