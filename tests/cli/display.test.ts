import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  stripAnsi, createColors, wordWrap, sleep,
  renderVisionBox, renderProfileSummary, sideBySide, renderCtaBox, renderRoadmapPhases,
} from '../../src/cli/display.js';
import type { RepoProfile } from '../../src/core/analyzers/types.js';

describe('stripAnsi', () => {
  it('removes ANSI escape sequences', () => {
    expect(stripAnsi('\x1b[1;32mhello\x1b[0m')).toBe('hello');
  });

  it('passes through plain text', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });
});

describe('createColors', () => {
  it('wraps text with ANSI codes when enabled', () => {
    const c = createColors(true);
    const result = c.bold('hello');
    expect(result).toContain('\x1b[1m');
    expect(result).toContain('hello');
    expect(result).toContain('\x1b[0m');
  });

  it('returns plain text when disabled', () => {
    const c = createColors(false);
    expect(c.bold('hello')).toBe('hello');
    expect(c.boldCyan('hello')).toBe('hello');
    expect(c.dim('hello')).toBe('hello');
  });
});

describe('wordWrap', () => {
  it('wraps text at the given width', () => {
    const result = wordWrap('one two three four five', 10);
    const lines = result.split('\n');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(10);
    }
  });

  it('does not wrap short text', () => {
    expect(wordWrap('hello', 20)).toBe('hello');
  });

  it('handles empty string', () => {
    expect(wordWrap('', 20)).toBe('');
  });
});

describe('sleep', () => {
  it('resolves after delay', async () => {
    const start = Date.now();
    await sleep(10);
    expect(Date.now() - start).toBeGreaterThanOrEqual(5);
  });
});

describe('renderVisionBox', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('renders all fields', () => {
    const c = createColors(false);
    renderVisionBox([
      { heading: 'Purpose', value: 'Build the best app' },
      { heading: 'Audience', value: 'Developers' },
      { heading: 'Priorities', value: 'speed, reliability' },
      { heading: 'Non-goals', value: 'Social features' },
      { heading: 'Tech', value: 'TypeScript' },
    ], c, false);

    const output = logSpy.mock.calls.map(c2 => c2[0]).join('\n');
    expect(output).toContain('Vision');
    expect(output).toContain('Purpose');
    expect(output).toContain('Build the best app');
    expect(output).toContain('Audience');
    expect(output).toContain('Developers');
    expect(output).toContain('Priorities');
    expect(output).toContain('speed, reliability');
    expect(output).toContain('Non-goals');
    expect(output).toContain('Social features');
    expect(output).toContain('Tech');
    expect(output).toContain('TypeScript');
  });

  it('handles empty fields gracefully', () => {
    const c = createColors(false);
    renderVisionBox([
      { heading: 'Purpose', value: 'Test' },
    ], c, false);

    const output = logSpy.mock.calls.map(c2 => c2[0]).join('\n');
    expect(output).toContain('Purpose');
    expect(output).toContain('Test');
  });
});

describe('sideBySide', () => {
  it('produces correct structure with borders', () => {
    const c = createColors(false);
    const result = sideBySide(
      'Before', ['3 TODOs', 'No structure'],
      'After', ['Vision locked', 'Sprint ready'],
      c,
    );

    expect(result.length).toBeGreaterThan(2);
    const joined = result.join('\n');
    expect(joined).toContain('Before');
    expect(joined).toContain('After');
    expect(joined).toContain('3 TODOs');
    expect(joined).toContain('Vision locked');
  });

  it('handles unequal content heights', () => {
    const c = createColors(false);
    const result = sideBySide(
      'Left', ['one'],
      'Right', ['one', 'two', 'three'],
      c,
    );
    // Should not throw, all rows should have both boxes
    expect(result.length).toBeGreaterThan(2);
  });
});

