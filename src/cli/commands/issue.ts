import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import {
  buildIssueCandidates,
  dedupeCandidates,
  formatIssueBody,
  formatIssueScoutComment,
  mergeIssueScoutState,
  parseIssueScoutState,
  renderIssueScoutDigest,
  sprintIdKey,
} from '../../core/index.js';
import type {
  ExistingIssue,
  IssueScoutCandidate,
  IssueScoutEvidence,
  IssueScoutState,
  IssueScoutStateRecord,
  SprintId,
} from '../../core/index.js';

interface ParsedIssueArgs {
  flags: Record<string, string>;
  repeated: Record<string, string[]>;
  positionals: string[];
}

interface ScoutRunOptions {
  cwd: string;
  repo?: string;
  sources: string[];
  fetchExisting: boolean;
}

interface ScoutRunResult {
  repo?: string;
  sources: string[];
  evidenceCount: number;
  candidates: IssueScoutCandidate[];
}

interface CreateAction {
  title: string;
  fingerprint: string;
  action: 'created' | 'commented' | 'deduped';
  issueNumber?: number;
  issueUrl?: string;
}

const DEFAULT_SOURCES = [
  '.slope/common-issues.json',
  '.slope/transcripts',
  '.slope/review-findings.json',
  '.slope/guard-metrics.jsonl',
];

const DEFAULT_STATE_PATH = '.slope/issue-scout.json';

export async function issueCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  if (subcommand === 'scout') {
    await runScoutCommand(args.slice(1));
    return;
  }

  if (subcommand === 'triage') {
    await runTriageCommand(args.slice(1));
    return;
  }

  throw new Error(`Unknown issue subcommand: ${subcommand}`);
}

function parseArgs(args: string[]): ParsedIssueArgs {
  const flags: Record<string, string> = {};
  const repeated: Record<string, string[]> = {};
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const eq = arg.indexOf('=');
    let key: string;
    let value: string;
    if (eq >= 0) {
      key = arg.slice(2, eq);
      value = arg.slice(eq + 1);
    } else {
      key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        value = next;
        i++;
      } else {
        value = 'true';
      }
    }

    flags[key] = value;
    if (!repeated[key]) repeated[key] = [];
    repeated[key].push(value);
  }

  return { flags, repeated, positionals };
}

async function runScoutCommand(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const cwd = process.cwd();
  const repo = parsed.flags.repo;
  const create = parsed.flags.create === 'true';
  const dryRun = parsed.flags['dry-run'] === 'true' || !create;
  const json = parsed.flags.json === 'true';
  const output = parsed.flags.output;
  const statePath = parsed.flags['state-path'] ?? DEFAULT_STATE_PATH;
  const commentDuplicates = parsed.flags['comment-duplicates'] === 'true';

  if (create && parsed.flags['dry-run'] === 'true') {
    throw new Error('Use either --dry-run or --create, not both.');
  }
  if (create && !repo) {
    throw new Error('--create requires --repo=<owner/repo>.');
  }

  const sources = parsed.repeated.source?.length ? parsed.repeated.source : DEFAULT_SOURCES;
  const run = await buildScoutRun({
    cwd,
    repo,
    sources,
    fetchExisting: Boolean(repo),
  });

  let actions: CreateAction[] = [];
  if (create) {
    actions = createOrCommentIssues(run.candidates, {
      repo: repo!,
      cwd,
      statePath: resolve(cwd, statePath),
      commentDuplicates,
    });
  }

  const payload = {
    mode: create ? 'create' : 'dry-run',
    repo,
    sources: run.sources,
    evidence_count: run.evidenceCount,
    candidate_count: run.candidates.length,
    candidates: run.candidates.map(candidate => serializeCandidate(candidate)),
    actions,
  };

  if (output) {
    writeJson(resolve(cwd, output), payload);
  }

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  printScoutSummary(run, dryRun, actions);
}

async function runTriageCommand(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const cwd = process.cwd();
  const repo = parsed.flags.repo;
  const output = parsed.flags.output;
  const json = parsed.flags.json === 'true';
  const sources = parsed.repeated.source?.length ? parsed.repeated.source : DEFAULT_SOURCES;

  const run = await buildScoutRun({
    cwd,
    repo,
    sources,
    fetchExisting: Boolean(repo),
  });

  const digest = renderIssueScoutDigest(run.candidates, { repo });
  if (output) {
    writeText(resolve(cwd, output), digest);
  }

  if (json) {
    console.log(JSON.stringify({
      repo,
      sources: run.sources,
      evidence_count: run.evidenceCount,
      candidate_count: run.candidates.length,
      digest,
      candidates: run.candidates.map(candidate => serializeCandidate(candidate)),
    }, null, 2));
    return;
  }

  console.log(digest);
}

