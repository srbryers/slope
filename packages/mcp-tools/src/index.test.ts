import { describe, it, expect } from 'vitest';
import { createSlopeToolsServer, SLOPE_MCP_TOOL_NAMES } from './index.js';
import { computeHandicapCard, buildScorecard } from '@slope-dev/core';

describe('createSlopeToolsServer', () => {
  it('returns an MCP server instance', () => {
    const server = createSlopeToolsServer();
    expect(server).toBeDefined();
    expect(typeof server).toBe('object');
  });

  it('exposes 10 tools', () => {
    expect(SLOPE_MCP_TOOL_NAMES).toHaveLength(10);
    expect(SLOPE_MCP_TOOL_NAMES).toContain('compute_handicap');
    expect(SLOPE_MCP_TOOL_NAMES).toContain('build_scorecard');
    expect(SLOPE_MCP_TOOL_NAMES).toContain('format_briefing');
  });
});

describe('core integration', () => {
  it('compute_handicap: computeHandicapCard with empty scorecards returns valid shape', () => {
    const result = computeHandicapCard([]);
    expect(result).toBeDefined();
    expect(result.all_time).toBeDefined();
    expect(result.last_5).toBeDefined();
    expect(result.last_10).toBeDefined();
    expect(typeof result.all_time.handicap).toBe('number');
  });

  it('build_scorecard: buildScorecard with minimal input returns valid scorecard', () => {
    const result = buildScorecard({
      sprint_number: 1,
      theme: 'Test',
      par: 3,
      slope: 0,
      date: '2026-02-21',
      shots: [
        { ticket_key: 'S1-1', title: 'One', club: 'wedge', result: 'in_the_hole', hazards: [] },
      ],
    });
    expect(result).toBeDefined();
    expect(result.sprint_number).toBe(1);
    expect(result.score).toBeDefined();
    expect(result.score_label).toBeDefined();
    expect(Array.isArray(result.shots)).toBe(true);
  });
});