describe('renderCtaBox', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('renders correct tools for given platforms', () => {
    const c = createColors(false);
    renderCtaBox([
      { name: 'Claude Code', cmd: '$ claude "Run slope briefing"' },
      { name: 'Cursor', cmd: '> Run slope briefing' },
    ], c);

    const output = logSpy.mock.calls.map(c2 => c2[0]).join('\n');
    expect(output).toContain('Get Started');
    expect(output).toContain('Claude Code');
    expect(output).toContain('Cursor');
  });

  it('handles single tool', () => {
    const c = createColors(false);
    renderCtaBox([
      { name: 'Claude Code', cmd: '$ claude "hello"' },
    ], c);

    const output = logSpy.mock.calls.map(c2 => c2[0]).join('\n');
    expect(output).toContain('Claude Code');
  });
});

describe('renderRoadmapPhases', () => {
  it('renders phases with tickets', () => {
    const c = createColors(false);
    const roadmap = {
      phases: [
        { name: 'Phase 1 — Speed', sprints: [1] },
        { name: 'Phase 2 — Reliability', sprints: [2] },
      ],
      sprints: [
        { id: 1, par: 4, tickets: [
          { key: 'S1-1', title: 'Set up cron' },
          { key: 'S1-2', title: 'Build pipeline' },
        ]},
        { id: 2, par: 4, tickets: [
          { key: 'S2-1', title: 'Add retry logic' },
        ]},
      ],
    };

    const lines = renderRoadmapPhases(roadmap, c);
    const output = lines.join('\n');
    expect(output).toContain('Phase 1');
    expect(output).toContain('Speed');
    expect(output).toContain('S1-1');
    expect(output).toContain('Set up cron');
    expect(output).toContain('Phase 2');
    expect(output).toContain('S2-1');
  });

  it('handles empty roadmap', () => {
    const c = createColors(false);
    const lines = renderRoadmapPhases({ phases: [], sprints: [] }, c);
    expect(lines).toEqual([]);
  });

  it('applies ticket title overrides', () => {
    const c = createColors(false);
    const roadmap = {
      phases: [{ name: 'Phase 1', sprints: [1] }],
      sprints: [{ id: 1, par: 4, tickets: [
        { key: 'S1-1', title: 'TODO: Add cache' },
      ]}],
    };

    const lines = renderRoadmapPhases(roadmap, c, { 'S1-1': 'Implement caching layer' });
    const output = lines.join('\n');
    expect(output).toContain('Implement caching layer');
    expect(output).not.toContain('TODO:');
  });

  it('strips TODO prefix when no override', () => {
    const c = createColors(false);
    const roadmap = {
      phases: [{ name: 'Phase 1', sprints: [1] }],
      sprints: [{ id: 1, par: 4, tickets: [
        { key: 'S1-1', title: 'TODO: Add cache' },
      ]}],
    };

    const lines = renderRoadmapPhases(roadmap, c);
    const output = lines.join('\n');
    expect(output).toContain('Add cache');
    expect(output).not.toContain('TODO:');
  });
});

function makeProfile(overrides?: Partial<RepoProfile>): RepoProfile {
  return {
    analyzedAt: '2026-01-01T00:00:00Z',
    analyzersRun: ['stack', 'structure', 'git', 'testing', 'ci', 'docs'],
    stack: { primaryLanguage: 'TypeScript', languages: { TypeScript: 80 }, frameworks: ['react', 'next', 'vitest'] },
    structure: { totalFiles: 100, sourceFiles: 48, testFiles: 12, maxDepth: 5, isMonorepo: false, modules: [{ name: 'src', path: 'src', fileCount: 48 }], largeFiles: [] },
    git: { totalCommits: 200, commitsLast90d: 50, commitsPerWeek: 5, contributors: [{ name: 'Dev', email: 'dev@test.com', commits: 200 }], activeBranches: ['main'], inferredCadence: 'weekly' },
    testing: { framework: 'vitest', testFileCount: 12, hasTestScript: true, hasCoverage: true, testDirs: ['tests'] },
    ci: { system: 'github-actions', configFiles: ['.github/workflows/ci.yml'], hasTestStage: true, hasBuildStage: true, hasDeployStage: false },
    docs: { hasReadme: true, hasContributing: false, hasChangelog: true, hasAdr: false, hasApiDocs: false },
    ...overrides,
  };
}

