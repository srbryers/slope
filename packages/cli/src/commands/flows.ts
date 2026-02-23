// slope flows — Manage user flow definitions

import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { loadConfig, loadFlows, validateFlows, checkFlowStaleness } from '@slope-dev/core';
import type { FlowsFile } from '@slope-dev/core';

const EXAMPLE_FLOWS: FlowsFile = {
  version: '1',
  last_generated: new Date().toISOString(),
  flows: [
    {
      id: 'example-flow',
      title: 'Example User Flow',
      description: 'Replace this with a real user-facing workflow (e.g., OAuth login, checkout, onboarding).',
      entry_point: 'src/index.ts',
      steps: [
        {
          name: 'Entry',
          description: 'User arrives at the entry point',
          file_paths: ['src/index.ts'],
        },
      ],
      files: ['src/index.ts'],
      tags: ['example'],
      last_verified_sha: '',
      last_verified_at: '',
    },
  ],
};

function getCurrentSha(cwd: string): string {
  try {
    return execSync('git rev-parse HEAD', { cwd, encoding: 'utf8', timeout: 5000 }).trim();
  } catch {
    return '';
  }
}

function flowsInit(cwd: string, flowsPath: string): void {
  if (existsSync(flowsPath)) {
    console.log(`Flows file already exists at ${flowsPath}`);
    console.log('Edit it directly to add flow definitions.\n');
    return;
  }

  const dir = dirname(flowsPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(flowsPath, JSON.stringify(EXAMPLE_FLOWS, null, 2) + '\n');
  console.log(`Created flows file at ${flowsPath}`);
  console.log('Edit the example flow or replace with your own definitions.\n');
}

function flowsList(cwd: string, flowsPath: string): void {
  const flows = loadFlows(flowsPath);
  if (!flows) {
    console.log('No flows defined. Run `slope flows init` to create a template.\n');
    return;
  }

  if (flows.flows.length === 0) {
    console.log('Flows file exists but contains no flow definitions.\n');
    return;
  }

  const currentSha = getCurrentSha(cwd);

  console.log('\nUser Flow Definitions\n');
  console.log('| ID | Title | Tags | Files | Stale? |');
  console.log('|----|-------|------|-------|--------|');

  for (const flow of flows.flows) {
    const tags = flow.tags.join(', ') || '—';
    let staleLabel = '—';

    if (flow.last_verified_sha && currentSha) {
      const { stale, changedFiles } = checkFlowStaleness(flow, currentSha, cwd);
      staleLabel = stale ? `Yes (${changedFiles.length} files)` : 'No';
    } else if (!flow.last_verified_sha) {
      staleLabel = 'Unverified';
    }

    console.log(`| ${flow.id} | ${flow.title} | ${tags} | ${flow.files.length} | ${staleLabel} |`);
  }

  console.log(`\n${flows.flows.length} flow(s) defined.\n`);
}

function flowsCheck(cwd: string, flowsPath: string): void {
  const flows = loadFlows(flowsPath);
  if (!flows) {
    console.error('No flows file found. Run `slope flows init` to create one.\n');
    process.exit(1);
  }

  console.log('\nSLOPE Flow Validation\n');

  // Structural validation
  const { errors, warnings } = validateFlows(flows, cwd);

  for (const err of errors) {
    console.log(`  \x1b[31m[ERROR]\x1b[0m ${err}`);
  }
  for (const warn of warnings) {
    console.log(`  \x1b[33m[WARN]\x1b[0m ${warn}`);
  }

  // Staleness check
  const currentSha = getCurrentSha(cwd);
  const staleFlows: string[] = [];

  if (currentSha) {
    for (const flow of flows.flows) {
      if (!flow.last_verified_sha) {
        console.log(`  \x1b[33m[WARN]\x1b[0m Flow "${flow.id}": no last_verified_sha — cannot check staleness`);
        continue;
      }
      const { stale, changedFiles } = checkFlowStaleness(flow, currentSha, cwd);
      if (stale) {
        staleFlows.push(flow.id);
        console.log(`  \x1b[31m[STALE]\x1b[0m Flow "${flow.id}": ${changedFiles.length} file(s) changed: ${changedFiles.join(', ')}`);
      } else {
        console.log(`  \x1b[32m[OK]\x1b[0m Flow "${flow.id}": current`);
      }
    }
  }

  console.log('');

  if (errors.length > 0) {
    console.log(`\x1b[31m${errors.length} error(s), ${warnings.length} warning(s)\x1b[0m\n`);
    process.exit(1);
  }

  if (staleFlows.length > 0) {
    console.log(`\x1b[33m${staleFlows.length} stale flow(s)\x1b[0m\n`);
    process.exit(1);
  }

  console.log(`\x1b[32mAll ${flows.flows.length} flow(s) valid and current.\x1b[0m\n`);
}

export async function flowsCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const flowsPath = join(cwd, config.flowsPath);

  const sub = args[0];

  switch (sub) {
    case 'init':
      flowsInit(cwd, flowsPath);
      break;
    case 'list':
      flowsList(cwd, flowsPath);
      break;
    case 'check':
      flowsCheck(cwd, flowsPath);
      break;
    default:
      console.log(`
slope flows — Manage user flow definitions

Usage:
  slope flows init     Create .slope/flows.json with example template
  slope flows list     List all flows with staleness indicators
  slope flows check    Validate all flows (file existence, staleness); exit 1 if stale

Flow definitions map user-facing workflows (OAuth, checkout, onboarding) to
code paths, making them queryable via MCP: search({ module: 'flows' })
`);
      if (sub) process.exit(1);
      break;
  }
}