async function buildScoutRun(options: ScoutRunOptions): Promise<ScoutRunResult> {
  const sourcePaths = options.sources.map(source => resolve(options.cwd, source));
  const evidence = readIssueScoutSources(options.cwd, sourcePaths);
  const candidates = buildIssueCandidates(evidence);
  const existing = options.fetchExisting && options.repo ? fetchExistingIssues(options.repo) : [];
  const deduped = existing.length > 0 ? dedupeCandidates(candidates, existing) : dedupeCandidates(candidates, []);

  return {
    repo: options.repo,
    sources: sourcePaths
      .filter(path => existsSync(path))
      .map(path => relative(options.cwd, path)),
    evidenceCount: evidence.length,
    candidates: deduped,
  };
}

function readIssueScoutSources(cwd: string, sourcePaths: string[]): IssueScoutEvidence[] {
  const evidence: IssueScoutEvidence[] = [];
  for (const sourcePath of sourcePaths) {
    if (!existsSync(sourcePath)) continue;
    const stat = statSync(sourcePath);
    if (stat.isDirectory()) {
      for (const file of walkFiles(sourcePath)) {
        evidence.push(...readIssueScoutFile(cwd, file));
      }
    } else if (stat.isFile()) {
      evidence.push(...readIssueScoutFile(cwd, sourcePath));
    }
  }
  return evidence;
}

function walkFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...walkFiles(path));
    } else if (stat.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function readIssueScoutFile(cwd: string, filePath: string): IssueScoutEvidence[] {
  const ext = extname(filePath).toLowerCase();
  if (!['.json', '.jsonl', '.md', '.txt', '.log'].includes(ext)) return [];

  const raw = readFileSync(filePath, 'utf8');
  const sourcePath = relative(cwd, filePath);

  if (ext === '.json') {
    try {
      return readJsonEvidence(sourcePath, JSON.parse(raw));
    } catch {
      return [makeEvidence(sourcePath, raw)];
    }
  }

  if (ext === '.jsonl') {
    const items: IssueScoutEvidence[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        items.push(makeEvidence(sourcePath, summarizeObject(JSON.parse(line))));
      } catch {
        items.push(makeEvidence(sourcePath, line));
      }
    }
    return items;
  }

  return splitTextEvidence(sourcePath, raw);
}

function readJsonEvidence(sourcePath: string, value: unknown): IssueScoutEvidence[] {
  if (isScorecardJson(value)) return [];

  const records = candidateJsonRecords(value);
  if (records.length === 0) return [];
  return records.map(record => {
    const quote = summarizeObject(record);
    return makeEvidence(sourcePath, quote, {
      sprint: extractSprint(quote, record),
      command: extractCommand(quote),
      details: summarizeDetails(record),
    });
  });
}

function candidateJsonRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (!isRecord(value)) return [];
  if (isScorecardJson(value)) return [];

  const keys = ['recurring_patterns', 'patterns', 'common_issues', 'issues', 'findings', 'events'];
  for (const key of keys) {
    const nested = value[key];
    if (Array.isArray(nested)) return nested.filter(isRecord);
  }

  return [value];
}

function summarizeObject(value: unknown): string {
  if (!isRecord(value)) return String(value);

  const fields = [
    'title',
    'name',
    'summary',
    'description',
    'pattern',
    'issue',
    'observed',
    'expected',
    'evidence',
    'impact',
    'workaround',
    'notes',
    'command',
  ];

  const parts: string[] = [];
  for (const field of fields) {
    const item = value[field];
    if (typeof item === 'string') parts.push(item);
    else if (Array.isArray(item)) parts.push(item.map(entry => typeof entry === 'string' ? entry : JSON.stringify(entry)).join(' '));
    else if (isRecord(item)) parts.push(JSON.stringify(item));
  }

  return parts.length > 0 ? parts.join('\n') : JSON.stringify(value);
}

function summarizeDetails(value: Record<string, unknown>): Record<string, unknown> {
  const details: Record<string, unknown> = {};
  for (const key of ['id', 'category', 'severity', 'count', 'frequency', 'first_seen', 'last_seen']) {
    if (value[key] !== undefined) details[key] = value[key];
  }
  return details;
}

