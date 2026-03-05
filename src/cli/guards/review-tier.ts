import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HookInput, GuardResult } from '../../core/index.js';
import { selectSpecialists } from '../../core/index.js';
import type { CommonIssuesFile } from '../../core/index.js';
import { loadConfig } from '../config.js';
import { loadSprintState, saveSprintState, createSprintState } from '../sprint-state.js';
import { saveReviewState, type ReviewState } from '../commands/review-state.js';
import {
  findPlanContent,
  countTickets,
  countPackageRefs,
  extractFilePatterns,
  extractTicketInfo,
  type PlanFile,
} from './plan-analysis.js';

/**
 * Review-tier guard: fires PostToolUse on Write.
 * When a plan file is written to .claude/plans/*.md, recommends review tier
 * with specialist reviewers, surfaces relevant gotchas, and instructs
 * Claude to use AskUserQuestion for review setup.
 */
export async function reviewTierGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  // Only fire when a plan file is written
  const filePath = input.tool_input?.file_path as string | undefined;
  if (!filePath) return {};

  // Check if the written file is a plan file
  const normalizedPath = filePath.replace(/\\/g, '/');
  if (!normalizedPath.includes('.claude/plans/') || !normalizedPath.endsWith('.md')) {
    return {};
  }

  // Read the plan content — prefer the just-written file path directly,
  // since findPlanContent(cwd) only searches repo-local .claude/plans/ and
  // Claude Code writes plans to ~/.claude/plans/ (global user directory).
  let plan: PlanFile | null = null;
  try {
    const content = readFileSync(filePath, 'utf8');
    plan = { path: normalizedPath, content };
  } catch {
    // File not readable — fall back to directory scan
    plan = findPlanContent(cwd);
  }
  if (!plan) return {};

  // Analyze the plan
  const ticketCount = countTickets(plan.content);
  const packageRefs = countPackageRefs(plan.content);
  const hasSchemaOrApi = /\b(schema|migration|api|endpoint)\b/i.test(plan.content);
  const hasInfra = /\b(infrastructure|new package|new service|architect)\b/i.test(plan.content);
  const isResearchOrDocs = /^#+\s*(research|docs|documentation|infra|spike)\b/im.test(plan.content)
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
    tier = 'Standard';
    rounds = 2;
  }

  // Check if review-state.json already meets/exceeds tier
  const statePath = join(cwd, '.slope', 'review-state.json');
  if (existsSync(statePath)) {
    try {
      const existing: ReviewState = JSON.parse(readFileSync(statePath, 'utf8'));
      if (existing.rounds_required >= rounds) {
        return {};
      }
    } catch { /* malformed — proceed */ }
  }

  // Build scope description
  const scopeDesc = [
    `${ticketCount} ticket${ticketCount !== 1 ? 's' : ''}`,
    packageRefs > 1 ? `${packageRefs} packages` : null,
    hasSchemaOrApi ? 'schema/API changes' : null,
    hasInfra ? 'new infrastructure' : null,
  ].filter(Boolean).join(', ');

  // Select specialists from ticket info
  const ticketInfo = extractTicketInfo(plan.content);
  const specialists = selectSpecialists(ticketInfo);
  const specialistList = specialists.length > 0 ? specialists.join(', ') : 'none detected';

  // Load relevant gotchas (capped at 5)
  const gotchas = loadRelevantGotchas(cwd, plan.content);

  // Build context
  const lines: string[] = [
    `SLOPE plan-review: Plan detected with ${ticketCount} tickets, ${scopeDesc}.`,
    `Recommended tier: ${tier} (${rounds} round${rounds !== 1 ? 's' : ''}).`,
    `Recommended reviewers: architect + ${specialistList}.`,
  ];

  if (gotchas.length > 0) {
    lines.push('');
    lines.push('Relevant gotchas from past sprints:');
    for (const g of gotchas) {
      lines.push(`  - ${g}`);
    }
  }

  lines.push('');
  lines.push('IMPORTANT: You MUST now ask the user how they want to handle the plan review using AskUserQuestion.');
  lines.push('Present these options:');
  lines.push(`1. Architect + ${specialistList} review (Recommended)`);
  lines.push('2. Architect review only');
  lines.push('3. Custom reviewers — user specifies');
  lines.push('4. Skip review');

  // Create sprint-state if it doesn't already exist
  if (!loadSprintState(cwd)) {
    // Try to extract sprint number from plan content
    const sprintMatch = plan.content.match(/Sprint\s+(\d+)/i);
    const sprintNumber = sprintMatch ? parseInt(sprintMatch[1], 10) : 0;
    if (sprintNumber > 0) {
      const state = createSprintState(sprintNumber, 'planning');
      saveSprintState(cwd, state);
    }
  }

  // Write review-state.json so workflow-gate can mechanically block ExitPlanMode
  // until reviews are complete. Advisory context can be lost to compaction;
  // disk state cannot.
  const reviewState: ReviewState = {
    rounds_required: rounds,
    rounds_completed: 0,
    plan_file: plan.path,
    tier: tier.toLowerCase(),
    started_at: new Date().toISOString(),
  };
  saveReviewState(cwd, reviewState);

  return { context: lines.join('\n') };
}

/**
 * Load gotchas from common-issues.json that are relevant to plan file patterns.
 * Returns at most 5 entries.
 */
function loadRelevantGotchas(cwd: string, planContent: string): string[] {
  try {
    const config = loadConfig(cwd);
    const issuesPath = join(cwd, config.commonIssuesPath);
    if (!existsSync(issuesPath)) return [];

    const issues: CommonIssuesFile = JSON.parse(readFileSync(issuesPath, 'utf8'));
    const filePatterns = extractFilePatterns(planContent);
    const warnings: string[] = [];

    for (const pattern of issues.recurring_patterns) {
      const text = `${pattern.title} ${pattern.description} ${pattern.prevention}`.toLowerCase();

      // Check if any plan file pattern segments match the issue
      const isRelevant = filePatterns.some(fp => {
        const segments = fp.toLowerCase().split('/').filter(Boolean);
        return segments.some(seg => text.includes(seg));
      });

      if (isRelevant) {
        const lastSprint = Math.max(...pattern.sprints_hit);
        warnings.push(`[${pattern.category}] ${pattern.title} (last: S${lastSprint}) — ${pattern.prevention.slice(0, 100)}`);
      }

      if (warnings.length >= 5) break;
    }

    return warnings;
  } catch { return []; }
}
