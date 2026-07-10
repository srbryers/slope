import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadRoadmapSourceStore,
  validateRoadmapSourceStore,
} from '../src/cli/roadmap-source-store.js';

describe('SLOPE roadmap source federation dogfood', () => {
  it('keeps the authored bundle valid and the compatibility projection current', () => {
    const store = loadRoadmapSourceStore(process.cwd());
    const validation = validateRoadmapSourceStore(store);

    expect(validation.errors).toEqual([]);
    expect(readFileSync(store.outputPath, 'utf8')).toBe(store.projection);
    expect(store.sources.some(source => source.entry.kind === 'archive')).toBe(true);
    expect(store.sources.some(source => source.entry.kind === 'phase')).toBe(true);
  });

  it('assigns every sprint exactly once and archives only fully evidenced bundles', () => {
    const store = loadRoadmapSourceStore(process.cwd());
    const memberships = new Map<number, number>();

    for (const source of store.sources) {
      const memberIds = source.document.phase.sprints;
      expect(source.document.sprints.map(sprint => sprint.id)).toEqual(memberIds);
      for (const sprint of source.document.sprints) {
        memberships.set(sprint.id, (memberships.get(sprint.id) ?? 0) + 1);
        if (source.entry.kind !== 'archive') continue;
        const scorecard = source.document.scorecards?.[String(sprint.id)];
        expect(scorecard, `${source.entry.path} S${sprint.id}`).toBeTruthy();
        expect(existsSync(resolve(store.cwd, scorecard!)), scorecard).toBe(true);
      }
    }

    expect([...memberships.values()].every(count => count === 1)).toBe(true);
    expect([...memberships.keys()].sort((a, b) => a - b)).toEqual(
      store.roadmap.sprints.map(sprint => sprint.id).sort((a, b) => a - b),
    );
  });

  it('preserves the pre-federation historical sprint definitions byte-for-byte', () => {
    const store = loadRoadmapSourceStore(process.cwd());
    const history = store.roadmap.sprints.filter(sprint => sprint.id <= 231);
    const digest = createHash('sha256').update(JSON.stringify(history)).digest('hex');

    // Baseline: commit 2fd935d, immediately before the S232 source migration.
    // Phase membership repairs are outside sprint definitions and intentionally
    // do not alter this digest.
    expect(digest).toBe('ad9a6e95a5ac63b7ad87fdb0303bbe47c27f3c8234055ed5fb6220c8cee2d218');
  });
});
