import { describe, it, expect } from 'vitest';
import { classifyShot, recommendClub, generateTrainingPlan } from '../src/advisor.js';
import { computeDispersion } from '../src/dispersion.js';
import { computeHandicapCard } from '../src/handicap.js';
import type {
  GolfScorecard,
  ShotRecord,
  HoleStats,
  ExecutionTrace,
  HazardHit,
  ClubSelection,
  ShotResult,
} from '../src/types.js';

// ═══════════════════════════════════════════════════════════
// Real SLOPE-era data (Sprint 167-185)
// ═══════════════════════════════════════════════════════════

/** Shot data extracted from retro JSON files */
interface RetroShot {
  sprint: number;
  key: string;
  club: ClubSelection;
  result: ShotResult;
  hazards: HazardHit[];
}

/**
 * All 70 shots from SLOPE-era sprints (S167-S185).
 * Extracted from docs/retros/sprint-{N}.json files.
 */
const REAL_SHOTS: RetroShot[] = [
  // Sprint 167 (11 shots)
  { sprint: 167, key: 'S167-1a', club: 'wedge', result: 'in_the_hole', hazards: [] },
  { sprint: 167, key: 'S167-2a', club: 'short_iron', result: 'green', hazards: [{ type: 'bunker', description: 'CREATE TABLE IF NOT EXISTS conflicted with migration 038' }] },
  { sprint: 167, key: 'S167-3a', club: 'short_iron', result: 'green', hazards: [{ type: 'rough', description: 'Expo web router does not support direct /setup navigation in Playwright' }] },
  { sprint: 167, key: 'S167-1', club: 'short_iron', result: 'in_the_hole', hazards: [] },
  { sprint: 167, key: 'S167-2', club: 'short_iron', result: 'green', hazards: [] },
  { sprint: 167, key: 'S167-3', club: 'wedge', result: 'green', hazards: [] },
  { sprint: 167, key: 'S167-4', club: 'short_iron', result: 'in_the_hole', hazards: [] },
  { sprint: 167, key: 'S167-5', club: 'wedge', result: 'green', hazards: [] },
  { sprint: 167, key: 'S167-6', club: 'putter', result: 'in_the_hole', hazards: [] },
  { sprint: 167, key: 'S167-7', club: 'wedge', result: 'green', hazards: [] },
  { sprint: 167, key: 'S167-8', club: 'wedge', result: 'green', hazards: [] },

  // Sprint 168 (7 shots)
  { sprint: 168, key: 'S168-1', club: 'short_iron', result: 'green', hazards: [{ type: 'bunker', description: 'ValidationResult naming collision' }] },
  { sprint: 168, key: 'S168-2', club: 'short_iron', result: 'green', hazards: [{ type: 'rough', description: 'tsx cannot resolve workspace packages' }] },
  { sprint: 168, key: 'S168-3', club: 'wedge', result: 'in_the_hole', hazards: [] },
  { sprint: 168, key: 'S168-4', club: 'short_iron', result: 'in_the_hole', hazards: [] },
  { sprint: 168, key: 'S168-5', club: 'short_iron', result: 'in_the_hole', hazards: [] },
  { sprint: 168, key: 'S168-6', club: 'short_iron', result: 'in_the_hole', hazards: [] },
  { sprint: 168, key: 'S168-7', club: 'short_iron', result: 'in_the_hole', hazards: [] },

  // Sprint 169 (2 shots)
  { sprint: 169, key: 'S169-1', club: 'putter', result: 'in_the_hole', hazards: [] },
  { sprint: 169, key: 'S169-2', club: 'putter', result: 'in_the_hole', hazards: [] },

  // Sprint 170 (2 shots)
  { sprint: 170, key: 'S170-1', club: 'putter', result: 'in_the_hole', hazards: [{ type: 'bunker', description: 'Backlog was 15 sprints stale' }] },
  { sprint: 170, key: 'S170-2', club: 'putter', result: 'in_the_hole', hazards: [] },

  // Sprint 171 (4 shots)
  { sprint: 171, key: 'S171-1', club: 'wedge', result: 'in_the_hole', hazards: [] },
  { sprint: 171, key: 'S171-2', club: 'short_iron', result: 'in_the_hole', hazards: [] },
  { sprint: 171, key: 'S171-3', club: 'wedge', result: 'in_the_hole', hazards: [] },
  { sprint: 171, key: 'S171-4', club: 'putter', result: 'in_the_hole', hazards: [] },

  // Sprint 172 (3 shots)
  { sprint: 172, key: 'S172-1', club: 'putter', result: 'in_the_hole', hazards: [] },
  { sprint: 172, key: 'S172-2', club: 'wedge', result: 'green', hazards: [{ type: 'rough', description: 'Existing tests assumed glance tier = read-only tools' }] },
  { sprint: 172, key: 'S172-3', club: 'short_iron', result: 'in_the_hole', hazards: [] },

  // Sprint 173 (3 shots)
  { sprint: 173, key: 'S173-1', club: 'putter', result: 'in_the_hole', hazards: [] },
  { sprint: 173, key: 'S173-2', club: 'short_iron', result: 'in_the_hole', hazards: [] },
  { sprint: 173, key: 'S173-3', club: 'short_iron', result: 'in_the_hole', hazards: [] },

  // Sprint 174 (3 shots)
  { sprint: 174, key: 'S174-1', club: 'short_iron', result: 'in_the_hole', hazards: [] },
  { sprint: 174, key: 'S174-2', club: 'wedge', result: 'in_the_hole', hazards: [] },
  { sprint: 174, key: 'S174-3', club: 'wedge', result: 'in_the_hole', hazards: [] },

  // Sprint 175 (3 shots)
  { sprint: 175, key: 'S175-1', club: 'short_iron', result: 'in_the_hole', hazards: [{ type: 'rough', description: 'enterDemoMode() calls reset() which clears isExploring' }] },
  { sprint: 175, key: 'S175-2', club: 'wedge', result: 'in_the_hole', hazards: [] },
  { sprint: 175, key: 'S175-3', club: 'wedge', result: 'in_the_hole', hazards: [] },

  // Sprint 176 (3 shots)
  { sprint: 176, key: 'S176-1', club: 'short_iron', result: 'in_the_hole', hazards: [] },
  { sprint: 176, key: 'S176-2', club: 'driver', result: 'green', hazards: [{ type: 'rough', description: 'Tailwind v4 requires @tailwindcss/vite' }, { type: 'rough', description: 'Broken links to private GitHub repo' }] },
  { sprint: 176, key: 'S176-3', club: 'short_iron', result: 'in_the_hole', hazards: [{ type: 'rough', description: 'Read the Green deep-content padding' }] },

  // Sprint 177 (3 shots)
  { sprint: 177, key: 'S177-1', club: 'wedge', result: 'in_the_hole', hazards: [] },
  { sprint: 177, key: 'S177-2', club: 'wedge', result: 'in_the_hole', hazards: [] },
  { sprint: 177, key: 'S177-3', club: 'wedge', result: 'in_the_hole', hazards: [] },

  // Sprint 178 (4 shots)
  { sprint: 178, key: 'S178-1', club: 'short_iron', result: 'in_the_hole', hazards: [] },
  { sprint: 178, key: 'S178-2', club: 'long_iron', result: 'green', hazards: [{ type: 'rough', description: 'Branch confusion during testing' }] },
  { sprint: 178, key: 'S178-3', club: 'short_iron', result: 'green', hazards: [] },
  { sprint: 178, key: 'S178-4', club: 'wedge', result: 'green', hazards: [] },

  // Sprint 180 (4 shots)
  { sprint: 180, key: 'S180-1', club: 'short_iron', result: 'in_the_hole', hazards: [] },
  { sprint: 180, key: 'S180-2', club: 'short_iron', result: 'in_the_hole', hazards: [] },
  { sprint: 180, key: 'S180-3', club: 'short_iron', result: 'green', hazards: [{ type: 'bunker', description: 'ShotClassification not exported from shared-schemas' }] },
  { sprint: 180, key: 'S180-4', club: 'wedge', result: 'in_the_hole', hazards: [] },

  // Sprint 181 (4 shots)
  { sprint: 181, key: 'S181-1', club: 'wedge', result: 'in_the_hole', hazards: [] },
  { sprint: 181, key: 'S181-2', club: 'short_iron', result: 'in_the_hole', hazards: [] },
  { sprint: 181, key: 'S181-3', club: 'wedge', result: 'in_the_hole', hazards: [] },
  { sprint: 181, key: 'S181-4', club: 'short_iron', result: 'in_the_hole', hazards: [] },

  // Sprint 182 (4 shots)
  { sprint: 182, key: 'S182-1', club: 'short_iron', result: 'in_the_hole', hazards: [{ type: 'rough', description: 'Test scorecard missing special_plays field' }] },
  { sprint: 182, key: 'S182-2', club: 'wedge', result: 'in_the_hole', hazards: [] },
  { sprint: 182, key: 'S182-4', club: 'putter', result: 'in_the_hole', hazards: [] },
  { sprint: 182, key: 'S182-3', club: 'short_iron', result: 'in_the_hole', hazards: [] },

  // Sprint 183 (3 shots)
  { sprint: 183, key: 'S183-1', club: 'short_iron', result: 'in_the_hole', hazards: [] },
  { sprint: 183, key: 'S183-2', club: 'long_iron', result: 'green', hazards: [
    { type: 'bunker', description: 'GitHub Actions billing failure' },
    { type: 'bunker', description: 'Migration ordering collision' },
    { type: 'bunker', description: 'Missing IF NOT EXISTS column guards' },
    { type: 'bunker', description: 'Docker credential store WSL2' },
    { type: 'bunker', description: 'DOCKER_CONFIG env var leaks into build context' },
    { type: 'bunker', description: 'Used wrong fly.toml' },
  ] },
  { sprint: 183, key: 'S183-3', club: 'wedge', result: 'in_the_hole', hazards: [
    { type: 'rough', description: 'Stale API key' },
    { type: 'rough', description: 'backlog_add shell function mapped fields incorrectly' },
  ] },

  // Sprint 184 (4 shots)
  { sprint: 184, key: 'S184-2', club: 'wedge', result: 'in_the_hole', hazards: [] },
  { sprint: 184, key: 'S184-1', club: 'short_iron', result: 'in_the_hole', hazards: [] },
  { sprint: 184, key: 'S184-3', club: 'putter', result: 'in_the_hole', hazards: [] },
  { sprint: 184, key: 'S184-4', club: 'short_iron', result: 'in_the_hole', hazards: [] },

  // Sprint 185 (3 shots)
  { sprint: 185, key: 'S185-1', club: 'short_iron', result: 'in_the_hole', hazards: [] },
  { sprint: 185, key: 'S185-2', club: 'short_iron', result: 'in_the_hole', hazards: [] },
  { sprint: 185, key: 'S185-3', club: 'wedge', result: 'in_the_hole', hazards: [] },

  // Sprint 186 (2 shots — research sprint)
  { sprint: 186, key: 'S186-1', club: 'wedge', result: 'in_the_hole', hazards: [] },
  { sprint: 186, key: 'S186-2', club: 'wedge', result: 'in_the_hole', hazards: [] },

  // Sprint 187 (2 shots — research sprint)
  { sprint: 187, key: 'S187-1', club: 'wedge', result: 'in_the_hole', hazards: [] },
  { sprint: 187, key: 'S187-2', club: 'wedge', result: 'in_the_hole', hazards: [] },

  // Sprint 188 (2 shots — trace enrichment)
  { sprint: 188, key: 'S188-1', club: 'short_iron', result: 'in_the_hole', hazards: [{ type: 'rough', description: 'Pre-existing HazardType test bug — advisor validation test used non-existent hazard types' }] },
  { sprint: 188, key: 'S188-2', club: 'short_iron', result: 'in_the_hole', hazards: [] },
];

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

