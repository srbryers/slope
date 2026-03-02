// SLOPE CLI — Documentation manifest generation
// All I/O (git, filesystem) lives here. Core is pure.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildDocsManifest } from '../../core/index.js';
import type { ChangelogSection, ChangelogEntry, ChangelogChange, DocsManifest } from '../../core/index.js';
import { CLI_COMMAND_REGISTRY } from '../registry.js';

// Ensure metaphors are registered before manifest build
import '../../core/metaphors/index.js';

// ── Git helpers ────────────────────────────────────────────────

function exec(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    }).trim();
  } catch {
    return '';
  }
}

function getGitSha(cwd: string): string {
  return exec('git rev-parse HEAD', cwd) || 'unknown';
}

function getPackageVersion(cwd: string): string {
  try {
    const pkgPath = resolve(cwd, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return pkg.version || '0.0.0-unknown';
  } catch {
    return '0.0.0-unknown';
  }
}

// ── Changelog parser ───────────────────────────────────────────

const CONVENTIONAL_RE = /^(?<type>feat|fix|chore|docs|refactor|test)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?:\s*(?<desc>.+)$/;
const SLOPE_TICKET_RE = /^S[\w-]+:\s*/;

function parseCommitType(subject: string): ChangelogChange {
  const match = subject.match(CONVENTIONAL_RE);
  if (match?.groups) {
    return {
      type: match.groups.type as ChangelogChange['type'],
      scope: match.groups.scope || undefined,
      description: match.groups.desc,
      breaking: match.groups.breaking === '!',
    };
  }

  // SLOPE ticket format: S48-1: description
  const slopeMatch = subject.match(SLOPE_TICKET_RE);
  if (slopeMatch) {
    return {
      type: 'other',
      description: subject,
      breaking: false,
    };
  }

  return { type: 'other', description: subject, breaking: false };
}

function getVersionTags(cwd: string): string[] {
  const raw = exec('git tag --sort=-creatordate', cwd);
  if (!raw) return [];
  return raw
    .split('\n')
    .map(t => t.trim())
    .filter(t => /^v?\d+\.\d+/.test(t));
}

function getTagDate(cwd: string, tag: string): string {
  const date = exec(`git log -1 --format=%aI ${tag}`, cwd);
  return date ? date.slice(0, 10) : '';
}

/** Parse git log output lines into ChangelogChange[] */
function parseLogLines(raw: string): ChangelogChange[] {
  return raw.split('\n').filter(Boolean).map(line => {
    const [hash, ...rest] = line.split('|||');
    const subject = rest.join('|||');
    const change = parseCommitType(subject);
    change.hash = hash;
    return change;
  });
}

/** Validate a git ref name to prevent shell injection */
function isValidGitRef(ref: string): boolean {
  return /^[\w./@-]+$/.test(ref);
}

export function parseChangelog(cwd: string, since?: string): ChangelogSection {
  try {
    // Validate user-supplied ref
    if (since && !isValidGitRef(since)) {
      return { status: 'unavailable', entries: [], reason: `Invalid git ref: ${since}` };
    }

    // Check if we're in a git repo
    const gitCheck = exec('git rev-parse --is-inside-work-tree', cwd);
    if (gitCheck !== 'true') {
      return { status: 'unavailable', entries: [], reason: 'Not a git repository' };
    }

    const tags = getVersionTags(cwd);
    const sinceTag = since || (tags.length > 0 ? tags[0] : undefined);

    // Build git log range
    const range = sinceTag ? `${sinceTag}..HEAD` : '';
    const logCmd = `git log ${range} --format=%H%x7C%x7C%x7C%s --no-merges`.trim();
    const raw = exec(logCmd, cwd);

    const entries: ChangelogEntry[] = [];

    // Unreleased commits (HEAD..latest tag or all if no tags)
    if (raw) {
      const changes = parseLogLines(raw);
      if (changes.length > 0) {
        entries.push({
          version: 'Unreleased',
          date: new Date().toISOString().slice(0, 10),
          changes,
        });
      }
    }

    // Past version entries from tags
    for (let i = 0; i < tags.length && i < 10; i++) {
      const tag = tags[i];
      const prevTag = tags[i + 1];
      const tagRange = prevTag ? `${prevTag}..${tag}` : tag;
      const tagLog = exec(`git log ${tagRange} --format=%H%x7C%x7C%x7C%s --no-merges`, cwd);
      if (!tagLog) continue;

      const changes = parseLogLines(tagLog);
      if (changes.length > 0) {
        entries.push({
          version: tag,
          date: getTagDate(cwd, tag),
          changes,
        });
      }
    }

    return { status: entries.length > 0 ? 'success' : 'partial', entries };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'unavailable', entries: [], reason: msg };
  }
}

// ── Markdown formatter ─────────────────────────────────────────

