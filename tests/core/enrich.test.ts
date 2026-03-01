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

import { enrichTicket, enrichBacklog, estimateTokens } from '../../src/core/enrich.js';
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
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-enrich-'));
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

// --- estimateTokens ---

describe('estimateTokens', () => {
  it('estimates from file sizes', () => {
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/a.ts'), 'x'.repeat(400)); // 400 bytes

    const tokens = estimateTokens(['src/a.ts'], tmpDir);
    // 400 / 4 * 1.2 = 120
    expect(tokens).toBe(120);
  });

  it('handles missing files gracefully', () => {
    const tokens = estimateTokens(['missing.ts'], tmpDir);
    expect(tokens).toBe(0);
  });

  it('sums multiple files', () => {
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/a.ts'), 'x'.repeat(400));
    writeFileSync(join(tmpDir, 'src/b.ts'), 'x'.repeat(800));

    const tokens = estimateTokens(['src/a.ts', 'src/b.ts'], tmpDir);
    // (400 + 800) / 4 * 1.2 = 360
    expect(tokens).toBe(360);
  });
});

// --- enrichTicket ---

describe('enrichTicket', () => {
  it('returns correct structure', async () => {
    const store = createMockStore([
      { id: 1, filePath: 'src/core/store.ts', chunkIndex: 0, chunkText: 'code', score: 0.8 },
      { id: 2, filePath: 'src/core/config.ts', chunkIndex: 0, chunkText: 'config', score: 0.45 },
    ]);

    mkdirSync(join(tmpDir, 'src/core'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/core/store.ts'), 'export class Store {}');
    writeFileSync(join(tmpDir, 'src/core/config.ts'), 'export const config = {}');

    const enriched = await enrichTicket({
      ticket: {
        key: 'S1-1',
        title: 'Store feature',
        description: 'Add store stuff',
        modules: ['src/core'],
        acceptance_criteria: ['tests pass'],
        club: 'short_iron',
        max_files: 2,
      },
      store,
      embeddingConfig: mockEmbConfig,
      scorecards: [],
      cwd: tmpDir,
    });

    expect(enriched.key).toBe('S1-1');
    expect(enriched.files.primary).toContain('src/core/store.ts');
    expect(enriched.files.related).toContain('src/core/config.ts');
    expect(enriched.estimated_tokens).toBeGreaterThanOrEqual(0);
    expect(enriched.acceptance_criteria).toEqual(['tests pass']);
    expect(enriched.modules).toEqual(['src/core']);
  });

  it('preserves original ticket fields', async () => {
    const store = createMockStore([]);

    const enriched = await enrichTicket({
      ticket: {
        key: 'T1',
        title: 'Test',
        description: 'Description',
        modules: ['mod1'],
        acceptance_criteria: ['ac1', 'ac2'],
        club: 'driver',
        max_files: 3,
      },
      store,
      embeddingConfig: mockEmbConfig,
      scorecards: [],
      cwd: tmpDir,
    });

    expect(enriched.key).toBe('T1');
    expect(enriched.title).toBe('Test');
    expect(enriched.description).toBe('Description');
    expect(enriched.club).toBe('driver');
    expect(enriched.max_files).toBe(3);
  });

  it('includes similar tickets from scorecards', async () => {
    const store = createMockStore([]);
    const scorecards = [
      makeScorecard(38, [
        { ticket_key: 'S38-1', title: 'Store backup implementation', result: 'green' },
      ]),
    ];

    const enriched = await enrichTicket({
      ticket: {
        key: 'T1',
        title: 'Store backup edge cases',
        description: '',
        modules: [],
        acceptance_criteria: [],
        club: 'short_iron',
        max_files: 1,
      },
      store,
      embeddingConfig: mockEmbConfig,
      scorecards,
      cwd: tmpDir,
    });

    expect(enriched.similar_tickets.length).toBeGreaterThan(0);
    expect(enriched.similar_tickets[0].key).toBe('S38-1');
  });

  it('includes hazards from scorecards', async () => {
    const store = createMockStore([]);
    const scorecards = [
      makeScorecard(46, [], ['store migration pitfall']),
    ];

    const enriched = await enrichTicket({
      ticket: {
        key: 'T1',
        title: 'Test',
        description: '',
        modules: ['store'],
        acceptance_criteria: [],
        club: 'putter',
        max_files: 1,
      },
      store,
      embeddingConfig: mockEmbConfig,
      scorecards,
      cwd: tmpDir,
    });

    expect(enriched.hazards.length).toBeGreaterThan(0);
    expect(enriched.hazards[0]).toContain('store migration');
  });
});

// --- enrichBacklog ---

describe('enrichBacklog', () => {
  it('enriches all tickets', async () => {
    const backlogPath = join(tmpDir, 'backlog.json');
    writeFileSync(backlogPath, JSON.stringify({
      sprints: [{
        id: 'S1',
        tickets: [
          { key: 'S1-1', title: 'Feature A', description: '', modules: [], acceptance_criteria: [], club: 'short_iron', max_files: 1 },
          { key: 'S1-2', title: 'Feature B', description: '', modules: [], acceptance_criteria: [], club: 'putter', max_files: 1 },
        ],
      }],
    }));

    const store = createMockStore([]);
    const enriched = await enrichBacklog({
      backlogPath,
      store,
      embeddingConfig: mockEmbConfig,
      scorecards: [],
      cwd: tmpDir,
    });

    expect(enriched.sprints).toHaveLength(1);
    expect(enriched.sprints[0].tickets).toHaveLength(2);
    expect(enriched._enrichMeta.version).toBe(1);
    expect(enriched._enrichMeta.enrichedAt).toBeTruthy();
    expect(enriched._enrichMeta.topK).toBe(5);
  });

  it('preserves original sprint fields', async () => {
    const backlogPath = join(tmpDir, 'backlog.json');
    writeFileSync(backlogPath, JSON.stringify({
      sprints: [{
        id: 'S1',
        title: 'Sprint One',
        strategy: 'Focus on core',
        tickets: [
          { key: 'S1-1', title: 'Feature', description: '', modules: [], acceptance_criteria: [], club: 'putter', max_files: 1 },
        ],
      }],
      customField: 'preserved',
    }));

    const store = createMockStore([]);
    const enriched = await enrichBacklog({
      backlogPath,
      store,
      embeddingConfig: mockEmbConfig,
      scorecards: [],
      cwd: tmpDir,
    });

    expect(enriched.sprints[0].title).toBe('Sprint One');
    expect(enriched.sprints[0].strategy).toBe('Focus on core');
    expect((enriched as Record<string, unknown>).customField).toBe('preserved');
  });

  it('handles empty sprints array', async () => {
    const backlogPath = join(tmpDir, 'backlog.json');
    writeFileSync(backlogPath, JSON.stringify({ sprints: [] }));

    const store = createMockStore([]);
    const enriched = await enrichBacklog({
      backlogPath,
      store,
      embeddingConfig: mockEmbConfig,
      scorecards: [],
      cwd: tmpDir,
    });

    expect(enriched.sprints).toHaveLength(0);
    expect(enriched._enrichMeta.version).toBe(1);
  });

  it('handles missing sprints field', async () => {
    const backlogPath = join(tmpDir, 'backlog.json');
    writeFileSync(backlogPath, JSON.stringify({}));

    const store = createMockStore([]);
    const enriched = await enrichBacklog({
      backlogPath,
      store,
      embeddingConfig: mockEmbConfig,
      scorecards: [],
      cwd: tmpDir,
    });

    expect(enriched.sprints).toHaveLength(0);
  });
});