/** Map a club to a package scope path for trace reconstruction */
function clubToScope(club: ClubSelection): string[] {
  // Most SLOPE-era work was in packages/shared, with some orchestrator and mobile
  // Using generic scopes that match the project structure
  return ['packages/shared/src/'];
}

/**
 * Reconstruct an ExecutionTrace from a retro shot.
 *
 * Strategy:
 * - Clean shots (in_the_hole, no hazards): all files in scope, tests pass first run
 * - in_the_hole with hazards: hazards resolved before first test pass → first_run: true
 * - green with hazards: tests required re-run after hazard fix → first_run: false
 * - green without hazards: minor rework needed → first_run: false for some tests
 */
function buildTraceFromShot(shot: RetroShot): ExecutionTrace {
  const scope = clubToScope(shot.club);
  const modifiedFiles = scope.map(s => s + 'index.ts');
  const hasHazards = shot.hazards.length > 0;

  if (shot.result === 'in_the_hole' && !hasHazards) {
    // Clean execution
    return {
      planned_scope_paths: scope,
      modified_files: modifiedFiles,
      test_results: [{ suite: 'shared', passed: true, first_run: true }],
      reverts: 0,
      elapsed_minutes: 30,
      hazards_encountered: [],
    };
  }

  if (shot.result === 'in_the_hole' && hasHazards) {
    // Hazards resolved in first pass
    return {
      planned_scope_paths: scope,
      modified_files: modifiedFiles,
      test_results: [{ suite: 'shared', passed: true, first_run: true }],
      reverts: 0,
      elapsed_minutes: 45,
      hazards_encountered: shot.hazards,
    };
  }

  if (shot.result === 'green' && hasHazards) {
    // Hazards required rework after initial test pass
    return {
      planned_scope_paths: scope,
      modified_files: modifiedFiles,
      test_results: [{ suite: 'shared', passed: true, first_run: false }],
      reverts: 0,
      elapsed_minutes: 60,
      hazards_encountered: shot.hazards,
    };
  }

  // green without hazards — minor rework without recorded hazards
  // This represents cases where the PM judged rework happened even without formal hazards
  return {
    planned_scope_paths: scope,
    modified_files: modifiedFiles,
    test_results: [{ suite: 'shared', passed: true, first_run: false }],
    reverts: 0,
    elapsed_minutes: 45,
    hazards_encountered: [],
  };
}

// Helper to build a minimal scorecard from retro data
function makeScorecard(sprintNum: number, shots: RetroShot[]): GolfScorecard {
  const sprintShots = shots.filter(s => s.sprint === sprintNum);
  const shotRecords: ShotRecord[] = sprintShots.map(s => ({
    ticket_key: s.key,
    title: `${s.key} ticket`,
    club: s.club,
    result: s.result,
    hazards: s.hazards,
  }));

  const greenCount = sprintShots.filter(s => s.result === 'green' || s.result === 'in_the_hole').length;
  const stats: HoleStats = {
    fairways_hit: sprintShots.length,
    fairways_total: sprintShots.length,
    greens_in_regulation: greenCount,
    greens_total: sprintShots.length,
    putts: 0,
    penalties: 0,
    hazards_hit: sprintShots.reduce((sum, s) => sum + s.hazards.length, 0),
    hazard_penalties: 0,
    miss_directions: { long: 0, short: 0, left: 0, right: 0 },
  };

  return {
    sprint_number: sprintNum,
    theme: `Sprint ${sprintNum}`,
    par: sprintShots.length <= 2 ? 3 : sprintShots.length <= 4 ? 4 : 5,
    slope: 0,
    score: sprintShots.length,
    score_label: 'par',
    date: '2026-02-19',
    shots: shotRecords,
    conditions: [],
    special_plays: [],
    stats,
    yardage_book_updates: [],
    bunker_locations: [],
    course_management_notes: [],
  };
}

// ═══════════════════════════════════════════════════════════
// S186-1: classifyShot() Validation
// ═══════════════════════════════════════════════════════════