function formatChangelogMarkdown(changelog: ChangelogSection): string {
  if (changelog.status === 'unavailable') {
    return `# Changelog\n\nChangelog unavailable: ${changelog.reason || 'unknown error'}\n`;
  }

  const lines = ['# Changelog', ''];
  for (const entry of changelog.entries) {
    lines.push(`## ${entry.version}${entry.date ? ` (${entry.date})` : ''}`, '');

    // Group by type
    const groups = new Map<string, ChangelogChange[]>();
    for (const change of entry.changes) {
      const key = change.type;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(change);
    }

    const typeLabels: Record<string, string> = {
      feat: 'Features',
      fix: 'Bug Fixes',
      chore: 'Chores',
      docs: 'Documentation',
      refactor: 'Refactoring',
      test: 'Tests',
      other: 'Other',
    };

    for (const [type, changes] of groups) {
      lines.push(`### ${typeLabels[type] || type}`, '');
      for (const c of changes) {
        const scope = c.scope ? `**${c.scope}:** ` : '';
        const breaking = c.breaking ? ' **BREAKING**' : '';
        lines.push(`- ${scope}${c.description}${breaking}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ── Subcommands ────────────────────────────────────────────────

async function generateSubcommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const outputArg = args.find(a => a.startsWith('--output='));
  const outputPath = outputArg ? outputArg.slice('--output='.length) : resolve(cwd, '.slope', 'docs.json');
  const pretty = args.includes('--pretty');
  const incremental = args.includes('--incremental');
  const toStdout = args.includes('--stdout');

  const version = getPackageVersion(cwd);
  const gitSha = getGitSha(cwd);
  const changelog: ChangelogSection = incremental
    ? { status: 'unavailable', entries: [], reason: 'Skipped (--incremental)' }
    : parseChangelog(cwd);

  const manifest = buildDocsManifest({ version, gitSha, changelog, commands: CLI_COMMAND_REGISTRY });
  const json = JSON.stringify(manifest, null, pretty ? 2 : undefined);

  if (toStdout) {
    console.log(json);
  } else {
    writeFileSync(outputPath, json + '\n', 'utf8');
    console.log(`Manifest written to ${outputPath}`);
    console.log(`  Version: ${manifest.version}`);
    console.log(`  Commands: ${manifest.commands.length}`);
    console.log(`  Guards: ${manifest.guards.length}`);
    console.log(`  Metaphors: ${manifest.metaphors.length}`);
    console.log(`  Roles: ${manifest.roles.length}`);
    console.log(`  Changelog: ${manifest.changelog.status} (${manifest.changelog.entries.length} entries)`);
  }
}

async function changelogSubcommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const sinceArg = args.find(a => a.startsWith('--since='));
  const since = sinceArg ? sinceArg.slice('--since='.length) : undefined;
  const formatArg = args.find(a => a.startsWith('--format='));
  const format = formatArg ? formatArg.slice('--format='.length) : 'markdown';

  const changelog = parseChangelog(cwd, since);

  if (format === 'json') {
    console.log(JSON.stringify(changelog, null, 2));
  } else {
    console.log(formatChangelogMarkdown(changelog));
  }
}

async function checkSubcommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const manifestArg = args.find(a => a.startsWith('--manifest='));
  const manifestPath = manifestArg
    ? manifestArg.slice('--manifest='.length)
    : resolve(cwd, '.slope', 'docs.json');

  if (!existsSync(manifestPath)) {
    console.error(`No manifest found at ${manifestPath}`);
    console.error('Run "slope docs generate" first.');
    process.exit(1);
  }

  let saved: DocsManifest;
  try {
    saved = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    console.error(`Failed to parse manifest: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  // Generate fresh manifest for comparison
  const version = getPackageVersion(cwd);
  const gitSha = getGitSha(cwd);
  // Skip changelog for check — only compare structural sections
  const changelog: ChangelogSection = { status: 'unavailable', entries: [], reason: 'Skipped for check' };
  const fresh = buildDocsManifest({ version, gitSha, changelog, commands: CLI_COMMAND_REGISTRY });

  // Compare per-section checksums (skip changelog — it's git-dependent)
  const sectionsToCheck = ['commands', 'guards', 'metaphors', 'roles', 'constants'] as const;
  const drifted: string[] = [];

  for (const section of sectionsToCheck) {
    const savedChecksum = saved.checksums?.[section];
    const freshChecksum = fresh.checksums?.[section];
    if (savedChecksum !== freshChecksum) {
      drifted.push(section);
    }
  }

  if (drifted.length === 0) {
    console.log('Manifest is current. No drift detected.');
  } else {
    console.error(`Drift detected in ${drifted.length} section(s): ${drifted.join(', ')}`);
    console.error('Run "slope docs generate" to update.');
    process.exit(1);
  }
}

// ── Dispatcher ─────────────────────────────────────────────────

export async function docsCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const subArgs = args.slice(1);

  switch (sub) {
    case 'generate':
      return generateSubcommand(subArgs);
    case 'changelog':
      return changelogSubcommand(subArgs);
    case 'check':
      return checkSubcommand(subArgs);
    default:
      console.log(`
slope docs — Generate documentation manifest and changelog

Usage:
  slope docs generate [--output=path] [--pretty] [--incremental] [--stdout]
  slope docs changelog [--since=version] [--format=markdown|json]
  slope docs check [--manifest=path]

Subcommands:
  generate      Build manifest JSON from registries + git history
  changelog     Generate changelog from conventional commits
  check         Compare saved manifest against current state (exit 1 on drift)

Options:
  --output=path       Write manifest to path (default: .slope/docs.json)
  --pretty            Pretty-print JSON output
  --incremental       Skip changelog generation
  --stdout            Write to stdout instead of file
  --since=version     Changelog since this version/tag
  --format=FORMAT     Changelog output format: markdown (default) or json
  --manifest=path     Path to saved manifest for check (default: .slope/docs.json)
`);
      if (sub) process.exit(1);
  }
}
