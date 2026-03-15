// Import-graph blast radius — parse TS imports, build dependency graph, find transitive dependents.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', 'dist', '.slope', '.git']);

/**
 * Parse import/export statements from TypeScript source content.
 * Extracts relative import paths, resolving them relative to the file's directory.
 *
 * Handles: named imports, default imports, side-effect imports, type imports,
 * re-exports, and star re-exports. Skips node: prefixes, bare specifiers (npm),
 * and dynamic import() expressions.
 *
 * @returns Array of resolved paths relative to rootDir
 */
export function parseImports(content: string, filePath: string, rootDir: string): string[] {
  const dir = dirname(filePath);
  const imports: string[] = [];

  // Match import/export ... from '...' patterns (handles multi-line via greedy from match)
  const fromRegex = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  // Match side-effect imports: import './foo'
  const sideEffectRegex = /import\s+['"]([^'"]+)['"]/g;

  for (const regex of [fromRegex, sideEffectRegex]) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      const specifier = match[1];
      const resolved = resolveImport(specifier, dir, rootDir);
      if (resolved !== null) {
        imports.push(resolved);
      }
    }
  }

  // Deduplicate
  return [...new Set(imports)];
}

/**
 * Resolve an import specifier to a path relative to rootDir.
 * Returns null for node: prefixes, bare specifiers (npm packages), etc.
 */
function resolveImport(specifier: string, fromDir: string, rootDir: string): string | null {
  // Skip node: builtins
  if (specifier.startsWith('node:')) return null;

  // Skip bare specifiers (npm packages) — no ./ or ../ prefix
  if (!specifier.startsWith('.')) return null;

  const absolutePath = resolve(fromDir, specifier);

  // Try resolving: strip .js → try .ts, try as-is .ts, try /index.ts
  const candidates = buildCandidates(absolutePath);

  for (const candidate of candidates) {
    try {
      const stat = statSync(candidate);
      if (stat.isFile()) {
        return relative(rootDir, candidate);
      }
    } catch {
      // File doesn't exist, try next candidate
    }
  }

  // Return the best-guess relative path even if file doesn't exist
  // (supports graph building even with missing files)
  if (specifier.endsWith('.js')) {
    return relative(rootDir, absolutePath.replace(/\.js$/, '.ts'));
  }
  return relative(rootDir, absolutePath + '.ts');
}

function buildCandidates(absolutePath: string): string[] {
  const candidates: string[] = [];

  if (absolutePath.endsWith('.js')) {
    // ESM convention: .js in source → actual .ts file
    candidates.push(absolutePath.replace(/\.js$/, '.ts'));
  } else if (absolutePath.endsWith('.ts')) {
    candidates.push(absolutePath);
  } else {
    // Extensionless — try .ts, then /index.ts
    candidates.push(absolutePath + '.ts');
    candidates.push(join(absolutePath, 'index.ts'));
  }

  return candidates;
}

/**
 * Build an import graph by walking all .ts files in a directory.
 * Returns a Map where each key is a file path (relative to rootDir)
 * and values are the files it imports.
 */
export function buildImportGraph(rootDir: string): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  walkDir(rootDir, rootDir, graph);
  return graph;
}

function walkDir(dir: string, rootDir: string, graph: Map<string, string[]>): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      walkDir(fullPath, rootDir, graph);
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      const relPath = relative(rootDir, fullPath);
      try {
        const content = readFileSync(fullPath, 'utf8');
        const imports = parseImports(content, fullPath, rootDir);
        graph.set(relPath, imports);
      } catch {
        graph.set(relPath, []);
      }
    }
  }
}

/**
 * Compute blast radius — find all transitive dependents of a target file.
 * Inverts the import graph and performs BFS from the target.
 *
 * @param graph - Import graph from buildImportGraph()
 * @param targetFile - File path relative to rootDir
 * @returns Sorted array of files that transitively depend on the target
 */
export function blastRadius(graph: Map<string, string[]>, targetFile: string): string[] {
  // Build reverse graph: file → files that import it
  const reverseGraph = new Map<string, string[]>();

  for (const [file, imports] of graph) {
    for (const imp of imports) {
      if (!reverseGraph.has(imp)) {
        reverseGraph.set(imp, []);
      }
      reverseGraph.get(imp)!.push(file);
    }
  }

  // BFS from target
  const visited = new Set<string>();
  const queue = [targetFile];
  visited.add(targetFile);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const dependents = reverseGraph.get(current) ?? [];

    for (const dep of dependents) {
      if (!visited.has(dep)) {
        visited.add(dep);
        queue.push(dep);
      }
    }
  }

  // Remove the target itself from results
  visited.delete(targetFile);

  return [...visited].sort();
}
