import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildPostMergeRetro,
  buildRetroMemoryPlans,
  persistRetroMemories,
} from '../../src/core/retro.js';
import { searchMemories } from '../../src/core/memory.js';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'slope-retro-'));
}

describe('post-merge retro memory contract', () => {
  it('normalizes retro fields and infers outcome', () => {
    const retro = buildPostMergeRetro({
      sprint: 137,
      pr: 512,
      summary: '  merged cleanly   after review ',
      learnings: [{ text: ' keep post-merge learnings durable ', category: 'workflow', weight: 12 }],
      hazards: ['  avoid advisory-only closeout gates  '],
      followUps: [' add CLI command '],
      mergedAt: '2026-06-05T12:00:00.000Z',
    });

    expect(retro.outcome).toBe('follow_up');
    expect(retro.summary).toBe('merged cleanly after review');
    expect(retro.learnings[0]).toEqual({
      text: 'keep post-merge learnings durable',
      category: 'workflow',
      weight: 10,
    });
    expect(retro.hazards).toEqual(['avoid advisory-only closeout gates']);
    expect(retro.followUps).toEqual(['add CLI command']);
  });

  it('accepts decimal sprint ids for inserted sprint retros (#529)', () => {
    const retro = buildPostMergeRetro({
      sprint: 146.1,
      pr: 527,
      summary: 'release shipped',
      learnings: [{ text: 'Decimal sprint retros should persist' }],
    });

    expect(retro.sprint).toBe(146.1);
    expect(buildRetroMemoryPlans(retro)[0].text).toContain('S146.1 PR #527');
  });

  it('turns retro results into durable memory plans', () => {
    const retro = buildPostMergeRetro({
      sprint: 137,
      pr: 512,
      summary: 'Retro command shipped',
      learnings: [{ text: 'Use memory source auto-retro', category: 'project', weight: 8 }],
      hazards: ['Post-merge closeout can be skipped'],
      followUps: ['Document agent skill'],
      sourceSessionId: 'session-1',
    });

    const plans = buildRetroMemoryPlans(retro);

    expect(plans.map(p => p.category)).toEqual(['project', 'project', 'hazard', 'workflow']);
    expect(plans[0].text).toContain('S137 PR #512 post-merge retro summary');
    expect(plans[1].text).toContain('auto-retro');
    expect(plans.every(p => p.sourceSessionId === 'session-1')).toBe(true);
  });

  it('persists auto-retro memories idempotently', () => {
    const cwd = createTempDir();
    const retro = buildPostMergeRetro({
      sprint: 137,
      learnings: [{ text: 'Persist the learning once', category: 'workflow' }],
    });

    const first = persistRetroMemories(cwd, retro);
    const second = persistRetroMemories(cwd, retro);
    const memories = searchMemories(cwd, { source: 'auto-retro' });

    expect(first.added).toHaveLength(1);
    expect(second.added).toHaveLength(0);
    expect(second.skipped).toHaveLength(1);
    expect(memories).toHaveLength(1);
    expect(memories[0].source).toBe('auto-retro');
  });

  it('blocks suspected secrets before persisting auto-retro memories', () => {
    const cwd = createTempDir();
    const retro = buildPostMergeRetro({
      sprint: 137,
      learnings: [{ text: 'Token value sk-abcdefghijklmnopqrstuvwxyz123456 should not persist' }],
    });

    expect(() => persistRetroMemories(cwd, retro)).toThrow(/secret pattern/i);
    expect(searchMemories(cwd, { source: 'auto-retro' })).toHaveLength(0);
  });
});
