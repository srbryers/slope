import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildScorecard } from '../../src/core/builder.js';
import { formatSprintReview } from '../../src/core/formatter.js';
import { validateRoadmap } from '../../src/core/roadmap.js';
import { extractSprintReferences } from '../../src/core/analyzers/git.js';
import { runStalenessCheck, parseMapMetadata } from '../../src/cli/commands/map.js';
import { parseReviewArgs } from '../../src/cli/commands/review.js';
import type { RoadmapDefinition } from '../../src/core/roadmap.js';

// Regression cover for the issues verified fixed during the Phase 62 triage.
// Each fix landed in an earlier sprint without a test pinning the reported
// symptom, so they could regress silently. These lock the symptom, not the
// implementation.

describe('#684 — review shot accounting', () => {
  // Filed as: Fairway % and GIR % reported 0% (0/0) on unchanged scorecards,
  // so shots were not counted at all rather than scored as misses.
  const reported = {
    sprint_number: 220,
    par: 4,
    slope: 3,
    score: 4,
    score_label: 'par',
    shots: [
      { ticket_key: 'S220-1', club: 'long_iron', result: 'green', hazards: [{ type: 'rough', severity: 'minor', description: 'x' }], notes: 'a' },
      { ticket_key: 'S220-2', club: 'short_iron', result: 'green', hazards: [], notes: 'b' },
      { ticket_key: 'S220-3', club: 'wedge', result: 'green', hazards: [], notes: 'c' },
    ],
  };

  it('counts every shot when the scorecard carries no stats block', () => {
    const card = buildScorecard(reported as never);
    expect(card.stats.fairways_total).toBe(3);
    expect(card.stats.greens_total).toBe(3);
    expect(card.stats.fairways_hit).toBe(3);
    expect(card.stats.greens_in_regulation).toBe(3);
  });

  it('renders 100% rather than 0% (0/0) in the review', () => {
    const review = formatSprintReview(buildScorecard(reported as never));
    expect(review).toContain('| Fairway % | 100% (3/3) |');
    expect(review).toContain('| GIR % | 100% (3/3) |');
    expect(review).not.toContain('(0/0)');
  });
});

describe('#686 / #690 — shipped-commit detection on roadmap edits', () => {
  // Filed as: a planned or deferred sprint reported as shipped because its id
  // appeared in the text of commits about the roadmap itself.
  const roadmapOnlyCommits = [
    'docs(roadmap): defer the SaaS arc (S73–S80) — the wedding is the project',
    'Roadmap: reconcile with reality — S230–S239, Phase 32, SaaS deferred',
    'The backlog, honest (S240)',
    'chore: clear the debts — lint to zero, scorecards valid, roadmap unbroken',
    'docs(roadmap): S154 — embedded payout onboarding',
    'docs(roadmap): insert the Admin v2 flagship-first track (S107-S110)',
    'docs(roadmap): replan for the product epic + hygiene pass',
    'chore(roadmap): reconcile with reality — Phase 14, deferred SaaS arc',
    'docs: note the deferred SaaS arc S67–S80 in the phase README',
  ];

  it('does not read any roadmap or docs commit as shipping a sprint', () => {
    for (const subject of roadmapOnlyCommits) {
      expect(extractSprintReferences([subject]), subject).toEqual(new Set());
    }
  });

  it('still reads a real implementation commit as shipping', () => {
    expect(extractSprintReferences(['feat(S80): commercial handoff and product launch'])).toEqual(new Set([80]));
    expect(extractSprintReferences(['fix: correct the thing (S80-2)'])).toEqual(new Set([80]));
  });
});

