# Execution Plan: S-LOCAL-049-2
## Harden: builder.test.ts
Club: short_iron | Est. tokens: 13471

## Files to Modify
- vitest.config.ts (relevance: 0.56)
  ```
  import { defineConfig } from 'vitest/config';
  
  export default defineConfig({
    test: {
      include: ['tests/**/*.test.ts'],
    },
  });
  
  ```
- docs/tutorial-first-sprint.md (relevance: 0.55)
  ```
  | `hazard_penalties`    | number | Hazards that added to score      |
  | `miss_directions`     | object | `{ long, short, left, right }`   |
  
  ### Condition Types
  
  | Type         | Meaning                            |
  |--------------|------------------------------------|
  | `wind`       | External service issues            |
  | `rain`       | Team/process disruptions           |
  | `firm`       | Tight deadlines                    |
  ...
  ```
- src/core/review.ts (relevance: 0.55)
  ```
  import type {
    ReviewType,
    ReviewFinding,
    ReviewRecommendation,
    HazardHit,
    HazardType,
    HazardSeverity,
    ClubSelection,
    SprintType,
    GolfScorecard,
  ...
  ```
- src/core/dispersion.ts (relevance: 0.55)
  ```
  import type {
    GolfScorecard,
    MissDirection,
    ShotResult,
    DispersionReport,
    AreaReport,
    ClubSelection,
  } from './types.js';
  import { normalizeStats } from './builder.js';
  
  ...
  ```
- src/core/initiative.ts (relevance: 0.55)
  ```
  import type { ReviewType } from './types.js';
  // RoadmapDefinition used via parseRoadmap return type
  
  import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
  import { join, dirname } from 'node:path';
  import { parseRoadmap } from './roadmap.js';
  
  // --- Specialist Types (distinct from ReviewType) ---
  
  export type SpecialistType = 'backend' | 'ml-engineer' | 'database' | 'frontend' | 'ux-designer';
  ...
  ```
- tests/cli/guards/pr-review.test.ts (test file)
- tests/cli/review-amend.test.ts (test file)
- tests/cli/review-findings.test.ts (test file)
- tests/cli/review-state.test.ts (test file)
- tests/core/metaphor-preview.test.ts (test file)
- tests/core/review.test.ts (test file)
- tests/core/dispersion.test.ts (test file)
- tests/cli/initiative.test.ts (test file)
- tests/core/initiative.test.ts (test file)

## Similar Past Tickets
- S10-2: "CI/test signal parser for Vitest and Jest" → in_the_hole (sprint 10)
- S29-1: "Fix broken test mocks" → in_the_hole (sprint 29)
- S29-6: "Test full release→publish flow" → green (sprint 29)

## Constraints
- pnpm test passes
- pnpm typecheck passes
- Review and harden builder.test.ts

## Verification
- pnpm test
- pnpm typecheck
