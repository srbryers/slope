import type { ReviewType } from './types.js';
// RoadmapDefinition used via parseRoadmap return type

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseRoadmap } from './roadmap.js';

// --- Specialist Types (distinct from ReviewType) ---

export type SpecialistType = 'backend' | 'ml-engineer' | 'database' | 'frontend' | 'ux-designer';

// --- Initiative Sprint Phase (state machine) ---

export type InitiativeSprintPhase =
  | 'pending'
  | 'planning'
  | 'plan_review'
  | 'executing'
  | 'scoring'
  | 'pr_review'
  | 'complete';

// --- Review Gate Config ---

export interface ReviewGateConfig {
  plan: {
    required: ReviewType[];
    specialists: 'auto' | SpecialistType[];
  };
  pr: {
    required: ReviewType[];
  };
}

// --- Review Record ---

export interface ReviewRecord {
  reviewer: SpecialistType | ReviewType;
  completed: boolean;
  findings_count: number;
  reviewer_mode: 'manual' | 'auto';
}

// --- Initiative Sprint Status ---

export interface InitiativeSprintStatus {
  sprint_number: number;
  phase: InitiativeSprintPhase;
  plan_reviews: ReviewRecord[];
  pr_reviews: ReviewRecord[];
  scorecard?: string;
  pr_url?: string;
  branch?: string;
}

// --- Initiative Definition ---

export interface InitiativeDefinition {
  name: string;
  description: string;
  roadmap: string;
  review_gates: ReviewGateConfig;
  sprints: InitiativeSprintStatus[];
}

// --- Review Checklist ---

export interface ReviewChecklistItem {
  question: string;
  category: string;
}

export interface ReviewChecklistContext {
  sprint_number: number;
  ticket_count: number;
  slope: number;
  file_patterns: string[];
  has_new_infra: boolean;
  description?: string;
}

// --- State Machine ---

const VALID_TRANSITIONS: Record<InitiativeSprintPhase, InitiativeSprintPhase | null> = {
  pending: 'planning',
  planning: 'plan_review',
  plan_review: 'executing',
  executing: 'scoring',
  scoring: 'pr_review',
  pr_review: 'complete',
  complete: null,
};

export function getNextPhase(current: InitiativeSprintPhase): InitiativeSprintPhase | null {
  return VALID_TRANSITIONS[current];
}

export function canAdvance(sprint: InitiativeSprintStatus, gates: ReviewGateConfig): { ok: true } | { ok: false; reason: string } {
  const next = getNextPhase(sprint.phase);
  if (!next) return { ok: false, reason: `Sprint is already complete` };

  // Validate prerequisites for specific transitions
  if (sprint.phase === 'plan_review') {
    // All required plan reviews + specialist reviews must be completed
    const requiredReviews = gates.plan.required;
    for (const reviewType of requiredReviews) {
      const record = sprint.plan_reviews.find(r => r.reviewer === reviewType);
      if (!record || !record.completed) {
        return { ok: false, reason: `Required plan review not complete: ${reviewType}` };
      }
    }
    // Check specialist reviews
    const specialistReviews = sprint.plan_reviews.filter(
      r => !requiredReviews.includes(r.reviewer as ReviewType),
    );
    const incompleteSpecialists = specialistReviews.filter(r => !r.completed);
    if (incompleteSpecialists.length > 0) {
      return {
        ok: false,
        reason: `Specialist reviews not complete: ${incompleteSpecialists.map(r => r.reviewer).join(', ')}`,
      };
    }
  }

  if (sprint.phase === 'pr_review') {
    // All required PR reviews must be completed
    for (const reviewType of gates.pr.required) {
      const record = sprint.pr_reviews.find(r => r.reviewer === reviewType);
      if (!record || !record.completed) {
        return { ok: false, reason: `Required PR review not complete: ${reviewType}` };
      }
    }
  }

  return { ok: true };
}

// --- Specialist Selection ---

