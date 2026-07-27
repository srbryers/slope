import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';
import { compareSprintIdKeys, loadConfig, loadScorecards, detectLatestSprint, GUARD_DEFINITIONS, loadFlows, checkFlowStaleness, parseSprintId, sprintIdKey } from '../../core/index.js';
import type { SlopeConfig } from '../../core/index.js';
import { CLI_COMMAND_REGISTRY } from '../registry.js';
import { SLOPE_REGISTRY } from '../../mcp/registry.js';

// ── Helpers ─────────────────────────────────────────────────────

function exec(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, {
      cwd,
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function toRepoPath(path: string): string {
  return path.replace(/\\/g, '/');
}

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.cs', '.java', '.go', '.rs', '.rb', '.php',
  '.swift', '.kt', '.kts', '.c', '.cc', '.cpp', '.h', '.hpp',
]);

const SKIP_SOURCE_DIRS = new Set([
  '.git', '.slope', '.venv', 'venv', 'node_modules', 'dist',
  'build', 'coverage', '__pycache__', 'bin', 'obj', 'library', 'temp',
]);

function sourceExtension(name: string): string | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.d.ts')) return '.ts';
  for (const ext of SOURCE_EXTENSIONS) {
    if (lower.endsWith(ext)) return ext;
  }
  return null;
}

function isTestSource(name: string, fullPath: string): boolean {
  const lowerName = name.toLowerCase();
  const repoPath = toRepoPath(fullPath).toLowerCase();
  return /\.(test|spec)\.[^.]+$/.test(lowerName)
    || /_test\.[^.]+$/.test(lowerName)
    || /(^|\/)(__tests__|tests?|specs?)(\/|$)/.test(repoPath);
}

interface ProjectIdentity {
  /** True when running inside the SLOPE source repo (package.json name === @slope-dev/slope).
   *  False for downstream projects that installed SLOPE — they need a generic project map
   *  rather than a map of SLOPE's own internals. (#351) */
  isSlopeSelf: boolean;
  /** Display title for the map. SLOPE keeps its hardcoded title; generic projects use
   *  package.json `name` (or directory basename as fallback). */
  title: string;
  /** One-line description. SLOPE keeps its tagline; generic projects use package.json
   *  `description`, or omit if absent. */
  description: string | null;
}

function sprintCurrencyDeltaTenths(currentKey: string, mapKey: string): number {
  const current = parseSprintId(currentKey);
  const previous = parseSprintId(mapKey);
  if (!current) return 0;

  const rawDelta = previous
    ? (current.base - previous.base) * 10
      + (current.insert ?? 0)
      - (previous.insert ?? 0)
    : mapKey === '0'
      ? current.base * 10 + (current.insert ?? 0)
      : 0;
  const comparison = compareSprintIdKeys(currentKey, mapKey);

  if (comparison > 0) return Math.max(1, rawDelta);
  if (comparison < 0) return Math.min(-1, rawDelta);
  return 0;
}

function formatSprintCurrencyDelta(deltaTenths: number): string {
  const whole = Math.trunc(deltaTenths / 10);
  const fraction = Math.abs(deltaTenths % 10);
  return fraction === 0 ? String(whole) : `${whole}.${fraction}`;
}

function readProjectIdentity(cwd: string): ProjectIdentity {
  const pkgPath = join(cwd, 'package.json');
  let name: string | null = null;
  let description: string | null = null;
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (typeof pkg.name === 'string') name = pkg.name;
      if (typeof pkg.description === 'string') description = pkg.description;
    } catch {
      // Malformed package.json → treat as generic with no metadata
    }
  }
  const isSlopeSelf = name === '@slope-dev/slope';
  if (isSlopeSelf) {
    return {
      isSlopeSelf: true,
      title: 'SLOPE Codebase Map',
      description: 'Sprint Lifecycle & Operational Performance Engine — pluggable-metaphor sprint scoring.',
    };
  }
  // Fallback title for repos with no package.json: directory basename
  const fallback = cwd.split('/').filter(Boolean).pop() ?? 'Project';
  return {
    isSlopeSelf: false,
    title: `${name ?? fallback} Codebase Map`,
    description,
  };
}

