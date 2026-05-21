import { isAbsolute, resolve } from 'node:path';
import type { HookInput } from '../../core/index.js';

const PATCH_TEXT_KEYS = ['command', 'patch', 'input'] as const;
const DIRECT_PATH_KEYS = ['file_path', 'path'] as const;
const DIRECT_PATH_ARRAY_KEYS = ['file_paths', 'paths'] as const;

/**
 * Resolve file paths touched by a hook input across agent harness payloads.
 *
 * Claude-style tools usually provide tool_input.file_path. Codex apply_patch
 * hooks carry the edited files inside the patch text, commonly in
 * tool_input.command.
 */
export function resolveTouchedPaths(input: HookInput): string[] {
  const toolInput = input.tool_input ?? {};
  const paths: string[] = [];

  for (const key of DIRECT_PATH_KEYS) {
    const value = toolInput[key];
    if (typeof value === 'string') paths.push(value);
  }

  for (const key of DIRECT_PATH_ARRAY_KEYS) {
    const value = toolInput[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item === 'string') paths.push(item);
    }
  }

  const patchText = getApplyPatchText(input);
  if (patchText) paths.push(...parseApplyPatchTouchedPaths(patchText));

  return uniqueNonEmpty(paths);
}

export function resolvePrimaryTouchedPath(input: HookInput): string | undefined {
  return resolveTouchedPaths(input)[0];
}

export function normalizeTouchedPath(filePath: string | undefined, cwd: string): string | null {
  if (!filePath) return null;

  const normalizedCwd = cwd.replace(/\\/g, '/').replace(/\/$/, '');
  const normalizedPath = filePath.trim().replace(/\\/g, '/');
  if (!normalizedPath) return null;

  const relativePath = normalizedPath.startsWith(`${normalizedCwd}/`)
    ? normalizedPath.slice(normalizedCwd.length + 1)
    : normalizedPath;

  return relativePath.replace(/^\.\//, '');
}

export function toAbsoluteTouchedPath(filePath: string, cwd: string): string {
  const trimmed = filePath.trim();
  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(cwd, trimmed);
}

export function getApplyPatchText(input: HookInput): string | null {
  const toolInput = input.tool_input ?? {};
  for (const key of PATCH_TEXT_KEYS) {
    const value = toolInput[key];
    if (typeof value === 'string' && value.includes('*** Begin Patch')) {
      return value;
    }
  }
  return null;
}

export function parseApplyPatchTouchedPaths(patchText: string): string[] {
  const paths: string[] = [];
  for (const line of patchText.split(/\r?\n/)) {
    const match = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/);
    if (match) {
      paths.push(match[1]);
      continue;
    }

    const moveMatch = line.match(/^\*\*\* Move to: (.+)$/);
    if (moveMatch) paths.push(moveMatch[1]);
  }
  return uniqueNonEmpty(paths);
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}
