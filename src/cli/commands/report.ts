import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../config.js';
import { loadScorecards, buildReportData, generateHtmlReport, getMetaphor } from '../../core/index.js';

export async function reportCommand(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  const config = loadConfig();
  const cwd = process.cwd();

  // Parse flags
  const htmlFlag = args.includes('--html');
  const outputArg = args.find(a => a.startsWith('--output='));
  const metaphorArg = args.find(a => a.startsWith('--metaphor='));

  if (!htmlFlag) {
    console.log('Error: --html flag is required. Other formats coming soon.');
    console.log('Usage: slope report --html [--output=path]');
    process.exit(1);
  }

  // Load scorecards
  const scorecards = loadScorecards(config, cwd);
  if (scorecards.length === 0) {
    console.error('No scorecards found. Nothing to report.');
    process.exit(1);
  }

  // Build report data
  const data = buildReportData(scorecards);

  // Resolve metaphor
  const metaphorId = metaphorArg?.slice('--metaphor='.length) ?? config.metaphor ?? 'golf';
  let metaphor;
  try {
    metaphor = getMetaphor(metaphorId);
  } catch {
    console.error(`Unknown metaphor: "${metaphorId}". Using golf.`);
    metaphor = getMetaphor('golf');
  }

  // Generate HTML
  const html = generateHtmlReport(data, metaphor);

  // Write output
  const reportsDir = join(cwd, '.slope', 'reports');
  if (!existsSync(reportsDir)) {
    mkdirSync(reportsDir, { recursive: true });
  }

  const dateStr = new Date().toISOString().split('T')[0];
  const outputPath = outputArg?.slice('--output='.length) ?? join(reportsDir, `report-${dateStr}.html`);

  writeFileSync(outputPath, html, 'utf8');
  console.log(`\nSLOPE Report generated: ${outputPath}`);
  console.log(`  ${scorecards.length} scorecards analyzed`);
  console.log(`  Metaphor: ${metaphorId}`);
}

function printUsage(): void {
  console.log(`
slope report — Generate SLOPE performance reports

Usage:
  slope report --html                  Generate HTML report (default output: .slope/reports/)
  slope report --html --output=<path>  Generate to specific path
  slope report --html --metaphor=<id>  Use specific metaphor for labels

Examples:
  slope report --html
  slope report --html --output=my-report.html
  slope report --html --metaphor=gaming
`);
}