function splitTextEvidence(sourcePath: string, raw: string): IssueScoutEvidence[] {
  const heading = /^#\s+(.+)$/m.exec(raw)?.[1]?.trim();
  const chunks = raw
    .split(/\n\s*\n/)
    .map(chunk => chunk.trim())
    .filter(Boolean);

  if (chunks.length === 0) return [];
  return chunks.map(chunk => makeEvidence(sourcePath, heading && !chunk.includes(heading)
    ? `${heading}\n${chunk}`
    : chunk));
}

function makeEvidence(
  sourcePath: string,
  quote: string,
  overrides: Partial<IssueScoutEvidence> = {},
): IssueScoutEvidence {
  const compact = quote
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return {
    source: sourcePath,
    sourcePath,
    sprint: overrides.sprint ?? extractSprint(compact),
    command: overrides.command ?? extractCommand(compact),
    quote: compact,
    details: overrides.details,
  };
}

function extractSprint(text: string, value?: Record<string, unknown>): SprintId | undefined {
  const raw = value?.sprint ?? value?.sprint_number ?? value?.sprintNumber;
  if (typeof raw === 'number' || typeof raw === 'string') {
    const sprint = sprintIdKey(raw);
    if (sprint !== null) return sprint;
  }
  const match = /\bS(\d+(?:\.\d+)?)\b/i.exec(text);
  if (!match) return undefined;
  return sprintIdKey(match[1]) ?? undefined;
}

