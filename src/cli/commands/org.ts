/**
 * slope org — Multi-repo aggregation commands
 *
 * Subcommands:
 *   slope org init              Create .slope/org.json template
 *   slope org status [--json]   Show all repos, handicaps, active sprints
 *   slope org issues [--json]   Show org-wide recurring patterns
 */

import { loadOrgConfig, createOrgConfig, computeOrgHandicap, mergeCommonIssues } from '../../core/org.js';

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)(?:=(.+))?$/);
    if (match) flags[match[1]] = match[2] ?? 'true';
  }
  return flags;
}

export async function orgCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const flags = parseFlags(args.slice(1));
  const cwd = process.cwd();

  switch (sub) {
    case 'init':
      initCommand(cwd);
      break;
    case 'status':
      statusCommand(cwd, flags);
      break;
    case 'issues':
      issuesCommand(cwd, flags);
      break;
    default:
      console.log(`
slope org — Multi-repo aggregation

Usage:
  slope org init              Create .slope/org.json template with repo paths
  slope org status [--json]   Show all repos with handicaps and sprint counts
  slope org issues [--json]   Show recurring patterns shared across repos
`);
      if (sub) process.exit(1);
  }
}

function initCommand(cwd: string): void {
  const template = [
    { name: 'current', path: cwd },
  ];
  createOrgConfig(cwd, template);
  console.log('\nCreated .slope/org.json with current repo.');
  console.log('Edit the file to add more repos:\n');
  console.log('  { "repos": [');
  console.log('    { "name": "api", "path": "/path/to/api" },');
  console.log('    { "name": "web", "path": "/path/to/web" }');
  console.log('  ] }\n');
}

function statusCommand(cwd: string, flags: Record<string, string>): void {
  const orgConfig = loadOrgConfig(cwd);
  const orgHandicap = computeOrgHandicap(orgConfig);

  if (flags.json === 'true') {
    console.log(JSON.stringify(orgHandicap, null, 2));
    return;
  }

  console.log('\n=== Org Status ===\n');
  console.log(`  Repos: ${orgConfig.repos.length}`);
  console.log(`  Total sprints: ${orgHandicap.total_sprints}`);

  if (orgHandicap.per_repo.length > 0) {
    console.log(`  Org handicap: ${orgHandicap.overall.all_time.handicap.toFixed(1)}\n`);

    console.log('  Repo              Handicap  Sprints  Latest');
    console.log('  ────────────────  ────────  ───────  ──────');
    for (const r of orgHandicap.per_repo) {
      const hcp = r.handicap.all_time.handicap.toFixed(1);
      const latest = r.latest_sprint !== undefined ? `S${r.latest_sprint}` : '—';
      console.log(`  ${r.repo.padEnd(18)}${hcp.padStart(8)}  ${String(r.sprint_count).padStart(7)}  ${latest.padStart(6)}`);
    }
  } else {
    console.log('\n  No scorecards found in any repo.');
  }
  console.log('');
}

function issuesCommand(cwd: string, flags: Record<string, string>): void {
  const orgConfig = loadOrgConfig(cwd);
  const orgIssues = mergeCommonIssues(orgConfig);

  if (flags.json === 'true') {
    console.log(JSON.stringify(orgIssues, null, 2));
    return;
  }

  if (orgIssues.length === 0) {
    console.log('\nNo recurring patterns shared across 2+ repos.\n');
    return;
  }

  console.log(`\n=== Org-Wide Recurring Patterns (${orgIssues.length}) ===\n`);
  for (const issue of orgIssues) {
    console.log(`  [${issue.category}] ${issue.title}`);
    console.log(`    Repos: ${issue.repos.join(', ')}`);
    console.log(`    Prevention: ${issue.prevention.slice(0, 100)}`);
    console.log('');
  }
}
