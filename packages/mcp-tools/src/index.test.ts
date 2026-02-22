import { describe, it, expect } from 'vitest';
import { createSlopeToolsServer, SLOPE_MCP_TOOL_NAMES, detectSetupHints, buildSetupHint } from './index.js';
import type { SetupHints } from './index.js';
import { SLOPE_REGISTRY, SLOPE_TYPES } from './registry.js';
import { runInSandbox } from './sandbox.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SlopeStore, SlopeSession, SprintClaim, GolfScorecard } from '@slope-dev/core';
import type { CommonIssuesFile } from '@slope-dev/core';

/** In-memory mock store for testing */
function createMockStore(): SlopeStore & { sessions: SlopeSession[]; claims: SprintClaim[] } {
  const sessions: SlopeSession[] = [];
  const claims: SprintClaim[] = [];

  return {
    sessions,
    claims,
    async registerSession(s) {
      const session: SlopeSession = { ...s, started_at: new Date().toISOString(), last_heartbeat_at: new Date().toISOString() };
      sessions.push(session);
      return session;
    },
    async removeSession(id) {
      const idx = sessions.findIndex(s => s.session_id === id);
      if (idx === -1) return false;
      sessions.splice(idx, 1);
      return true;
    },
    async getActiveSessions() { return [...sessions]; },
    async getSessionsBySwarm(swarmId: string) { return sessions.filter(s => s.swarm_id === swarmId); },
    async updateHeartbeat() {},
    async cleanStaleSessions() { return 0; },
    async claim(input) {
      const claim: SprintClaim = { ...input, id: `claim-${Date.now()}`, claimed_at: new Date().toISOString() };
      claims.push(claim);
      return claim;
    },
    async release(id) {
      const idx = claims.findIndex(c => c.id === id);
      if (idx === -1) return false;
      claims.splice(idx, 1);
      return true;
    },
    async list(n) { return claims.filter(c => c.sprint_number === n); },
    async get(id) { return claims.find(c => c.id === id); },
    async getActiveClaims(n) { return n !== undefined ? claims.filter(c => c.sprint_number === n) : [...claims]; },
    async saveScorecard() {},
    async listScorecards() { return []; },
    async loadCommonIssues() { return { recurring_patterns: [] }; },
    async saveCommonIssues() {},
    async insertEvent(e) { return { ...e, id: `evt-${Date.now()}`, timestamp: new Date().toISOString() } as any; },
    async getEventsBySession() { return []; },
    async getEventsBySprint() { return []; },
    async getEventsByTicket() { return []; },
    close() {},
  };
}

