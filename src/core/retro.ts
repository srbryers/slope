import { addMemory, searchMemories } from './memory.js';
import type { Memory, MemoryCategory } from './memory-types.js';
import { sprintIdKey, type SprintId } from './sprint-id.js';

export type RetroOutcome = 'success' | 'mixed' | 'follow_up';

export interface RetroLearningInput {
  text: string;
  category?: MemoryCategory;
  weight?: number;
}

export interface RetroLearning {
  text: string;
  category: MemoryCategory;
  weight: number;
}

export interface PostMergeRetroInput {
  sprint: SprintId;
  pr?: number;
  outcome?: RetroOutcome;
  mergedAt?: string;
  summary?: string;
  learnings?: RetroLearningInput[];
  hazards?: string[];
  followUps?: string[];
  sourceSessionId?: string;
}

export interface PostMergeRetroResult {
  sprint: string;
  pr?: number;
  outcome: RetroOutcome;
  mergedAt: string;
  summary?: string;
  learnings: RetroLearning[];
  hazards: string[];
  followUps: string[];
  sourceSessionId?: string;
}

export interface RetroMemoryPlan {
  text: string;
  category: MemoryCategory;
  weight: number;
  sourceSessionId?: string;
}

export interface PersistRetroMemoriesResult {
  added: Memory[];
  skipped: RetroMemoryPlan[];
}

function assertSprint(value: SprintId): string {
  const sprint = sprintIdKey(value);
  if (sprint === null) {
    throw new TypeError(`Invalid sprint number: ${value}`);
  }
  return sprint;
}

function clampWeight(weight: number | undefined, fallback: number): number {
  const value = typeof weight === 'number' && Number.isFinite(weight) ? weight : fallback;
  return Math.max(1, Math.min(10, value));
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeTexts(values: string[] | undefined): string[] {
  return (values ?? [])
    .map(normalizeText)
    .filter(Boolean);
}

export function normalizeRetroLearning(input: RetroLearningInput): RetroLearning {
  const text = normalizeText(input.text);
  if (!text) {
    throw new TypeError('Retro learning text is required');
  }
  return {
    text,
    category: input.category ?? 'workflow',
    weight: clampWeight(input.weight, 7),
  };
}

export function buildPostMergeRetro(input: PostMergeRetroInput): PostMergeRetroResult {
  const sprint = assertSprint(input.sprint);
  const hazards = normalizeTexts(input.hazards);
  const followUps = normalizeTexts(input.followUps);
  const learnings = (input.learnings ?? []).map(normalizeRetroLearning);
  const summary = input.summary ? normalizeText(input.summary) : undefined;
  const outcome = input.outcome
    ?? (followUps.length > 0 ? 'follow_up' : hazards.length > 0 ? 'mixed' : 'success');

  return {
    sprint,
    ...(input.pr !== undefined ? { pr: input.pr } : {}),
    outcome,
    mergedAt: input.mergedAt ?? new Date().toISOString(),
    ...(summary ? { summary } : {}),
    learnings,
    hazards,
    followUps,
    ...(input.sourceSessionId ? { sourceSessionId: input.sourceSessionId } : {}),
  };
}

export function buildRetroMemoryPlans(retro: PostMergeRetroResult): RetroMemoryPlan[] {
  const prefix = retro.pr ? `S${retro.sprint} PR #${retro.pr}` : `S${retro.sprint}`;
  const sourceSessionId = retro.sourceSessionId;
  const plans: RetroMemoryPlan[] = [];

  if (retro.summary) {
    plans.push({
      text: `${prefix} post-merge retro summary: ${retro.summary}`,
      category: 'project',
      weight: 6,
      ...(sourceSessionId ? { sourceSessionId } : {}),
    });
  }

  for (const learning of retro.learnings) {
    plans.push({
      text: `${prefix} retro learning: ${learning.text}`,
      category: learning.category,
      weight: learning.weight,
      ...(sourceSessionId ? { sourceSessionId } : {}),
    });
  }

  for (const hazard of retro.hazards) {
    plans.push({
      text: `${prefix} retro hazard: ${hazard}`,
      category: 'hazard',
      weight: 8,
      ...(sourceSessionId ? { sourceSessionId } : {}),
    });
  }

  for (const followUp of retro.followUps) {
    plans.push({
      text: `${prefix} retro follow-up: ${followUp}`,
      category: 'workflow',
      weight: 7,
      ...(sourceSessionId ? { sourceSessionId } : {}),
    });
  }

  return plans;
}

function hasExistingRetroMemory(cwd: string, text: string): boolean {
  return searchMemories(cwd, {
    query: text.slice(0, 80),
    source: 'auto-retro',
    limit: 20,
  }).some(memory => memory.text === text);
}

export function persistRetroMemories(
  cwd: string,
  retro: PostMergeRetroResult,
): PersistRetroMemoriesResult {
  const added: Memory[] = [];
  const skipped: RetroMemoryPlan[] = [];

  for (const plan of buildRetroMemoryPlans(retro)) {
    if (hasExistingRetroMemory(cwd, plan.text)) {
      skipped.push(plan);
      continue;
    }

    added.push(addMemory(cwd, plan.text, {
      category: plan.category,
      weight: plan.weight,
      source: 'auto-retro',
      sourceSessionId: plan.sourceSessionId,
    }));
  }

  return { added, skipped };
}