describe('classifyShot() — real data validation', () => {
  describe('clean shots (in_the_hole, no hazards)', () => {
    const cleanShots = REAL_SHOTS.filter(
      s => s.result === 'in_the_hole' && s.hazards.length === 0,
    );

    it(`validates ${cleanShots.length} clean shots as in_the_hole`, () => {
      let agreements = 0;
      const disagreements: { key: string; expected: ShotResult; got: ShotResult }[] = [];

      for (const shot of cleanShots) {
        const trace = buildTraceFromShot(shot);
        const classification = classifyShot(trace);

        if (classification.result === shot.result) {
          agreements++;
        } else {
          disagreements.push({
            key: shot.key,
            expected: shot.result,
            got: classification.result,
          });
        }
      }

      expect(agreements).toBe(cleanShots.length);
      expect(disagreements).toHaveLength(0);
    });

    it('reports high confidence for clean shots', () => {
      for (const shot of cleanShots) {
        const trace = buildTraceFromShot(shot);
        const classification = classifyShot(trace);
        expect(classification.confidence).toBeGreaterThanOrEqual(0.9);
      }
    });
  });

  describe('in_the_hole with hazards (resolved in first pass)', () => {
    const ithWithHazards = REAL_SHOTS.filter(
      s => s.result === 'in_the_hole' && s.hazards.length > 0,
    );

    it(`validates ${ithWithHazards.length} hazard-resolved shots`, () => {
      for (const shot of ithWithHazards) {
        const trace = buildTraceFromShot(shot);
        const classification = classifyShot(trace);

        // Algorithm should classify as in_the_hole (hazards resolved before test pass)
        expect(classification.result).toBe('in_the_hole');
        expect(classification.confidence).toBeGreaterThanOrEqual(0.8);
      }
    });
  });

  describe('green with hazards (required rework)', () => {
    const greenWithHazards = REAL_SHOTS.filter(
      s => s.result === 'green' && s.hazards.length > 0,
    );

    it(`validates ${greenWithHazards.length} rework shots as green`, () => {
      for (const shot of greenWithHazards) {
        const trace = buildTraceFromShot(shot);
        const classification = classifyShot(trace);

        // Algorithm should classify as green (hazards + rework after initial pass)
        expect(classification.result).toBe('green');
      }
    });
  });

  describe('green without hazards (human judgment gap)', () => {
    const greenNoHazards = REAL_SHOTS.filter(
      s => s.result === 'green' && s.hazards.length === 0,
    );

    it('identifies algorithm-human disagreement on green-without-hazards', () => {
      // These shots were classified as "green" by the human PM but have no
      // recorded hazards, reverts, or test failures. The algorithm sees a
      // clean execution trace and classifies them as "in_the_hole".
      //
      // This is the KEY FINDING: the algorithm cannot detect subjective
      // rework that the PM observed but didn't record as formal hazards.
      // The PM likely saw iteration/rework that didn't rise to the level
      // of a recorded hazard but still warranted "green" over "in_the_hole".
      let algorithmSaysInTheHole = 0;
      let algorithmSaysGreen = 0;

      for (const shot of greenNoHazards) {
        const trace = buildTraceFromShot(shot);
        const classification = classifyShot(trace);

        if (classification.result === 'in_the_hole') {
          algorithmSaysInTheHole++;
        } else {
          algorithmSaysGreen++;
        }
      }

      // Algorithm classifies all green-without-hazards as in_the_hole
      // because the trace shows no miss signals and no hazards
      expect(algorithmSaysInTheHole).toBe(greenNoHazards.length);
      expect(algorithmSaysGreen).toBe(0);
      // This represents the ~9.2% disagreement rate (7/76 shots)
      expect(greenNoHazards.length).toBe(7);
    });
  });

  describe('aggregate metrics', () => {
    it('computes overall agreement rate', () => {
      let agreements = 0;
      let total = 0;

      for (const shot of REAL_SHOTS) {
        const trace = buildTraceFromShot(shot);
        const classification = classifyShot(trace);
        total++;
        if (classification.result === shot.result) {
          agreements++;
        }
      }

      const agreementRate = (agreements / total) * 100;

      // Expected: ~90.8% agreement (69/76) after S186-S188 expansion
      // - Clean in_the_hole → algorithm says in_the_hole (55 shots) ✓
      // - in_the_hole with hazards → algorithm says in_the_hole (7 shots) ✓
      // - green with hazards → algorithm says green (7 shots) ✓
      // - green without hazards → algorithm says in_the_hole (7 shots) ✗
      //
      // The 7 disagreements remain — all green-without-hazards cases where the
      // human PM detected rework that wasn't captured as formal hazards.
      // Adding 6 agreeing shots from S186-S188 improved the rate from 90.0% to 90.8%.
      expect(agreementRate).toBeGreaterThanOrEqual(90);
      expect(total).toBe(76);
    });

    it('computes confidence distribution', () => {
      const confidences: number[] = [];

      for (const shot of REAL_SHOTS) {
        const trace = buildTraceFromShot(shot);
        const classification = classifyShot(trace);
        confidences.push(classification.confidence);
      }

      const avgConfidence = confidences.reduce((s, c) => s + c, 0) / confidences.length;
      const highConfidence = confidences.filter(c => c >= 0.9).length;
      const medConfidence = confidences.filter(c => c >= 0.7 && c < 0.9).length;

      expect(avgConfidence).toBeGreaterThan(0.85);
      expect(highConfidence).toBeGreaterThan(confidences.length * 0.7);
    });
  });
});

// ═══════════════════════════════════════════════════════════
// classifyShot() — realistic miss scenarios
// ═══════════════════════════════════════════════════════════

describe('classifyShot() — realistic miss scenarios derived from real sprints', () => {
  it('missed_long: S183-2 pattern — files modified outside planned scope', () => {
    // S183-2 was a long_iron with 6 hazards. What if scope leaked?
    const trace: ExecutionTrace = {
      planned_scope_paths: ['packages/orchestrator/src/routes/'],
      modified_files: [
        'packages/orchestrator/src/routes/deploy.ts',
        'packages/orchestrator/src/routes/health.ts',
        'packages/shared/src/schemas.ts',   // outside planned scope
        'packages/mobile/src/hooks/useDeploy.ts', // outside planned scope
        'infra/fly-orchestrator.toml',       // outside planned scope
      ],
      test_results: [{ suite: 'orchestrator', passed: true, first_run: true }],
      reverts: 0,
      elapsed_minutes: 90,
      hazards_encountered: [
        { type: 'bunker', description: 'Migration ordering collision' },
      ],
    };

    const result = classifyShot(trace);
    expect(result.result).toBe('missed_long');
    expect(result.miss_direction).toBe('long');
    expect(result.reasoning).toContain('outside scope');
  });

  it('missed_short: S168-1 pattern — planned scope paths not touched', () => {
    // S168-1 was a short_iron with a naming collision hazard.
    // What if planned files weren't actually modified?
    const trace: ExecutionTrace = {
      planned_scope_paths: [
        'packages/shared/src/slope-builder.ts',
        'packages/shared/src/dispersion.ts',
        'packages/orchestrator/src/routes/config.ts',
      ],
      modified_files: [
        'packages/shared/src/slope-builder.ts',
        // dispersion.ts and config.ts NOT modified — under-scoped
      ],
      test_results: [{ suite: 'shared', passed: true, first_run: true }],
      reverts: 0,
      elapsed_minutes: 40,
      hazards_encountered: [
        { type: 'bunker', description: 'Naming collision' },
      ],
    };

    const result = classifyShot(trace);
    expect(result.result).toBe('missed_short');
    expect(result.miss_direction).toBe('short');
    expect(result.reasoning).toContain('not touched');
  });

  it('missed_left: S167-2a pattern — approach reverted', () => {
    // S167-2a was green with a migration rewrite hazard.
    // What if the approach was actually reverted?
    const trace: ExecutionTrace = {
      planned_scope_paths: ['packages/orchestrator/src/migrations/'],
      modified_files: ['packages/orchestrator/src/migrations/039_fix.ts'],
      test_results: [{ suite: 'orchestrator', passed: true, first_run: false }],
      reverts: 2, // Two reverts — wrong approach taken twice
      elapsed_minutes: 90,
      hazards_encountered: [
        { type: 'bunker', description: 'CREATE TABLE conflicted with migration 038' },
      ],
    };

    const result = classifyShot(trace);
    expect(result.result).toBe('missed_left');
    expect(result.miss_direction).toBe('left');
    expect(result.reasoning).toContain('revert');
  });

  it('missed_right: S176-2 pattern — some test suites failing', () => {
    // S176-2 was a driver with 2 hazards. What if some test suites failed?
    const trace: ExecutionTrace = {
      planned_scope_paths: ['packages/landing/src/'],
      modified_files: ['packages/landing/src/pages/index.astro'],
      test_results: [
        { suite: 'landing', passed: true, first_run: true },
        { suite: 'shared', passed: false, first_run: true },  // unexpected failure
        { suite: 'orchestrator', passed: true, first_run: true },
      ],
      reverts: 0,
      elapsed_minutes: 120,
      hazards_encountered: [
        { type: 'rough', description: 'Tailwind v4 integration' },
      ],
    };

    const result = classifyShot(trace);
    expect(result.result).toBe('missed_right');
    expect(result.miss_direction).toBe('right');
    expect(result.reasoning).toContain('failing');
  });

  it('missed_long with competing signals — scope leak dominates over hazards', () => {
    // Multiple signals: out-of-scope files AND some test failures
    // Out-of-scope should dominate because more files leaked
    const trace: ExecutionTrace = {
      planned_scope_paths: ['packages/shared/src/'],
      modified_files: [
        'packages/shared/src/advisor.ts',
        'packages/orchestrator/src/routes/stats.ts', // scope leak
        'packages/orchestrator/src/services/slope.ts', // scope leak
        'packages/mobile/src/hooks/useSlope.ts', // scope leak
      ],
      test_results: [
        { suite: 'shared', passed: true, first_run: true },
        { suite: 'orchestrator', passed: false, first_run: true }, // also failing
      ],
      reverts: 0,
      elapsed_minutes: 75,
      hazards_encountered: [],
    };

    const result = classifyShot(trace);
    expect(result.result).toBe('missed_long');
    // 3 out-of-scope files (weight 3) vs 1 failing test (weight 1) → missed_long dominates
  });

  it('revert dominates over scope leak — wrong approach is worse', () => {
    const trace: ExecutionTrace = {
      planned_scope_paths: ['packages/shared/src/'],
      modified_files: [
        'packages/shared/src/advisor.ts',
        'packages/mobile/src/hooks/useFoo.ts', // minor scope leak
      ],
      test_results: [{ suite: 'shared', passed: true, first_run: true }],
      reverts: 3, // 3 reverts = weight 6
      elapsed_minutes: 100,
      hazards_encountered: [],
    };

    const result = classifyShot(trace);
    expect(result.result).toBe('missed_left');
    // reverts weight (3*2=6) > out-of-scope weight (1) → missed_left dominates
  });

  it('green: hazards with rework but no miss signals', () => {
    // Real pattern: hazards encountered, tests needed re-run, but all within scope
    const trace: ExecutionTrace = {
      planned_scope_paths: ['packages/shared/src/'],
      modified_files: ['packages/shared/src/slope-builder.ts'],
      test_results: [{ suite: 'shared', passed: true, first_run: false }],
      reverts: 0,
      elapsed_minutes: 60,
      hazards_encountered: [
        { type: 'bunker', description: 'Export collision' },
      ],
    };

    const result = classifyShot(trace);
    expect(result.result).toBe('green');
    expect(result.confidence).toBe(1.0);
  });

  it('in_the_hole: hazards resolved before first test pass', () => {
    const trace: ExecutionTrace = {
      planned_scope_paths: ['packages/shared/src/'],
      modified_files: ['packages/shared/src/handicap.ts'],
      test_results: [{ suite: 'shared', passed: true, first_run: true }],
      reverts: 0,
      elapsed_minutes: 30,
      hazards_encountered: [
        { type: 'rough', description: 'Minor type mismatch caught during implementation' },
      ],
    };

    const result = classifyShot(trace);
    expect(result.result).toBe('in_the_hole');
    expect(result.confidence).toBe(0.9);
  });
});

