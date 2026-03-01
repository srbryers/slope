import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock embedding client — no real HTTP calls
vi.mock('../../src/core/embedding-client.js', () => ({
  embed: vi.fn(async (texts: string[]) => {
    return texts.map(() => new Float32Array(768));
  }),
}));

import {
  generatePrepPlan,
  formatPrepPlan,
  resolveTicket,
  findSimilarTickets,
  extractHazards,
  collectTestFiles,
  buildQueryText,
} from '../../src/core/prep.js';
import type { PrepPlan } from '../../src/core/prep.js';
import type { GolfScorecard } from '../../src/core/types.js';
import type { EmbeddingStore, EmbeddingSearchResult } from '../../src/core/embedding-store.js';

function createMockStore(results: EmbeddingSearchResult[] = []): EmbeddingStore {
  return {
    searchEmbeddings: vi.fn(async () => results),
    saveEmbeddings: vi.fn(async () => {}),
    getIndexedFiles: vi.fn(async () => []),
    deleteEmbeddingsByFile: vi.fn(async () => {}),
    getEmbeddingStats: vi.fn(async () => ({
      fileCount: 1, chunkCount: 1, model: 'test', dimensions: 768,
      lastIndexedAt: null, lastIndexedSha: null,
    })),
    setIndexMeta: vi.fn(async () => {}),
    getIndexMeta: vi.fn(async () => null),
  };
}

const mockEmbConfig = {
  endpoint: 'http://localhost:11434/v1/embeddings',
  model: 'test',
  dimensions: 768,
};

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-prep-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeScorecard(
  sprint: number,
  shots: Array<{ ticket_key: string; title: string; result: string }>,
  bunkers: string[] = [],
): GolfScorecard {
  return {
    sprint_number: sprint,
    theme: `Sprint ${sprint}`,
    par: 4,
    slope: 1,
    score: 4,
    score_label: 'par',
    date: '2024-01-01',
    shots: shots.map(s => ({
      ...s,
      club: 'short_iron' as const,
      hazards: [],
    })),
    conditions: [],
    special_plays: [],
    stats: {
      fairways_hit: 0, fairways_total: 0, greens_in_regulation: 0,
      greens_total: 0, putts: 0, penalties: 0, hazards_hit: 0,
      hazard_penalties: 0, miss_directions: {} as Record<string, number>,
    },
    yardage_book_updates: [],
    bunker_locations: bunkers,
    course_management_notes: [],
  } as GolfScorecard;
}

// --- resolveTicket ---

describe('resolveTicket', () => {
  it('finds ticket in backlog', () => {
    mkdirSync(join(tmpDir, 'slope-loop'), { recursive: true });
    writeFileSync(join(tmpDir, 'slope-loop/backlog.json'), JSON.stringify({
      sprints: [{
        id: 'S47',
        tickets: [{
          key: 'S47-1',
          title: 'Core prep module',
          description: 'Create prep.ts',
          modules: ['src/core'],
          acceptance_criteria: ['tests pass'],
          club: 'short_iron',
          max_files: 2,
        }],
      }],
    }));

    const ticket = resolveTicket('S47-1', tmpDir);
    expect(ticket).not.toBeNull();
    expect(ticket!.key).toBe('S47-1');
    expect(ticket!.title).toBe('Core prep module');
    expect(ticket!.modules).toEqual(['src/core']);
  });

  it('finds ticket in roadmap', () => {
    mkdirSync(join(tmpDir, 'docs/backlog'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs/backlog/roadmap.json'), JSON.stringify({
      sprints: [{
        id: 'S47',
        tickets: [{
          key: 'S47-2',
          title: 'Prep CLI',
          description: 'Create CLI command',
          modules: ['src/cli'],
        }],
      }],
    }));

    const ticket = resolveTicket('S47-2', tmpDir);
    expect(ticket).not.toBeNull();
    expect(ticket!.key).toBe('S47-2');
  });

  it('returns null for missing ticket', () => {
    const ticket = resolveTicket('MISSING-1', tmpDir);
    expect(ticket).toBeNull();
  });

  it('prefers roadmap over backlog', () => {
    mkdirSync(join(tmpDir, 'docs/backlog'), { recursive: true });
    mkdirSync(join(tmpDir, 'slope-loop'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs/backlog/roadmap.json'), JSON.stringify({
      sprints: [{ tickets: [{ key: 'T1', title: 'From roadmap' }] }],
    }));
    writeFileSync(join(tmpDir, 'slope-loop/backlog.json'), JSON.stringify({
      sprints: [{ tickets: [{ key: 'T1', title: 'From backlog' }] }],
    }));

    const ticket = resolveTicket('T1', tmpDir);
    expect(ticket!.title).toBe('From roadmap');
  });
});

