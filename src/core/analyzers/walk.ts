// SLOPE — Shared recursive directory walker for analyzers
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface WalkEntry {
  path: string;
  fullPath: string;
  isDirectory: boolean;
  depth: number;
}

const DEFAULT_SKIP = ['node_modules', 'dist', '.git', '.slope', '.next', '__pycache__', 'target', 'vendor'];

export function walkDir(root: string, opts?: {
  skip?: string[];
  maxDepth?: number;
}): WalkEntry[] {
  const skip = new Set(opts?.skip ?? DEFAULT_SKIP);
  const maxDepth = opts?.maxDepth ?? Infinity;
  const entries: WalkEntry[] = [];

  function recurse(dir: string, depth: number): void {
    if (depth > maxDepth) return;
    let items;
    try {
      items = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      if (skip.has(item.name)) continue;
      const fullPath = join(dir, item.name);
      const relPath = relative(root, fullPath);
      entries.push({ path: relPath, fullPath, isDirectory: item.isDirectory(), depth });
      if (item.isDirectory()) {
        recurse(fullPath, depth + 1);
      }
    }
  }

  recurse(root, 0);
  return entries;
}
