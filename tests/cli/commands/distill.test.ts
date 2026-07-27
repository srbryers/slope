import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storeMock = vi.hoisted(() => ({
  getEventsBySprint: vi.fn(),
  listScorecards: vi.fn(),
  loadCommonIssues: vi.fn(),
  close: vi.fn(),
}));
const resolveStoreMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/cli/store.js', () => ({
  resolveStore: resolveStoreMock,
}));

import { distillCommand } from '../../../src/cli/commands/distill.js';

describe('slope distill sprint selection', () => {
  beforeEach(() => {
    storeMock.getEventsBySprint.mockReset().mockResolvedValue([]);
    storeMock.listScorecards.mockReset().mockResolvedValue([]);
    storeMock.loadCommonIssues.mockReset().mockResolvedValue({ recurring_patterns: [] });
    storeMock.close.mockReset();
    resolveStoreMock.mockReset().mockResolvedValue(storeMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves an explicit canonical sprint id', async () => {
    await distillCommand(['--sprint=458.10', '--dry-run']);

    expect(storeMock.getEventsBySprint).toHaveBeenCalledOnce();
    expect(storeMock.getEventsBySprint).toHaveBeenCalledWith('458.10');
    expect(storeMock.getEventsBySprint).not.toHaveBeenCalledWith('458.1');
    expect(storeMock.listScorecards).not.toHaveBeenCalled();
  });

  it('discovers canonical sprint ids from scorecards without an integer scan', async () => {
    storeMock.listScorecards.mockResolvedValue([
      { sprint_number: '458.1' },
      { sprint_number: '458.10' },
      { sprint_number: '458.10' },
    ]);

    await distillCommand(['--dry-run']);

    expect(storeMock.getEventsBySprint.mock.calls).toEqual([
      ['458.1'],
      ['458.10'],
    ]);
  });
});
