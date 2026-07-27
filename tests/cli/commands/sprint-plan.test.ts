import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { renderSprintPlan, sprintPlanCommand } from '../../../src/cli/commands/sprint-plan.js';
import type { RoadmapDefinition, RoadmapSprint, RoadmapTicket } from '../../../src/core/index.js';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SLOPE_BIN = resolve(REPO_ROOT, 'dist', 'cli', 'index.js');

function makeTicket(key: string, overrides: Partial<RoadmapTicket> = {}): RoadmapTicket {
  return {
    key,
    title: `Title for ${key}`,
    club: 'short_iron',
    complexity: 'standard',
    ...overrides,
  };
}

function makeSprint(id: number, overrides: Partial<RoadmapSprint> = {}): RoadmapSprint {
  return {
    id,
    theme: `Theme ${id}`,
    par: 4,
    slope: 1,
    type: 'feature',
    tickets: [makeTicket(`S${id}-1`), makeTicket(`S${id}-2`), makeTicket(`S${id}-3`)],
    ...overrides,
  };
}

function makeRoadmap(sprints: RoadmapSprint[]): RoadmapDefinition {
  return {
    name: 'Test',
    phases: [{ name: 'P1', sprints: sprints.map(s => s.id) }],
    sprints,
  };
}

describe('renderSprintPlan (GH #312)', () => {
  it('includes all required sections for a basic sprint', () => {
    const sprint = makeSprint(2, { theme: 'Build the foundation' });
    const roadmap = makeRoadmap([sprint]);
    const md = renderSprintPlan(sprint, roadmap, []);

    expect(md).toContain('# Sprint 2 Plan — Build the foundation');
    expect(md).toContain('## Objective');
    expect(md).toContain('## Tickets');
    expect(md).toContain('## Required gates');
    expect(md).toContain('## Required checks before commit');
    expect(md).toContain('## Hazards');
    expect(md).toContain('## Acceptance criteria');
    expect(md).toContain('## Suggested commit boundaries');
  });

  it('renders ticket table with key/title/club/complexity', () => {
    const sprint = makeSprint(2);
    const md = renderSprintPlan(sprint, makeRoadmap([sprint]), []);
    expect(md).toContain('| S2-1 | Title for S2-1 | short_iron | standard | — |');
  });

  it('shows depends_on column when ticket has intra-sprint deps', () => {
    const sprint = makeSprint(2, {
      tickets: [
        makeTicket('S2-1'),
        makeTicket('S2-2', { depends_on: ['S2-1'] }),
      ],
    });
    const md = renderSprintPlan(sprint, makeRoadmap([sprint]), []);
    expect(md).toMatch(/\| S2-2 \|.*\| S2-1 \|/);
  });

  it('includes Dependencies section when sprint has depends_on', () => {
    const completed = makeSprint(1);
    (completed as RoadmapSprint & { status?: string }).status = 'complete';
    const planned = makeSprint(2, { depends_on: [1] });
    const md = renderSprintPlan(planned, makeRoadmap([completed, planned]), []);
    expect(md).toContain('## Dependencies');
    expect(md).toContain('- S1 (complete)');
  });

  it('renders decimal inserted sprint ids without truncating', () => {
    const completed = makeSprint(114);
    (completed as RoadmapSprint & { status?: string }).status = 'complete';
    const inserted = makeSprint(114.5, {
      theme: 'Skill-aware briefing',
      depends_on: [114],
      tickets: [makeTicket('S114.5-1'), makeTicket('S114.5-2'), makeTicket('S114.5-3')],
    });
    const md = renderSprintPlan(inserted, makeRoadmap([completed, inserted]), []);

    expect(md).toContain('# Sprint 114.5 Plan — Skill-aware briefing');
    expect(md).toContain('| S114.5-1 | Title for S114.5-1 |');
    expect(md).toContain('- S114 (complete)');
  });

  it('renders the canonical key when a numeric mirror cannot preserve trailing zeroes', () => {
    const inserted = makeSprint(458.1, {
      id_key: '458.10',
      theme: 'Canonical identity',
      tickets: [
        makeTicket('S458.10-1'),
        makeTicket('S458.10-2'),
        makeTicket('S458.10-3'),
      ],
    });

    const md = renderSprintPlan(inserted, makeRoadmap([inserted]), []);

    expect(md).toContain('# Sprint 458.10 Plan — Canonical identity');
    expect(md).not.toContain('# Sprint 458.1 Plan');
  });

  it('marks pending dependencies', () => {
    const upstream = makeSprint(1); // no status
    const sprint = makeSprint(2, { depends_on: [1] });
    const md = renderSprintPlan(sprint, makeRoadmap([upstream, sprint]), []);
    expect(md).toContain('- S1 (pending)');
  });

  it('topologically orders tickets with deps', () => {
    const sprint = makeSprint(2, {
      tickets: [
        makeTicket('S2-2', { depends_on: ['S2-1'] }),
        makeTicket('S2-3', { depends_on: ['S2-2'] }),
        makeTicket('S2-1'),
      ],
    });
    const md = renderSprintPlan(sprint, makeRoadmap([sprint]), []);
    const orderSection = md.split('## Recommended order')[1].split('##')[0];
    const idx1 = orderSection.indexOf('S2-1');
    const idx2 = orderSection.indexOf('S2-2');
    const idx3 = orderSection.indexOf('S2-3');
    expect(idx1).toBeGreaterThanOrEqual(0);
    expect(idx1).toBeLessThan(idx2);
    expect(idx2).toBeLessThan(idx3);
  });

  it('falls back to insertion order when ticket deps form a cycle', () => {
    const sprint = makeSprint(2, {
      tickets: [
        makeTicket('S2-1', { depends_on: ['S2-2'] }),
        makeTicket('S2-2', { depends_on: ['S2-1'] }),
      ],
    });
    const md = renderSprintPlan(sprint, makeRoadmap([sprint]), []);
    expect(md).toContain('1. S2-1');
    expect(md).toContain('2. S2-2');
  });

  it('renders hazard lines when provided', () => {
    const sprint = makeSprint(2);
    const md = renderSprintPlan(sprint, makeRoadmap([sprint]), [
      '- [S70] rough: API shape assumption',
      '- bunker: src/migrations',
    ]);
    expect(md).toContain('- [S70] rough: API shape assumption');
    expect(md).toContain('- bunker: src/migrations');
    expect(md).not.toContain('No recent hazards on file');
  });

  it('shows no-hazards placeholder when list is empty', () => {
    const sprint = makeSprint(2);
    const md = renderSprintPlan(sprint, makeRoadmap([sprint]), []);
    expect(md).toContain('No recent hazards on file');
  });
});

