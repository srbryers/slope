import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { estimateComplexity } from '../../src/core/analyzers/complexity.js';
import { analyzeBacklog } from '../../src/core/analyzers/backlog.js';
import { generateConfig } from '../../src/core/generators/config.js';
import { generateFirstSprint } from '../../src/core/generators/first-sprint.js';
import { generateCommonIssues } from '../../src/core/generators/common-issues.js';
import type { RepoProfile } from '../../src/core/analyzers/types.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'slope-smart-init-'));
}

/** Set up a minimal git + node project in a temp dir */
function setupSampleRepo(dir: string): void {
  // Init git
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test User"', { cwd: dir, stdio: 'pipe' });

  // package.json
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'test-project',
    scripts: { test: 'vitest run' },
    devDependencies: { vitest: '^1.0.0' },
  }, null, 2));

  // Source files
  mkdirSync(join(dir, 'src/core'), { recursive: true });
  mkdirSync(join(dir, 'src/api'), { recursive: true });
  writeFileSync(join(dir, 'src/core/auth.ts'), [
    'export function login() {',
    '  // TODO: add rate limiting',
    '  // FIXME: validate input',
    '  return true;',
    '}',
  ].join('\n'));
  writeFileSync(join(dir, 'src/core/db.ts'), [
    '// HACK: workaround for connection pooling',
    '// HACK: temporary retry logic',
    '// HACK: manual query builder',
    'export const db = {};',
  ].join('\n'));
  writeFileSync(join(dir, 'src/api/routes.ts'), [
    '// TODO: add error handling',
    'export const routes = [];',
  ].join('\n'));

  // Test files
  mkdirSync(join(dir, 'tests'), { recursive: true });
  writeFileSync(join(dir, 'tests/auth.test.ts'), 'test("login", () => {})');

  // Git commit
  execSync('git add -A && git commit -m "initial"', { cwd: dir, stdio: 'pipe' });
}

describe('smart init pipeline', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    setupSampleRepo(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs the full analysis → generate pipeline', async () => {
    // Simulate the --smart pipeline without invoking the CLI directly
    const { runAnalyzers } = await import('../../src/core/analyzers/index.js');
    const profile = await runAnalyzers({ cwd: tmpDir });

    // Verify profile
    expect(profile.stack.primaryLanguage).toBe('TypeScript');
    expect(profile.structure.sourceFiles).toBeGreaterThanOrEqual(3);

    // Complexity
    const complexity = estimateComplexity(profile);
    expect(complexity.estimatedPar).toBeGreaterThanOrEqual(3);
    expect(typeof complexity.estimatedSlope).toBe('number');

    // Backlog
    const backlog = await analyzeBacklog(tmpDir);
    expect(backlog.todos.length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(backlog.todosByModule).length).toBeGreaterThanOrEqual(2);

    // Config
    const config = generateConfig(profile);
    expect(config.projectName).toBeTruthy();
    expect(config.metaphor).toBe('golf');

    // First sprint
    const sprint = generateFirstSprint(profile, complexity, backlog);
    expect(sprint.sprint.tickets.length).toBeGreaterThanOrEqual(1);
    expect(sprint.sprint.par).toBe(complexity.estimatedPar);
    expect(sprint.roadmap.phases).toHaveLength(1);

    // Common issues
    const issues = generateCommonIssues(profile, backlog);
    // Should have a code-quality pattern from HACK/FIXME cluster in core module
    const codePattern = issues.recurring_patterns.find(p => p.category === 'code-quality' && p.title.includes('core'));
    expect(codePattern).toBeDefined();
    expect(codePattern!.reported_by).toContain('analyzer');
  });

  it('generated config reflects repo analysis', async () => {
    const { runAnalyzers } = await import('../../src/core/analyzers/index.js');
    const profile = await runAnalyzers({ cwd: tmpDir });
    const config = generateConfig(profile);

    // Should infer from package.json / git
    expect(config.team).toBeDefined();
    expect(Object.keys(config.team).length).toBeGreaterThanOrEqual(1);
    expect(config.sprintCadence).toBeTruthy();
  });

  it('first sprint has appropriate tickets from backlog', async () => {
    const { runAnalyzers } = await import('../../src/core/analyzers/index.js');
    const profile = await runAnalyzers({ cwd: tmpDir });
    const complexity = estimateComplexity(profile);
    const backlog = await analyzeBacklog(tmpDir);
    const sprint = generateFirstSprint(profile, complexity, backlog);

    // Should have TODO-based tickets
    const todoTickets = sprint.sprint.tickets.filter(t => t.title.includes('TODO'));
    expect(todoTickets.length).toBeGreaterThanOrEqual(1);

    // All tickets should have valid keys
    for (const ticket of sprint.sprint.tickets) {
      expect(ticket.key).toMatch(/^S1-\d+$/);
      expect(ticket.club).toBeTruthy();
    }
  });

  it('common issues are seeded from backlog', async () => {
    const { runAnalyzers } = await import('../../src/core/analyzers/index.js');
    const profile = await runAnalyzers({ cwd: tmpDir });
    const backlog = await analyzeBacklog(tmpDir);
    const issues = generateCommonIssues(profile, backlog);

    // All patterns should have sequential IDs and analyzer attribution
    for (const pattern of issues.recurring_patterns) {
      expect(pattern.id).toBeGreaterThan(0);
      expect(pattern.reported_by).toContain('analyzer');
      expect(pattern.sprints_hit).toEqual([]);
    }
  });
});
