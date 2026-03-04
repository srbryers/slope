// Planner — generates concrete execution plans for Aider without embeddings.
// 4-tier file discovery: enriched → modules → grep → generic.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectTestFiles } from '../../core/prep.js';
import { isLocalModel } from './model-selector.js';
import type { BacklogTicket, ExecutionPlan, PlanFileEntry } from './types.js';
import type { Logger } from './logger.js';

// Stop words for keyword extraction
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those',
  'it', 'its', 'as', 'if', 'not', 'no', 'so', 'up', 'out', 'all',
  'add', 'update', 'fix', 'remove', 'change', 'make', 'use', 'new',
]);

/**
 * Extract top keywords from text for grep discovery.
 */
export function extractKeywords(text: string, max = 3): string[] {
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));

  // Count frequency
  const freq = new Map<string, number>();
  for (const w of words) {
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w);
}

/**
 * Read the first N lines of a file and match against acceptance criteria
 * to produce a specific action description.
 */
function inferAction(filePath: string, ticket: BacklogTicket, cwd: string): { action: string; reason: string } {
  const fullPath = join(cwd, filePath);
  let header = '';
  try {
    const content = readFileSync(fullPath, 'utf8');
    header = content.split('\n').slice(0, 50).join('\n');
  } catch {
    return { action: 'Modify as described in ticket', reason: ticket.acceptance_criteria[0] ?? ticket.title };
  }

  // Try to match acceptance criteria keywords against file content
  for (const ac of ticket.acceptance_criteria) {
    const acWords = ac.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    for (const word of acWords) {
      if (header.toLowerCase().includes(word)) {
        return { action: `Modify to satisfy: ${ac}`, reason: ac };
      }
    }
  }

  // Fallback: use ticket description keywords
  return { action: `Update per ticket requirements`, reason: ticket.acceptance_criteria[0] ?? ticket.title };
}

/**
 * Tier 1: Use enriched primary files from the ticket.
 */
function tier1Enriched(ticket: BacklogTicket, cwd: string): PlanFileEntry[] | null {
  if (!ticket.files?.primary || ticket.files.primary.length === 0) return null;

  const entries: PlanFileEntry[] = [];
  for (const f of ticket.files.primary) {
    if (!f || !existsSync(join(cwd, f))) continue;
    const { action, reason } = inferAction(f, ticket, cwd);
    entries.push({ path: f, action, reason });
  }

  return entries.length > 0 ? entries : null;
}

/**
 * Tier 1.5: Use ticket.modules for scoped file discovery.
 * Includes module files themselves (if they exist on disk) plus grep within module paths.
 */
export function tier15Modules(ticket: BacklogTicket, cwd: string): PlanFileEntry[] | null {
  if (!ticket.modules || ticket.modules.length === 0) return null;

  const matchedFiles = new Set<string>();

  for (const mod of ticket.modules) {
    const fullPath = join(cwd, mod);

    // Include the module file itself if it exists
    if (existsSync(fullPath) && !mod.endsWith('/')) {
      matchedFiles.add(mod);
    }

    // Grep keywords within the module path (file's parent dir or directory itself)
    const keywords = extractKeywords(`${ticket.title} ${ticket.description}`);
    // Use relative path for grep so output is relative to cwd
    const relSearchDir = existsSync(fullPath) && !mod.endsWith('/')
      ? join(mod, '..')   // parent dir of file (relative)
      : mod;              // directory itself (relative)

    if (!existsSync(join(cwd, relSearchDir))) continue;

    for (const keyword of keywords) {
      if (matchedFiles.size >= 5) break;
      try {
        const output = execFileSync('grep', [
          '-rl', '--include=*.ts', '--include=*.js',
          keyword,
          relSearchDir,
        ], { cwd, encoding: 'utf8', timeout: 5000 });

        for (const line of output.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.includes('.test.') || trimmed.includes('node_modules')) continue;
          matchedFiles.add(trimmed);
          if (matchedFiles.size >= 5) break;
        }
      } catch {
        // grep returns exit code 1 when no matches — not an error
      }
    }
  }

  if (matchedFiles.size === 0) return null;

  const entries: PlanFileEntry[] = [];
  for (const f of matchedFiles) {
    const { action, reason } = inferAction(f, ticket, cwd);
    entries.push({ path: f, action, reason });
  }

  return entries;
}

/**
 * Tier 2: Grep for keywords from ticket title/description.
 */