function setupRepoForCli(): string {
  const dir = mkdtempSync(join(tmpdir(), 'slope-sprint-plan-'));
  mkdirSync(join(dir, '.slope'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'backlog'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'retros'), { recursive: true });
  writeFileSync(join(dir, '.slope', 'config.json'), JSON.stringify({
    roadmapPath: 'docs/backlog/roadmap.json',
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
  }));
  writeFileSync(join(dir, 'docs', 'backlog', 'roadmap.json'), JSON.stringify({
    name: 'Test',
    phases: [{ name: 'P1', sprints: [1] }],
    sprints: [{
      id: 1,
      theme: 'Test sprint',
      par: 4,
      slope: 1,
      type: 'feature',
      tickets: [
        { key: 'S1-1', title: 'first', club: 'wedge', complexity: 'small' },
      ],
    }],
  }));
  return dir;
}

describe('slope sprint plan --output (#341)', () => {
  beforeAll(() => {
    if (!existsSync(SLOPE_BIN)) {
      throw new Error(`dist not built — run \`pnpm build\` first. Expected ${SLOPE_BIN}`);
    }
  });

  it('honors absolute --output= path instead of stripping leading slash', () => {
    const cwd = setupRepoForCli();
    const outDir = mkdtempSync(join(tmpdir(), 'slope-sprint-plan-out-'));
    const absOut = join(outDir, 'plan.md');
    try {
      const out = execSync(`node ${SLOPE_BIN} sprint plan --sprint=1 --output=${absOut}`, {
        cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      // The plan must land at the absolute path, NOT a repo-relative tmp/
      expect(existsSync(absOut)).toBe(true);
      expect(existsSync(join(cwd, absOut.replace(/^\//, '')))).toBe(false);
      // Reported path is the resolved absolute target — no surprises
      expect(out).toContain(`Wrote ${absOut}`);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('still resolves relative --output= against cwd', () => {
    const cwd = setupRepoForCli();
    try {
      execSync(`node ${SLOPE_BIN} sprint plan --sprint=1 --output=custom/plan.md`, {
        cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      expect(existsSync(join(cwd, 'custom', 'plan.md'))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('selects 458.10 without aliasing 458.1', async () => {
    const cwd = setupRepoForCli();
    const originalCwd = process.cwd();
    try {
      writeFileSync(join(cwd, 'docs', 'backlog', 'roadmap.json'), JSON.stringify({
        name: 'Canonical selectors',
        phases: [{
          name: 'P1',
          sprints: [458.1, 458.1],
          sprint_keys: ['458.1', '458.10'],
        }],
        sprints: [
          {
            id: 458.1,
            id_key: '458.1',
            theme: 'First insert',
            par: 4,
            slope: 1,
            type: 'feature',
            tickets: [{ key: 'S458.1-1', title: 'first', club: 'wedge', complexity: 'small' }],
          },
          {
            id: 458.1,
            id_key: '458.10',
            theme: 'Tenth insert',
            par: 4,
            slope: 1,
            type: 'feature',
            tickets: [{ key: 'S458.10-1', title: 'tenth', club: 'wedge', complexity: 'small' }],
          },
        ],
      }));
      process.chdir(cwd);

      await sprintPlanCommand(['--sprint=458.10']);

      const canonicalPath = join(cwd, 'docs', 'backlog', 'sprint-458.10-plan.md');
      expect(existsSync(canonicalPath)).toBe(true);
      expect(readFileSync(canonicalPath, 'utf8')).toContain('# Sprint 458.10 Plan — Tenth insert');
      expect(readFileSync(canonicalPath, 'utf8')).not.toContain('First insert');
      expect(existsSync(join(cwd, 'docs', 'backlog', 'sprint-458.1-plan.md'))).toBe(false);
    } finally {
      process.chdir(originalCwd);
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