function countSourceFiles(root: string): { source: number; test: number } {
  let source = 0;
  let test = 0;

  function walk(dir: string): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_SOURCE_DIRS.has(entry.name.toLowerCase())) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (sourceExtension(entry.name)) {
        if (isTestSource(entry.name, full)) {
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
  sprint: string;
  source_files: number;
  test_files: number;
  cli_commands: number;
  guards: number;
  flows: number;
}

function countMapMetadataFiles(cwd: string, identity: ProjectIdentity): { source: number; test: number } {
  // SLOPE itself has a known split layout; downstream projects may have
  // multiple source roots, so count from the repository root for them.
  if (identity.isSlopeSelf) {
    return {
      source: countSourceFiles(join(cwd, 'src')).source,
      test: countSourceFiles(join(cwd, 'tests')).test,
    };
  }
  return countSourceFiles(cwd);
}

function gatherMetadata(cwd: string, config: SlopeConfig, identity: ProjectIdentity): MapMetadata {
  const gitSha = exec('git rev-parse HEAD', cwd);
  const latestSprint = detectLatestSprint(config, cwd);
  const counts = countMapMetadataFiles(cwd, identity);

  // CLI commands + guards are SLOPE's own registries — only meaningful when
  // mapping SLOPE itself. Report 0 for downstream projects so the metadata
  // doesn't lie about their surface.
  const cliCommands = identity.isSlopeSelf ? CLI_COMMAND_REGISTRY.length : 0;
  const guardsCount = identity.isSlopeSelf ? GUARD_DEFINITIONS.length : 0;

  // Count flows
  const flowsPath = join(cwd, config.flowsPath ?? '.slope/flows.json');
  const flowsData = loadFlows(flowsPath);
  const flowCount = flowsData?.flows.length ?? 0;

  return {
    generated_at: new Date().toISOString(),
    git_sha: gitSha,
    sprint: latestSprint,
    source_files: counts.source,
    test_files: counts.test,
    cli_commands: cliCommands,
    guards: guardsCount,
    flows: flowCount,
  };
}

// ── Section Generators ──────────────────────────────────────────

/** Inventory generator for downstream (non-SLOPE) projects. Walks the
 *  conventional monorepo workspace dirs (`packages/`, `apps/`, `libs/`)
 *  plus a top-level `src/` if present, and prints one section per package.
 *  Each package shows its package.json `name` + `description` (when
 *  present) and a source/test file count. (#351) */
function generateGenericPackageInventory(cwd: string): string {
  const lines: string[] = [''];
  const workspaceParents = ['packages', 'apps', 'libs'];
  const sections: { kind: string; name: string; description: string; root: string }[] = [];

  for (const parent of workspaceParents) {
    const parentDir = join(cwd, parent);
    if (!existsSync(parentDir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(parentDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .sort();
    } catch {
      continue;
    }
    for (const name of entries) {
      const root = join(parentDir, name);
      const pkgPath = join(root, 'package.json');
      let pkgName = `${parent}/${name}`;
      let description = '';
      if (existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
          if (typeof pkg.name === 'string') pkgName = pkg.name;
          if (typeof pkg.description === 'string') description = pkg.description;
        } catch {
          /* keep folder-derived label */
        }
      }
      sections.push({ kind: parent, name: pkgName, description, root });
    }
  }

  // Also include a top-level `src/` if the project isn't a workspace
  if (existsSync(join(cwd, 'src')) && sections.length === 0) {
    sections.push({ kind: 'src', name: 'src/', description: '', root: join(cwd, 'src') });
  }

  const rootCounts = countSourceFiles(cwd);
  if (sections.length === 0 && (rootCounts.source > 0 || rootCounts.test > 0)) {
    sections.push({ kind: 'repo', name: 'Repository root', description: '', root: cwd });
  }

  if (sections.length === 0) {
    return '\n_No packages, apps, or top-level src/ directory detected. The map can still track flows, sprint history, and gotchas._\n';
  }

  for (const s of sections) {
    const { source, test } = countSourceFiles(s.root);
    const repoPath = toRepoPath(relative(cwd, s.root)) || '.';
    lines.push(`### \`${repoPath}\``);
    lines.push(`- Package: \`${s.name}\``);
    if (s.description) lines.push(`- ${s.description}`);
    lines.push(`- Source files: ${source} | Test files: ${test}`);
    lines.push('');
  }
  return lines.join('\n');
}

function generatePackageInventory(cwd: string): string {
  const srcDir = join(cwd, 'src');
  if (!existsSync(srcDir)) return '';

  const lines: string[] = [''];

  const subdirs = readdirSync(srcDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  for (const subdir of subdirs) {
    const subSrcDir = join(srcDir, subdir);
    const subTestDir = join(cwd, 'tests', subdir);
    const { source } = countSourceFiles(subSrcDir);
    const { test: testCount } = existsSync(subTestDir) ? countSourceFiles(subTestDir) : { test: 0 };

    lines.push(`### \`src/${subdir}\``);
    lines.push(`- Source files: ${source} | Test files: ${testCount}`);

    // List key modules (top-level .ts files in src/<subdir>/)
    const modules = readdirSync(subSrcDir)
      .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.spec.ts') && f !== 'index.ts')
      .sort();

    if (modules.length > 0) {
      lines.push('- Key modules:');
      for (const mod of modules.slice(0, 15)) {
        const modPath = join(subSrcDir, mod);
        const firstLine = readFirstComment(modPath);
        const label = mod.replace('.ts', '');
        lines.push(`  - \`${label}\`${firstLine ? ` — ${firstLine}` : ''}`);
      }
      if (modules.length > 15) {
        lines.push(`  - ... and ${modules.length - 15} more`);
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
  const indexPath = join(cwd, 'src', 'core', 'index.ts');
  if (!existsSync(indexPath)) return '';

  const content = readFileSync(indexPath, 'utf8');
  const lines: string[] = [''];

  // Build name→signature lookup from SLOPE_REGISTRY
  const sigMap = new Map(SLOPE_REGISTRY.map(e => [e.name, e.signature]));

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
      if (names.length === 0) continue;

      if (isType) {
        // Skip type-only exports — discoverable via search({ module: 'types' })
        continue;
      } else {
        // Function exports: one per line with signature from registry
        for (const name of names) {
          const sig = sigMap.get(name);
          if (sig) {
            lines.push(`- \`${sig}\``);
          } else {
            lines.push(`- \`${name}\``);
          }
        }
      }
    }
  }

  // Remove empty section headers (headers followed by another header or end)
  const filtered: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('**') && lines[i].endsWith(':**')) {
      // Check if next non-empty line is also a header or end of list
      const next = lines.slice(i + 1).find(l => l.length > 0);
      if (!next || (next.startsWith('**') && next.endsWith(':**'))) {
        continue; // Skip empty section header
      }
    }
    filtered.push(lines[i]);
  }

  // Token budget guard: warn if API surface section is too large
  const output = filtered.join('\n');
  if (output.length > 15000) {
    console.warn(`Warning: API surface section is ${output.length} chars (~${Math.round(output.length / 4)} tokens) — consider trimming.`);
  }

  return output;
}

function generateCliCommands(): string {
  const lines: string[] = [''];

  for (const entry of CLI_COMMAND_REGISTRY) {
    lines.push(`- \`slope ${entry.cmd}\` — ${entry.desc}`);
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
  const mcpIndexPath = join(cwd, 'src', 'mcp', 'index.ts');
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
  const testsDir = join(cwd, 'tests');
  if (!existsSync(testsDir)) return '';

  const lines: string[] = [''];

  lines.push('| Directory | Test Files | Command |');
  lines.push('|-----------|-----------|---------|');

  const subdirs = readdirSync(testsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  let totalTests = 0;
  for (const subdir of subdirs) {
    const { test: testCount } = countSourceFiles(join(testsDir, subdir));
    totalTests += testCount;
    if (testCount > 0) {
      lines.push(`| tests/${subdir} | ${testCount} | \`pnpm test\` |`);
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

function generateFlowsSummary(cwd: string, config: SlopeConfig): string {
  const flowsPath = join(cwd, config.flowsPath ?? '.slope/flows.json');
  const flows = loadFlows(flowsPath);

  if (!flows || flows.flows.length === 0) {
    return '\nNo flows defined. Run `slope flows init` to create flow definitions.\n';
  }

  let currentSha = '';
  try {
    currentSha = exec('git rev-parse HEAD', cwd);
  } catch { /* not in git repo */ }

  const lines: string[] = [''];
  lines.push('| ID | Title | Tags | Files | Stale? |');
  lines.push('|----|-------|------|-------|--------|');

  for (const flow of flows.flows) {
    const tags = flow.tags.join(', ') || '—';
    let staleLabel = '—';

    if (currentSha && flow.last_verified_sha) {
      const { stale, changedFiles } = checkFlowStaleness(flow, currentSha, cwd);
      staleLabel = stale ? `Yes (${changedFiles.length})` : 'No';
    } else if (!flow.last_verified_sha) {
      staleLabel = 'Unverified';
    }

    lines.push(`| \`${flow.id}\` | ${flow.title} | ${tags} | ${flow.files.length} | ${staleLabel} |`);
  }

  lines.push('');
  lines.push(`Query via MCP: \`search({ module: 'flows' })\` or \`search({ module: 'flows', query: '<id>' })\``);

  return lines.join('\n');
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
  const metadata = formatMetadataBlock(meta);
  const withoutLeadingMetadata = stripLeadingMetadataBlocks(content);
  return `${metadata}\n\n${withoutLeadingMetadata.replace(/^\s+/, '')}`;
}

function stripLeadingMetadataBlocks(content: string): string {
  let remaining = content;
  while (remaining.startsWith('---\n')) {
    const end = remaining.indexOf('\n---', 4);
    if (end === -1) break;
    const afterEnd = end + '\n---'.length;
    const nextChar = remaining[afterEnd];
    if (nextChar != null && nextChar !== '\n' && nextChar !== '\r') break;
    remaining = remaining.slice(afterEnd).replace(/^\r?\n/, '');
  }
  return remaining;
}

// ── Template for new map ────────────────────────────────────────

/** Map template for downstream projects (anything that isn't @slope-dev/slope itself).
 *  Skips SLOPE-internal sections (API surface, CLI registry, guards, MCP) which
 *  would otherwise dump SLOPE's own surface into the user's CODEBASE.md (#351). */
function generateGenericMap(cwd: string, config: SlopeConfig, meta: MapMetadata, identity: ProjectIdentity): string {
  return `---
generated_at: "${meta.generated_at}"
git_sha: "${meta.git_sha}"
sprint: ${meta.sprint}
source_files: ${meta.source_files}
test_files: ${meta.test_files}
flows: ${meta.flows}
---

# ${identity.title}
${identity.description ? `\n${identity.description}\n` : ''}
## Package Inventory

<!-- AUTO-GENERATED: START packages -->
${generateGenericPackageInventory(cwd)}
<!-- AUTO-GENERATED: END packages -->

## User Flows

<!-- AUTO-GENERATED: START flows -->
${generateFlowsSummary(cwd, config)}
<!-- AUTO-GENERATED: END flows -->

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
<!-- AUTO-GENERATED: END gotchas -->`;
}

function generateFullMap(cwd: string, config: SlopeConfig, meta: MapMetadata): string {
  const sections = [
    `---
generated_at: "${meta.generated_at}"
git_sha: "${meta.git_sha}"
sprint: ${meta.sprint}
source_files: ${meta.source_files}
test_files: ${meta.test_files}
cli_commands: ${meta.cli_commands}
guards: ${meta.guards}
flows: ${meta.flows}
---

# SLOPE Codebase Map

Sprint Lifecycle & Operational Performance Engine — pluggable-metaphor sprint scoring.

## Package Inventory

<!-- AUTO-GENERATED: START packages -->
${generatePackageInventory(cwd)}
<!-- AUTO-GENERATED: END packages -->

## API Surface (core)

Re-exports from \`src/core/index.ts\`:

<!-- AUTO-GENERATED: START api -->
${generateApiSurface(cwd)}
<!-- AUTO-GENERATED: END api -->

## CLI Commands

<!-- AUTO-GENERATED: START cli -->
${generateCliCommands()}
<!-- AUTO-GENERATED: END cli -->

## Guard Definitions

<!-- AUTO-GENERATED: START guards -->
${generateGuardsList()}
<!-- AUTO-GENERATED: END guards -->

## MCP Tools

<!-- AUTO-GENERATED: START mcp -->
${generateMcpTools(cwd)}
<!-- AUTO-GENERATED: END mcp -->

## User Flows

<!-- AUTO-GENERATED: START flows -->
${generateFlowsSummary(cwd, config)}
<!-- AUTO-GENERATED: END flows -->

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
  const identity = readProjectIdentity(cwd);
  const { source: currentSource } = countMapMetadataFiles(cwd, identity);

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
    const distance = gitDistanceSinceMapSha(cwd, mapSha);
    if (distance > 50) {
      results.push({ label: 'Git distance', status: 'stale', message: `${distance} commits behind (threshold: 50)` });
    } else if (distance > 30) {
      results.push({ label: 'Git distance', status: 'warn', message: `${distance} commits behind` });
    } else {
      results.push({ label: 'Git distance', status: 'ok', message: `${distance} commits behind — OK` });
    }
  }

  // 3. Sprint currency
  const mapSprint = sprintIdKey(meta.sprint) ?? '0';
  const currentSprint = detectLatestSprint(config, cwd);
  const sprintComparison = compareSprintIdKeys(currentSprint, mapSprint);
  const sprintDeltaTenths = sprintCurrencyDeltaTenths(currentSprint, mapSprint);
  const currentSprintLabel = currentSprint;
  const mapSprintLabel = mapSprint;
  const sprintDeltaLabel = formatSprintCurrencyDelta(sprintDeltaTenths);
  if (sprintComparison > 0 && sprintDeltaTenths > 30) {
    results.push({ label: 'Sprint currency', status: 'stale', message: `Sprint ${currentSprintLabel} (map says ${mapSprintLabel}, +${sprintDeltaLabel} behind)` });
  } else if (sprintComparison > 0) {
    results.push({ label: 'Sprint currency', status: 'warn', message: `Sprint ${currentSprintLabel} (map says ${mapSprintLabel}, +${sprintDeltaLabel})` });
  } else {
    results.push({ label: 'Sprint currency', status: 'ok', message: `Sprint ${currentSprintLabel} — current` });
  }

  // 4. Dead file references
  const fileRefs = mapContent.matchAll(/`((?:src|tests)\/[^`\s]+\.(?:ts|tsx|json|md))`/g);
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

function gitDistanceSinceMapSha(cwd: string, mapSha: string): number {
  const sha = mapSha.trim();
  if (!/^[0-9a-fA-F]{4,64}$/.test(sha)) return 0;
  const raw = exec(`git rev-list --count --ancestry-path ${sha}..HEAD`, cwd);
  const parsed = parseInt(raw || '0', 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMetadataBlock(meta: MapMetadata): string {
  return [
    '---',
    `generated_at: "${meta.generated_at}"`,
    `git_sha: "${meta.git_sha}"`,
    `sprint: ${meta.sprint}`,
    `source_files: ${meta.source_files}`,
    `test_files: ${meta.test_files}`,
    `cli_commands: ${meta.cli_commands}`,
    `guards: ${meta.guards}`,
    `flows: ${meta.flows}`,
    '---',
  ].join('\n');
}

function updateOrInsertMetadataBlock(content: string, meta: MapMetadata): string {
  if (/^---\n[\s\S]*?\n---/m.test(content)) {
    return updateMetadataBlock(content, meta);
  }
  return `${formatMetadataBlock(meta)}\n\n${content}`;
}

function hasAutoGeneratedSections(content: string): boolean {
  return content.includes('<!-- AUTO-GENERATED: START packages -->')
    || content.includes('<!-- AUTO-GENERATED: START flows -->')
    || content.includes('<!-- AUTO-GENERATED: START tests -->')
    || content.includes('<!-- AUTO-GENERATED: START history -->')
    || content.includes('<!-- AUTO-GENERATED: START gotchas -->');
}

function updateGenericMapSections(content: string, cwd: string, config: SlopeConfig, meta: MapMetadata): string {
  let updated = updateOrInsertMetadataBlock(content, meta);
  updated = replaceAutoSection(updated, 'packages', generateGenericPackageInventory(cwd));
  updated = replaceAutoSection(updated, 'flows', generateFlowsSummary(cwd, config));
  updated = replaceAutoSection(updated, 'tests', generateTestInventory(cwd));
  updated = replaceAutoSection(updated, 'history', generateSprintHistory(cwd, config));
  updated = replaceAutoSection(updated, 'gotchas', generateKnownGotchas(cwd, config));
  return updated;
}

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)(?:=(.+))?$/);
    if (match) result[match[1]] = match[2] ?? 'true';
  }
  return result;
}

export async function mapCommand(args: string[], cwd: string = process.cwd()): Promise<void> {
  const flags = parseArgs(args);
  const config = loadConfig(cwd);
  const outputPath = flags.output || join(cwd, 'CODEBASE.md');
  const isCheck = flags.check === 'true';
  const force = flags.force === 'true';

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

  const identity = readProjectIdentity(cwd);
  const meta = gatherMetadata(cwd, config, identity);

  if (!identity.isSlopeSelf) {
    const existingContent = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : null;
    // Downstream project: preserve existing curated maps unless the caller
    // explicitly forces replacement or the file is an old SLOPE-shaped map.
    if (existingContent && !force && !isSlopeShapedMap(existingContent)) {
      const content = hasAutoGeneratedSections(existingContent)
        ? updateGenericMapSections(existingContent, cwd, config, meta)
        : updateOrInsertMetadataBlock(existingContent, meta);
      writeFileSync(outputPath, content, 'utf8');
      if (hasAutoGeneratedSections(existingContent)) {
        console.log(`  Updated project map sections for \`${identity.title}\``);
      } else {
        console.log('  Refreshed CODEBASE.md metadata and preserved existing manual content');
      }
    } else {
      const content = generateGenericMap(cwd, config, meta, identity);
      writeFileSync(outputPath, content, 'utf8');
      console.log(`  Generated project map for \`${identity.title}\``);
    }
  } else if (existsSync(outputPath)) {
    // SLOPE-self update — replace auto-generated sections only, preserving
    // any manual content between markers.
    let content = readFileSync(outputPath, 'utf8');

    content = updateMetadataBlock(content, meta);
    content = replaceAutoSection(content, 'packages', generatePackageInventory(cwd));
    content = replaceAutoSection(content, 'api', generateApiSurface(cwd));
    content = replaceAutoSection(content, 'cli', generateCliCommands());
    content = replaceAutoSection(content, 'guards', generateGuardsList());
    content = replaceAutoSection(content, 'mcp', generateMcpTools(cwd));
    content = replaceAutoSection(content, 'flows', generateFlowsSummary(cwd, config));
    content = replaceAutoSection(content, 'tests', generateTestInventory(cwd));
    content = replaceAutoSection(content, 'history', generateSprintHistory(cwd, config));
    content = replaceAutoSection(content, 'gotchas', generateKnownGotchas(cwd, config));

    writeFileSync(outputPath, content, 'utf8');
    console.log('  Updated auto-generated sections');
  } else {
    // SLOPE-self, no existing map — create new from full template
    const content = generateFullMap(cwd, config, meta);
    writeFileSync(outputPath, content, 'utf8');
    console.log('  Created new codebase map');
  }

  const finalContent = readFileSync(outputPath, 'utf8');
  const lineCount = finalContent.split('\n').length;
  const sizeKb = (Buffer.byteLength(finalContent, 'utf8') / 1024).toFixed(1);
  console.log(`  ${lineCount} lines, ${sizeKb}KB`);
  console.log(`  ${meta.source_files} source files, ${meta.test_files} test files`);
  // CLI/guard counts are SLOPE-internal — only meaningful when mapping
  // SLOPE itself. Suppress for downstream projects to avoid claiming a
  // 0-command surface they don't have.
  if (identity.isSlopeSelf) {
    console.log(`  ${meta.cli_commands} CLI commands, ${meta.guards} guards`);
  }
  console.log(`\nMap written to ${relative(cwd, outputPath)}\n`);
}

function isSlopeShapedMap(content: string): boolean {
  return /^# SLOPE Codebase Map\b/m.test(content)
    || content.includes('Sprint Lifecycle & Operational Performance Engine');
}

function printUsage(): void {
  console.log(`
slope map — Generate/update the SLOPE codebase map

Usage:
  slope map                   Generate or update CODEBASE.md
  slope map --check           Check staleness (exit 1 if stale)
  slope map --output=<path>   Custom output path (default: CODEBASE.md)
  slope map --force           Replace an existing downstream map instead of preserving manual content

The codebase map provides a compact (~500 line) overview of the project
for agent navigation. Auto-generated sections are updated in place;
manual content between markers is preserved.
`);
}
