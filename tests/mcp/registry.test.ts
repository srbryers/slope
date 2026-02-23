import { describe, it, expect } from 'vitest';
import { SLOPE_REGISTRY, SLOPE_TYPES } from '../../src/mcp/registry.js';

describe('MCP registry — PR signal entries', () => {
  it('includes parsePRJson', () => {
    const entry = SLOPE_REGISTRY.find(e => e.name === 'parsePRJson');
    expect(entry).toBeDefined();
    expect(entry!.module).toBe('core');
    expect(entry!.signature).toContain('PRSignal');
  });

  it('includes buildGhCommand', () => {
    const entry = SLOPE_REGISTRY.find(e => e.name === 'buildGhCommand');
    expect(entry).toBeDefined();
    expect(entry!.signature).toContain('prNumber');
  });

  it('includes mergePRChecksWithCI', () => {
    const entry = SLOPE_REGISTRY.find(e => e.name === 'mergePRChecksWithCI');
    expect(entry).toBeDefined();
    expect(entry!.signature).toContain('CISignal');
  });

  it('includes emptyPRSignal', () => {
    const entry = SLOPE_REGISTRY.find(e => e.name === 'emptyPRSignal');
    expect(entry).toBeDefined();
    expect(entry!.signature).toContain('PRSignal');
  });
});

describe('SLOPE_TYPES — PR signal types', () => {
  it('includes PRPlatform type', () => {
    expect(SLOPE_TYPES).toContain('PRPlatform');
  });

  it('includes PRReviewDecision type', () => {
    expect(SLOPE_TYPES).toContain('PRReviewDecision');
  });

  it('includes PRSignal interface', () => {
    expect(SLOPE_TYPES).toContain('interface PRSignal');
  });

  it('includes CombinedSignals with pr field', () => {
    expect(SLOPE_TYPES).toContain('CombinedSignals');
    expect(SLOPE_TYPES).toContain('pr?: PRSignal');
  });
});