// --- buildQueryText ---

describe('buildQueryText', () => {
  it('combines title, description, and modules', () => {
    const q = buildQueryText({ title: 'Add feature', description: 'New functionality', modules: ['src/core'] });
    expect(q).toContain('Add feature');
    expect(q).toContain('New functionality');
    expect(q).toContain('src/core');
  });

  it('handles empty modules', () => {
    const q = buildQueryText({ title: 'Fix bug', description: '', modules: [] });
    expect(q).toBe('Fix bug');
  });
});

// --- findSimilarTickets ---

describe('findSimilarTickets', () => {
  it('finds tickets with overlapping keywords', () => {
    const scorecards = [
      makeScorecard(1, [
        { ticket_key: 'S1-1', title: 'Store backup implementation', result: 'green' },
        { ticket_key: 'S1-2', title: 'Add CLI help text', result: 'fairway' },
      ]),
    ];

    const similar = findSimilarTickets('Store backup edge cases', scorecards);
    expect(similar.length).toBeGreaterThan(0);
    expect(similar[0].key).toBe('S1-1');
  });

  it('returns empty for no matches', () => {
    const scorecards = [
      makeScorecard(1, [
        { ticket_key: 'S1-1', title: 'xyz abc', result: 'green' },
      ]),
    ];

    const similar = findSimilarTickets('completely unrelated topic', scorecards);
    expect(similar).toEqual([]);
  });

  it('limits results to maxResults', () => {
    const scorecards = [
      makeScorecard(1, [
        { ticket_key: 'S1-1', title: 'store implementation one', result: 'green' },
        { ticket_key: 'S1-2', title: 'store implementation two', result: 'fairway' },
        { ticket_key: 'S1-3', title: 'store implementation three', result: 'green' },
        { ticket_key: 'S1-4', title: 'store implementation four', result: 'fairway' },
      ]),
    ];

    const similar = findSimilarTickets('store implementation', scorecards, 2);
    expect(similar.length).toBeLessThanOrEqual(2);
  });

  it('returns empty for empty title', () => {
    const scorecards = [
      makeScorecard(1, [
        { ticket_key: 'S1-1', title: 'something', result: 'green' },
      ]),
    ];

    const similar = findSimilarTickets('', scorecards);
    expect(similar).toEqual([]);
  });
});

// --- extractHazards ---

describe('extractHazards', () => {
  it('extracts matching bunker locations', () => {
    const scorecards = [
      makeScorecard(44, [], ['sqlite-vec BigInt issue']),
      makeScorecard(45, [], ['shell script quoting']),
    ];

    const hazards = extractHazards(['sqlite'], scorecards);
    expect(hazards).toHaveLength(1);
    expect(hazards[0]).toContain('sqlite-vec');
    expect(hazards[0]).toContain('S44');
  });

  it('returns all hazards when modules is empty', () => {
    const scorecards = [
      makeScorecard(44, [], ['issue one']),
      makeScorecard(45, [], ['issue two']),
    ];

    const hazards = extractHazards([], scorecards);
    expect(hazards).toHaveLength(2);
  });

  it('deduplicates by exact string', () => {
    const scorecards = [
      makeScorecard(44, [], ['same issue']),
      makeScorecard(45, [], ['same issue']),
    ];

    const hazards = extractHazards([], scorecards);
    expect(hazards).toHaveLength(1);
  });

  it('limits to recent scorecards', () => {
    const scorecards = Array.from({ length: 10 }, (_, i) =>
      makeScorecard(i + 1, [], [`issue-${i + 1}`]),
    );

    // Default recentCount=5, so only last 5 scorecards (6-10)
    const hazards = extractHazards([], scorecards);
    expect(hazards).toHaveLength(5);
    expect(hazards[0]).toContain('S6');
  });
});

// --- collectTestFiles ---

