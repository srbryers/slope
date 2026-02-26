// SLOPE — Structure Analyzer: file counts, depth, monorepo detection, modules, large files
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { walkDir } from './walk.js';
import type { StructureProfile } from './types.js';

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.rb', '.java', '.kt', '.cs', '.cpp', '.c', '.swift', '.php']);
const TEST_PATTERNS = ['.test.', '.spec.', '_test.', 'test_'];
const COUNTABLE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.rb', '.java', '.kt']);
const LARGE_FILE_THRESHOLD = 1000;

function isTestFile(path: string): boolean {
  return TEST_PATTERNS.some(p => path.includes(p));
}

function countLines(filePath: string): number {
  try {
    const content = readFileSync(filePath, 'utf8');
    return content.split('\n').length;
  } catch {
    return 0;
  }
}

export async function analyzeStructure(cwd: string): Promise<StructureProfile> {
  const entries = walkDir(cwd);

  let totalFiles = 0;
  let sourceFiles = 0;
  let testFiles = 0;
  let maxDepth = 0;
  const moduleCounts: Record<string, { path: string; count: number }> = {};
  const largeFiles: Array<{ path: string; lines: number }> = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    totalFiles++;

    if (entry.depth > maxDepth) maxDepth = entry.depth;

    const ext = extname(entry.path);
    if (!SOURCE_EXTS.has(ext)) continue;

    if (isTestFile(entry.path)) {
      testFiles++;
    } else {
      sourceFiles++;
    }

    // Check for large files
    if (COUNTABLE_EXTS.has(ext) && !isTestFile(entry.path)) {
      const lines = countLines(entry.fullPath);
      if (lines > LARGE_FILE_THRESHOLD) {
        largeFiles.push({ path: entry.path, lines });
      }
    }

    // Track modules: top-level directories under src/ (or root-level dirs)
    const parts = entry.path.split('/');
    if (parts[0] === 'src' && parts.length > 1) {
      const modName = parts[1];
      const modPath = `src/${modName}`;
      if (!moduleCounts[modName]) moduleCounts[modName] = { path: modPath, count: 0 };
      moduleCounts[modName].count++;
    }
  }

  // Detect monorepo
  const isMonorepo = detectMonorepo(cwd, entries);

  // Build modules list (dirs with >5 source files)
  const modules = Object.entries(moduleCounts)
    .filter(([, v]) => v.count >= 5)
    .map(([name, v]) => ({ name, path: v.path, fileCount: v.count }))
    .sort((a, b) => b.fileCount - a.fileCount);

  // Sort large files by line count descending
  largeFiles.sort((a, b) => b.lines - a.lines);

  return {
    totalFiles,
    sourceFiles,
    testFiles,
    maxDepth,
    isMonorepo,
    modules,
    largeFiles: largeFiles.slice(0, 10),
  };
}

function detectMonorepo(cwd: string, entries: ReturnType<typeof walkDir>): boolean {
  // Multiple package.json files indicate monorepo
  const packageJsons = entries.filter(e => !e.isDirectory && e.path.endsWith('package.json'));
  if (packageJsons.length > 1) return true;

  // Workspaces in root package.json
  try {
    const rootPkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    if (rootPkg.workspaces) return true;
  } catch { /* skip */ }

  // pnpm-workspace.yaml
  if (existsSync(join(cwd, 'pnpm-workspace.yaml'))) return true;

  // packages/ or apps/ dirs with their own manifests
  for (const dirName of ['packages', 'apps']) {
    const dir = join(cwd, dirName);
    if (existsSync(dir)) {
      const subEntries = entries.filter(e => e.path.startsWith(dirName + '/') && e.path.endsWith('package.json'));
      if (subEntries.length > 0) return true;
    }
  }

  return false;
}
