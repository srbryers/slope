import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storeMock = vi.hoisted(() => ({
  getAllEvents: vi.fn(),
  getEventsBySprint: vi.fn(),
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
    storeMock.getAllEvents.mockReset().mockResolvedValue([]);
    storeMock.getEventsBySprint.mockReset().mockResolvedValue([]);
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
    expect(storeMock.getAllEvents).not.toHaveBeenCalled();
  });

  it('loads all events without inferring sprint ids', async () => {
    storeMock.getAllEvents.mockResolvedValue([
      { id: 'one', timestamp: '2026-01-01T00:00:00Z', type: 'decision', data: {}, sprint_number: '458.1' },
      { id: 'ten', timestamp: '2026-01-02T00:00:00Z', type: 'decision', data: {}, sprint_number: '458.10' },
      { id: 'none', timestamp: '2026-01-03T00:00:00Z', type: 'decision', data: {} },
    ]);

    await distillCommand(['--dry-run']);

    expect(storeMock.getAllEvents).toHaveBeenCalledOnce();
    expect(storeMock.getEventsBySprint).not.toHaveBeenCalled();
  });
});