describe('collectTestFiles', () => {
  it('finds test files matching source stems', () => {
    mkdirSync(join(tmpDir, 'tests/core'), { recursive: true });
    writeFileSync(join(tmpDir, 'tests/core/store.test.ts'), 'test');
    writeFileSync(join(tmpDir, 'tests/core/config.test.ts'), 'test');

    const found = collectTestFiles(['src/core/store.ts'], tmpDir);
    expect(found).toContain('tests/core/store.test.ts');
    expect(found).not.toContain('tests/core/config.test.ts');
  });

  it('handles missing tests directory', () => {
    const found = collectTestFiles(['src/core/store.ts'], tmpDir);
    expect(found).toEqual([]);
  });

  it('fuzzy matches test files', () => {
    mkdirSync(join(tmpDir, 'tests/core'), { recursive: true });
    writeFileSync(join(tmpDir, 'tests/core/embedding-store.test.ts'), 'test');

    const found = collectTestFiles(['src/core/embedding.ts'], tmpDir);
    expect(found.length).toBeGreaterThan(0);
  });

  it('handles multiple primary paths', () => {
    mkdirSync(join(tmpDir, 'tests/core'), { recursive: true });
    writeFileSync(join(tmpDir, 'tests/core/store.test.ts'), 'test');
    writeFileSync(join(tmpDir, 'tests/core/config.test.ts'), 'test');

    const found = collectTestFiles(['src/core/store.ts', 'src/core/config.ts'], tmpDir);
    expect(found).toContain('tests/core/store.test.ts');
    expect(found).toContain('tests/core/config.test.ts');
  });
});

// --- generatePrepPlan ---