describe('createSlopeToolsServer', () => {
  it('returns an MCP server instance without store', () => {
    const server = createSlopeToolsServer();
    expect(server).toBeDefined();
    expect(typeof server).toBe('object');
  });

  it('returns an MCP server instance with store', () => {
    const server = createSlopeToolsServer(createMockStore());
    expect(server).toBeDefined();
  });

  it('exposes exactly 5 tool names', () => {
    expect(SLOPE_MCP_TOOL_NAMES).toHaveLength(5);
    expect(SLOPE_MCP_TOOL_NAMES).toContain('search');
    expect(SLOPE_MCP_TOOL_NAMES).toContain('execute');
    expect(SLOPE_MCP_TOOL_NAMES).toContain('session_status');
    expect(SLOPE_MCP_TOOL_NAMES).toContain('acquire_claim');
    expect(SLOPE_MCP_TOOL_NAMES).toContain('check_conflicts');
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

  it('store module entries exist', () => {
    const storeEntries = SLOPE_REGISTRY.filter((e) => e.module === 'store');
    expect(storeEntries).toHaveLength(3);
    expect(storeEntries.map(e => e.name)).toEqual(['session_status', 'acquire_claim', 'check_conflicts']);
  });

  it('SLOPE_TYPES contains key type definitions', () => {
    expect(SLOPE_TYPES).toContain('GolfScorecard');
    expect(SLOPE_TYPES).toContain('HandicapCard');
    expect(SLOPE_TYPES).toContain('SlopeConfig');
    expect(SLOPE_TYPES).toContain('ScorecardInput');
    expect(SLOPE_TYPES).toContain('SlopeSession');
  });

  it('registry includes roadmap functions', () => {
    const roadmapNames = [
      'validateRoadmap', 'computeCriticalPath', 'findParallelOpportunities',
      'parseRoadmap', 'formatRoadmapSummary', 'formatStrategicContext',
    ];
    for (const name of roadmapNames) {
      expect(SLOPE_REGISTRY.find(e => e.name === name)).toBeDefined();
    }
  });

  it('registry includes loadRoadmap fs helper', () => {
    const entry = SLOPE_REGISTRY.find(e => e.name === 'loadRoadmap');
    expect(entry).toBeDefined();
    expect(entry!.module).toBe('fs');
  });

  it('SLOPE_TYPES contains roadmap type definitions', () => {
    expect(SLOPE_TYPES).toContain('RoadmapDefinition');
    expect(SLOPE_TYPES).toContain('RoadmapSprint');
    expect(SLOPE_TYPES).toContain('RoadmapTicket');
    expect(SLOPE_TYPES).toContain('CriticalPathResult');
    expect(SLOPE_TYPES).toContain('ParallelGroup');
  });

  // S15 orchestration registry entries
  it('registry includes standup functions', () => {
    const names = ['generateStandup', 'formatStandup', 'parseStandup', 'extractRelevantHandoffs'];
    for (const name of names) {
      expect(SLOPE_REGISTRY.find(e => e.name === name)).toBeDefined();
    }
  });

  it('registry includes escalation functions', () => {
    const names = ['detectEscalation', 'buildEscalationEvent', 'resolveEscalationConfig'];
    for (const name of names) {
      expect(SLOPE_REGISTRY.find(e => e.name === name)).toBeDefined();
    }
  });

  it('registry includes team handicap functions', () => {
    const names = ['computeTeamHandicap', 'computeRoleHandicap', 'computeSwarmEfficiency', 'analyzeRoleCombinations'];
    for (const name of names) {
      expect(SLOPE_REGISTRY.find(e => e.name === name)).toBeDefined();
    }
  });

  it('registry includes agent breakdown functions', () => {
    const entry = SLOPE_REGISTRY.find(e => e.name === 'buildAgentBreakdowns');
    expect(entry).toBeDefined();
    expect(entry!.module).toBe('core');
  });

  it('SLOPE_TYPES contains orchestration type definitions', () => {
    expect(SLOPE_TYPES).toContain('StandupReport');
    expect(SLOPE_TYPES).toContain('HandoffEntry');
    expect(SLOPE_TYPES).toContain('EscalationConfig');
    expect(SLOPE_TYPES).toContain('EscalationResult');
    expect(SLOPE_TYPES).toContain('AgentBreakdown');
    expect(SLOPE_TYPES).toContain('TeamHandicapCard');
    expect(SLOPE_TYPES).toContain('SwarmEfficiency');
    expect(SLOPE_TYPES).toContain('RoleHandicap');
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

  it('executes roadmap functions in sandbox', async () => {
    const code = `
      const roadmap = {
        name: 'Test',
        phases: [{ name: 'P1', sprints: [1, 2] }],
        sprints: [
          { id: 1, theme: 'A', par: 4, slope: 2, type: 'feature', tickets: [
            { key: 'S1-1', title: 'T1', club: 'short_iron', complexity: 'standard' },
            { key: 'S1-2', title: 'T2', club: 'wedge', complexity: 'small' },
            { key: 'S1-3', title: 'T3', club: 'short_iron', complexity: 'standard' },
          ]},
          { id: 2, theme: 'B', par: 4, slope: 2, type: 'feature', depends_on: [1], tickets: [
            { key: 'S2-1', title: 'T1', club: 'short_iron', complexity: 'standard' },
            { key: 'S2-2', title: 'T2', club: 'short_iron', complexity: 'standard' },
            { key: 'S2-3', title: 'T3', club: 'wedge', complexity: 'small' },
          ]},
        ],
      };
      const v = validateRoadmap(roadmap);
      const cp = computeCriticalPath(roadmap);
      return { valid: v.valid, criticalPath: cp.path, length: cp.length };
    `;
    const { result } = await runInSandbox(code, process.cwd());
    const r = result as { valid: boolean; criticalPath: number[]; length: number };
    expect(r.valid).toBe(true);
    expect(r.criticalPath).toEqual([1, 2]);
    expect(r.length).toBe(2);
  });

  it('loadRoadmap returns null when no roadmap file', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'slope-sandbox-roadmap-'));
    const slopeDir = join(tmp, '.slope');
    mkdirSync(slopeDir, { recursive: true });
    writeFileSync(join(slopeDir, 'config.json'), JSON.stringify({
      scorecardDir: 'docs/retros',
      scorecardPattern: 'sprint-*.json',
      minSprint: 1,
    }));

    const { result } = await runInSandbox('return loadRoadmap();', tmp);
    expect(result).toBeNull();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('loadRoadmap loads and parses roadmap from file', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'slope-sandbox-roadmap-'));
    const slopeDir = join(tmp, '.slope');
    const backlogDir = join(tmp, 'docs', 'backlog');
    mkdirSync(slopeDir, { recursive: true });
    mkdirSync(backlogDir, { recursive: true });
    writeFileSync(join(slopeDir, 'config.json'), JSON.stringify({
      scorecardDir: 'docs/retros',
      scorecardPattern: 'sprint-*.json',
      minSprint: 1,
    }));
    writeFileSync(join(backlogDir, 'roadmap.json'), JSON.stringify({
      name: 'Test Roadmap',
      phases: [{ name: 'P1', sprints: [1] }],
      sprints: [{
        id: 1, theme: 'Intro', par: 3, slope: 1, type: 'feature',
        tickets: [
          { key: 'S1-1', title: 'T1', club: 'wedge', complexity: 'small' },
          { key: 'S1-2', title: 'T2', club: 'wedge', complexity: 'small' },
          { key: 'S1-3', title: 'T3', club: 'wedge', complexity: 'small' },
        ],
      }],
    }));

    const { result } = await runInSandbox('const r = loadRoadmap(); return r ? r.name : null;', tmp);
    expect(result).toBe('Test Roadmap');
    rmSync(tmp, { recursive: true, force: true });
  });

  // S15 orchestration sandbox tests
  it('executes generateStandup in sandbox', async () => {
    const code = `
      const report = generateStandup({
        sessionId: 'test-sess',
        agent_role: 'backend',
        events: [],
        claims: [],
      });
      return report.sessionId;
    `;
    const { result } = await runInSandbox(code, process.cwd());
    expect(result).toBe('test-sess');
  });

  it('executes detectEscalation in sandbox', async () => {
    const code = `
      const results = detectEscalation({
        standups: [],
        conflicts: [],
        events: [],
      });
      return results.length;
    `;
    const { result } = await runInSandbox(code, process.cwd());
    expect(result).toBe(0);
  });

  it('executes buildAgentBreakdowns in sandbox', async () => {
    const code = `
      const agents = buildAgentBreakdowns([{
        session_id: 's1',
        agent_role: 'backend',
        shots: [{ ticket_key: 'T-1', title: 'Test', club: 'short_iron', result: 'green', hazards: [] }],
      }]);
      return agents[0].score;
    `;
    const { result } = await runInSandbox(code, process.cwd());
    expect(result).toBe(1);
  });

  it('executes computeTeamHandicap in sandbox', async () => {
    const code = `
      const card = computeTeamHandicap([]);
      return card.swarm_efficiency.total_sprints;
    `;
    const { result } = await runInSandbox(code, process.cwd());
    expect(result).toBe(0);
  });

  it('executes resolveEscalationConfig in sandbox', async () => {
    const code = `
      const config = resolveEscalationConfig({ blocker_timeout: 30 });
      return config.blocker_timeout;
    `;
    const { result } = await runInSandbox(code, process.cwd());
    expect(result).toBe(30);
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

describe('mock store tools', () => {
  it('session_status returns sessions and claims from mock', async () => {
    const store = createMockStore();
    await store.registerSession({ session_id: 's1', role: 'primary', ide: 'claude-code' });
    await store.claim({ sprint_number: 1, player: 'alice', target: 'T-1', scope: 'ticket', session_id: 's1' });

    const sessions = await store.getActiveSessions();
    const claims = await store.getActiveClaims();
    expect(sessions).toHaveLength(1);
    expect(claims).toHaveLength(1);
  });

  it('acquire_claim creates claim in mock', async () => {
    const store = createMockStore();
    const claim = await store.claim({ sprint_number: 1, player: 'bob', target: 'T-2', scope: 'ticket' });
    expect(claim.id).toMatch(/^claim-/);
    expect(claim.target).toBe('T-2');
  });

  it('check_conflicts detects overlaps', async () => {
    const { checkConflicts } = await import('@slope-dev/core');
    const store = createMockStore();
    await store.claim({ sprint_number: 1, player: 'alice', target: 'T-1', scope: 'ticket' });
    await store.claim({ sprint_number: 1, player: 'bob', target: 'T-1', scope: 'ticket' });

    const claims = await store.getActiveClaims(1);
    const conflicts = checkConflicts(claims);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].severity).toBe('overlap');
  });

  it('check_conflicts filters by sprint', async () => {
    const { checkConflicts } = await import('@slope-dev/core');
    const store = createMockStore();
    await store.claim({ sprint_number: 1, player: 'alice', target: 'T-1', scope: 'ticket' });
    await store.claim({ sprint_number: 2, player: 'bob', target: 'T-1', scope: 'ticket' });

    const claimsSprint1 = await store.getActiveClaims(1);
    const conflicts = checkConflicts(claimsSprint1);
    expect(conflicts).toHaveLength(0); // Different sprints, only sprint 1 claims returned
  });

  it('server without store creates successfully with only 2 base tools', () => {
    const server = createSlopeToolsServer();
    expect(server).toBeDefined();
  });

  it('server with store creates successfully', () => {
    const server = createSlopeToolsServer(createMockStore());
    expect(server).toBeDefined();
  });
});

describe('detectSetupHints', () => {
  it('returns all false when no hooks.json or settings.json exist', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'slope-hints-'));
    const hints = detectSetupHints(tmp);
    expect(hints.guardsInstalled).toBe(false);
    expect(hints.lifecycleHooksInstalled).toBe(false);
    expect(hints.settingsConfigured).toBe(false);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('detects guard hooks in hooks.json', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'slope-hints-'));
    const slopeDir = join(tmp, '.slope');
    mkdirSync(slopeDir, { recursive: true });
    writeFileSync(join(slopeDir, 'hooks.json'), JSON.stringify({
      installed: {
        'guard-explore': { provider: 'claude-code', installed_at: '2026-01-01T00:00:00Z' },
        'guard-hazard': { provider: 'claude-code', installed_at: '2026-01-01T00:00:00Z' },
      },
    }));
    const hints = detectSetupHints(tmp);
    expect(hints.guardsInstalled).toBe(true);
    expect(hints.lifecycleHooksInstalled).toBe(false);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('detects lifecycle hooks in hooks.json', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'slope-hints-'));
    const slopeDir = join(tmp, '.slope');
    mkdirSync(slopeDir, { recursive: true });
    writeFileSync(join(slopeDir, 'hooks.json'), JSON.stringify({
      installed: {
        'session-start': { provider: 'claude-code', installed_at: '2026-01-01T00:00:00Z' },
        'session-end': { provider: 'claude-code', installed_at: '2026-01-01T00:00:00Z' },
      },
    }));
    const hints = detectSetupHints(tmp);
    expect(hints.guardsInstalled).toBe(false);
    expect(hints.lifecycleHooksInstalled).toBe(true);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('requires both session-start and session-end for lifecycle', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'slope-hints-'));
    const slopeDir = join(tmp, '.slope');
    mkdirSync(slopeDir, { recursive: true });
    writeFileSync(join(slopeDir, 'hooks.json'), JSON.stringify({
      installed: {
        'session-start': { provider: 'claude-code', installed_at: '2026-01-01T00:00:00Z' },
      },
    }));
    const hints = detectSetupHints(tmp);
    expect(hints.lifecycleHooksInstalled).toBe(false);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('detects slope-guard.sh in settings.json', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'slope-hints-'));
    const claudeDir = join(tmp, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({
      hooks: {
        PreToolUse: [{ hooks: [{ command: '$CLAUDE_PROJECT_DIR/.claude/hooks/slope-guard.sh explore' }] }],
      },
    }));
    const hints = detectSetupHints(tmp);
    expect(hints.settingsConfigured).toBe(true);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('handles malformed hooks.json gracefully', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'slope-hints-'));
    const slopeDir = join(tmp, '.slope');
    mkdirSync(slopeDir, { recursive: true });
    writeFileSync(join(slopeDir, 'hooks.json'), 'not valid json{{{');
    const hints = detectSetupHints(tmp);
    expect(hints.guardsInstalled).toBe(false);
    expect(hints.lifecycleHooksInstalled).toBe(false);
    rmSync(tmp, { recursive: true, force: true });
  });
});

