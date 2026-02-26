// SLOPE — Complexity Estimator
// Derives par, slope, risk areas, and bus factor from a RepoProfile.

import type { RepoProfile } from './types.js';

export interface ComplexityProfile {
  estimatedPar: 3 | 4 | 5;
  estimatedSlope: number;
  slopeFactors: string[];
  riskAreas: Array<{ module: string; reason: string }>;
  busFactor: Array<{ module: string; topContributor: string; pct: number }>;
}

/**
 * Estimate complexity from a RepoProfile.
 * Par is based on module count, slope from structural signals.
 */
export function estimateComplexity(profile: RepoProfile): ComplexityProfile {
  // --- Par estimation from module count ---
  const moduleCount = profile.structure.modules.length;
  let estimatedPar: 3 | 4 | 5;
  if (moduleCount <= 2) {
    estimatedPar = 3;
  } else if (moduleCount <= 4) {
    estimatedPar = 4;
  } else {
    estimatedPar = 5;
  }

  // --- Slope factors ---
  const slopeFactors: string[] = [];
  if (profile.structure.isMonorepo) slopeFactors.push('monorepo');
  if (profile.testing.testFileCount === 0) slopeFactors.push('no-tests');
  if (profile.git.contributors.length === 1) slopeFactors.push('solo-developer');
  if (profile.structure.largeFiles.length > 3) slopeFactors.push('large-files');
  if (profile.stack.frameworks.length > 5) slopeFactors.push('complex-stack');

  // --- Risk areas: high file count modules with no apparent test coverage ---
  const testDirSet = new Set(profile.testing.testDirs.map(d => d.replace(/^tests?\//, '')));
  const riskAreas: Array<{ module: string; reason: string }> = [];
  for (const mod of profile.structure.modules) {
    if (mod.fileCount > 20 && !testDirSet.has(mod.name)) {
      riskAreas.push({ module: mod.name, reason: 'High file count with no dedicated test directory' });
    }
  }

  // --- Bus factor: approximate from contributors ---
  const busFactor: Array<{ module: string; topContributor: string; pct: number }> = [];
  const contributors = profile.git.contributors;
  if (contributors.length === 1) {
    // Solo developer — all modules have bus factor risk
    for (const mod of profile.structure.modules) {
      busFactor.push({
        module: mod.name,
        topContributor: contributors[0].name,
        pct: 100,
      });
    }
  } else if (contributors.length > 0) {
    // Check if top contributor dominates (>80% of commits)
    const totalCommits = contributors.reduce((sum, c) => sum + c.commits, 0);
    const top = contributors[0]; // already sorted by commit count from analyzer
    const topPct = Math.round((top.commits / totalCommits) * 100);
    if (topPct > 80) {
      for (const mod of profile.structure.modules) {
        busFactor.push({
          module: mod.name,
          topContributor: top.name,
          pct: topPct,
        });
      }
    }
  }

  return {
    estimatedPar,
    estimatedSlope: slopeFactors.length,
    slopeFactors,
    riskAreas,
    busFactor,
  };
}