const SPECIALIST_PATTERNS: Record<SpecialistType, RegExp> = {
  backend: /\b(store|api|server|endpoint|route|middleware|auth|cli|command|handler)\b/i,
  'ml-engineer': /\b(ml|ai|model|embedding|vector|neural|inference|llm|prompt|scoring|prediction)\b/i,
  database: /\b(sqlite|postgres|pg|migration|schema|table|index|query|store-pg|sql)\b/i,
  frontend: /\b(html|css|component|dashboard|report|chart|svg|template|render|canvas)\b/i,
  'ux-designer': /\b(onboarding|init|interview|wizard|tutorial|ux|accessibility|flow|getting-started|walkthrough)\b/i,
};

const SPECIALIST_PRIORITY: SpecialistType[] = [
  'backend',
  'database',
  'ml-engineer',
  'frontend',
  'ux-designer',
];

export function selectSpecialists(tickets: Array<{ title: string; description?: string; filePatterns?: string[] }>): SpecialistType[] {
  // Concatenate all ticket text
  const text = tickets
    .map(t => [t.title, t.description ?? '', ...(t.filePatterns ?? [])].join(' '))
    .join(' ');

  // Count keyword hits per specialist
  const counts = new Map<SpecialistType, number>();
  for (const [specialist, pattern] of Object.entries(SPECIALIST_PATTERNS)) {
    const matches = text.match(new RegExp(pattern, 'gi'));
    counts.set(specialist as SpecialistType, matches?.length ?? 0);
  }

  // Include specialists with hit count >= 2
  const selected = SPECIALIST_PRIORITY.filter(s => (counts.get(s) ?? 0) >= 2);

  // If none meet threshold, include the top scorer (minimum 1 specialist)
  if (selected.length === 0) {
    let maxCount = 0;
    let topSpecialist: SpecialistType = 'backend';
    for (const s of SPECIALIST_PRIORITY) {
      const count = counts.get(s) ?? 0;
      if (count > maxCount) {
        maxCount = count;
        topSpecialist = s;
      }
    }
    return [topSpecialist];
  }

  return selected;
}

// --- Review Checklists ---

const ARCHITECT_PLAN_CHECKLIST: ReviewChecklistItem[] = [
  { question: 'Does the plan duplicate existing SLOPE infrastructure? (check imports, existing functions)', category: 'duplication' },
  { question: 'Are dependencies correct and ordering optimal?', category: 'dependencies' },
  { question: 'Does the approach match codebase patterns? (naming, module structure, export style)', category: 'patterns' },
  { question: 'Are there scope gaps or underscoped complexity?', category: 'scope' },
  { question: 'Does it introduce unnecessary abstractions?', category: 'complexity' },
  { question: 'Are ticket counts reasonable (3-4 per sprint)?', category: 'scope' },
];

const ARCHITECT_PR_CHECKLIST: ReviewChecklistItem[] = [
  { question: 'Design decisions align with plan', category: 'alignment' },
  { question: 'API surface changes are intentional (new exports from index.ts)', category: 'api' },
  { question: 'No breaking changes without version bump', category: 'compatibility' },
  { question: 'Cross-package dependencies use workspace:* protocol', category: 'monorepo' },
];

const CODE_PR_CHECKLIST: ReviewChecklistItem[] = [
  { question: 'Tests cover new functionality (check test file count delta)', category: 'testing' },
  { question: 'Error handling at system boundaries', category: 'errors' },
  { question: 'No security vulnerabilities', category: 'security' },
  { question: 'TypeScript strict mode compliance', category: 'types' },
  { question: 'Conventional commit messages', category: 'commits' },
];

