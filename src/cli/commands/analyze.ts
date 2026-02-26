// SLOPE — slope analyze: run repo profile analyzers
import { runAnalyzers, saveRepoProfile } from '../../core/analyzers/index.js';
import type { AnalyzerName, RepoProfile } from '../../core/analyzers/types.js';

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)(?:=(.+))?$/);
    if (match) result[match[1]] = match[2] ?? 'true';
  }
  return result;
}

function formatSummary(profile: RepoProfile): string {
  const lines: string[] = [];

  // Stack
  const stackParts = [profile.stack.primaryLanguage || 'unknown'];
  if (profile.stack.packageManager) stackParts.push(profile.stack.packageManager);
  if (profile.stack.runtime) stackParts.push(profile.stack.runtime);
  if (profile.stack.buildTool) stackParts.push(profile.stack.buildTool);
  if (profile.stack.frameworks.length > 0) stackParts.push(profile.stack.frameworks.slice(0, 3).join(', '));
  lines.push(`  Stack:       ${stackParts.join(', ')}`);

  // Structure
  lines.push(`  Structure:   ${profile.structure.sourceFiles} source files, ${profile.structure.testFiles} test files, ${profile.structure.modules.length} modules`);
  if (profile.structure.isMonorepo) lines[lines.length - 1] += ' (monorepo)';

  // Team
  const contribCount = profile.git.contributors.length;
  lines.push(`  Team:        ${contribCount} active contributor${contribCount !== 1 ? 's' : ''} (last 90 days)`);

  // Velocity
  lines.push(`  Velocity:    ${profile.git.commitsPerWeek} commits/week → ${profile.git.inferredCadence} cadence`);

  // Testing
  const testParts: string[] = [];
  if (profile.testing.framework) testParts.push(profile.testing.framework);
  if (profile.testing.hasCoverage) testParts.push('with coverage');
  if (profile.testing.testFileCount > 0) testParts.push(`${profile.testing.testFileCount} test files`);
  lines.push(`  Testing:     ${testParts.length > 0 ? testParts.join(', ') : 'none detected'}`);

  // CI
  if (profile.ci) {
    if (profile.ci.system) {
      const stages: string[] = [];
      if (profile.ci.hasTestStage) stages.push('test');
      if (profile.ci.hasBuildStage) stages.push('build');
      if (profile.ci.hasDeployStage) stages.push('deploy');
      const stageStr = stages.length > 0 ? ` (${stages.join(', ')})` : '';
      lines.push(`  CI:          ${profile.ci.system}${stageStr}`);
    } else {
      lines.push(`  CI:          none detected`);
    }
  }

  // Docs
  if (profile.docs) {
    const docParts: string[] = [];
    if (profile.docs.hasReadme) docParts.push('README');
    if (profile.docs.hasContributing) docParts.push('CONTRIBUTING');
    if (profile.docs.hasChangelog) docParts.push('CHANGELOG');
    if (profile.docs.hasAdr) docParts.push('ADR');
    if (profile.docs.hasApiDocs) docParts.push('API docs');
    lines.push(`  Docs:        ${docParts.length > 0 ? docParts.join(', ') : 'none detected'}`);
  }

  return lines.join('\n');
}

export async function analyzeCommand(args: string[]): Promise<void> {
  const flags = parseArgs(args);
  const cwd = process.cwd();

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
slope analyze — Scan repo and generate a profile

Usage:
  slope analyze                          Run all analyzers
  slope analyze --analyzers=stack,git    Run specific analyzers
  slope analyze --json                   Output full profile as JSON
`);
    return;
  }

  // Parse analyzer filter
  let analyzers: AnalyzerName[] | undefined;
  if (flags.analyzers) {
    analyzers = flags.analyzers.split(',').filter(
      (a): a is AnalyzerName => ['stack', 'structure', 'git', 'testing', 'ci', 'docs'].includes(a)
    );
  }

  console.log('Analyzing repository...\n');

  const profile = await runAnalyzers({ cwd, analyzers });
  saveRepoProfile(profile, cwd);

  if (flags.json === 'true') {
    console.log(JSON.stringify(profile, null, 2));
    return;
  }

  console.log(formatSummary(profile));
  console.log(`\n  Profile saved to .slope/repo-profile.json\n`);
}
