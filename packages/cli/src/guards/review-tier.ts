import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { HookInput, GuardResult } from '@srbryers/core';

interface ReviewState {
  rounds_required: number;
  rounds_completed: number;
  plan_file?: string;
}

/**
 * Review-tier guard: fires PreToolUse on ExitPlanMode.
 * Recommends a review tier based on plan scope (context-only, never deny).
 */
export async function reviewTierGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  // Find the plan file
  const planContent = findPlanContent(input, cwd);
  if (!planContent) return {};

  // Analyze the plan
  const ticketCount = countTickets(planContent);
  const packageRefs = countPackageRefs(planContent);
  const hasSchemaOrApi = /\b(schema|migration|api|endpoint)\b/i.test(planContent);
  const hasInfra = /\b(infrastructure|new package|new service|architect)\b/i.test(planContent);
  const isResearchOrDocs = /^#+\s*(research|docs|documentation|infra|spike)\b/im.test(planContent)
    && ticketCount === 0;

  // Determine recommended tier
  let tier: string;
  let rounds: number;

  if (isResearchOrDocs || ticketCount === 0) {
    tier = 'Skip';
    rounds = 0;
  } else if (ticketCount <= 2 && packageRefs <= 1) {
    tier = 'Light';
    rounds = 1;
  } else if (ticketCount >= 5 || hasInfra) {
    tier = 'Deep';
    rounds = 3;
  } else {
    // 3-4 tickets, or multi-package, or schema/API changes
    tier = 'Standard';
    rounds = 2;
  }

  // Check if review-state.json already matches
  const statePath = join(cwd, '.slope', 'review-state.json');
  if (existsSync(statePath)) {
    try {
      const state: ReviewState = JSON.parse(readFileSync(statePath, 'utf8'));
      if (state.rounds_required >= rounds) {
        // Already set to at least the recommended level — silent passthrough
        return {};
      }
    } catch { /* malformed — proceed with recommendation */ }
  }

  // Build context message
  const scopeDesc = [
    `${ticketCount} ticket${ticketCount !== 1 ? 's' : ''}`,
    packageRefs > 1 ? `${packageRefs} packages` : null,
    hasSchemaOrApi ? 'schema/API changes' : null,
    hasInfra ? 'new infrastructure' : null,
  ].filter(Boolean).join(', ');

  return {
    context: `SLOPE review-tier: Plan has ${scopeDesc} — recommend ${tier} review (${rounds} round${rounds !== 1 ? 's' : ''}). Set rounds_required: ${rounds} in .slope/review-state.json`,
  };
}

function findPlanContent(input: HookInput, cwd: string): string | null {
  // Try to find plan file from tool_input (ExitPlanMode context)
  // Claude Code stores plans in .claude/plans/
  const plansDir = join(cwd, '.claude', 'plans');

  if (existsSync(plansDir)) {
    // Find the most recently modified .md file
    try {
      const files = readdirSync(plansDir)
        .filter(f => f.endsWith('.md'))
        .map(f => ({
          name: f,
          path: join(plansDir, f),
          mtime: (() => { try { return statSync(join(plansDir, f)).mtimeMs; } catch { return 0; } })(),
        }))
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length > 0) {
        return readFileSync(files[0].path, 'utf8');
      }
    } catch { /* no plans dir or can't read */ }
  }

  return null;
}

function countTickets(content: string): number {
  // Match ticket patterns: ### S\d+-\d+, ### Ticket, numbered ticket headers
  const ticketHeaders = content.match(/^###\s+S\d+-\d+/gm) ?? [];
  if (ticketHeaders.length > 0) return ticketHeaders.length;

  // Fallback: count ### level headers that look like tickets
  const h3Headers = content.match(/^###\s+/gm) ?? [];
  return h3Headers.length;
}

function countPackageRefs(content: string): number {
  // Count distinct packages/ references
  const refs = new Set<string>();
  const matches = content.matchAll(/packages\/(\w[\w-]*)/g);
  for (const m of matches) {
    refs.add(m[1]);
  }
  return refs.size;
}