const SPECIALIST_PLAN_CHECKLISTS: Record<SpecialistType, ReviewChecklistItem[]> = {
  backend: [
    { question: 'API design follows existing patterns', category: 'api' },
    { question: 'Error handling patterns are consistent', category: 'errors' },
    { question: 'CLI flag conventions match existing commands', category: 'cli' },
    { question: 'Test strategy covers edge cases', category: 'testing' },
    { question: 'Backwards compatibility maintained', category: 'compatibility' },
  ],
  'ml-engineer': [
    { question: 'Model integration approach is sound', category: 'integration' },
    { question: 'Token/cost considerations addressed', category: 'cost' },
    { question: 'Fallback behavior defined for failures', category: 'fallback' },
    { question: 'Evaluation metrics specified', category: 'metrics' },
    { question: 'Context window budgets documented', category: 'budget' },
  ],
  database: [
    { question: 'Schema design is normalized appropriately', category: 'schema' },
    { question: 'Migration strategy handles rollback', category: 'migration' },
    { question: 'Query performance considered for large datasets', category: 'performance' },
    { question: 'Store interface parity maintained (SQLite / PG)', category: 'parity' },
    { question: 'Rollback plan documented', category: 'rollback' },
  ],
  frontend: [
    { question: 'Rendering approach is efficient', category: 'rendering' },
    { question: 'Accessibility requirements met', category: 'accessibility' },
    { question: 'No external deps (self-contained HTML/SVG)', category: 'dependencies' },
    { question: 'Responsive design considered', category: 'responsive' },
  ],
  'ux-designer': [
    { question: 'User flow is clear and intuitive', category: 'flow' },
    { question: 'Progressive disclosure applied', category: 'disclosure' },
    { question: 'Error states have helpful messages', category: 'errors' },
    { question: 'Help text is actionable', category: 'help' },
    { question: 'Graceful degradation for edge cases', category: 'degradation' },
  ],
};

export type ReviewChecklistType = ReviewType | SpecialistType;
export type ReviewGate = 'plan' | 'pr';

export function getReviewChecklist(
  reviewerType: ReviewChecklistType,
  gate: ReviewGate,
  _context?: ReviewChecklistContext,
): ReviewChecklistItem[] {
  if (gate === 'plan') {
    if (reviewerType === 'architect') return ARCHITECT_PLAN_CHECKLIST;
    if (reviewerType in SPECIALIST_PLAN_CHECKLISTS) {
      return SPECIALIST_PLAN_CHECKLISTS[reviewerType as SpecialistType];
    }
    return [];
  }

  if (gate === 'pr') {
    if (reviewerType === 'architect') return ARCHITECT_PR_CHECKLIST;
    if (reviewerType === 'code') return CODE_PR_CHECKLIST;
    return [];
  }

  return [];
}

// --- Initiative File I/O ---

const INITIATIVE_FILE = '.slope/initiative.json';
const INITIATIVE_LOCK = '.slope/.initiative.lock';

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function acquireLock(cwd: string): boolean {
  const lockDir = join(cwd, INITIATIVE_LOCK);
  const parent = join(cwd, '.slope');
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
  try {
    mkdirSync(lockDir, { recursive: false });
    writeFileSync(join(lockDir, 'pid'), String(process.pid));
    return true;
  } catch {
    // Check for stale lock
    try {
      const pid = parseInt(readFileSync(join(lockDir, 'pid'), 'utf8'), 10);
      if (!isNaN(pid) && !isProcessAlive(pid)) {
        rmSync(lockDir, { recursive: true });
        return acquireLock(cwd); // retry once after removing stale lock
      }
    } catch { /* lock dir exists but no pid file — treat as held */ }
    return false;
  }
}

function releaseLock(cwd: string): void {
  const lockDir = join(cwd, INITIATIVE_LOCK);
  try {
    rmSync(lockDir, { recursive: true });
  } catch { /* lock already released */ }
}

function withLock<T>(cwd: string, fn: () => T): T {
  if (!acquireLock(cwd)) {
    throw new Error('Initiative file is locked by another process. Try again.');
  }
  try {
    return fn();
  } finally {
    releaseLock(cwd);
  }
}

