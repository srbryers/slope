import { describe, it, expect } from 'vitest';
import { SLOPE_REGISTRY, SLOPE_TYPES } from '../../src/mcp/registry.js';

describe('MCP registry — flows entries', () => {
  it('includes parseFlows', () => {
    const entry = SLOPE_REGISTRY.find(e => e.name === 'parseFlows');
    expect(entry).toBeDefined();
    expect(entry!.module).toBe('flows');
    expect(entry!.signature).toContain('FlowsFile');
  });

  it('includes validateFlows', () => {
    const entry = SLOPE_REGISTRY.find(e => e.name === 'validateFlows');
    expect(entry).toBeDefined();
    expect(entry!.module).toBe('flows');
    expect(entry!.signature).toContain('errors');
  });

  it('includes checkFlowStaleness', () => {
    const entry = SLOPE_REGISTRY.find(e => e.name === 'checkFlowStaleness');
    expect(entry).toBeDefined();
    expect(entry!.module).toBe('flows');
    expect(entry!.signature).toContain('stale');
  });

  it('includes loadFlows', () => {
    const entry = SLOPE_REGISTRY.find(e => e.name === 'loadFlows');
    expect(entry).toBeDefined();
    expect(entry!.module).toBe('flows');
    expect(entry!.signature).toContain('FlowsFile | null');
  });

  it('filters by flows module', () => {
    const flowEntries = SLOPE_REGISTRY.filter(e => e.module === 'flows');
    expect(flowEntries).toHaveLength(4);
  });
});

describe('SLOPE_TYPES — flow types', () => {
  it('includes FlowStep interface', () => {
    expect(SLOPE_TYPES).toContain('interface FlowStep');
  });

  it('includes FlowDefinition interface', () => {
    expect(SLOPE_TYPES).toContain('interface FlowDefinition');
  });

  it('includes FlowsFile interface', () => {
    expect(SLOPE_TYPES).toContain('interface FlowsFile');
  });

  it('FlowDefinition has expected fields', () => {
    expect(SLOPE_TYPES).toContain('last_verified_sha');
    expect(SLOPE_TYPES).toContain('entry_point');
    expect(SLOPE_TYPES).toContain('tags: string[]');
  });
});
