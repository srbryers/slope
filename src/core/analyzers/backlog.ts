// SLOPE — Backlog Analyzer
// Scans source files for TODO/FIXME/HACK/XXX comments and parses CHANGELOG unreleased.

import { readFileSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { walkDir } from './walk.js';

export interface TodoEntry {
  type: 'TODO' | 'FIXME' | 'HACK' | 'XXX';
  text: string;
  file: string;
  line: number;
}

export interface BacklogAnalysis {
  todos: TodoEntry[];
  todosByModule: Record<string, TodoEntry[]>;
  changelogUnreleased?: string[];
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.js', '.tsx', '.jsx', '.py', '.go', '.rs', '.rb']);
const TODO_PATTERN = /(?:\/\/|#)\s*(TODO|FIXME|HACK|XXX)[:\s]+(.+)/i;
const MAX_TODOS = 200;

/**
 * Analyze a codebase for TODO/FIXME/HACK/XXX comments and changelog data.
 */
export async function analyzeBacklog(cwd: string): Promise<BacklogAnalysis> {
  const entries = walkDir(cwd, { maxDepth: 8 });
  const todos: TodoEntry[] = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (todos.length >= MAX_TODOS) break;

    const ext = getExtension(entry.path);
    if (!SOURCE_EXTENSIONS.has(ext)) continue;

    let content: string;
    try {
      content = readFileSync(entry.fullPath, 'utf8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (todos.length >= MAX_TODOS) break;

      const match = TODO_PATTERN.exec(lines[i]);
      if (match) {
        todos.push({
          type: match[1].toUpperCase() as TodoEntry['type'],
          text: match[2].trim(),
          file: entry.path,
          line: i + 1,
        });
      }
    }
  }

  // Group by module (first directory component under src/)
  const todosByModule: Record<string, TodoEntry[]> = {};
  for (const todo of todos) {
    const mod = inferModule(todo.file);
    if (!todosByModule[mod]) todosByModule[mod] = [];
    todosByModule[mod].push(todo);
  }

  // Parse CHANGELOG.md for unreleased section
  const changelogUnreleased = parseChangelogUnreleased(cwd);

  return { todos, todosByModule, changelogUnreleased };
}

function getExtension(filePath: string): string {
  const dot = filePath.lastIndexOf('.');
  return dot >= 0 ? filePath.slice(dot) : '';
}

function inferModule(filePath: string): string {
  const parts = filePath.split('/');
  // If file is under src/X/..., use X as module name
  const srcIdx = parts.indexOf('src');
  if (srcIdx >= 0 && srcIdx + 1 < parts.length) {
    return parts[srcIdx + 1];
  }
  // Otherwise use first directory, or 'root'
  return parts.length > 1 ? parts[0] : 'root';
}

function parseChangelogUnreleased(cwd: string): string[] | undefined {
  const changelogPath = join(cwd, 'CHANGELOG.md');
  if (!existsSync(changelogPath)) return undefined;

  let content: string;
  try {
    content = readFileSync(changelogPath, 'utf8');
  } catch {
    return undefined;
  }

  const lines = content.split('\n');
  const items: string[] = [];
  let inUnreleased = false;

  for (const line of lines) {
    // Match ## Unreleased or ## [Unreleased]
    if (/^##\s+\[?unreleased\]?/i.test(line)) {
      inUnreleased = true;
      continue;
    }
    // Stop at next heading
    if (inUnreleased && /^##\s/.test(line)) {
      break;
    }
    if (inUnreleased) {
      const trimmed = line.replace(/^[-*]\s*/, '').trim();
      if (trimmed) items.push(trimmed);
    }
  }

  return items.length > 0 ? items : undefined;
}
