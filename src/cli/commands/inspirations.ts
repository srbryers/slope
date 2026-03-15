// slope inspirations — Track external OSS inspiration sources

import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { loadConfig, loadInspirations, validateInspirations, linkInspirationToSprint, deriveId } from '../../core/index.js';
import type { InspirationsFile, InspirationStatus } from '../../core/index.js';

function parseRepeatable(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) {
      values.push(args[++i]);
    } else if (args[i].startsWith(`${flag}=`)) {
      values.push(args[i].slice(flag.length + 1));
    }
  }
  return values;
}

function parseFlag(args: string[], flag: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) return args[i + 1];
    if (args[i].startsWith(`${flag}=`)) return args[i].slice(flag.length + 1);
  }
  return undefined;
}

function inspirationsAdd(args: string[], inspirationsPath: string): void {
  const url = parseFlag(args, '--url');
  const project = parseFlag(args, '--project');
  const ideas = parseRepeatable(args, '--idea');
  const idOverride = parseFlag(args, '--id');

  if (!url || !project || ideas.length === 0) {
    console.error('Usage: slope inspirations add --url=<url> --project=<name> --idea="idea text" [--idea="another"] [--id=<id>]');
    process.exit(1);
  }

  const id = idOverride ?? deriveId(project);

  // Load or create file
  let file: InspirationsFile = loadInspirations(inspirationsPath) ?? {
    version: '1',
    last_updated: new Date().toISOString(),
    inspirations: [],
  };

  // Check for ID collision
  if (file.inspirations.some(e => e.id === id)) {
    console.error(`Error: Inspiration with ID "${id}" already exists.`);
    console.error(`Use --id=<unique-id> to specify a different ID.`);
    process.exit(1);
  }

  file.inspirations.push({
    id,
    source_url: url,
    project_name: project,
    ideas,
    status: 'backlogged',
    linked_sprints: [],
    added_at: new Date().toISOString(),
  });

  file.last_updated = new Date().toISOString();

  const dir = dirname(inspirationsPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(inspirationsPath, JSON.stringify(file, null, 2) + '\n');
  console.log(`Added inspiration "${id}" (${project}) with ${ideas.length} idea(s).`);
}

function inspirationsList(args: string[], inspirationsPath: string): void {
  const file = loadInspirations(inspirationsPath);
  if (!file) {
    console.log('No inspirations tracked. Run `slope inspirations add` to add one.\n');
    return;
  }

  if (file.inspirations.length === 0) {
    console.log('Inspirations file exists but contains no entries.\n');
    return;
  }

  const statusFilter = parseFlag(args, '--status') as InspirationStatus | undefined;
  let entries = file.inspirations;
  if (statusFilter) {
    entries = entries.filter(e => e.status === statusFilter);
  }

  console.log('\nInspiration Sources\n');
  console.log('| ID | Project | Status | Ideas | Sprints |');
  console.log('|----|---------|--------|-------|---------|');

  for (const entry of entries) {
    const sprints = entry.linked_sprints.length > 0 ? entry.linked_sprints.join(', ') : '—';
    console.log(`| ${entry.id} | ${entry.project_name} | ${entry.status} | ${entry.ideas.length} | ${sprints} |`);
  }

  console.log(`\n${entries.length} inspiration(s)${statusFilter ? ` (filtered: ${statusFilter})` : ''}.\n`);
}

function inspirationsLink(args: string[], inspirationsPath: string): void {
  const id = parseFlag(args, '--id');
  const sprintStr = parseFlag(args, '--sprint');

  if (!id || !sprintStr) {
    console.error('Usage: slope inspirations link --id=<id> --sprint=<N>');
    process.exit(1);
  }

  const sprint = parseInt(sprintStr, 10);
  if (isNaN(sprint)) {
    console.error(`Invalid sprint number: ${sprintStr}`);
    process.exit(1);
  }

  linkInspirationToSprint(inspirationsPath, id, sprint);
  console.log(`Linked inspiration "${id}" to sprint ${sprint}.`);
}

export async function inspirationsCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const inspirationsPath = join(cwd, config.inspirationsPath ?? '.slope/inspirations.json');

  const sub = args[0];

  switch (sub) {
    case 'add':
      inspirationsAdd(args.slice(1), inspirationsPath);
      break;
    case 'list':
      inspirationsList(args.slice(1), inspirationsPath);
      break;
    case 'link':
      inspirationsLink(args.slice(1), inspirationsPath);
      break;
    default:
      console.log(`
slope inspirations — Track external OSS inspiration sources

Usage:
  slope inspirations add --url=<url> --project=<name> --idea="idea" [--idea="another"] [--id=<id>]
  slope inspirations list [--status=<status>]
  slope inspirations link --id=<id> --sprint=<N>

Tracks external projects and ideas adapted into SLOPE.
Queryable via MCP: search({ module: 'inspirations' })
`);
      if (sub) process.exit(1);
      break;
  }
}