function extractCommand(text: string): string | undefined {
  const backtick = /`(slope\s+[^`]+)`/.exec(text);
  if (backtick) return backtick[1].trim();

  const inline = /\bslope\s+[a-z][\w-]*(?:\s+[a-z][\w-]*)?(?:\s+--?[a-z][\w-]*(?:=[^\s,.;)]+)?)?/.exec(text);
  return inline ? inline[0].trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScorecardJson(value: unknown): boolean {
  return isRecord(value)
    && Array.isArray(value.shots)
    && (value.sprint_number !== undefined || value.sprint !== undefined);
}

function serializeCandidate(candidate: IssueScoutCandidate): Record<string, unknown> {
  return {
    title: candidate.title,
    kind: candidate.kind,
    confidence: candidate.confidence,
    labels: candidate.labels,
    fingerprint: candidate.fingerprint,
    summary: candidate.summary,
    evidence: candidate.evidence,
    dedupe: candidate.dedupe,
    body: formatIssueBody(candidate),
  };
}

function fetchExistingIssues(repo: string): ExistingIssue[] {
  const result = runGh([
    'issue',
    'list',
    '--repo',
    repo,
    '--state',
    'all',
    '--limit',
    '200',
    '--json',
    'number,title,body,state,url,labels',
  ]);

  const parsed = JSON.parse(result || '[]') as Array<Record<string, unknown>>;
  return parsed.map(item => ({
    number: Number(item.number),
    title: String(item.title ?? ''),
    body: typeof item.body === 'string' ? item.body : undefined,
    state: typeof item.state === 'string' ? item.state : undefined,
    url: typeof item.url === 'string' ? item.url : undefined,
    labels: Array.isArray(item.labels)
      ? item.labels.map(label => isRecord(label) ? String(label.name ?? '') : String(label)).filter(Boolean)
      : [],
  })).filter(issue => Number.isFinite(issue.number) && issue.title);
}

function createOrCommentIssues(
  candidates: IssueScoutCandidate[],
  opts: { repo: string; cwd: string; statePath: string; commentDuplicates: boolean },
): CreateAction[] {
  const state = readIssueScoutState(opts.statePath);
  const stateByFingerprint = new Map(state.records.map(record => [record.fingerprint, record]));
  const actions: CreateAction[] = [];
  const records: IssueScoutStateRecord[] = [];

  for (const candidate of candidates) {
    const existingRecord = stateByFingerprint.get(candidate.fingerprint);
    if (existingRecord) {
      actions.push({
        title: candidate.title,
        fingerprint: candidate.fingerprint,
        action: existingRecord.status,
        issueNumber: existingRecord.issueNumber,
        issueUrl: existingRecord.issueUrl,
      });
      continue;
    }

    const matched = candidate.dedupe?.matchedIssue;
    if (candidate.dedupe?.status === 'duplicate' && matched) {
      if (opts.commentDuplicates) {
        runGh([
          'issue',
          'comment',
          String(matched.number),
          '--repo',
          opts.repo,
          '--body',
          formatIssueScoutComment(candidate),
        ]);
      }
      const action: CreateAction = {
        title: candidate.title,
        fingerprint: candidate.fingerprint,
        action: opts.commentDuplicates ? 'commented' : 'deduped',
        issueNumber: matched.number,
        issueUrl: matched.url,
      };
      actions.push(action);
      records.push(recordFromAction(candidate, action));
      continue;
    }

    const issueUrl = runGh([
      'issue',
      'create',
      '--repo',
      opts.repo,
      '--title',
      candidate.title,
      '--body',
      formatIssueBody(candidate),
      ...candidate.labels.flatMap(label => ['--label', label]),
    ]).trim();
    const issueNumber = issueNumberFromUrl(issueUrl);
    const action: CreateAction = {
      title: candidate.title,
      fingerprint: candidate.fingerprint,
      action: 'created',
      issueNumber,
      issueUrl,
    };
    actions.push(action);
    records.push(recordFromAction(candidate, action));
  }

  if (records.length > 0) {
    writeIssueScoutState(opts.statePath, mergeIssueScoutState(state, records));
  }

  return actions;
}

function readIssueScoutState(path: string): IssueScoutState {
  if (!existsSync(path)) return { version: 1, records: [] };
  return parseIssueScoutState(readFileSync(path, 'utf8'));
}

function writeIssueScoutState(path: string, state: IssueScoutState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

function recordFromAction(candidate: IssueScoutCandidate, action: CreateAction): IssueScoutStateRecord {
  return {
    fingerprint: candidate.fingerprint,
    title: candidate.title,
    issueNumber: action.issueNumber,
    issueUrl: action.issueUrl,
    status: action.action,
    updatedAt: new Date().toISOString(),
    sourcePaths: Array.from(new Set(candidate.evidence.map(item => item.sourcePath).filter(Boolean) as string[])).sort(),
  };
}

function issueNumberFromUrl(url: string): number | undefined {
  const match = /\/issues\/(\d+)/.exec(url);
  return match ? Number(match[1]) : undefined;
}

function runGh(args: string[]): string {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if ((result.status ?? 0) !== 0) {
    throw new Error(`gh ${args.join(' ')} failed: ${(result.stderr ?? '').trim()}`);
  }
  return result.stdout ?? '';
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function printScoutSummary(run: ScoutRunResult, dryRun: boolean, actions: CreateAction[]): void {
  console.log('\nSLOPE Issue Scout\n');
  if (run.repo) console.log(`  Repository: ${run.repo}`);
  console.log(`  Sources: ${run.sources.length > 0 ? run.sources.join(', ') : 'none found'}`);
  console.log(`  Evidence items: ${run.evidenceCount}`);
  console.log(`  Candidates: ${run.candidates.length}`);
  if (dryRun) console.log('  Mode: dry-run');

  if (run.candidates.length === 0) {
    console.log('\n  No SLOPE-driven issue candidates found.\n');
    return;
  }

  console.log('\n  Candidate issues:');
  for (const candidate of run.candidates) {
    const dedupe = candidate.dedupe;
    const marker = dedupe?.status === 'duplicate' ? 'duplicate' : 'new';
    const match = dedupe?.matchedIssue ? ` -> #${dedupe.matchedIssue.number}` : '';
    console.log(`    - [${marker}] ${candidate.title}${match}`);
    console.log(`      confidence=${candidate.confidence.toFixed(2)} labels=${candidate.labels.join(', ')} fingerprint=${candidate.fingerprint}`);
    console.log(`      evidence=${candidate.evidence.length} dedupe=${dedupe?.reason ?? 'not checked'}`);
  }

  if (actions.length > 0) {
    console.log('\n  Actions:');
    for (const action of actions) {
      const target = action.issueNumber ? `#${action.issueNumber}` : action.issueUrl ?? action.fingerprint;
      console.log(`    - ${action.action}: ${action.title} (${target})`);
    }
  }
  console.log('');
}

function printUsage(): void {
  console.log(`
slope issue - Detect and triage SLOPE-driven product issues from agent work

Usage:
  slope issue scout [--source=<path>]... [--repo=<owner/repo>] [--dry-run] [--json]
  slope issue scout --repo=<owner/repo> --create [--comment-duplicates]
  slope issue triage [--source=<path>]... [--repo=<owner/repo>] [--daily-digest]

Options:
  --source=<path>          File or directory to scan (repeatable)
  --repo=<owner/repo>      GitHub repository for dedupe/create
  --dry-run                Print candidates without opening issues
  --create                 Open new issues for non-duplicates
  --comment-duplicates     In create mode, comment on matched issues with new evidence
  --output=<path>          Write JSON scout output or markdown digest
  --state-path=<path>      Fingerprint state path (default: .slope/issue-scout.json)
  --json                   Print machine-readable JSON

Default sources:
  .slope/common-issues.json, .slope/transcripts, .slope/review-findings.json, .slope/guard-metrics.jsonl
`);
}