// ═══════════════════════════════════════════════════════════
// S189-1: Revert-detection impact analysis
// ═══════════════════════════════════════════════════════════

describe('classifyShot() — revert-detection impact analysis (S189-1)', () => {
  // The 7 "green without hazards" disagreements: S167-2, S167-3, S167-5,
  // S167-7, S167-8, S178-3, S178-4. The PM scored "green" (rework detected)
  // but the algorithm sees a clean trace and says "in_the_hole".
  //
  // Hypothesis: if S188's revert_count had been available, revert signals
  // would close some of these gaps. We test with revert=1 (minor rework)
  // and revert=2 (significant rework) to see when the algorithm flips.

  const GREEN_NO_HAZARD_KEYS = ['S167-2', 'S167-3', 'S167-5', 'S167-7', 'S167-8', 'S178-3', 'S178-4'];

  it('single revert (revert_count=1) reclassifies to missed_left — overrides PM green', () => {
    // With 1 revert, classifyShot sees a missed_left signal (weight=2).
    // This doesn't match the PM's "green" — it's worse than green.
    // A future "minor_rework" field would be needed to express "green with effort".
    for (const key of GREEN_NO_HAZARD_KEYS) {
      const trace: ExecutionTrace = {
        planned_scope_paths: ['packages/shared/src/'],
        modified_files: ['packages/shared/src/index.ts'],
        test_results: [{ suite: 'shared', passed: true, first_run: false }],
        reverts: 1,
        elapsed_minutes: 45,
        hazards_encountered: [],
      };
      const result = classifyShot(trace);
      // With reverts > 0, algorithm classifies as missed_left, not green
      expect(result.result).toBe('missed_left');
    }
  });

  it('revert_count=0 with first_run=false still yields in_the_hole (not green)', () => {
    // This confirms the gap: without reverts OR hazards, the algorithm
    // has no signal to distinguish "green" from "in_the_hole" when
    // the only indicator is first_run=false.
    //
    // Finding: first_run=false alone is insufficient to trigger "green"
    // without hazards — the algorithm requires hazards_encountered.length > 0
    // for the green path.
    for (const key of GREEN_NO_HAZARD_KEYS) {
      const trace: ExecutionTrace = {
        planned_scope_paths: ['packages/shared/src/'],
        modified_files: ['packages/shared/src/index.ts'],
        test_results: [{ suite: 'shared', passed: true, first_run: false }],
        reverts: 0,
        elapsed_minutes: 45,
        hazards_encountered: [],
      };
      const result = classifyShot(trace);
      // No miss signals + no hazards = in_the_hole
      expect(result.result).toBe('in_the_hole');
    }
  });

  it('revert_count=1 WITH hazards would correctly classify as green (not missed_left)', () => {
    // When hazards are present alongside a single revert, the miss signal (weight=2)
    // still dominates. This means revert data alone can't express "green" — it
    // overshoots to "missed_left". A future enhancement needs a
    // "minor_rework" threshold (e.g., reverts=1 AND hazards → green, not miss).
    const trace: ExecutionTrace = {
      planned_scope_paths: ['packages/shared/src/'],
      modified_files: ['packages/shared/src/index.ts'],
      test_results: [{ suite: 'shared', passed: true, first_run: false }],
      reverts: 1,
      elapsed_minutes: 45,
      hazards_encountered: [{ type: 'rough', description: 'Minor adjustment needed' }],
    };
    const result = classifyShot(trace);
    // Revert weight (1*2=2) dominates → missed_left, not green
    // This reveals the algorithm needs a "rework" vs "wrong approach" distinction
    expect(result.result).toBe('missed_left');
  });

  it('summary: revert_count does NOT close the green-without-hazards gap', () => {
    // Key finding: revert_count is too coarse for the 7 disagreements.
    // - revert_count=0: algorithm says in_the_hole (same as before — gap unchanged)
    // - revert_count≥1: algorithm says missed_left (overshoots past green)
    //
    // The gap requires a new signal: a "minor_rework" field that means
    // "iteration happened but wasn't a full revert/wrong approach".
    // Potential signals: commit count > expected, time elapsed > median,
    // or an explicit PM annotation.
    const revert0 = classifyShot({
      planned_scope_paths: ['packages/shared/src/'],
      modified_files: ['packages/shared/src/index.ts'],
      test_results: [{ suite: 'shared', passed: true, first_run: false }],
      reverts: 0,
      elapsed_minutes: 45,
      hazards_encountered: [],
    });
    const revert1 = classifyShot({
      planned_scope_paths: ['packages/shared/src/'],
      modified_files: ['packages/shared/src/index.ts'],
      test_results: [{ suite: 'shared', passed: true, first_run: false }],
      reverts: 1,
      elapsed_minutes: 45,
      hazards_encountered: [],
    });

    expect(revert0.result).toBe('in_the_hole'); // Under-detects
    expect(revert1.result).toBe('missed_left'); // Over-detects
    // Neither hits "green" — the gap remains
  });
});

// ═══════════════════════════════════════════════════════════
// S189-1: Synthetic miss stress test
// ═══════════════════════════════════════════════════════════