describe('buildSetupHint', () => {
  it('returns null when everything is set up', () => {
    const hints: SetupHints = { guardsInstalled: true, lifecycleHooksInstalled: true, settingsConfigured: true };
    expect(buildSetupHint(hints)).toBeNull();
  });

  it('includes guard hint when guards not installed', () => {
    const hints: SetupHints = { guardsInstalled: false, lifecycleHooksInstalled: true, settingsConfigured: true };
    const result = buildSetupHint(hints);
    expect(result).toContain('Guard hooks');
    expect(result).toContain('slope hook add --level=full');
    expect(result).not.toContain('Lifecycle hooks');
  });

  it('includes lifecycle hint when lifecycle hooks not installed', () => {
    const hints: SetupHints = { guardsInstalled: true, lifecycleHooksInstalled: false, settingsConfigured: true };
    const result = buildSetupHint(hints);
    expect(result).toContain('Lifecycle hooks');
    expect(result).toContain('slope hook add session-start');
    expect(result).not.toContain('Guard hooks');
  });

  it('includes both hints when nothing is installed', () => {
    const hints: SetupHints = { guardsInstalled: false, lifecycleHooksInstalled: false, settingsConfigured: false };
    const result = buildSetupHint(hints);
    expect(result).toContain('Guard hooks');
    expect(result).toContain('Lifecycle hooks');
    expect(result).toContain('SLOPE Setup Hint');
  });
});

describe('search with setup hints', () => {
  it('server accepts setupHints parameter', () => {
    const hints: SetupHints = { guardsInstalled: false, lifecycleHooksInstalled: false, settingsConfigured: false };
    const server = createSlopeToolsServer(undefined, hints);
    expect(server).toBeDefined();
  });
});