function tier2Grep(ticket: BacklogTicket, cwd: string): PlanFileEntry[] | null {
  const keywords = extractKeywords(`${ticket.title} ${ticket.description}`);
  if (keywords.length === 0) return null;

  const matchedFiles = new Set<string>();

  for (const keyword of keywords) {
    if (matchedFiles.size >= 5) break;
    try {
      const output = execFileSync('grep', [
        '-rl', '--include=*.ts', '--include=*.js',
        keyword,
        'src/', 'packages/',
      ], { cwd, encoding: 'utf8', timeout: 5000 });

      for (const line of output.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.includes('.test.') && !trimmed.includes('node_modules')) {
          matchedFiles.add(trimmed);
        }
        if (matchedFiles.size >= 5) break;
      }
    } catch {
      // grep returns exit code 1 when no matches — not an error
    }
  }

  if (matchedFiles.size === 0) return null;

  const entries: PlanFileEntry[] = [];
  for (const f of matchedFiles) {
    const { action, reason } = inferAction(f, ticket, cwd);
    entries.push({ path: f, action, reason });
  }

  return entries;
}

/**
 * Tier 3: Generic fallback using modules or description.
 */
function tier3Generic(ticket: BacklogTicket): PlanFileEntry[] {
  if (ticket.modules.length > 0) {
    return ticket.modules.slice(0, 5).map(m => ({
      path: m,
      action: 'Identify and modify relevant files in this module',
      reason: ticket.acceptance_criteria[0] ?? ticket.title,
    }));
  }

  return [{
    path: '(read description to identify target files)',
    action: ticket.title,
    reason: ticket.acceptance_criteria[0] ?? ticket.title,
  }];
}

/**
 * Build model-specific approach text.
 */
function buildApproach(model: string): string {
  if (isLocalModel(model)) {
    return `## Approach (local model — keep it simple)
- Focus on ONE file at a time
- Make the smallest possible change that satisfies the criteria
- Prefer editing existing code over adding new files`;
  }
  return `## Approach (plan then execute)
1. List the specific changes needed per file
2. For each file: read it, make the change, verify
3. Run verification commands after all changes`;
}

/**
 * Generate a concrete execution plan for a ticket using 4-tier file discovery.
 * No embeddings required.
 */
export function generatePlan(
  ticket: BacklogTicket,
  model: string,
  cwd: string,
  log: Logger,
): ExecutionPlan {
  // Tier 1: enriched files
  const enriched = tier1Enriched(ticket, cwd);
  if (enriched) {
    log.info(`Plan tier: enriched (${enriched.length} files)`);
    return {
      ticket: ticket.key,
      title: ticket.title,
      files: enriched,
      testFiles: collectTestFiles(enriched.map(e => e.path), cwd),
      approach: buildApproach(model),
      generated: 'enriched',
    };
  }

  // Tier 1.5: module-scoped discovery
  const modules = tier15Modules(ticket, cwd);
  if (modules) {
    log.info(`Plan tier: modules (${modules.length} files)`);
    return {
      ticket: ticket.key,
      title: ticket.title,
      files: modules,
      testFiles: collectTestFiles(modules.map(e => e.path), cwd),
      approach: buildApproach(model),
      generated: 'modules',
    };
  }

  // Tier 2: grep discovery
  const grepped = tier2Grep(ticket, cwd);
  if (grepped) {
    log.info(`Plan tier: grep (${grepped.length} files)`);
    return {
      ticket: ticket.key,
      title: ticket.title,
      files: grepped,
      testFiles: collectTestFiles(grepped.map(e => e.path), cwd),
      approach: buildApproach(model),
      generated: 'grep',
    };
  }

  // Tier 3: generic
  log.info('Plan tier: generic');
  return {
    ticket: ticket.key,
    title: ticket.title,
    files: tier3Generic(ticket),
    testFiles: [],
    approach: buildApproach(model),
    generated: 'generic',
  };
}

/**
 * Format an ExecutionPlan as a structured Aider --message prompt.
 */
export function formatPlanAsPrompt(plan: ExecutionPlan, ticket: BacklogTicket): string {
  const fileSection = plan.files.map(f =>
    `### ${f.path}\n**Action:** ${f.action}\n**Reason:** ${f.reason}`
  ).join('\n\n');

  const testSection = plan.testFiles.length > 0
    ? plan.testFiles.map(t => `- ${t}`).join('\n')
    : '- (run full test suite)';

  const acSection = ticket.acceptance_criteria
    .map(ac => `  [ ] ${ac}`)
    .join('\n');

  return `You are working on the SLOPE project (TypeScript monorepo, pnpm, vitest).

## Task
${ticket.key}: ${ticket.title}

## Description
${ticket.description}

## Execution Plan
For each file below, make the specified change:

${fileSection}

## Test Files to Verify
${testSection}

## Acceptance Criteria (ALL must pass)
${acSection}

## Verification
  1. pnpm typecheck
  2. pnpm test

## Rules
- Read each file BEFORE modifying — understand existing patterns
- Make real, substantive changes — no comment-only or whitespace edits
- If a file already satisfies criteria, skip it
- Commit: '${ticket.key}: <what you changed>'

${plan.approach}`;
}