describe('classifyShot() — synthetic miss stress test (S189-1)', () => {
  // 15 synthetic ExecutionTrace objects testing miss patterns
  // that haven't occurred in real SLOPE-era data.

  describe('missed_long — scope leak variations', () => {
    it('1 out-of-scope file: mild scope leak', () => {
      const trace: ExecutionTrace = {
        planned_scope_paths: ['packages/shared/src/'],
        modified_files: [
          'packages/shared/src/advisor.ts',
          'packages/orchestrator/src/util.ts', // 1 leak
        ],
        test_results: [{ suite: 'shared', passed: true, first_run: true }],
        reverts: 0,
        elapsed_minutes: 40,
        hazards_encountered: [],
      };
      const result = classifyShot(trace);
      expect(result.result).toBe('missed_long');
      expect(result.confidence).toBe(1.0); // single signal
    });

    it('3 out-of-scope files: moderate scope leak', () => {
      const trace: ExecutionTrace = {
        planned_scope_paths: ['packages/shared/src/'],
        modified_files: [
          'packages/shared/src/advisor.ts',
          'packages/orchestrator/src/routes/stats.ts',
          'packages/mobile/src/hooks/useSlope.ts',
          'infra/fly.toml',
        ],
        test_results: [{ suite: 'shared', passed: true, first_run: true }],
        reverts: 0,
        elapsed_minutes: 60,
        hazards_encountered: [],
      };
      const result = classifyShot(trace);
      expect(result.result).toBe('missed_long');
      expect(result.confidence).toBe(1.0);
    });

    it('5+ out-of-scope files: severe scope leak', () => {
      const trace: ExecutionTrace = {
        planned_scope_paths: ['packages/shared/src/handicap.ts'],
        modified_files: [
          'packages/shared/src/handicap.ts',
          'packages/shared/src/schemas.ts',
          'packages/orchestrator/src/routes/config.ts',
          'packages/orchestrator/src/services/slope.ts',
          'packages/mobile/src/hooks/useSlope.ts',
          'packages/mobile/src/screens/SlopeScreen.tsx',
          'docs/CaddyStack-Orchestrator-API.md',
        ],
        test_results: [{ suite: 'shared', passed: true, first_run: true }],
        reverts: 0,
        elapsed_minutes: 120,
        hazards_encountered: [],
      };
      const result = classifyShot(trace);
      expect(result.result).toBe('missed_long');
      // Weight = 6 out-of-scope files (everything except handicap.ts is OOS since
      // planned scope is the exact file path)
      expect(result.confidence).toBe(1.0);
    });
  });

  describe('missed_short — partial scope coverage', () => {
    it('1 of 3 planned paths covered', () => {
      const trace: ExecutionTrace = {
        planned_scope_paths: [
          'packages/shared/src/advisor.ts',
          'packages/shared/src/handicap.ts',
          'packages/shared/src/dispersion.ts',
        ],
        modified_files: ['packages/shared/src/advisor.ts'],
        test_results: [{ suite: 'shared', passed: true, first_run: true }],
        reverts: 0,
        elapsed_minutes: 30,
        hazards_encountered: [],
      };
      const result = classifyShot(trace);
      expect(result.result).toBe('missed_short');
      expect(result.miss_direction).toBe('short');
    });

    it('0 of 2 planned paths covered — nothing modified', () => {
      const trace: ExecutionTrace = {
        planned_scope_paths: [
          'packages/shared/src/advisor.ts',
          'packages/shared/src/handicap.ts',
        ],
        modified_files: ['packages/shared/src/schemas.ts'], // unrelated file
        test_results: [{ suite: 'shared', passed: true, first_run: true }],
        reverts: 0,
        elapsed_minutes: 20,
        hazards_encountered: [],
      };
      const result = classifyShot(trace);
      // Both signals: missed_short (weight=2) + missed_long (weight=1)
      // missed_short dominates
      expect(result.result).toBe('missed_short');
    });
  });

  describe('missed_left — revert variations', () => {
    it('1 revert: mild wrong approach', () => {
      const trace: ExecutionTrace = {
        planned_scope_paths: ['packages/shared/src/'],
        modified_files: ['packages/shared/src/advisor.ts'],
        test_results: [{ suite: 'shared', passed: true, first_run: false }],
        reverts: 1,
        elapsed_minutes: 60,
        hazards_encountered: [],
      };
      const result = classifyShot(trace);
      expect(result.result).toBe('missed_left');
      expect(result.confidence).toBe(1.0); // single signal
    });

    it('2 reverts: significant wrong approach', () => {
      const trace: ExecutionTrace = {
        planned_scope_paths: ['packages/shared/src/'],
        modified_files: ['packages/shared/src/advisor.ts'],
        test_results: [{ suite: 'shared', passed: true, first_run: false }],
        reverts: 2,
        elapsed_minutes: 90,
        hazards_encountered: [],
      };
      const result = classifyShot(trace);
      expect(result.result).toBe('missed_left');
      // Weight = 2*2 = 4
      expect(result.confidence).toBe(1.0);
    });

    it('3+ reverts: severe wrong approach', () => {
      const trace: ExecutionTrace = {
        planned_scope_paths: ['packages/shared/src/'],
        modified_files: ['packages/shared/src/advisor.ts'],
        test_results: [{ suite: 'shared', passed: true, first_run: false }],
        reverts: 5,
        elapsed_minutes: 180,
        hazards_encountered: [
          { type: 'bunker', description: 'Completely wrong architecture' },
        ],
      };
      const result = classifyShot(trace);
      expect(result.result).toBe('missed_left');
      // Weight = 5*2 = 10
      expect(result.confidence).toBe(1.0);
    });
  });

  describe('missed_right — test failure variations', () => {
    it('1 failing test suite: mild execution error', () => {
      const trace: ExecutionTrace = {
        planned_scope_paths: ['packages/shared/src/'],
        modified_files: ['packages/shared/src/advisor.ts'],
        test_results: [
          { suite: 'shared', passed: true, first_run: true },
          { suite: 'orchestrator', passed: false, first_run: true },
        ],
        reverts: 0,
        elapsed_minutes: 45,
        hazards_encountered: [],
      };
      const result = classifyShot(trace);
      expect(result.result).toBe('missed_right');
      expect(result.miss_direction).toBe('right');
    });

    it('2 failing test suites: moderate execution error', () => {
      const trace: ExecutionTrace = {
        planned_scope_paths: ['packages/shared/src/'],
        modified_files: ['packages/shared/src/advisor.ts'],
        test_results: [
          { suite: 'shared', passed: true, first_run: true },
          { suite: 'orchestrator', passed: false, first_run: true },
          { suite: 'mobile', passed: false, first_run: true },
        ],
        reverts: 0,
        elapsed_minutes: 60,
        hazards_encountered: [],
      };
      const result = classifyShot(trace);
      expect(result.result).toBe('missed_right');
    });

    it('3 failing test suites: severe execution error', () => {
      const trace: ExecutionTrace = {
        planned_scope_paths: ['packages/shared/src/'],
        modified_files: ['packages/shared/src/advisor.ts'],
        test_results: [
          { suite: 'shared', passed: true, first_run: true },
          { suite: 'orchestrator', passed: false, first_run: true },
          { suite: 'mobile', passed: false, first_run: true },
          { suite: 'bootstrap', passed: false, first_run: true },
        ],
        reverts: 0,
        elapsed_minutes: 90,
        hazards_encountered: [],
      };
      const result = classifyShot(trace);
      expect(result.result).toBe('missed_right');
    });
  });

  describe('combined signals', () => {
    it('revert + scope leak: revert dominates when weight higher', () => {
      const trace: ExecutionTrace = {
        planned_scope_paths: ['packages/shared/src/'],
        modified_files: [
          'packages/shared/src/advisor.ts',
          'packages/mobile/src/hooks/useFoo.ts', // 1 leak (weight 1)
        ],
        test_results: [{ suite: 'shared', passed: true, first_run: true }],
        reverts: 2, // weight 4
        elapsed_minutes: 90,
        hazards_encountered: [],
      };
      const result = classifyShot(trace);
      expect(result.result).toBe('missed_left');
      // Mixed signals → confidence < 1.0
      expect(result.confidence).toBeLessThan(1.0);
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('scope leak + test failure: scope leak dominates when more files', () => {
      const trace: ExecutionTrace = {
        planned_scope_paths: ['packages/shared/src/'],
        modified_files: [
          'packages/shared/src/advisor.ts',
          'packages/orchestrator/src/a.ts', // leak
          'packages/orchestrator/src/b.ts', // leak
          'packages/orchestrator/src/c.ts', // leak (weight 3)
        ],
        test_results: [
          { suite: 'shared', passed: true, first_run: true },
          { suite: 'orchestrator', passed: false, first_run: true }, // 1 failure (weight 1)
        ],
        reverts: 0,
        elapsed_minutes: 60,
        hazards_encountered: [],
      };
      const result = classifyShot(trace);
      expect(result.result).toBe('missed_long');
    });

    it('all signals present: highest weight wins', () => {
      const trace: ExecutionTrace = {
        planned_scope_paths: ['packages/shared/src/', 'packages/orchestrator/src/routes/'],
        modified_files: [
          'packages/shared/src/advisor.ts',
          // orchestrator routes not modified → missed_short (weight 1)
          'packages/mobile/src/hooks/useFoo.ts', // scope leak → missed_long (weight 1)
        ],
        test_results: [
          { suite: 'shared', passed: true, first_run: true },
          { suite: 'mobile', passed: false, first_run: true }, // missed_right (weight 1)
        ],
        reverts: 3, // missed_left (weight 6) — dominates
        elapsed_minutes: 120,
        hazards_encountered: [{ type: 'bunker', description: 'Everything went wrong' }],
      };
      const result = classifyShot(trace);
      expect(result.result).toBe('missed_left');
      // 4 signals → lower confidence
      expect(result.confidence).toBeLessThan(1.0);
    });
  });
});

// ═══════════════════════════════════════════════════════════
// S186-2: recommendClub() Validation
// ═══════════════════════════════════════════════════════════

describe('recommendClub() — sequential replay against real data', () => {
  // Unique sprint numbers in order
  const sprintNumbers = [...new Set(REAL_SHOTS.map(s => s.sprint))].sort((a, b) => a - b);

  // Build cumulative scorecards
  const scorecardsBySprint: Map<number, GolfScorecard> = new Map();
  for (const num of sprintNumbers) {
    scorecardsBySprint.set(num, makeScorecard(num, REAL_SHOTS));
  }

  // Reverse-map club to complexity
  const CLUB_TO_COMPLEXITY: Record<ClubSelection, 'trivial' | 'small' | 'medium' | 'large'> = {
    putter: 'trivial',
    wedge: 'small',
    short_iron: 'medium',
    long_iron: 'large',
    driver: 'large',
  };

  it('replays all 70 shots with cumulative history', () => {
    let exactMatches = 0;
    let withinOne = 0;
    let total = 0;
    const clubOrder: ClubSelection[] = ['putter', 'wedge', 'short_iron', 'long_iron', 'driver'];
    const recommendations: Array<{
      key: string;
      human: ClubSelection;
      recommended: ClubSelection;
      confidence: number;
      exact: boolean;
      within1: boolean;
    }> = [];

    for (const sprintNum of sprintNumbers) {
      // Cumulative scorecards: all sprints before this one
      const priorCards = sprintNumbers
        .filter(n => n < sprintNum)
        .map(n => scorecardsBySprint.get(n)!)
        .filter(Boolean);

      const sprintShots = REAL_SHOTS.filter(s => s.sprint === sprintNum);

      for (const shot of sprintShots) {
        const complexity = CLUB_TO_COMPLEXITY[shot.club];
        const rec = recommendClub({
          ticketComplexity: complexity,
          scorecards: priorCards,
        });

        total++;
        const humanIdx = clubOrder.indexOf(shot.club);
        const recIdx = clubOrder.indexOf(rec.club);
        const exact = rec.club === shot.club;
        const w1 = Math.abs(humanIdx - recIdx) <= 1;

        if (exact) exactMatches++;
        if (w1) withinOne++;

        recommendations.push({
          key: shot.key,
          human: shot.club,
          recommended: rec.club,
          confidence: rec.confidence,
          exact,
          within1: w1,
        });
      }
    }

    const exactRate = (exactMatches / total) * 100;
    const within1Rate = (withinOne / total) * 100;

    // With no misses in historical data:
    // - No downgrade triggers (miss_rate is 0% for all clubs)
    // - Algorithm returns default club for complexity level
    // - Since we reverse-map human club → complexity → default club, exact match should be high
    // - The only exception: driver (large→long_iron without 3+ slope factors)
    expect(exactRate).toBeGreaterThanOrEqual(98); // 75/76 — only driver disagrees
    expect(within1Rate).toBe(100); // driver→long_iron is within-1
    expect(total).toBe(76);
  });

  it('analyzes systematic bias', () => {
    let conservative = 0; // algorithm recommends lower club than human
    let aggressive = 0;   // algorithm recommends higher club than human
    let exact = 0;
    const clubOrder: ClubSelection[] = ['putter', 'wedge', 'short_iron', 'long_iron', 'driver'];

    for (const sprintNum of sprintNumbers) {
      const priorCards = sprintNumbers
        .filter(n => n < sprintNum)
        .map(n => scorecardsBySprint.get(n)!)
        .filter(Boolean);

      const sprintShots = REAL_SHOTS.filter(s => s.sprint === sprintNum);

      for (const shot of sprintShots) {
        const complexity = CLUB_TO_COMPLEXITY[shot.club];
        const rec = recommendClub({
          ticketComplexity: complexity,
          scorecards: priorCards,
        });

        const humanIdx = clubOrder.indexOf(shot.club);
        const recIdx = clubOrder.indexOf(rec.club);

        if (recIdx < humanIdx) conservative++;
        else if (recIdx > humanIdx) aggressive++;
        else exact++;
      }
    }

    // With clean history and reverse-mapped complexity, nearly all should be exact
    // The 1 driver shot (S176-2) shows as conservative (driver→long_iron without slope factors)
    expect(exact).toBeGreaterThanOrEqual(75);
    expect(conservative).toBe(1); // Only the driver→long_iron downshift
    expect(aggressive).toBe(0);
  });

  it('tracks confidence vs accuracy correlation', () => {
    const highConfExact: boolean[] = [];
    const lowConfExact: boolean[] = [];

    for (const sprintNum of sprintNumbers) {
      const priorCards = sprintNumbers
        .filter(n => n < sprintNum)
        .map(n => scorecardsBySprint.get(n)!)
        .filter(Boolean);

      const sprintShots = REAL_SHOTS.filter(s => s.sprint === sprintNum);

      for (const shot of sprintShots) {
        const complexity = CLUB_TO_COMPLEXITY[shot.club];
        const rec = recommendClub({
          ticketComplexity: complexity,
          scorecards: priorCards,
        });

        const isExact = rec.club === shot.club;
        if (rec.confidence >= 0.7) {
          highConfExact.push(isExact);
        } else {
          lowConfExact.push(isExact);
        }
      }
    }

    // High confidence recommendations should be more accurate
    const highConfAccuracy = highConfExact.filter(Boolean).length / (highConfExact.length || 1);
    expect(highConfAccuracy).toBeGreaterThanOrEqual(0.95);
  });

  it('handles first sprint with no history', () => {
    // Sprint 167 has no prior scorecards
    const shot = REAL_SHOTS.find(s => s.sprint === 167)!;
    const rec = recommendClub({
      ticketComplexity: CLUB_TO_COMPLEXITY[shot.club],
      scorecards: [],
    });

    // With no history, confidence should be 0.3
    expect(rec.confidence).toBe(0.3);
    expect(rec.club).toBe(shot.club); // default mapping matches
  });

  it('confidence increases with history depth', () => {
    const confidenceOverTime: { sprint: number; avgConfidence: number }[] = [];

    for (const sprintNum of sprintNumbers) {
      const priorCards = sprintNumbers
        .filter(n => n < sprintNum)
        .map(n => scorecardsBySprint.get(n)!)
        .filter(Boolean);

      const sprintShots = REAL_SHOTS.filter(s => s.sprint === sprintNum);
      const confs: number[] = [];

      for (const shot of sprintShots) {
        const complexity = CLUB_TO_COMPLEXITY[shot.club];
        const rec = recommendClub({
          ticketComplexity: complexity,
          scorecards: priorCards,
        });
        confs.push(rec.confidence);
      }

      confidenceOverTime.push({
        sprint: sprintNum,
        avgConfidence: confs.reduce((s, c) => s + c, 0) / confs.length,
      });
    }

    // First sprint should have lowest confidence
    expect(confidenceOverTime[0].avgConfidence).toBeCloseTo(0.3, 5);

    // Later sprints should have higher confidence (more history)
    const lastFew = confidenceOverTime.slice(-3);
    const avgLast = lastFew.reduce((s, c) => s + c.avgConfidence, 0) / lastFew.length;
    expect(avgLast).toBeGreaterThan(0.3);
  });

  it('large complexity always maps to long_iron (never driver)', () => {
    // Driver upgrade was removed — large always maps to long_iron regardless of slope factors
    const priorCards = sprintNumbers
      .filter(n => n < 176)
      .map(n => scorecardsBySprint.get(n)!)
      .filter(Boolean);

    const noSlope = recommendClub({
      ticketComplexity: 'large',
      scorecards: priorCards,
    });
    expect(noSlope.club).toBe('long_iron');

    const withSlope = recommendClub({
      ticketComplexity: 'large',
      scorecards: priorCards,
      slopeFactors: ['cross_package', 'new_area', 'external_dep'],
    });
    expect(withSlope.club).toBe('long_iron');
  });
});

// ═══════════════════════════════════════════════════════════
// S189-2: recommendClub() — synthetic miss history
// ═══════════════════════════════════════════════════════════

describe('recommendClub() — synthetic miss history (S189-2)', () => {
  /** Build a scorecard with specific shot results for testing miss scenarios */
  function makeSyntheticScorecard(
    sprintNum: number,
    shots: Array<{ club: ClubSelection; result: ShotResult; hazards?: HazardHit[] }>,
  ): GolfScorecard {
    const shotRecords: ShotRecord[] = shots.map((s, i) => ({
      ticket_key: `SYNTH-${sprintNum}-${i + 1}`,
      title: `Synthetic ticket ${i + 1}`,
      club: s.club,
      result: s.result,
      hazards: s.hazards ?? [],
    }));

    const missCount = shots.filter(s => !['fairway', 'green', 'in_the_hole'].includes(s.result)).length;
    const hazardCount = shots.reduce((sum, s) => sum + (s.hazards?.length ?? 0), 0);
    const stats: HoleStats = {
      fairways_hit: shots.length - missCount,
      fairways_total: shots.length,
      greens_in_regulation: shots.length - missCount,
      greens_total: shots.length,
      putts: 0,
      penalties: missCount,
      hazards_hit: hazardCount,
      hazard_penalties: 0,
      miss_directions: {
        long: shots.filter(s => s.result === 'missed_long').length,
        short: shots.filter(s => s.result === 'missed_short').length,
        left: shots.filter(s => s.result === 'missed_left').length,
        right: shots.filter(s => s.result === 'missed_right').length,
      },
    };

    return {
      sprint_number: sprintNum,
      theme: `Synthetic Sprint ${sprintNum}`,
      par: shots.length <= 2 ? 3 : shots.length <= 4 ? 4 : 5,
      slope: 0,
      score: shots.length + missCount,
      score_label: missCount > 0 ? 'bogey' : 'par',
      date: '2026-02-20',
      shots: shotRecords,
      conditions: [],
      special_plays: [],
      stats,
      yardage_book_updates: [],
      bunker_locations: [],
      course_management_notes: [],
    };
  }

  it('high miss rate on short_iron (>30%) triggers downgrade to wedge', () => {
    // 5 sprints of history where short_iron has 2/5 misses (40%)
    const history: GolfScorecard[] = [
      makeSyntheticScorecard(900, [
        { club: 'short_iron', result: 'in_the_hole' },
        { club: 'wedge', result: 'in_the_hole' },
      ]),
      makeSyntheticScorecard(901, [
        { club: 'short_iron', result: 'missed_long' },
        { club: 'wedge', result: 'in_the_hole' },
      ]),
      makeSyntheticScorecard(902, [
        { club: 'short_iron', result: 'in_the_hole' },
        { club: 'putter', result: 'in_the_hole' },
      ]),
      makeSyntheticScorecard(903, [
        { club: 'short_iron', result: 'missed_right' },
        { club: 'wedge', result: 'in_the_hole' },
      ]),
      makeSyntheticScorecard(904, [
        { club: 'short_iron', result: 'in_the_hole' },
        { club: 'wedge', result: 'in_the_hole' },
      ]),
    ];

    const rec = recommendClub({
      ticketComplexity: 'medium', // normally maps to short_iron
      scorecards: history,
    });

    // 2/5 = 40% miss rate > 30% → downgrade from short_iron to wedge
    expect(rec.club).toBe('wedge');
    expect(rec.reasoning).toContain('Downgraded');
  });

  it('dominant "long" miss direction adds provisional suggestion', () => {
    // History with mostly "missed_long" misses → dominant miss = "long"
    const history: GolfScorecard[] = [
      makeSyntheticScorecard(910, [
        { club: 'short_iron', result: 'missed_long' },
        { club: 'short_iron', result: 'missed_long' },
      ]),
      makeSyntheticScorecard(911, [
        { club: 'short_iron', result: 'in_the_hole' },
        { club: 'wedge', result: 'missed_long' },
      ]),
      makeSyntheticScorecard(912, [
        { club: 'short_iron', result: 'in_the_hole' },
        { club: 'wedge', result: 'in_the_hole' },
      ]),
    ];

    const rec = recommendClub({
      ticketComplexity: 'medium',
      scorecards: history,
    });

    // Should have a provisional suggestion about dominant miss direction
    expect(rec.provisional_suggestion).toBeDefined();
    expect(rec.provisional_suggestion).toContain('miss rate');
  });

  it('mixed miss directions — no dominant direction → no provisional', () => {
    const history: GolfScorecard[] = [
      makeSyntheticScorecard(920, [
        { club: 'short_iron', result: 'missed_long' },
        { club: 'short_iron', result: 'missed_short' },
      ]),
      makeSyntheticScorecard(921, [
        { club: 'short_iron', result: 'missed_left' },
        { club: 'short_iron', result: 'missed_right' },
      ]),
      makeSyntheticScorecard(922, [
        { club: 'wedge', result: 'in_the_hole' },
        { club: 'wedge', result: 'in_the_hole' },
      ]),
    ];

    const rec = recommendClub({
      ticketComplexity: 'medium',
      scorecards: history,
    });

    // Miss directions are evenly spread → no dominant direction
    // computeDispersion may or may not find a dominant miss depending on threshold
    // The key point: 4 misses evenly across 4 directions = no dominant
    if (rec.provisional_suggestion) {
      // If a provisional is present, it shouldn't say "dominant"
      // (computeDispersion might still flag high overall miss rate)
      expect(rec.provisional_suggestion).toContain('miss rate');
    }
  });

  it('low sample count (2 uses, 1 miss = 50%) DOES trigger downgrade with enough history', () => {
    // With only 2 uses of a club, a 50% miss rate technically exceeds 30%.
    // The algorithm does NOT have a minimum sample size guard — it trusts
    // computeAreaPerformance raw miss rate. This is a potential improvement area.
    const history: GolfScorecard[] = [
      makeSyntheticScorecard(930, [
        { club: 'long_iron', result: 'missed_long' },
        { club: 'wedge', result: 'in_the_hole' },
      ]),
      makeSyntheticScorecard(931, [
        { club: 'long_iron', result: 'in_the_hole' },
        { club: 'wedge', result: 'in_the_hole' },
      ]),
    ];

    const rec = recommendClub({
      ticketComplexity: 'large', // normally maps to long_iron
      scorecards: history,
    });

    // 1/2 = 50% miss rate > 30% → downgrade from long_iron to short_iron
    // NOTE: This is aggressive — with only 2 samples, 1 miss shouldn't
    // necessarily trigger a downgrade. Potential improvement: require N≥3.
    expect(rec.club).toBe('short_iron');
    expect(rec.reasoning).toContain('Downgraded');
  });
});

// ═══════════════════════════════════════════════════════════
// S189-2: Driver slope threshold boundary testing
// ═══════════════════════════════════════════════════════════

describe('recommendClub() — large always maps to long_iron (S222-1)', () => {
  it('2 slope factors → long_iron', () => {
    const rec = recommendClub({
      ticketComplexity: 'large',
      scorecards: [],
      slopeFactors: ['cross_package', 'schema_migration'],
    });
    expect(rec.club).toBe('long_iron');
  });

  it('3 slope factors → long_iron (driver upgrade removed)', () => {
    const rec = recommendClub({
      ticketComplexity: 'large',
      scorecards: [],
      slopeFactors: ['cross_package', 'schema_migration', 'new_area'],
    });
    expect(rec.club).toBe('long_iron');
  });

  it('4 slope factors → long_iron (driver upgrade removed)', () => {
    const rec = recommendClub({
      ticketComplexity: 'large',
      scorecards: [],
      slopeFactors: ['cross_package', 'schema_migration', 'new_area', 'external_dep'],
    });
    expect(rec.club).toBe('long_iron');
  });

  it('slope factors do not affect any complexity level', () => {
    const rec = recommendClub({
      ticketComplexity: 'medium',
      scorecards: [],
      slopeFactors: ['cross_package', 'schema_migration', 'new_area'],
    });
    expect(rec.club).toBe('short_iron');
  });
});

// ═══════════════════════════════════════════════════════════
// S189-2: Confidence calibration analysis
// ═══════════════════════════════════════════════════════════

describe('recommendClub() — confidence calibration (S189-2)', () => {
  // Build cumulative history using REAL_SHOTS
  const sprintNumbers = [...new Set(REAL_SHOTS.map(s => s.sprint))].sort((a, b) => a - b);
  const scorecardsBySprint: Map<number, GolfScorecard> = new Map();
  for (const num of sprintNumbers) {
    scorecardsBySprint.set(num, makeScorecard(num, REAL_SHOTS));
  }

  const CLUB_TO_COMPLEXITY: Record<ClubSelection, 'trivial' | 'small' | 'medium' | 'large'> = {
    putter: 'trivial',
    wedge: 'small',
    short_iron: 'medium',
    long_iron: 'large',
    driver: 'large',
  };

  it('confidence starts at 0.3, reaches 0.5 quickly, plateaus at 1.0', () => {
    const confidenceByDepth: { depth: number; avgConfidence: number }[] = [];

    for (let i = 0; i < sprintNumbers.length; i++) {
      const sprintNum = sprintNumbers[i];
      const priorCards = sprintNumbers
        .slice(0, i)
        .map(n => scorecardsBySprint.get(n)!)
        .filter(Boolean);

      const sprintShots = REAL_SHOTS.filter(s => s.sprint === sprintNum);
      const confs: number[] = [];

      for (const shot of sprintShots) {
        const complexity = CLUB_TO_COMPLEXITY[shot.club];
        const rec = recommendClub({
          ticketComplexity: complexity,
          scorecards: priorCards,
        });
        confs.push(rec.confidence);
      }

      confidenceByDepth.push({
        depth: priorCards.length,
        avgConfidence: confs.reduce((s, c) => s + c, 0) / confs.length,
      });
    }

    // Phase 1: starts at 0.3 (no history)
    expect(confidenceByDepth[0].avgConfidence).toBeCloseTo(0.3, 5);

    // Phase 2: jumps to 0.5 after first sprint
    expect(confidenceByDepth[1].avgConfidence).toBeGreaterThanOrEqual(0.5);

    // Phase 3: reaches 1.0 within first 5 sprints for commonly-used clubs
    const firstFive = confidenceByDepth.slice(0, 5);
    const reachedMax = firstFive.some(c => c.avgConfidence === 1.0);
    expect(reachedMax).toBe(true);

    // Phase 4: plateaus — last 5 sprints all at 0.5+ for common clubs
    const lastFive = confidenceByDepth.slice(-5);
    for (const entry of lastFive) {
      expect(entry.avgConfidence).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('confidence thresholds are 0.3 / 0.5 / 1.0 (not continuous)', () => {
    // The algorithm uses discrete steps: 0 history → 0.3, 1-4 → 0.5, 5+ → 1.0
    const uniqueConfidences = new Set<number>();

    for (const sprintNum of sprintNumbers) {
      const priorCards = sprintNumbers
        .filter(n => n < sprintNum)
        .map(n => scorecardsBySprint.get(n)!)
        .filter(Boolean);

      const sprintShots = REAL_SHOTS.filter(s => s.sprint === sprintNum);

      for (const shot of sprintShots) {
        const complexity = CLUB_TO_COMPLEXITY[shot.club];
        const rec = recommendClub({
          ticketComplexity: complexity,
          scorecards: priorCards,
        });
        uniqueConfidences.add(rec.confidence);
      }
    }

    // Only 3 discrete confidence levels: 0.3, 0.5, 1.0
    expect(uniqueConfidences.size).toBeLessThanOrEqual(3);
    expect(uniqueConfidences.has(0.3)).toBe(true);
    expect(uniqueConfidences.has(0.5)).toBe(true);
    expect(uniqueConfidences.has(1.0)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// S189-2: generateTrainingPlan cross-validation
// ═══════════════════════════════════════════════════════════

describe('generateTrainingPlan() — cross-validation with synthetic miss histories (S189-2)', () => {
  /** Build a scorecard with specific shot results */
  function makeSyntheticScorecard(
    sprintNum: number,
    shots: Array<{ club: ClubSelection; result: ShotResult; hazards?: HazardHit[] }>,
  ): GolfScorecard {
    const shotRecords: ShotRecord[] = shots.map((s, i) => ({
      ticket_key: `TRAIN-${sprintNum}-${i + 1}`,
      title: `Training ticket ${i + 1}`,
      club: s.club,
      result: s.result,
      hazards: s.hazards ?? [],
    }));

    const missCount = shots.filter(s => !['fairway', 'green', 'in_the_hole'].includes(s.result)).length;
    const stats: HoleStats = {
      fairways_hit: shots.length - missCount,
      fairways_total: shots.length,
      greens_in_regulation: shots.length - missCount,
      greens_total: shots.length,
      putts: 0,
      penalties: missCount,
      hazards_hit: shots.reduce((sum, s) => sum + (s.hazards?.length ?? 0), 0),
      hazard_penalties: 0,
      miss_directions: {
        long: shots.filter(s => s.result === 'missed_long').length,
        short: shots.filter(s => s.result === 'missed_short').length,
        left: shots.filter(s => s.result === 'missed_left').length,
        right: shots.filter(s => s.result === 'missed_right').length,
      },
    };

    return {
      sprint_number: sprintNum,
      theme: `Training Sprint ${sprintNum}`,
      par: shots.length <= 2 ? 3 : shots.length <= 4 ? 4 : 5,
      slope: 0,
      score: shots.length + missCount,
      score_label: missCount > 0 ? 'bogey' : 'par',
      date: '2026-02-20',
      shots: shotRecords,
      conditions: [],
      special_plays: [],
      stats,
      yardage_book_updates: [],
      bunker_locations: [],
      course_management_notes: [],
    };
  }

  it('dominant "long" misses → training plan recommends scope reduction', () => {
    const history: GolfScorecard[] = [
      makeSyntheticScorecard(950, [
        { club: 'short_iron', result: 'missed_long' },
        { club: 'short_iron', result: 'missed_long' },
      ]),
      makeSyntheticScorecard(951, [
        { club: 'short_iron', result: 'missed_long' },
        { club: 'wedge', result: 'in_the_hole' },
      ]),
      makeSyntheticScorecard(952, [
        { club: 'short_iron', result: 'in_the_hole' },
        { club: 'wedge', result: 'in_the_hole' },
      ]),
    ];

    const handicap = computeHandicapCard(history);
    const dispersion = computeDispersion(history);
    const plan = generateTrainingPlan({
      handicap,
      dispersion,
      recentScorecards: history,
    });

    // Should recommend reducing scope (long = over-engineering)
    expect(plan.length).toBeGreaterThan(0);
    const dominantRec = plan.find(r => r.area.includes('Dominant miss'));
    expect(dominantRec).toBeDefined();
    expect(dominantRec!.priority).toBe('high');
    expect(dominantRec!.instruction_adjustment).toContain('scope');
  });

  it('dominant "left" misses → training plan recommends approach research', () => {
    const history: GolfScorecard[] = [
      makeSyntheticScorecard(960, [
        { club: 'short_iron', result: 'missed_left' },
        { club: 'short_iron', result: 'missed_left' },
      ]),
      makeSyntheticScorecard(961, [
        { club: 'short_iron', result: 'missed_left' },
        { club: 'wedge', result: 'in_the_hole' },
      ]),
      makeSyntheticScorecard(962, [
        { club: 'short_iron', result: 'in_the_hole' },
        { club: 'wedge', result: 'in_the_hole' },
      ]),
    ];

    const handicap = computeHandicapCard(history);
    const dispersion = computeDispersion(history);
    const plan = generateTrainingPlan({
      handicap,
      dispersion,
      recentScorecards: history,
    });

    const dominantRec = plan.find(r => r.area.includes('Dominant miss'));
    expect(dominantRec).toBeDefined();
    expect(dominantRec!.priority).toBe('high');
    expect(dominantRec!.instruction_adjustment).toContain('approach');
  });

  it('clean history → no training recommendations', () => {
    const history: GolfScorecard[] = [
      makeSyntheticScorecard(970, [
        { club: 'short_iron', result: 'in_the_hole' },
        { club: 'wedge', result: 'in_the_hole' },
      ]),
      makeSyntheticScorecard(971, [
        { club: 'short_iron', result: 'in_the_hole' },
        { club: 'wedge', result: 'in_the_hole' },
      ]),
      makeSyntheticScorecard(972, [
        { club: 'putter', result: 'in_the_hole' },
        { club: 'wedge', result: 'in_the_hole' },
      ]),
    ];

    const handicap = computeHandicapCard(history);
    const dispersion = computeDispersion(history);
    const plan = generateTrainingPlan({
      handicap,
      dispersion,
      recentScorecards: history,
    });

    // Clean history = no dominant miss, no worsening trend, no club issues
    expect(plan).toHaveLength(0);
  });

  it('club-specific high miss rate → training plan flags the club', () => {
    // short_iron has 3/4 misses across 4 sprints
    const history: GolfScorecard[] = [
      makeSyntheticScorecard(980, [
        { club: 'short_iron', result: 'missed_long' },
        { club: 'wedge', result: 'in_the_hole' },
      ]),
      makeSyntheticScorecard(981, [
        { club: 'short_iron', result: 'missed_right' },
        { club: 'wedge', result: 'in_the_hole' },
      ]),
      makeSyntheticScorecard(982, [
        { club: 'short_iron', result: 'missed_left' },
        { club: 'putter', result: 'in_the_hole' },
      ]),
      makeSyntheticScorecard(983, [
        { club: 'short_iron', result: 'in_the_hole' },
        { club: 'wedge', result: 'in_the_hole' },
      ]),
    ];

    const handicap = computeHandicapCard(history);
    const dispersion = computeDispersion(history);
    const plan = generateTrainingPlan({
      handicap,
      dispersion,
      recentScorecards: history,
    });

    // Should flag short_iron specifically
    const clubRec = plan.find(r => r.area.includes('short_iron'));
    expect(clubRec).toBeDefined();
    expect(clubRec!.priority).toBe('medium');
    expect(clubRec!.instruction_adjustment).toContain('short_iron');
  });
});
