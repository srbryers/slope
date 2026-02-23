import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';
import { loadConfig, loadScorecards, detectLatestSprint, GUARD_DEFINITIONS } from '@slope-dev/core';
import type { SlopeConfig } from '@slope-dev/core';

// ── Helpers ─────────────────────────────────────────────────────

function exec(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', timeout: 10000 }).trim();
  } catch {
    return '';
  }
}

function countSourceFiles(root: string): { source: number; test: number } {
  let source = 0;
  let test = 0;

  function walk(dir: string): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts')) {
          test++;
        } else {
          source++;
        }
      }
    }
  }

  walk(root);
  return { source, test };
}

// ── Metadata ────────────────────────────────────────────────────

interface MapMetadata {
  generated_at: string;
  git_sha: string;
  sprint: number;
  source_files: number;
  test_files: number;
  packages: number;
  cli_commands: number;
  guards: number;
}

function gatherMetadata(cwd: string, config: SlopeConfig): MapMetadata {
  const gitSha = exec('git rev-parse HEAD', cwd);
  const latestSprint = detectLatestSprint(config, cwd);

  // Count source and test files across all packages
  const packagesDir = join(cwd, 'packages');
  const { source, test } = countSourceFiles(packagesDir);

  // Count packages
  const pkgDirs = existsSync(packagesDir)
    ? readdirSync(packagesDir, { withFileTypes: true }).filter(d => d.isDirectory()).length
    : 0;

  // Count CLI commands
  const commandsDir = join(cwd, 'packages', 'cli', 'src', 'commands');
  const cliCommands = existsSync(commandsDir)
    ? readdirSync(commandsDir).filter(f => f.endsWith('.ts')).length
    : 0;

  return {
    generated_at: new Date().toISOString(),
    git_sha: gitSha,
    sprint: latestSprint,
    source_files: source,
    test_files: test,
    packages: pkgDirs,
    cli_commands: cliCommands,
    guards: GUARD_DEFINITIONS.length,
  };
}

// ── Section Generators ──────────────────────────────────────────

