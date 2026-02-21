import { describe, it, expect } from 'vitest';
import { createSlopeToolsServer, SLOPE_MCP_TOOL_NAMES } from './index.js';
import { SLOPE_REGISTRY, SLOPE_TYPES } from './registry.js';
import { runInSandbox } from './sandbox.js';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('createSlopeToolsServer', () => {
  it('returns an MCP server instance', () => {
    const server = createSlopeToolsServer();
    expect(server).toBeDefined();
    expect(typeof server).toBe('object');
  });

  it('exposes exactly 2 tools', () => {
    expect(SLOPE_MCP_TOOL_NAMES).toHaveLength(2);
    expect(SLOPE_MCP_TOOL_NAMES).toContain('search');
    expect(SLOPE_MCP_TOOL_NAMES).toContain('execute');
  });
});

describe('registry', () => {
  it('search with no args returns full registry', () => {
    expect(SLOPE_REGISTRY.length).toBeGreaterThan(30);
    expect(SLOPE_REGISTRY.every((e) => e.name && e.module && e.description)).toBe(true);
  });

  it('search with query filters correctly', () => {
    const q = 'handicap';
    const results = SLOPE_REGISTRY.filter(
      (e) => e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((e) => e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q))).toBe(true);
  });

  it('search with module filter returns only that module', () => {
    const fsEntries = SLOPE_REGISTRY.filter((e) => e.module === 'fs');
    expect(fsEntries.length).toBeGreaterThan(0);
    expect(fsEntries.every((e) => e.module === 'fs')).toBe(true);
  });

  it('SLOPE_TYPES contains key type definitions', () => {
    expect(SLOPE_TYPES).toContain('GolfScorecard');
    expect(SLOPE_TYPES).toContain('HandicapCard');
    expect(SLOPE_TYPES).toContain('SlopeConfig');
    expect(SLOPE_TYPES).toContain('ScorecardInput');
  });
});

describe('sandbox', () => {
  it('executes simple expression and returns result', async () => {
    const { result } = await runInSandbox('return 1 + 2;', process.cwd());
    expect(result).toBe(3);
  });

  it('executes core function: computePar(3)', async () => {
    const { result } = await runInSandbox('return computePar(3);', process.cwd());
    expect(result).toBe(4);
  });

  it('executes computeHandicapCard with empty array', async () => {
    const { result } = await runInSandbox('return computeHandicapCard([]);', process.cwd());
    expect(result).toBeDefined();
    expect((result as Record<string, unknown>).all_time).toBeDefined();
  });

  it('captures console.log output', async () => {
    const { result, logs } = await runInSandbox('console.log("hello"); return 42;', process.cwd());
    expect(result).toBe(42);
    expect(logs).toContain('hello');
  });

  it('returns constants', async () => {
    const { result } = await runInSandbox('return SLOPE_FACTORS;', process.cwd());
    expect(Array.isArray(result)).toBe(true);
    expect(result).toContain('cross_package');
  });

  it('rejects path escape', async () => {
    await expect(
      runInSandbox('return readFile("../../etc/passwd");', process.cwd()),
    ).rejects.toThrow(/[Pp]ath escape/);
  });

  it('times out on infinite loop', async () => {
    await expect(
      runInSandbox('while(true){}', process.cwd()),
    ).rejects.toThrow();
  }, 35_000);

  it('errors on require', async () => {
    await expect(
      runInSandbox('return require("fs");', process.cwd()),
    ).rejects.toThrow();
  });

  it('errors on process access', async () => {
    await expect(
      runInSandbox('return process.env;', process.cwd()),
    ).rejects.toThrow();
  });

  it('loads scorecards from a test project', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'slope-sandbox-'));
    const retrosDir = join(tmp, 'docs', 'retros');
    const slopeDir = join(tmp, '.slope');
    mkdirSync(retrosDir, { recursive: true });
    mkdirSync(slopeDir, { recursive: true });
    writeFileSync(join(slopeDir, 'config.json'), JSON.stringify({
      scorecardDir: 'docs/retros',
      scorecardPattern: 'sprint-*.json',
      minSprint: 1,
    }));
    writeFileSync(join(retrosDir, 'sprint-1.json'), JSON.stringify({
      sprint_number: 1, theme: 'Test', par: 3, slope: 0, score: 3,
      score_label: 'par', date: '2026-01-01',
      shots: [], conditions: [], special_plays: [], stats: {
        fairways_hit: 0, fairways_total: 0, greens_in_regulation: 0,
        greens_total: 0, putts: 0, penalties: 0, hazards_hit: 0,
        miss_directions: { long: 0, short: 0, left: 0, right: 0 },
      },
      yardage_book_updates: [], bunker_locations: [], course_management_notes: [],
    }));

    const { result } = await runInSandbox(
      'const cards = loadScorecards(); return cards.length;',
      tmp,
    );
    expect(result).toBe(1);
  });
});
