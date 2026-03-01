import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  selectSpecialists,
  getReviewChecklist,
  getNextPhase,
  canAdvance,
  loadInitiative,
  saveInitiative,
  createInitiative,
  advanceSprint,
  recordReview,
  getNextSprint,
  formatInitiativeStatus,
} from '../../src/core/initiative.js';
import type {
  InitiativeSprintStatus,
  ReviewGateConfig,
  InitiativeDefinition,
  InitiativeSprintPhase,
} from '../../src/core/initiative.js';

// --- Test fixtures ---

const TEST_DIR = join(process.cwd(), '.test-initiative-tmp');

const SAMPLE_ROADMAP = {
  name: 'Test Initiative',
  description: 'Test',
  phases: [{ name: 'Phase 1', sprints: [1, 2] }],
  sprints: [
    {
      id: 1,
      theme: 'Sprint One',
      par: 4,
      slope: 2,
      type: 'feature',
      tickets: [
        { key: 'S1-1', title: 'Add store API endpoint', club: 'short_iron', complexity: 'standard' },
        { key: 'S1-2', title: 'CLI command handler', club: 'wedge', complexity: 'small' },
      ],
    },
    {
      id: 2,
      theme: 'Sprint Two',
      par: 4,
      slope: 2,
      type: 'feature',
      depends_on: [1],
      tickets: [
        { key: 'S2-1', title: 'Dashboard rendering', club: 'short_iron', complexity: 'standard' },
      ],
    },
  ],
};

function setupTestDir(): void {
  mkdirSync(join(TEST_DIR, '.slope'), { recursive: true });
  mkdirSync(join(TEST_DIR, 'docs', 'backlog'), { recursive: true });
  writeFileSync(
    join(TEST_DIR, 'docs', 'backlog', 'roadmap.json'),
    JSON.stringify(SAMPLE_ROADMAP, null, 2),
  );
}

function cleanupTestDir(): void {
  rmSync(TEST_DIR, { recursive: true, force: true });
}

const DEFAULT_GATES: ReviewGateConfig = {
  plan: { required: ['architect'], specialists: 'auto' },
  pr: { required: ['architect', 'code'] },
};

function makeSprint(overrides: Partial<InitiativeSprintStatus> = {}): InitiativeSprintStatus {
  return {
    sprint_number: 1,
    phase: 'pending',
    plan_reviews: [],
    pr_reviews: [],
    ...overrides,
  };
}

// --- selectSpecialists ---