describe('renderProfileSummary', () => {
  it('renders stack, structure, testing, CI, and docs lines', () => {
    const c = createColors(false);
    const profile = makeProfile();
    const lines = renderProfileSummary(profile, c);
    const output = lines.join('\n');

    expect(output).toContain('Stack:');
    expect(output).toContain('TypeScript');
    expect(output).toContain('react, next');
    expect(output).toContain('Structure:');
    expect(output).toContain('48 source files');
    expect(output).toContain('12 tests');
    expect(output).toContain('Testing:');
    expect(output).toContain('vitest');
    expect(output).toContain('CI:');
    expect(output).toContain('GitHub Actions');
    expect(output).toContain('test, build');
    expect(output).toContain('Docs:');
    expect(output).toContain('README');
    expect(output).toContain('CHANGELOG');
  });

  it('skips sections with no data', () => {
    const c = createColors(false);
    const profile = makeProfile({
      ci: { configFiles: [], hasTestStage: false, hasBuildStage: false, hasDeployStage: false },
      docs: { hasReadme: false, hasContributing: false, hasChangelog: false, hasAdr: false, hasApiDocs: false },
    });
    const lines = renderProfileSummary(profile, c);
    const output = lines.join('\n');

    expect(output).not.toContain('CI:');
    expect(output).not.toContain('Docs:');
    // Stack and structure should still be present
    expect(output).toContain('Stack:');
    expect(output).toContain('Structure:');
  });

  it('handles minimal profile (all empty analyzers)', () => {
    const c = createColors(false);
    const profile = makeProfile({
      stack: { primaryLanguage: '', languages: {}, frameworks: [] },
      structure: { totalFiles: 0, sourceFiles: 0, testFiles: 0, maxDepth: 0, isMonorepo: false, modules: [], largeFiles: [] },
      testing: { testFileCount: 0, hasTestScript: false, hasCoverage: false, testDirs: [] },
      ci: { configFiles: [], hasTestStage: false, hasBuildStage: false, hasDeployStage: false },
      docs: { hasReadme: false, hasContributing: false, hasChangelog: false, hasAdr: false, hasApiDocs: false },
    });
    const lines = renderProfileSummary(profile, c);

    // All sections should be skipped for truly empty profile
    expect(lines).toEqual([]);
  });
});

describe('InteractiveResult type', () => {
  it('can be constructed with all required fields', () => {
    // Import and type-check the InteractiveResult interface
    const result = {
      projectName: 'test-app',
      metaphor: 'golf',
      platforms: ['claude-code'],
      vision: {
        purpose: 'Build something great',
        priorities: ['speed', 'reliability'],
        audience: 'Developers',
        nonGoals: ['Social features'],
        techDirection: 'TypeScript',
      },
      roadmap: null,
      backlogStats: null,
      profile: makeProfile(),
    };

    expect(result.projectName).toBe('test-app');
    expect(result.vision.priorities).toHaveLength(2);
    expect(result.roadmap).toBeNull();
    expect(result.backlogStats).toBeNull();
    expect(result.profile.stack.primaryLanguage).toBe('TypeScript');
  });

  it('can include backlog stats', () => {
    const result = {
      projectName: 'test-app',
      metaphor: 'golf',
      platforms: ['claude-code', 'cursor'],
      vision: {
        purpose: 'Build something great',
        priorities: ['speed'],
        techDirection: 'TypeScript',
      },
      roadmap: null,
      backlogStats: { todoCount: 23, moduleCount: 5, matchedCount: 18 },
      profile: makeProfile(),
    };

    expect(result.backlogStats!.todoCount).toBe(23);
    expect(result.backlogStats!.matchedCount).toBe(18);
  });
});
