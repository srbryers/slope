import { describe, it, expect } from 'vitest';
import { SLOPE_REGISTRY, SLOPE_TYPES, MCP_TOOL_REGISTRY } from '../../src/mcp/registry.js';
import { SLOPE_MCP_TOOL_NAMES } from '../../src/mcp/index.js';

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

describe('MCP registry — metaphor entries', () => {
  it('includes saveCustomMetaphor', () => {
    const entry = SLOPE_REGISTRY.find(e => e.name === 'saveCustomMetaphor');
    expect(entry).toBeDefined();
    expect(entry!.module).toBe('core');
    expect(entry!.signature).toContain('MetaphorDefinition');
  });

  it('includes METAPHOR_SCHEMA', () => {
    const entry = SLOPE_REGISTRY.find(e => e.name === 'METAPHOR_SCHEMA');
    expect(entry).toBeDefined();
    expect(entry!.module).toBe('constants');
  });

  it('includes saveConfig', () => {
    const entry = SLOPE_REGISTRY.find(e => e.name === 'saveConfig');
    expect(entry).toBeDefined();
    expect(entry!.module).toBe('fs');
  });
});

describe('MCP_TOOL_REGISTRY', () => {
  it('matches SLOPE_MCP_TOOL_NAMES', () => {
    const registryNames = MCP_TOOL_REGISTRY.map(t => t.name).sort();
    const toolNames = [...SLOPE_MCP_TOOL_NAMES].sort();
    expect(registryNames).toEqual(toolNames);
  });

  it('every tool has a non-empty description', () => {
    for (const tool of MCP_TOOL_REGISTRY) {
      expect(tool.desc.length).toBeGreaterThan(0);
    }
  });

  it('every tool has a requiresStore boolean', () => {
    for (const tool of MCP_TOOL_REGISTRY) {
      expect(typeof tool.requiresStore).toBe('boolean');
    }
  });

  it('search and execute do not require store', () => {
    const search = MCP_TOOL_REGISTRY.find(t => t.name === 'search');
    const execute = MCP_TOOL_REGISTRY.find(t => t.name === 'execute');
    expect(search?.requiresStore).toBe(false);
    expect(execute?.requiresStore).toBe(false);
  });

  it('store tools require store', () => {
    const storeTools = MCP_TOOL_REGISTRY.filter(t =>
      (t.name.startsWith('testing_') && t.name !== 'testing_plan_status') ||
      ['session_status', 'acquire_claim', 'check_conflicts', 'store_status'].includes(t.name)
    );
    expect(storeTools.length).toBeGreaterThan(0);
    for (const tool of storeTools) {
      expect(tool.requiresStore).toBe(true);
    }
  });

  it('testing_plan_status does not require store', () => {
    const tool = MCP_TOOL_REGISTRY.find(t => t.name === 'testing_plan_status');
    expect(tool).toBeDefined();
    expect(tool!.requiresStore).toBe(false);
  });

  it('params have name, type, and desc', () => {
    for (const tool of MCP_TOOL_REGISTRY) {
      for (const param of tool.params) {
        expect(param.name.length).toBeGreaterThan(0);
        expect(param.type.length).toBeGreaterThan(0);
        expect(param.desc.length).toBeGreaterThan(0);
      }
    }
  });

  it('publishes canonical sprint selector contracts', () => {
    const acquire = MCP_TOOL_REGISTRY.find(tool => tool.name === 'acquire_claim');
    const conflicts = MCP_TOOL_REGISTRY.find(tool => tool.name === 'check_conflicts');
    const testing = MCP_TOOL_REGISTRY.find(tool => tool.name === 'testing_session_start');

    expect(acquire?.params.map(param => param.name)).toEqual([
      'sessionId',
      'target',
      'scope',
      'sprintNumber',
      'player',
    ]);
    expect(acquire?.params.find(param => param.name === 'sprintNumber')?.type).toBe('string | number');
    expect(conflicts?.params.find(param => param.name === 'sprintNumber')?.type).toBe('string | number');
    expect(testing?.params.find(param => param.name === 'sprint')?.type).toBe('string | number');

    expect(SLOPE_REGISTRY.find(entry => entry.name === 'acquire_claim')?.signature)
      .toContain('sprintNumber: SprintIdInput');
    expect(SLOPE_REGISTRY.find(entry => entry.name === 'check_conflicts')?.signature)
      .toContain('sprintNumber?: SprintIdInput');
    expect(SLOPE_REGISTRY.find(entry => entry.name === 'testing_session_start')?.signature)
      .toContain('sprint?: SprintIdInput');
    expect(SLOPE_REGISTRY.find(entry => entry.name === 'buildEscalationEvent')?.signature)
      .toContain('sprintNumber?: SprintIdInput');
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

describe('SLOPE_TYPES — canonical sprint identity', () => {
  it('distinguishes canonical output ids from transitional inputs', () => {
    expect(SLOPE_TYPES).toContain('type SprintId = string;');
    expect(SLOPE_TYPES).toContain('type SprintIdInput = string | number;');
    expect(SLOPE_TYPES).toContain('sprint_number: SprintIdInput');
    expect(SLOPE_TYPES).toContain('interface SprintClaim { id: string; sprint_number: SprintId;');
    expect(SLOPE_TYPES).toContain('interface SlopeEvent { id: string;');
    expect(SLOPE_TYPES).toContain('sprint_number?: SprintId;');
    expect(SLOPE_TYPES).toContain('sprints_hit: SprintId[];');
    expect(SLOPE_TYPES).toContain('interface TournamentSprintEntry { sprintNumber: SprintId;');
    expect(SLOPE_TYPES).toContain('bestSprint: { sprintNumber: SprintId;');
    expect(SLOPE_TYPES).toContain('id_key?: string');
    expect(SLOPE_TYPES).toContain('interface CriticalPathResult { path: string[];');
  });
});