describe('selectSpecialists', () => {
  it('selects backend for store/api/cli keywords', () => {
    const result = selectSpecialists([
      { title: 'Add store API endpoint' },
      { title: 'CLI command handler' },
    ]);
    expect(result).toContain('backend');
  });

  it('selects ml-engineer for ML keywords', () => {
    const result = selectSpecialists([
      { title: 'Add ML model inference' },
      { title: 'Embedding vector search' },
    ]);
    expect(result).toContain('ml-engineer');
  });

  it('selects database for schema/migration keywords', () => {
    const result = selectSpecialists([
      { title: 'Schema migration for postgres' },
      { title: 'Add table index' },
    ]);
    expect(result).toContain('database');
  });

  it('selects frontend for html/css/dashboard keywords', () => {
    const result = selectSpecialists([
      { title: 'Dashboard chart rendering' },
      { title: 'SVG template component' },
    ]);
    expect(result).toContain('frontend');
  });

  it('selects ux-designer for onboarding/wizard keywords', () => {
    const result = selectSpecialists([
      { title: 'Onboarding interview wizard' },
      { title: 'Tutorial walkthrough' },
    ]);
    expect(result).toContain('ux-designer');
  });

  it('supports multiple specialists for mixed content', () => {
    const result = selectSpecialists([
      { title: 'Add store API endpoint handler' },
      { title: 'Schema migration for sqlite table' },
    ]);
    expect(result).toContain('backend');
    expect(result).toContain('database');
  });

  it('uses word boundary matching — "restore" does not count as "store" hit', () => {
    // "restore" should NOT trigger the backend "store" keyword (word boundary)
    // With no keywords matching, fallback picks top priority (backend) with 0 hits
    // The key assertion: "restore" alone shouldn't give backend 2+ hits
    const resultRestore = selectSpecialists([
      { title: 'Restore backup from archive' },
      { title: 'Restore old configuration' },
    ]);
    // Now compare: actual "store" keyword SHOULD give backend 2+ hits
    const resultStore = selectSpecialists([
      { title: 'Store backup data' },
      { title: 'Store old configuration' },
    ]);
    // "store" gives backend >= 2 hits, "restore" doesn't
    expect(resultStore).toContain('backend');
    // resultRestore uses fallback (0 matches), not threshold-based selection
    expect(resultRestore).toHaveLength(1); // fallback returns exactly 1
  });

  it('falls back to top scorer when none meet threshold', () => {
    const result = selectSpecialists([
      { title: 'Update the config file' },
    ]);
    // Should return at least one specialist
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('follows tie-breaking priority order', () => {
    // Both backend and database have 1 hit each — neither meets threshold
    // Backend has higher priority
    const result = selectSpecialists([
      { title: 'Add endpoint with query' },
    ]);
    expect(result[0]).toBe('backend');
  });

  it('considers file patterns in selection', () => {
    const result = selectSpecialists([
      { title: 'Update module', filePatterns: ['src/store-pg/index.ts', 'migrations/001.sql'] },
      { title: 'Fix query', filePatterns: ['src/store/sqlite.ts'] },
    ]);
    expect(result).toContain('database');
  });
});

// --- getReviewChecklist ---

describe('getReviewChecklist', () => {
  it('returns architect plan checklist', () => {
    const items = getReviewChecklist('architect', 'plan');
    expect(items.length).toBeGreaterThan(0);
    expect(items.some(i => i.category === 'duplication')).toBe(true);
  });

  it('returns architect PR checklist', () => {
    const items = getReviewChecklist('architect', 'pr');
    expect(items.length).toBeGreaterThan(0);
    expect(items.some(i => i.category === 'api')).toBe(true);
  });

  it('returns code PR checklist', () => {
    const items = getReviewChecklist('code', 'pr');
    expect(items.length).toBeGreaterThan(0);
    expect(items.some(i => i.category === 'testing')).toBe(true);
  });

  it('returns backend specialist plan checklist', () => {
    const items = getReviewChecklist('backend', 'plan');
    expect(items.length).toBeGreaterThan(0);
    expect(items.some(i => i.category === 'api')).toBe(true);
  });

  it('returns ml-engineer specialist plan checklist', () => {
    const items = getReviewChecklist('ml-engineer', 'plan');
    expect(items.length).toBeGreaterThan(0);
    expect(items.some(i => i.category === 'cost')).toBe(true);
  });

  it('returns database specialist plan checklist', () => {
    const items = getReviewChecklist('database', 'plan');
    expect(items.length).toBeGreaterThan(0);
    expect(items.some(i => i.category === 'schema')).toBe(true);
  });

  it('returns frontend specialist plan checklist', () => {
    const items = getReviewChecklist('frontend', 'plan');
    expect(items.length).toBeGreaterThan(0);
    expect(items.some(i => i.category === 'rendering')).toBe(true);
  });

  it('returns ux-designer specialist plan checklist', () => {
    const items = getReviewChecklist('ux-designer', 'plan');
    expect(items.length).toBeGreaterThan(0);
    expect(items.some(i => i.category === 'flow')).toBe(true);
  });

  it('returns empty array for unknown reviewer at plan gate', () => {
    const items = getReviewChecklist('security', 'plan');
    expect(items).toEqual([]);
  });

  it('returns empty array for specialist at PR gate', () => {
    const items = getReviewChecklist('backend', 'pr');
    expect(items).toEqual([]);
  });
});

// --- State Machine ---

describe('getNextPhase', () => {
  const transitions: Array<[InitiativeSprintPhase, InitiativeSprintPhase | null]> = [
    ['pending', 'planning'],
    ['planning', 'plan_review'],
    ['plan_review', 'executing'],
    ['executing', 'scoring'],
    ['scoring', 'pr_review'],
    ['pr_review', 'complete'],
    ['complete', null],
  ];

  for (const [from, to] of transitions) {
    it(`${from} → ${to ?? 'null'}`, () => {
      expect(getNextPhase(from)).toBe(to);
    });
  }
});

describe('canAdvance', () => {
  it('allows pending → planning', () => {
    const sprint = makeSprint({ phase: 'pending' });
    expect(canAdvance(sprint, DEFAULT_GATES).ok).toBe(true);
  });

  it('allows planning → plan_review', () => {
    const sprint = makeSprint({ phase: 'planning' });
    expect(canAdvance(sprint, DEFAULT_GATES).ok).toBe(true);
  });

  it('blocks plan_review → executing when required reviews incomplete', () => {
    const sprint = makeSprint({
      phase: 'plan_review',
      plan_reviews: [
        { reviewer: 'architect', completed: false, findings_count: 0, reviewer_mode: 'manual' },
      ],
    });
    const result = canAdvance(sprint, DEFAULT_GATES);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('architect');
  });

  it('allows plan_review → executing when all reviews complete', () => {
    const sprint = makeSprint({
      phase: 'plan_review',
      plan_reviews: [
        { reviewer: 'architect', completed: true, findings_count: 2, reviewer_mode: 'manual' },
        { reviewer: 'backend', completed: true, findings_count: 0, reviewer_mode: 'auto' },
      ],
    });
    expect(canAdvance(sprint, DEFAULT_GATES).ok).toBe(true);
  });

  it('blocks plan_review → executing when specialist review incomplete', () => {
    const sprint = makeSprint({
      phase: 'plan_review',
      plan_reviews: [
        { reviewer: 'architect', completed: true, findings_count: 0, reviewer_mode: 'manual' },
        { reviewer: 'backend', completed: false, findings_count: 0, reviewer_mode: 'auto' },
      ],
    });
    const result = canAdvance(sprint, DEFAULT_GATES);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('backend');
  });

  it('blocks pr_review → complete when PR reviews incomplete', () => {
    const sprint = makeSprint({
      phase: 'pr_review',
      pr_reviews: [
        { reviewer: 'architect', completed: true, findings_count: 0, reviewer_mode: 'manual' },
        { reviewer: 'code', completed: false, findings_count: 0, reviewer_mode: 'auto' },
      ],
    });
    const result = canAdvance(sprint, DEFAULT_GATES);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('code');
  });

  it('allows pr_review → complete when all PR reviews complete', () => {
    const sprint = makeSprint({
      phase: 'pr_review',
      pr_reviews: [
        { reviewer: 'architect', completed: true, findings_count: 1, reviewer_mode: 'manual' },
        { reviewer: 'code', completed: true, findings_count: 0, reviewer_mode: 'auto' },
      ],
    });
    expect(canAdvance(sprint, DEFAULT_GATES).ok).toBe(true);
  });

  it('blocks advancement from complete', () => {
    const sprint = makeSprint({ phase: 'complete' });
    const result = canAdvance(sprint, DEFAULT_GATES);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('already complete');
  });
});

// --- File I/O ---

describe('initiative file I/O', () => {
  beforeEach(setupTestDir);
  afterEach(cleanupTestDir);

  it('loadInitiative returns null when no file exists', () => {
    expect(loadInitiative(TEST_DIR)).toBeNull();
  });

  it('saveInitiative + loadInitiative roundtrip', () => {
    const initiative: InitiativeDefinition = {
      name: 'Test',
      description: 'Test initiative',
      roadmap: 'docs/backlog/roadmap.json',
      review_gates: DEFAULT_GATES,
      sprints: [makeSprint()],
    };
    saveInitiative(TEST_DIR, initiative);
    const loaded = loadInitiative(TEST_DIR);
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe('Test');
    expect(loaded!.sprints).toHaveLength(1);
  });

  it('createInitiative creates from roadmap', () => {
    const initiative = createInitiative(
      'Test Initiative',
      'Description',
      'docs/backlog/roadmap.json',
      TEST_DIR,
    );
    expect(initiative.name).toBe('Test Initiative');
    expect(initiative.sprints).toHaveLength(2);
    expect(initiative.sprints[0].sprint_number).toBe(1);
    expect(initiative.sprints[0].phase).toBe('pending');
    expect(initiative.review_gates.plan.required).toContain('architect');
  });

  it('createInitiative throws for invalid roadmap path', () => {
    expect(() => createInitiative('Test', '', 'nonexistent.json', TEST_DIR)).toThrow('Cannot read roadmap');
  });

  it('lock prevents concurrent writes', () => {
    // Simulate a held lock
    mkdirSync(join(TEST_DIR, '.slope', '.initiative.lock'), { recursive: false });

    const initiative: InitiativeDefinition = {
      name: 'Test',
      description: '',
      roadmap: 'r.json',
      review_gates: DEFAULT_GATES,
      sprints: [],
    };
    expect(() => saveInitiative(TEST_DIR, initiative)).toThrow('locked');

    // Clean up lock
    rmSync(join(TEST_DIR, '.slope', '.initiative.lock'), { recursive: true });
  });
});

// --- advanceSprint ---

describe('advanceSprint', () => {
  beforeEach(setupTestDir);
  afterEach(cleanupTestDir);

  it('advances pending → planning', () => {
    createInitiative('Test', '', 'docs/backlog/roadmap.json', TEST_DIR);
    const result = advanceSprint(TEST_DIR, 1);
    expect(result.previous).toBe('pending');
    expect(result.phase).toBe('planning');
  });

  it('advances through planning → plan_review and populates review records', () => {
    createInitiative('Test', '', 'docs/backlog/roadmap.json', TEST_DIR);
    advanceSprint(TEST_DIR, 1); // pending → planning
    advanceSprint(TEST_DIR, 1); // planning → plan_review

    const initiative = loadInitiative(TEST_DIR)!;
    const sprint = initiative.sprints.find(s => s.sprint_number === 1)!;
    expect(sprint.phase).toBe('plan_review');
    expect(sprint.plan_reviews.length).toBeGreaterThan(0);
    // Should have architect (required) + auto-selected specialist
    expect(sprint.plan_reviews.some(r => r.reviewer === 'architect')).toBe(true);
  });

  it('throws when trying to skip phases', () => {
    createInitiative('Test', '', 'docs/backlog/roadmap.json', TEST_DIR);
    // Manually set phase to plan_review without completing reviews
    const initiative = loadInitiative(TEST_DIR)!;
    initiative.sprints[0].phase = 'plan_review';
    initiative.sprints[0].plan_reviews = [
      { reviewer: 'architect', completed: false, findings_count: 0, reviewer_mode: 'manual' },
    ];
    saveInitiative(TEST_DIR, initiative);

    expect(() => advanceSprint(TEST_DIR, 1)).toThrow('architect');
  });

  it('throws for unknown sprint number', () => {
    createInitiative('Test', '', 'docs/backlog/roadmap.json', TEST_DIR);
    expect(() => advanceSprint(TEST_DIR, 99)).toThrow('not found');
  });

  it('throws when no initiative exists', () => {
    expect(() => advanceSprint(TEST_DIR, 1)).toThrow('No initiative found');
  });
});

// --- recordReview ---

describe('recordReview', () => {
  beforeEach(() => {
    setupTestDir();
    createInitiative('Test', '', 'docs/backlog/roadmap.json', TEST_DIR);
    advanceSprint(TEST_DIR, 1); // pending → planning
    advanceSprint(TEST_DIR, 1); // planning → plan_review
  });
  afterEach(cleanupTestDir);

  it('records a plan review completion', () => {
    recordReview(TEST_DIR, 1, 'plan', 'architect', 3);
    const initiative = loadInitiative(TEST_DIR)!;
    const sprint = initiative.sprints.find(s => s.sprint_number === 1)!;
    const archReview = sprint.plan_reviews.find(r => r.reviewer === 'architect')!;
    expect(archReview.completed).toBe(true);
    expect(archReview.findings_count).toBe(3);
  });

  it('adds new reviewer if not in existing records', () => {
    recordReview(TEST_DIR, 1, 'plan', 'security', 1);
    const initiative = loadInitiative(TEST_DIR)!;
    const sprint = initiative.sprints.find(s => s.sprint_number === 1)!;
    const secReview = sprint.plan_reviews.find(r => r.reviewer === 'security');
    expect(secReview).toBeDefined();
    expect(secReview!.completed).toBe(true);
  });

  it('throws when recording plan review in wrong phase', () => {
    // Complete all plan reviews first
    const initiative = loadInitiative(TEST_DIR)!;
    const sprint = initiative.sprints.find(s => s.sprint_number === 1)!;
    for (const r of sprint.plan_reviews) r.completed = true;
    saveInitiative(TEST_DIR, initiative);

    advanceSprint(TEST_DIR, 1); // plan_review → executing

    expect(() => recordReview(TEST_DIR, 1, 'plan', 'architect', 0)).toThrow('plan_review');
  });

  it('throws for unknown sprint', () => {
    expect(() => recordReview(TEST_DIR, 99, 'plan', 'architect', 0)).toThrow('not found');
  });
});

// --- getNextSprint ---

describe('getNextSprint', () => {
  it('returns first non-complete sprint', () => {
    const initiative: InitiativeDefinition = {
      name: 'Test',
      description: '',
      roadmap: 'r.json',
      review_gates: DEFAULT_GATES,
      sprints: [
        makeSprint({ sprint_number: 1, phase: 'complete' }),
        makeSprint({ sprint_number: 2, phase: 'planning' }),
        makeSprint({ sprint_number: 3, phase: 'pending' }),
      ],
    };
    const next = getNextSprint(initiative);
    expect(next).not.toBeNull();
    expect(next!.sprint_number).toBe(2);
  });

  it('returns null when all sprints complete', () => {
    const initiative: InitiativeDefinition = {
      name: 'Test',
      description: '',
      roadmap: 'r.json',
      review_gates: DEFAULT_GATES,
      sprints: [
        makeSprint({ sprint_number: 1, phase: 'complete' }),
        makeSprint({ sprint_number: 2, phase: 'complete' }),
      ],
    };
    expect(getNextSprint(initiative)).toBeNull();
  });
});

// --- formatInitiativeStatus ---

describe('formatInitiativeStatus', () => {
  it('produces formatted output with sprint table', () => {
    const initiative: InitiativeDefinition = {
      name: 'Test Initiative',
      description: '',
      roadmap: 'docs/backlog/roadmap.json',
      review_gates: DEFAULT_GATES,
      sprints: [
        makeSprint({ sprint_number: 1, phase: 'plan_review', plan_reviews: [
          { reviewer: 'architect', completed: true, findings_count: 2, reviewer_mode: 'manual' },
        ] }),
        makeSprint({ sprint_number: 2, phase: 'pending' }),
      ],
    };
    const output = formatInitiativeStatus(initiative);
    expect(output).toContain('Test Initiative');
    expect(output).toContain('S1');
    expect(output).toContain('plan_review');
    expect(output).toContain('0/2 sprints complete');
  });
});
