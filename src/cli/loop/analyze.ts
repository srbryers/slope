import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { resolveLoopConfig } from './config.js';
import { createLogger } from './logger.js';

/**
 * Mine scorecards to generate analysis.json + backlog.json.
 * Delegates to the existing analyze-scorecards.ts script which
 * has mature analysis logic (temporal weighting, hotspot detection,
 * 5-strategy backlog generation).
 */
export async function runAnalyze(flags: Record<string, string>, cwd: string): Promise<void> {
  const config = resolveLoopConfig(cwd);
  const log = createLogger('loop:analyze');
  const regenerate = flags.regenerate === 'true';

  const backlogPath = join(cwd, config.backlogPath);
  const analysisPath = join(cwd, 'slope-loop/analysis.json');
  const scriptPath = join(cwd, 'slope-loop/analyze-scorecards.ts');

  if (!existsSync(scriptPath)) {
    log.error(`Analysis script not found: ${scriptPath}`);
    process.exit(1);
  }

  if (existsSync(backlogPath) && !regenerate) {
    log.info('Backlog already exists. Use --regenerate to rebuild.');
    log.info(`  Backlog: ${backlogPath}`);
    if (existsSync(analysisPath)) {
      log.info(`  Analysis: ${analysisPath}`);
    }
    return;
  }

  // Build first (the script imports from dist/)
  log.info('Building project (required for analysis)...');
  try {
    execSync('pnpm build', { cwd, stdio: 'pipe', timeout: 120_000 });
  } catch {
    log.error('Build failed — cannot run analysis');
    process.exit(1);
  }

  log.info('Running scorecard analysis...');
  try {
    const output = execSync(`npx tsx "${scriptPath}"`, {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120_000,
    });
    console.log(output);
  } catch (err) {
    const error = err as { stderr?: string; message: string };
    log.error(`Analysis failed: ${error.stderr ?? error.message}`);
    process.exit(1);
  }

  if (existsSync(backlogPath)) {
    log.info(`Backlog generated: ${backlogPath}`);
  }
  if (existsSync(analysisPath)) {
    log.info(`Analysis written: ${analysisPath}`);
  }
}