export function loadInitiative(cwd: string): InitiativeDefinition | null {
  const filePath = join(cwd, INITIATIVE_FILE);
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw) as InitiativeDefinition;
  } catch (err) {
    throw new Error(`Corrupted initiative file at ${INITIATIVE_FILE}: ${(err as Error).message}`);
  }
}

export function saveInitiative(cwd: string, initiative: InitiativeDefinition): void {
  withLock(cwd, () => {
    const dir = dirname(join(cwd, INITIATIVE_FILE));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(cwd, INITIATIVE_FILE), JSON.stringify(initiative, null, 2) + '\n');
  });
}

// --- Initiative Creation ---

export function createInitiative(
  name: string,
  description: string,
  roadmapPath: string,
  cwd: string,
  gatesOverride?: Partial<ReviewGateConfig>,
): InitiativeDefinition {
  // Load and validate roadmap
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(cwd, roadmapPath), 'utf8'));
  } catch {
    throw new Error(`Cannot read roadmap at: ${roadmapPath}`);
  }

  const { roadmap } = parseRoadmap(raw);
  if (!roadmap) {
    throw new Error(`Invalid roadmap at: ${roadmapPath}`);
  }

  const defaultGates: ReviewGateConfig = {
    plan: { required: ['architect'], specialists: 'auto' },
    pr: { required: ['architect', 'code'] },
  };

  const gates: ReviewGateConfig = {
    plan: { ...defaultGates.plan, ...gatesOverride?.plan },
    pr: { ...defaultGates.pr, ...gatesOverride?.pr },
  };

  const sprints: InitiativeSprintStatus[] = roadmap.sprints.map(s => ({
    sprint_number: s.id,
    phase: 'pending' as const,
    plan_reviews: [],
    pr_reviews: [],
  }));

  const initiative: InitiativeDefinition = {
    name,
    description,
    roadmap: roadmapPath,
    review_gates: gates,
    sprints,
  };

  saveInitiative(cwd, initiative);
  return initiative;
}

// --- Advance Sprint Phase ---

export function advanceSprint(
  cwd: string,
  sprintNumber: number,
): { phase: InitiativeSprintPhase; previous: InitiativeSprintPhase } {
  const initiative = loadInitiative(cwd);
  if (!initiative) throw new Error('No initiative found. Run "slope initiative create" first.');

  const sprint = initiative.sprints.find(s => s.sprint_number === sprintNumber);
  if (!sprint) throw new Error(`Sprint ${sprintNumber} not found in initiative.`);

  const check = canAdvance(sprint, initiative.review_gates);
  if (!check.ok) throw new Error(check.reason);

  const previous = sprint.phase;
  const next = getNextPhase(sprint.phase);
  if (!next) throw new Error(`Cannot advance sprint ${sprintNumber}: no next phase from "${sprint.phase}".`);

  // On transition to plan_review, populate expected review records if empty
  if (next === 'plan_review' && sprint.plan_reviews.length === 0) {
    // Add required reviews
    for (const rt of initiative.review_gates.plan.required) {
      sprint.plan_reviews.push({
        reviewer: rt,
        completed: false,
        findings_count: 0,
        reviewer_mode: rt === 'architect' ? 'manual' : 'auto',
      });
    }

    // Add specialist reviews
    if (initiative.review_gates.plan.specialists === 'auto') {
      // Load roadmap to get ticket info for specialist selection
      try {
        const raw = JSON.parse(readFileSync(join(cwd, initiative.roadmap), 'utf8'));
        const { roadmap } = parseRoadmap(raw);
        if (roadmap) {
          const roadmapSprint = roadmap.sprints.find(s => s.id === sprintNumber);
          if (roadmapSprint) {
            const tickets = roadmapSprint.tickets.map(t => ({ title: t.title }));
            const specialists = selectSpecialists(tickets);
            for (const specialist of specialists) {
              sprint.plan_reviews.push({
                reviewer: specialist,
                completed: false,
                findings_count: 0,
                reviewer_mode: 'auto',
              });
            }
          }
        }
      } catch { /* roadmap unavailable — skip specialist selection */ }
    } else {
      for (const specialist of initiative.review_gates.plan.specialists) {
        sprint.plan_reviews.push({
          reviewer: specialist,
          completed: false,
          findings_count: 0,
          reviewer_mode: 'auto',
        });
      }
    }
  }

  // On transition to pr_review, populate expected PR review records if empty
  if (next === 'pr_review' && sprint.pr_reviews.length === 0) {
    for (const rt of initiative.review_gates.pr.required) {
      sprint.pr_reviews.push({
        reviewer: rt,
        completed: false,
        findings_count: 0,
        reviewer_mode: rt === 'architect' ? 'manual' : 'auto',
      });
    }
  }

  sprint.phase = next;
  saveInitiative(cwd, initiative);

  return { phase: next, previous };
}

