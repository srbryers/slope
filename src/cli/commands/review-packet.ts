import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import {
  detectLatestSprint,
  loadFindings,
  sprintIdKey,
  type ReviewFinding,
  type ReviewType,
  type SprintId,
} from '../../core/index.js';
import { loadConfig } from '../config.js';

type ReviewLane = Extract<ReviewType, 'architect' | 'code' | 'security' | 'ux' | 'ml-engineer'>;
type BudgetTier = 'focused' | 'standard' | 'deep' | 'exceptional';

const DEFAULT_EXCLUDE = ['docs/archive/**', 'vendor/**', 'node_modules/**', 'dist/**', 'coverage/**', '*.zip', '*.tar', '*.tgz'];
const TOKEN_BUDGETS: Record<BudgetTier, number> = {
  focused: 8_000,
  standard: 16_000,
  deep: 30_000,
  exceptional: 60_000,
};

interface ReviewPacketOptions {
  sprint?: SprintId;
  lane: ReviewLane;
  base?: string;
  head?: string;
  rereviewFrom?: string;
  budgetTier: BudgetTier;
  exclude: string[];
  out?: string;
  json: boolean;
}

function flagValue(args: string[], name: string): string | undefined {
  const inline = args.find(arg => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseArgs(args: string[]): ReviewPacketOptions {
  const lane = (flagValue(args, '--lane') ?? 'architect') as ReviewLane;
  if (!['architect', 'code', 'security', 'ux', 'ml-engineer'].includes(lane)) {
    throw new Error('--lane must be architect, code, security, ux, or ml-engineer');
  }
  const budgetTier = (flagValue(args, '--budget-tier') ?? 'standard') as BudgetTier;
  if (!Object.keys(TOKEN_BUDGETS).includes(budgetTier)) {
    throw new Error('--budget-tier must be focused, standard, deep, or exceptional');
  }
  const sprintRaw = flagValue(args, '--sprint');
  const sprint = sprintRaw ? sprintIdKey(sprintRaw) ?? undefined : undefined;
  if (sprintRaw && sprint == null) throw new Error('--sprint must be a valid sprint number');
  const exclude = args
    .filter(arg => arg.startsWith('--exclude-path='))
    .map(arg => arg.slice('--exclude-path='.length))
    .filter(Boolean);
  return {
    sprint,
    lane,
    base: flagValue(args, '--base'),
    head: flagValue(args, '--head') ?? 'HEAD',
    rereviewFrom: flagValue(args, '--rereview-from'),
    budgetTier,
    exclude,
    out: flagValue(args, '--out'),
    json: args.includes('--json'),
  };
}

function git(cwd: string, args: string[], maxBuffer = 4 * 1024 * 1024): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer }).trim();
}

function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\0')
    .replace(/\*/g, '[^/]*')
    .replace(/\0/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function isExcluded(path: string, excludes: string[]): boolean {
  const normalized = path.replace(/\\/g, '/');
  return excludes.some(pattern => globToRegex(pattern).test(normalized));
}

function utf8Prefix(value: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes <= maxBytes) return { text: value, truncated: false };
  let end = value.length;
  while (end > 0 && Buffer.byteLength(value.slice(0, end), 'utf8') > maxBytes) end = Math.floor(end * 0.9);
  while (end < value.length && Buffer.byteLength(value.slice(0, end + 1), 'utf8') <= maxBytes) end++;
  return { text: value.slice(0, end), truncated: true };
}

function unresolvedFindings(cwd: string, sprint: SprintId, lane: ReviewLane): string[] {
  const findings = loadFindings(cwd);
  const sprintFindings = (findings?.sprints as Record<string, ReviewFinding[]> | undefined)?.[String(sprint)] ?? [];
  return sprintFindings
    .filter(finding => !finding.resolved && finding.review_type === lane)
    .map(finding => `${finding.id}: ${finding.description}`);
}