describe('generatePrepPlan', () => {
  it('generates valid plan with mock store', async () => {
    mkdirSync(join(tmpDir, 'slope-loop'), { recursive: true });
    writeFileSync(join(tmpDir, 'slope-loop/backlog.json'), JSON.stringify({
      sprints: [{
        tickets: [{
          key: 'S47-1',
          title: 'Core prep module',
          description: 'Create prep.ts',
          modules: ['src/core'],
          acceptance_criteria: ['tests pass'],
          club: 'short_iron',
        }],
      }],
    }));

    mkdirSync(join(tmpDir, 'src/core'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/core/prep.ts'), 'export function test() {}');

    const store = createMockStore([{
      id: 1,
      filePath: 'src/core/prep.ts',
      chunkIndex: 0,
      chunkText: 'export function test() {}',
      score: 0.85,
    }]);

    const plan = await generatePrepPlan({
      ticketId: 'S47-1',
      store,
      embeddingConfig: mockEmbConfig,
      scorecards: [],
      cwd: tmpDir,
    });

    expect(plan.ticket).toBe('S47-1');
    expect(plan.title).toBe('Core prep module');
    expect(plan.club).toBe('short_iron');
    expect(plan.files.modify.length).toBeGreaterThan(0);
    expect(plan.metadata.version).toBe(1);
    expect(plan.metadata.estimatedTokens).toBeGreaterThan(0);
    expect(plan.verification).toContain('pnpm test');
    expect(plan.constraints).toContain('tests pass');
    expect(plan.constraints).toContain('pnpm test passes');
  });

  it('throws for missing ticket', async () => {
    const store = createMockStore();

    await expect(generatePrepPlan({
      ticketId: 'MISSING-1',
      store,
      embeddingConfig: mockEmbConfig,
      scorecards: [],
      cwd: tmpDir,
    })).rejects.toThrow('Ticket not found');
  });

  it('generates plan with empty scorecards', async () => {
    mkdirSync(join(tmpDir, 'slope-loop'), { recursive: true });
    writeFileSync(join(tmpDir, 'slope-loop/backlog.json'), JSON.stringify({
      sprints: [{ tickets: [{ key: 'T1', title: 'Test ticket', description: '', modules: [] }] }],
    }));

    const store = createMockStore([]);

    const plan = await generatePrepPlan({
      ticketId: 'T1',
      store,
      embeddingConfig: mockEmbConfig,
      scorecards: [],
      cwd: tmpDir,
    });

    expect(plan.similarTickets).toEqual([]);
    expect(plan.hazards).toEqual([]);
  });

  it('includes similar tickets from scorecards', async () => {
    mkdirSync(join(tmpDir, 'slope-loop'), { recursive: true });
    writeFileSync(join(tmpDir, 'slope-loop/backlog.json'), JSON.stringify({
      sprints: [{ tickets: [{ key: 'T1', title: 'Store backup logic', description: '', modules: [] }] }],
    }));

    const store = createMockStore([]);
    const scorecards = [
      makeScorecard(38, [
        { ticket_key: 'S38-2', title: 'Store backup edge cases', result: 'green' },
      ]),
    ];

    const plan = await generatePrepPlan({
      ticketId: 'T1',
      store,
      embeddingConfig: mockEmbConfig,
      scorecards,
      cwd: tmpDir,
    });

    expect(plan.similarTickets.length).toBeGreaterThan(0);
    expect(plan.similarTickets[0].key).toBe('S38-2');
  });

  it('deduplicates constraints when acceptance_criteria includes defaults', async () => {
    mkdirSync(join(tmpDir, 'slope-loop'), { recursive: true });
    writeFileSync(join(tmpDir, 'slope-loop/backlog.json'), JSON.stringify({
      sprints: [{
        tickets: [{
          key: 'T1',
          title: 'Dedup test',
          description: 'Test constraint dedup',
          modules: [],
          acceptance_criteria: ['pnpm test passes', 'custom criteria'],
          club: 'putter',
        }],
      }],
    }));

    const store = createMockStore([]);

    const plan = await generatePrepPlan({
      ticketId: 'T1',
      store,
      embeddingConfig: mockEmbConfig,
      scorecards: [],
      cwd: tmpDir,
    });

    // 'pnpm test passes' should appear exactly once
    const testPassCount = plan.constraints.filter(c => c === 'pnpm test passes').length;
    expect(testPassCount).toBe(1);
    expect(plan.constraints).toContain('custom criteria');
    expect(plan.constraints).toContain('pnpm typecheck passes');
  });

  it('includes hazards from scorecards', async () => {
    mkdirSync(join(tmpDir, 'slope-loop'), { recursive: true });
    writeFileSync(join(tmpDir, 'slope-loop/backlog.json'), JSON.stringify({
      sprints: [{ tickets: [{ key: 'T1', title: 'Test', description: '', modules: ['store'] }] }],
    }));

    const store = createMockStore([]);
    const scorecards = [
      makeScorecard(46, [], ['store migration pitfall']),
    ];

    const plan = await generatePrepPlan({
      ticketId: 'T1',
      store,
      embeddingConfig: mockEmbConfig,
      scorecards,
      cwd: tmpDir,
    });

    expect(plan.hazards.length).toBeGreaterThan(0);
    expect(plan.hazards[0]).toContain('store migration');
  });
});

// --- formatPrepPlan ---

describe('formatPrepPlan', () => {
  it('produces valid markdown structure', () => {
    const plan: PrepPlan = {
      ticket: 'S47-1',
      title: 'Core prep module',
      club: 'short_iron',
      description: 'Create prep.ts',
      files: {
        modify: [{ path: 'src/core/prep.ts', relevance: 0.89, snippet: 'export function test() {}' }],
        test: ['tests/core/prep.test.ts'],
      },
      similarTickets: [{ key: 'S38-2', title: 'Store backup', result: 'green', sprint: 38 }],
      hazards: ['sqlite-vec BigInt (S46)'],
      constraints: ['pnpm test passes', 'pnpm typecheck passes'],
      verification: ['pnpm test', 'pnpm typecheck'],
      metadata: {
        version: 1,
        generatedAt: '2024-01-01T00:00:00Z',
        estimatedTokens: 2400,
        queryText: 'Core prep module Create prep.ts src/core',
      },
    };

    const md = formatPrepPlan(plan);

    expect(md).toContain('# Execution Plan: S47-1');
    expect(md).toContain('## Core prep module');
    expect(md).toContain('Club: short_iron');
    expect(md).toContain('Est. tokens: 2400');
    expect(md).toContain('## Files to Modify');
    expect(md).toContain('src/core/prep.ts (relevance: 0.89)');
    expect(md).toContain('tests/core/prep.test.ts (test file)');
    expect(md).toContain('## Similar Past Tickets');
    expect(md).toContain('S38-2');
    expect(md).toContain('## Hazards');
    expect(md).toContain('sqlite-vec BigInt');
    expect(md).toContain('## Constraints');
    expect(md).toContain('## Verification');
    expect(md).toContain('pnpm test');
  });

  it('omits empty sections', () => {
    const plan: PrepPlan = {
      ticket: 'T1',
      title: 'Test',
      club: 'putter',
      description: '',
      files: { modify: [], test: [] },
      similarTickets: [],
      hazards: [],
      constraints: ['pnpm test passes'],
      verification: ['pnpm test'],
      metadata: {
        version: 1,
        generatedAt: '2024-01-01T00:00:00Z',
        estimatedTokens: 0,
        queryText: 'Test',
      },
    };

    const md = formatPrepPlan(plan);
    expect(md).not.toContain('## Similar Past Tickets');
    expect(md).not.toContain('## Hazards');
    expect(md).toContain('## Constraints');
  });
});