// --- Record Review ---

export function recordReview(
  cwd: string,
  sprintNumber: number,
  gate: ReviewGate,
  reviewer: ReviewChecklistType,
  findingsCount: number = 0,
): void {
  const initiative = loadInitiative(cwd);
  if (!initiative) throw new Error('No initiative found. Run "slope initiative create" first.');

  const sprint = initiative.sprints.find(s => s.sprint_number === sprintNumber);
  if (!sprint) throw new Error(`Sprint ${sprintNumber} not found in initiative.`);

  // Validate gate matches current phase
  if (gate === 'plan' && sprint.phase !== 'plan_review') {
    throw new Error(`Cannot record plan review: sprint is in "${sprint.phase}" phase (expected "plan_review")`);
  }
  if (gate === 'pr' && sprint.phase !== 'pr_review') {
    throw new Error(`Cannot record PR review: sprint is in "${sprint.phase}" phase (expected "pr_review")`);
  }

  const reviews = gate === 'plan' ? sprint.plan_reviews : sprint.pr_reviews;
  const existing = reviews.find(r => r.reviewer === reviewer);

  if (existing) {
    existing.completed = true;
    existing.findings_count = findingsCount;
  } else {
    reviews.push({
      reviewer,
      completed: true,
      findings_count: findingsCount,
      reviewer_mode: reviewer === 'architect' ? 'manual' : 'auto',
    });
  }

  saveInitiative(cwd, initiative);
}

// --- Next Sprint ---

export function getNextSprint(initiative: InitiativeDefinition): InitiativeSprintStatus | null {
  return initiative.sprints.find(s => s.phase !== 'complete') ?? null;
}

// --- Format Status ---

export function formatInitiativeStatus(initiative: InitiativeDefinition): string {
  const lines: string[] = [];
  lines.push(`\n# Initiative: ${initiative.name}`);
  lines.push('\u2550'.repeat(50));
  lines.push(`\nRoadmap: ${initiative.roadmap}`);

  const completed = initiative.sprints.filter(s => s.phase === 'complete').length;
  lines.push(`Progress: ${completed}/${initiative.sprints.length} sprints complete\n`);

  // Table header
  lines.push('Sprint  Phase         Plan Reviews          PR Reviews            Branch');
  lines.push('\u2500'.repeat(90));

  for (const sprint of initiative.sprints) {
    const planReviews = sprint.plan_reviews.length > 0
      ? sprint.plan_reviews.map(r => `${r.reviewer}:${r.completed ? '\u2713' : '\u2717'}`).join(' ')
      : '-';
    const prReviews = sprint.pr_reviews.length > 0
      ? sprint.pr_reviews.map(r => `${r.reviewer}:${r.completed ? '\u2713' : '\u2717'}`).join(' ')
      : '-';

    lines.push(
      `S${String(sprint.sprint_number).padEnd(5)} ` +
      `${sprint.phase.padEnd(13)} ` +
      `${planReviews.padEnd(21)} ` +
      `${prReviews.padEnd(21)} ` +
      `${sprint.branch ?? '-'}`,
    );
  }

  lines.push('');
  return lines.join('\n');
}