export function buildReviewPacket(cwd: string, options: ReviewPacketOptions): Record<string, unknown> {
  const config = loadConfig(cwd);
  const sprint = options.sprint ?? config.currentSprint ?? detectLatestSprint(config, cwd);
  const base = options.rereviewFrom ?? options.base ?? git(cwd, ['merge-base', 'HEAD', 'origin/main']);
  const head = options.head ?? 'HEAD';
  const allExcludes = [...DEFAULT_EXCLUDE, ...options.exclude];
  const nameStatus = git(cwd, ['diff', '--name-status', `${base}..${head}`]);
  const changed = nameStatus.split('\n')
    .map(line => line.trim().split(/\s+/).at(-1))
    .filter((path): path is string => Boolean(path))
    .map(path => path.replace(/\\/g, '/'));
  const includedPaths = changed.filter(path => !isExcluded(path, allExcludes));
  const excludedPaths = changed.filter(path => isExcluded(path, allExcludes));
  const diff = includedPaths.length > 0
    ? git(cwd, ['diff', '--unified=80', `${base}..${head}`, '--', ...includedPaths], 12 * 1024 * 1024)
    : '';
  const budgetTokens = TOKEN_BUDGETS[options.budgetTier];
  const maxDiffBytes = budgetTokens * 4;
  const boundedDiff = utf8Prefix(diff, maxDiffBytes);
  const packet = {
    schema: 'slope.review_packet.v1',
    sprint,
    lane: options.lane,
    mode: options.rereviewFrom ? 'delta_rereview' : 'full_review',
    base,
    head,
    budget: {
      tier: options.budgetTier,
      tokens: budgetTokens,
      max_diff_bytes: maxDiffBytes,
      model_guidance: options.budgetTier === 'exceptional'
        ? 'Use only with explicit over-budget rationale.'
        : 'Use a lightweight reviewer first pass at medium reasoning; escalate only for unresolved risk.',
    },
    changed_files: changed,
    included_paths: includedPaths,
    excluded_paths: excludedPaths,
    exclude_patterns: allExcludes,
    unresolved_findings: unresolvedFindings(cwd, sprint, options.lane),
    diff_stat: git(cwd, ['diff', '--stat', `${base}..${head}`]),
    diff: boundedDiff.text,
    diff_truncated: boundedDiff.truncated,
    generated_at: new Date().toISOString(),
  };
  const hash = createHash('sha256').update(JSON.stringify(packet)).digest('hex');
  return { ...packet, packet_hash: hash };
}

export function reviewPacketCommand(args: string[]): void {
  let options: ReviewPacketOptions;
  try {
    options = parseArgs(args);
  } catch (error) {
    console.error(`Invalid review packet options: ${(error as Error).message}`);
    process.exit(1);
    return;
  }
  const cwd = process.cwd();
  const packet = buildReviewPacket(cwd, options);
  const sprint = packet.sprint as SprintId;
  const head = String(packet.head).slice(0, 12).replace(/[^A-Za-z0-9_.-]/g, '');
  const out = options.out
    ? (isAbsolute(options.out) ? options.out : join(cwd, options.out))
    : join(cwd, '.slope', 'reviews', `sprint-${sprint}`, `${options.lane}-${packet.mode}-${head}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(packet, null, 2) + '\n');
  if (options.json) {
    console.log(JSON.stringify({ path: out, packet }, null, 2));
    return;
  }
  console.log(`Review packet written: ${relative(cwd, out).replace(/\\/g, '/')}`);
  console.log(`  Sprint: ${sprint}; lane: ${options.lane}; mode: ${packet.mode}`);
  console.log(`  Files: ${(packet.included_paths as string[]).length}/${(packet.changed_files as string[]).length}; budget: ${options.budgetTier} (${TOKEN_BUDGETS[options.budgetTier]} tokens)`);
  if (packet.diff_truncated) console.log('  Warning: diff truncated to packet budget.');
  console.log(`  Gate evidence: slope sprint gate ${options.lane === 'architect' ? 'architect_review' : 'code_review'} --reviewer=<id> --packet=${relative(cwd, out).replace(/\\/g, '/')} --evidence=<review-output> --verdict=pass`);
}