function generatePackageInventory(cwd: string): string {
  const packagesDir = join(cwd, 'packages');
  if (!existsSync(packagesDir)) return '';

  const lines: string[] = [''];

  const pkgs = readdirSync(packagesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  for (const pkg of pkgs) {
    const pkgDir = join(packagesDir, pkg);
    const { source, test } = countSourceFiles(pkgDir);

    // Read package.json for description
    const pkgJsonPath = join(pkgDir, 'package.json');
    let description = '';
    if (existsSync(pkgJsonPath)) {
      try {
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
        description = pkgJson.description || '';
      } catch { /* skip */ }
    }

    lines.push(`### \`packages/${pkg}\``);
    if (description) lines.push(`${description}`);
    lines.push(`- Source files: ${source} | Test files: ${test}`);

    // List key modules (src/*.ts top-level files)
    const srcDir = join(pkgDir, 'src');
    if (existsSync(srcDir)) {
      const modules = readdirSync(srcDir)
        .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.spec.ts') && f !== 'index.ts')
        .sort();

      if (modules.length > 0) {
        lines.push('- Key modules:');
        for (const mod of modules.slice(0, 15)) {
          const modPath = join(srcDir, mod);
          const firstLine = readFirstComment(modPath);
          const label = mod.replace('.ts', '');
          lines.push(`  - \`${label}\`${firstLine ? ` — ${firstLine}` : ''}`);
        }
        if (modules.length > 15) {
          lines.push(`  - ... and ${modules.length - 15} more`);
        }
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

function readFirstComment(filePath: string): string {
  try {
    const content = readFileSync(filePath, 'utf8');
    // Match first single-line comment or JSDoc description
    const singleLine = content.match(/^\/\/\s*(.+)/m);
    if (singleLine) return singleLine[1].trim();
    const jsDoc = content.match(/\/\*\*\s*\n?\s*\*?\s*(.+)/);
    if (jsDoc) return jsDoc[1].replace(/\*\/$/, '').trim();
  } catch { /* skip */ }
  return '';
}

function generateApiSurface(cwd: string): string {
  const indexPath = join(cwd, 'packages', 'core', 'src', 'index.ts');
  if (!existsSync(indexPath)) return '';

  const content = readFileSync(indexPath, 'utf8');
  const lines: string[] = [''];

  // Match all export blocks (single and multi-line) and section comments
  const exportRegex = /^(\/\/\s*.+)|^(export\s+(?:type\s+)?\{[\s\S]*?\})/gm;
  let match: RegExpExecArray | null;

  while ((match = exportRegex.exec(content)) !== null) {
    // Section comment
    if (match[1]) {
      const text = match[1].replace(/^\/\/\s*/, '').trim();
      if (!text.includes('barrel export')) {
        lines.push(`**${text}:**`);
      }
      continue;
    }

    // Export block
    if (match[2]) {
      const block = match[2];
      const isType = block.startsWith('export type');
      // Extract names from the braces
      const braceContent = block.match(/\{([\s\S]*?)\}/)?.[1] ?? '';
      const names = braceContent
        .split(',')
        .map(n => n.trim())
        .filter(n => n && !n.includes(' as '));
      if (names.length > 0) {
        const suffix = isType ? ' (types)' : '';
        lines.push(`- ${names.map(n => `\`${n}\``).join(', ')}${suffix}`);
      }
    }
  }

  return lines.join('\n');
}

function generateCliCommands(cwd: string): string {
  const commandsDir = join(cwd, 'packages', 'cli', 'src', 'commands');
  if (!existsSync(commandsDir)) return '';

  const lines: string[] = [''];

  const files = readdirSync(commandsDir)
    .filter(f => f.endsWith('.ts'))
    .sort();

  for (const file of files) {
    const name = file.replace('.ts', '');
    const filePath = join(commandsDir, file);
    const firstLine = readFirstComment(filePath);
    lines.push(`- \`slope ${name}\`${firstLine ? ` — ${firstLine}` : ''}`);
  }

  return lines.join('\n');
}

function generateGuardsList(): string {
  const lines: string[] = [''];

  lines.push('| Guard | Hook Event | Matcher | Description |');
  lines.push('|-------|-----------|---------|-------------|');

  for (const g of GUARD_DEFINITIONS) {
    lines.push(`| \`${g.name}\` | ${g.hookEvent} | ${g.matcher || '—'} | ${g.description} |`);
  }

  return lines.join('\n');
}

function generateMcpTools(cwd: string): string {
  // Read SLOPE_MCP_TOOL_NAMES from the mcp-tools package source
  const mcpIndexPath = join(cwd, 'packages', 'mcp-tools', 'src', 'index.ts');
  if (!existsSync(mcpIndexPath)) return '';

  const content = readFileSync(mcpIndexPath, 'utf8');
  const match = content.match(/SLOPE_MCP_TOOL_NAMES\s*=\s*\[([^\]]+)\]/);
  if (!match) return '';

  const tools = match[1]
    .split(',')
    .map(t => t.trim().replace(/['"]/g, ''))
    .filter(Boolean);

  const lines: string[] = [''];
  for (const tool of tools) {
    lines.push(`- \`${tool}\``);
  }

  return lines.join('\n');
}

function generateTestInventory(cwd: string): string {
  const packagesDir = join(cwd, 'packages');
  if (!existsSync(packagesDir)) return '';

  const lines: string[] = [''];

  lines.push('| Package | Test Files | Command |');
  lines.push('|---------|-----------|---------|');

  const pkgs = readdirSync(packagesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  let totalTests = 0;
  for (const pkg of pkgs) {
    const { test } = countSourceFiles(join(packagesDir, pkg));
    totalTests += test;
    if (test > 0) {
      lines.push(`| ${pkg} | ${test} | \`pnpm --filter @slope-dev/${pkg} test\` |`);
    }
  }

  lines.push('');
  lines.push(`**Total test files:** ${totalTests}`);
  lines.push('**Run all:** `pnpm -r test`');
  lines.push('**Typecheck:** `pnpm -r typecheck`');

  return lines.join('\n');
}

function generateSprintHistory(cwd: string, config: SlopeConfig): string {
  const scorecards = loadScorecards(config, cwd);
  if (scorecards.length === 0) return '';

  // Last 5 sprints
  const recent = scorecards.slice(-5);
  const lines: string[] = [''];

  lines.push('| Sprint | Theme | Tickets | Score |');
  lines.push('|--------|-------|---------|-------|');

  for (const card of recent) {
    const ticketCount = card.shots?.length ?? 0;
    const scoreLabel = card.score_label ?? '';
    lines.push(`| **${card.sprint_number}** | ${card.theme ?? ''} | ${ticketCount} | ${scoreLabel} |`);
  }

  return lines.join('\n');
}

function generateKnownGotchas(cwd: string, config: SlopeConfig): string {
  const issuesPath = join(cwd, config.commonIssuesPath);
  if (!existsSync(issuesPath)) return '';

  try {
    const data = JSON.parse(readFileSync(issuesPath, 'utf8'));
    const patterns = data.recurring_patterns ?? [];
    if (patterns.length === 0) return '';

    // Top patterns by sprint frequency
    const sorted = [...patterns]
      .sort((a: { sprints_hit?: number[] }, b: { sprints_hit?: number[] }) =>
        (b.sprints_hit?.length ?? 0) - (a.sprints_hit?.length ?? 0))
      .slice(0, 10);

    const lines: string[] = [''];

    for (const p of sorted) {
      const hits = p.sprints_hit?.length ?? 0;
      lines.push(`- **${p.title}** (${p.category}, ${hits} sprint${hits !== 1 ? 's' : ''}): ${p.description ?? ''}`);
    }

    return lines.join('\n');
  } catch {
    return '';
  }
}

// ── Auto-section replacement ────────────────────────────────────

function replaceAutoSection(content: string, sectionName: string, newContent: string): string {
  const startMarker = `<!-- AUTO-GENERATED: START ${sectionName} -->`;
  const endMarker = `<!-- AUTO-GENERATED: END ${sectionName} -->`;

  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1) {
    return content;
  }

  const before = content.slice(0, startIdx + startMarker.length);
  const after = content.slice(endIdx);

  return `${before}\n${newContent}\n${after}`;
}

function updateMetadataBlock(content: string, meta: MapMetadata): string {
  return content.replace(
    /^---\n[\s\S]*?\n---/m,
    [
      '---',
      `generated_at: "${meta.generated_at}"`,
      `git_sha: "${meta.git_sha}"`,
      `sprint: ${meta.sprint}`,
      `source_files: ${meta.source_files}`,
      `test_files: ${meta.test_files}`,
      `packages: ${meta.packages}`,
      `cli_commands: ${meta.cli_commands}`,
      `guards: ${meta.guards}`,
      '---',
    ].join('\n'),
  );
}

// ── Template for new map ────────────────────────────────────────

function generateFullMap(cwd: string, config: SlopeConfig, meta: MapMetadata): string {
  const sections = [
    `---
generated_at: "${meta.generated_at}"
git_sha: "${meta.git_sha}"
sprint: ${meta.sprint}
source_files: ${meta.source_files}
test_files: ${meta.test_files}
packages: ${meta.packages}
cli_commands: ${meta.cli_commands}
guards: ${meta.guards}
---

# SLOPE Codebase Map

Sprint Lifecycle & Operational Performance Engine — pluggable-metaphor sprint scoring.

## Package Inventory

<!-- AUTO-GENERATED: START packages -->
${generatePackageInventory(cwd)}
<!-- AUTO-GENERATED: END packages -->

## API Surface (core)

Re-exports from \`packages/core/src/index.ts\`:

<!-- AUTO-GENERATED: START api -->
${generateApiSurface(cwd)}
<!-- AUTO-GENERATED: END api -->

## CLI Commands

<!-- AUTO-GENERATED: START cli -->
${generateCliCommands(cwd)}
<!-- AUTO-GENERATED: END cli -->

## Guard Definitions

<!-- AUTO-GENERATED: START guards -->
${generateGuardsList()}
<!-- AUTO-GENERATED: END guards -->

## MCP Tools

<!-- AUTO-GENERATED: START mcp -->
${generateMcpTools(cwd)}
<!-- AUTO-GENERATED: END mcp -->

## Test Inventory

<!-- AUTO-GENERATED: START tests -->
${generateTestInventory(cwd)}
<!-- AUTO-GENERATED: END tests -->

## Recent Sprint History

<!-- AUTO-GENERATED: START history -->
${generateSprintHistory(cwd, config)}
<!-- AUTO-GENERATED: END history -->

## Known Gotchas

Top recurring patterns from common-issues:

<!-- AUTO-GENERATED: START gotchas -->
${generateKnownGotchas(cwd, config)}
<!-- AUTO-GENERATED: END gotchas -->`,
  ];

  return sections.join('');
}

// ── Staleness Check ─────────────────────────────────────────────

export interface CheckResult {
  label: string;
  status: 'ok' | 'warn' | 'stale';
  message: string;
}

export function parseMapMetadata(content: string): Record<string, string> {
  const metaMatch = content.match(/^---\n([\s\S]*?)\n---/m);
  if (!metaMatch) return {};

  const meta: Record<string, string> = {};
  for (const line of metaMatch[1].split('\n')) {
    const m = line.match(/^(\w+):\s*"?([^"]*)"?$/);
    if (m) meta[m[1]] = m[2];
  }
  return meta;
}

export function runStalenessCheck(cwd: string, config: SlopeConfig, mapContent: string): CheckResult[] {
  const results: CheckResult[] = [];
  const meta = parseMapMetadata(mapContent);
  const packagesDir = join(cwd, 'packages');
  const { source: currentSource } = countSourceFiles(packagesDir);

  // 1. Source file count drift
  const mapFiles = parseInt(meta.source_files || '0', 10);
  if (mapFiles > 0) {
    const drift = Math.abs(currentSource - mapFiles) / mapFiles;
    const driftPct = (drift * 100).toFixed(1);
    if (drift > 0.20) {
      results.push({ label: 'Source files', status: 'stale', message: `${currentSource} (map says ${mapFiles}, ${driftPct}% drift) — STALE` });
    } else if (drift > 0.10) {
      results.push({ label: 'Source files', status: 'warn', message: `${currentSource} (map says ${mapFiles}, ${driftPct}% drift)` });
    } else {
      results.push({ label: 'Source files', status: 'ok', message: `${currentSource} (map says ${mapFiles}) — OK` });
    }
  }

  // 2. Git distance
  const mapSha = meta.git_sha || '';
  if (mapSha) {
    const distance = parseInt(exec(`git rev-list --count ${mapSha}..HEAD 2>/dev/null`, cwd) || '0', 10);
    if (distance > 50) {
      results.push({ label: 'Git distance', status: 'stale', message: `${distance} commits behind (threshold: 50)` });
    } else if (distance > 30) {
      results.push({ label: 'Git distance', status: 'warn', message: `${distance} commits behind` });
    } else {
      results.push({ label: 'Git distance', status: 'ok', message: `${distance} commits behind — OK` });
    }
  }

  // 3. Sprint currency
  const mapSprint = parseInt(meta.sprint || '0', 10);
  const currentSprint = detectLatestSprint(config, cwd);
  const sprintDelta = currentSprint - mapSprint;
  if (sprintDelta > 3) {
    results.push({ label: 'Sprint currency', status: 'stale', message: `Sprint ${currentSprint} (map says ${mapSprint}, +${sprintDelta} behind)` });
  } else if (sprintDelta > 0) {
    results.push({ label: 'Sprint currency', status: 'warn', message: `Sprint ${currentSprint} (map says ${mapSprint}, +${sprintDelta})` });
  } else {
    results.push({ label: 'Sprint currency', status: 'ok', message: `Sprint ${currentSprint} — current` });
  }

  // 4. Dead file references
  const fileRefs = mapContent.matchAll(/`(packages\/[^`\s]+\.(?:ts|tsx|json|md))`/g);
  const deadRefs: string[] = [];
  for (const m of fileRefs) {
    const refPath = m[1];
    if (!existsSync(join(cwd, refPath))) {
      deadRefs.push(refPath);
    }
  }
  if (deadRefs.length > 0) {
    results.push({
      label: 'Dead references',
      status: deadRefs.length > 3 ? 'stale' : 'warn',
      message: `${deadRefs.length} file paths in map no longer exist:\n${deadRefs.slice(0, 5).map(r => `    - ${r}`).join('\n')}`,
    });
  } else {
    results.push({ label: 'Dead references', status: 'ok', message: 'All file paths valid' });
  }

  return results;
}

// ── Main Command ────────────────────────────────────────────────

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)(?:=(.+))?$/);
    if (match) result[match[1]] = match[2] ?? 'true';
  }
  return result;
}

export async function mapCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const flags = parseArgs(args);
  const config = loadConfig(cwd);
  const outputPath = flags.output || join(cwd, 'CODEBASE.md');
  const isCheck = flags.check === 'true';

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  if (isCheck) {
    // Staleness check mode
    if (!existsSync(outputPath)) {
      console.log('\x1b[31mNo codebase map found at CODEBASE.md\x1b[0m');
      console.log('  Run `slope map` to generate it.\n');
      process.exit(1);
    }

    console.log('\nSLOPE Codebase Map — Staleness Check\n');
    const content = readFileSync(outputPath, 'utf8');
    const results = runStalenessCheck(cwd, config, content);
    let hasStale = false;

    for (const r of results) {
      const icon = r.status === 'ok' ? '\x1b[32mok\x1b[0m' : r.status === 'warn' ? '\x1b[33mwarn\x1b[0m' : '\x1b[31mSTALE\x1b[0m';
      console.log(`  [${icon}] ${r.label}: ${r.message}`);
      if (r.status === 'stale') hasStale = true;
    }

    console.log('');
    if (hasStale) {
      console.log('\x1b[31mOverall: STALE — run `slope map` to refresh\x1b[0m\n');
      process.exit(1);
    } else {
      console.log('\x1b[32mOverall: CURRENT\x1b[0m\n');
    }
    return;
  }

  // Generate / update mode
  console.log('Updating codebase map...\n');

  const meta = gatherMetadata(cwd, config);

  if (existsSync(outputPath)) {
    // Update existing map — replace auto-generated sections only
    let content = readFileSync(outputPath, 'utf8');

    content = updateMetadataBlock(content, meta);
    content = replaceAutoSection(content, 'packages', generatePackageInventory(cwd));
    content = replaceAutoSection(content, 'api', generateApiSurface(cwd));
    content = replaceAutoSection(content, 'cli', generateCliCommands(cwd));
    content = replaceAutoSection(content, 'guards', generateGuardsList());
    content = replaceAutoSection(content, 'mcp', generateMcpTools(cwd));
    content = replaceAutoSection(content, 'tests', generateTestInventory(cwd));
    content = replaceAutoSection(content, 'history', generateSprintHistory(cwd, config));
    content = replaceAutoSection(content, 'gotchas', generateKnownGotchas(cwd, config));

    writeFileSync(outputPath, content, 'utf8');
    console.log('  Updated auto-generated sections');
  } else {
    // Create new map from template
    const content = generateFullMap(cwd, config, meta);
    writeFileSync(outputPath, content, 'utf8');
    console.log('  Created new codebase map');
  }

  const finalContent = readFileSync(outputPath, 'utf8');
  const lineCount = finalContent.split('\n').length;
  const sizeKb = (Buffer.byteLength(finalContent, 'utf8') / 1024).toFixed(1);
  console.log(`  ${lineCount} lines, ${sizeKb}KB`);
  console.log(`  ${meta.source_files} source files, ${meta.test_files} test files, ${meta.packages} packages`);
  console.log(`  ${meta.cli_commands} CLI commands, ${meta.guards} guards`);
  console.log(`\nMap written to ${relative(cwd, outputPath)}\n`);
}

function printUsage(): void {
  console.log(`
slope map — Generate/update the SLOPE codebase map

Usage:
  slope map                   Generate or update CODEBASE.md
  slope map --check           Check staleness (exit 1 if stale)
  slope map --output=<path>   Custom output path (default: CODEBASE.md)

The codebase map provides a compact (~500 line) overview of the project
for agent navigation. Auto-generated sections are updated in place;
manual content between markers is preserved.
`);
}