describe('#688 — map staleness check', () => {
  // Filed as: `slope map --check` reported 64% drift immediately after
  // `slope map` wrote the file, because the two counted source files
  // differently — a gate its own documented fix could never clear.
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slope-map-'));
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    for (const name of ['a.ts', 'b.ts', 'c.ts']) {
      writeFileSync(join(tmpDir, 'src', name), 'export const x = 1;\n');
    }
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'downstream-project' }));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports OK against the count the map itself would write', () => {
    // The count the map records and the count --check recomputes must come
    // from one function, or the gate is permanently red.
    // `sprint` is required: runStalenessCheck feeds meta.sprint straight to
    // sprintIdKey, which throws on undefined.
    const mapContent = `---\nsource_files: "3"\nsprint: "1"\n---\n`;
    const results = runStalenessCheck(tmpDir, { scorecardDir: 'docs/retros' } as never, mapContent);
    const sourceCheck = results.find(r => r.label === 'Source files');
    expect(sourceCheck?.status).toBe('ok');
  });

  it('parses the metadata block it checks against', () => {
    expect(parseMapMetadata('---\nsource_files: "806"\ntest_files: "202"\n---\n').source_files).toBe('806');
  });
});

describe('#685 — roadmap sprint with no tickets key', () => {
  // Filed as: validate/show/status/review all died with "Cannot read
  // properties of undefined (reading 'map')", naming no sprint.
  const roadmap = {
    version: '1',
    name: 'Fixture',
    phases: [{ number: 1, name: 'P1', sprints: [1, 2] }],
    sprints: [
      { id: 1, theme: 'has tickets', par: 3, slope: 2, status: 'complete', depends_on: [], tickets: [] },
      { id: 2, theme: 'no tickets key', par: 3, slope: 2, status: 'complete', depends_on: [] },
    ],
  } as unknown as RoadmapDefinition;

  it('does not throw when a sprint omits tickets entirely', () => {
    expect(() => validateRoadmap(roadmap)).not.toThrow();
  });

  it('treats the missing key exactly like an explicit empty list', () => {
    const result = validateRoadmap(roadmap);
    const ticketWarnings = result.warnings.filter(w => w.message.includes('has 0 tickets'));
    // Sprint identity is a canonical string since S266.
    expect(ticketWarnings.map(w => String(w.sprint)).sort()).toEqual(['1', '2']);
  });

  it('leaves the caller\'s roadmap object untouched', () => {
    validateRoadmap(roadmap);
    expect((roadmap.sprints[1] as { tickets?: unknown }).tickets).toBeUndefined();
  });
});

describe('#689 — review sprint selector', () => {
  // Filed as: `--sprint N` and a bare `N` both failed with
  // "Failed to parse <cwd>/N"; only `--sprint=N` worked.
  it('accepts the equals form', () => {
    expect(parseReviewArgs(['--sprint=259']).sprintSelector).toBe('259');
  });

  it('accepts the space-separated form', () => {
    const parsed = parseReviewArgs(['--sprint', '259']);
    expect(parsed.sprintSelector).toBe('259');
    expect(parsed.path).toBeUndefined();
  });

  it('accepts a bare positional sprint number', () => {
    const parsed = parseReviewArgs(['259']);
    expect(parsed.sprintSelector).toBe('259');
    expect(parsed.path).toBeUndefined();
  });

  it('accepts an S-prefixed and a decimal sprint', () => {
    expect(parseReviewArgs(['S259']).sprintSelector).toBe('S259');
    expect(parseReviewArgs(['146.1']).sprintSelector).toBe('146.1');
  });

  it('still treats a path as a path', () => {
    const parsed = parseReviewArgs(['docs/retros/sprint-259.json']);
    expect(parsed.path).toBe('docs/retros/sprint-259.json');
    expect(parsed.sprintSelector).toBeUndefined();
  });

  it('carries the other flags through alongside a selector', () => {
    const parsed = parseReviewArgs(['--sprint', '259', '--plain', '--stdout', '--force']);
    expect(parsed).toMatchObject({
      sprintSelector: '259',
      mode: 'plain',
      outputPath: null,
      force: true,
      path: undefined,
    });
  });
});
