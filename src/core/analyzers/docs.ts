// SLOPE — Documentation Analyzer
// Checks for README, CONTRIBUTING, CHANGELOG, ADR, and API docs.

import { readFileSync, existsSync } from 'node:fs';
import { walkDir } from './walk.js';
import type { DocsProfile } from './types.js';

const ADR_DIRS = ['docs/adr', 'docs/decisions'];
const API_DOC_DIRS = ['docs/api'];
const API_DOC_FILES = ['openapi.json', 'swagger.json', 'openapi.yaml', 'openapi.yml'];

/**
 * Analyze a codebase for documentation presence and quality signals.
 */
export function analyzeDocs(cwd: string): DocsProfile {
  const entries = walkDir(cwd, { maxDepth: 3 });

  const readmeEntry = entries.find(e => !e.isDirectory && /^readme\.md$/i.test(e.path));
  const hasReadme = !!readmeEntry;
  const hasContributing = entries.some(e => !e.isDirectory && /^contributing\.md$/i.test(e.path));
  const hasChangelog = entries.some(e => !e.isDirectory && /^changelog\.md$/i.test(e.path));

  const hasAdr = ADR_DIRS.some(dir =>
    entries.some(e => e.isDirectory && e.path === dir)
  );

  const hasApiDocs = API_DOC_DIRS.some(dir =>
    entries.some(e => e.isDirectory && e.path === dir)
  ) || API_DOC_FILES.some(f =>
    entries.some(e => !e.isDirectory && e.path === f)
  );

  let readmeSummary: string | undefined;
  if (hasReadme && readmeEntry) {
    readmeSummary = extractReadmeSummary(readmeEntry.fullPath);
  }

  return { hasReadme, readmeSummary, hasContributing, hasChangelog, hasAdr, hasApiDocs };
}

function extractReadmeSummary(readmePath: string): string | undefined {
  if (!existsSync(readmePath)) return undefined;

  let content: string;
  try {
    content = readFileSync(readmePath, 'utf8');
  } catch {
    return undefined;
  }

  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip headings, empty lines, badges, and HTML
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('![')) continue;
    if (trimmed.startsWith('<')) continue;
    if (trimmed.startsWith('[!')) continue;

    // Found first paragraph text — take up to 200 chars
    return trimmed.length > 200 ? trimmed.slice(0, 200) + '...' : trimmed;
  }

  return undefined;
}
