import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HookInput, GuardResult } from '../../core/index.js';
import { loadConfig } from '../../core/index.js';

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
  if (process.env.SLOPE_ALLOW_SHIPPED_EDIT === '1') return {};

  const filePath = input.tool_input?.file_path as string | undefined;
  if (!filePath) return {};

  let roadmapAbs: string;
  try {
    const config = loadConfig(cwd);
    roadmapAbs = resolve(cwd, config.roadmapPath ?? DEFAULT_ROADMAP_PATH);
  } catch {
    roadmapAbs = resolve(cwd, DEFAULT_ROADMAP_PATH);
  }

  if (resolve(filePath) !== roadmapAbs) return {};

  let currentContent: string;
  try {
    currentContent = readFileSync(roadmapAbs, 'utf8');
  } catch {
    return {}; // file doesn't exist yet — nothing to protect
  }

  const newString = input.tool_input?.new_string as string | undefined;
  const oldString = input.tool_input?.old_string as string | undefined;
  if (newString === undefined) return {};

  let wouldBeContent: string;
  if (oldString !== undefined) {
    if (!currentContent.includes(oldString)) return {}; // Edit will fail with its own error
    wouldBeContent = currentContent.replace(oldString, newString);
  } else {
    wouldBeContent = newString;
  }

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

  const ka = Object.keys(a as Record<string, unknown>).sort();
  const kb = Object.keys(b as Record<string, unknown>).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return false;
    if (!deepEqual((a as Record<string, unknown>)[ka[i]], (b as Record<string, unknown>)[kb[i]])) return false;
  }
  return true;
}
