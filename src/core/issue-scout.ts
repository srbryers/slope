import { createHash } from 'node:crypto';
import type { SprintId } from './sprint-id.js';

export interface IssueScoutEvidence {
  source: string;
  sourcePath?: string;
  sprint?: SprintId;
  command?: string;
  quote: string;
  details?: Record<string, unknown>;
}

export interface IssueScoutClassification {
  slopeDriven: boolean;
  kind: string;
  title: string;
  labels: string[];
  confidence: number;
  summary: string;
  acceptanceCriteria: string[];
  reasons: string[];
}

export interface IssueScoutCandidate {
  kind: string;
  title: string;
  labels: string[];
  confidence: number;
  summary: string;
  acceptanceCriteria: string[];
  evidence: IssueScoutEvidence[];
  fingerprint: string;
  dedupe?: IssueScoutDedupeResult;
}

export interface ExistingIssue {
  number: number;
  title: string;
  body?: string;
  state?: string;
  url?: string;
  labels?: string[];
}

export interface IssueScoutDedupeResult {
  status: 'new' | 'duplicate';
  reason: string;
  matchedIssue?: ExistingIssue;
  similarity?: number;
}

export interface IssueScoutStateRecord {
  fingerprint: string;
  title: string;
  issueNumber?: number;
  issueUrl?: string;
  status: 'created' | 'commented' | 'deduped';
  updatedAt: string;
  sourcePaths?: string[];
}

export interface IssueScoutState {
  version: 1;
  records: IssueScoutStateRecord[];
}

interface PatternDefinition {
  kind: string;
  title: string;
  labels: string[];
  summary: string;
  acceptanceCriteria: string[];
  required: RegExp[];
  signals: RegExp[];
}

const FINGERPRINT_MARKER = 'slope-issue-scout:fingerprint:';

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'should',
  'slope', 'issue', 'issues', 'when', 'then', 'than', 'after', 'before',
  'during', 'agent', 'agents', 'sprint', 'sprints',
]);

const SLOPE_PRODUCT_SIGNALS: RegExp[] = [
  /\bslope\b/i,
  /\.slope\b/i,
  /\bscorecard\b/i,
  /\bbriefing\b/i,
  /\bauto-card\b/i,
  /\bclaim\b/i,
  /\bguard\b/i,
  /\bpost-push\b/i,
  /\bcloseout\b/i,
  /\breview\b/i,
  /\bvalidate\b/i,
  /\broadmap\b/i,
  /\btranscript\b/i,
  /\bcommon-issues\b/i,
  /\bNODE_MODULE_VERSION\b/i,
  /\bbetter-sqlite3\b/i,
];

const PROBLEM_SIGNALS: RegExp[] = [
  /\bfailed?\b/i,
  /\bfailure\b/i,
  /\berror\b/i,
  /\bcrash(?:ed)?\b/i,
  /\bhung\b/i,
  /\bhang(?:s|ing)?\b/i,
  /\bmissing\b/i,
  /\binvalid\b/i,
  /\bnonzero\b/i,
  /\bblocked\b/i,
  /\bworkaround\b/i,
  /\bmanual(?:ly)?\b/i,
  /\bwarning\b/i,
  /\bflood(?:ed|ing)?\b/i,
  /\bstale\b/i,
  /\bdrift\b/i,
  /\bopaque\b/i,
  /\bwrong\b/i,
  /\bregression\b/i,
  /\bbug\b/i,
];

const PATTERNS: PatternDefinition[] = [
  {
    kind: 'ticket-review-result-normalization',
    title: 'Ticket-style scorecards break review/recommend/amend normalization',
    labels: ['bug', 'agent-dx', 'workflow'],
    summary: 'Ticket-style scorecard miss results can be normalized into a misleading review result.',
    acceptanceCriteria: [
      'Ticket-style scorecards preserve miss results such as short, long, left, and right in review output.',
      'Review/recommend/amend paths normalize both classic shot records and ticket-style shot records consistently.',
      'Regression coverage includes a ticket-style scorecard where a short result must not render as Green.',
    ],
    required: [
      /ticket-style|ticket style/i,
      /render(?:ed|s)?[^.\n]{0,80}green[^.\n]{0,80}(short|miss)|short[^.\n]{0,80}render(?:ed|s)?[^.\n]{0,80}green/i,
      /review[^.\n]{0,80}green[^.\n]{0,80}short|review[^.\n]{0,80}short[^.\n]{0,80}green/i,
    ],
    signals: [/review/i, /recommend/i, /amend/i, /scorecard/i, /green/i, /\bshort\b/i],
  },
  {
    kind: 'canonical-review-artifact',
    title: 'Sprint review should materialize or verify the canonical review markdown',
    labels: ['bug', 'agent-dx', 'workflow'],
    summary: 'The nominal sprint review command can leave the canonical review markdown missing.',
    acceptanceCriteria: [
      'The closeout path either writes docs/retros/sprint-N-review.md or clearly requires an --output path.',
      'Validation or PR status warns when a scorecard exists without the matching review markdown.',
      'Tests cover the default review command and canonical artifact verification.',
    ],
    required: [/review[^.\n]{0,120}(markdown|md|artifact|stdout|materialize|missing)|sprint-\d+-review\.md/i],
    signals: [/slope review/i, /closeout/i, /docs\/retros/i, /stdout/i, /canonical/i],
  },
  {
    kind: 'pr-review-prompts-vs-reviewed',
    title: 'PR review state should not mark prompt generation as reviewed',
    labels: ['bug', 'agent-dx', 'workflow'],
    summary: 'PR closeout state can confuse generated review prompts with completed reviewer work.',
    acceptanceCriteria: [
      'slope pr status does not report PR review: reviewed from prompt generation alone.',
      'slope pr review records a review_pending or prompts_generated state unless reviewer output is present.',
      'Ready for PR closeout requires completed review rounds or explicit waiver metadata.',
    ],
    required: [/prompt[^.\n]{0,100}(reviewed|generation)|reviewed[^.\n]{0,100}prompt|PR review:\s*reviewed/i],
    signals: [/slope pr status/i, /slope pr review/i, /review rounds/i, /closeout/i, /waiver/i],
  },
  {
    kind: 'explore-stale-map-warning-flood',
    title: 'Explore/stale-map warnings flood output and can hang briefing across long sprint runs',
    labels: ['bug', 'agent-dx', 'workflow'],
    summary: 'Repeated explore or stale-map warnings can swamp agent output and make briefing/closeout unreliable.',
    acceptanceCriteria: [
      'Explore and stale-map warnings rate-limit identical messages per session or turn.',
      'slope briefing caps, paginates, or summarizes large historical hazard ledgers after useful output.',
      'slope map refuses to overwrite a useful CODEBASE.md with zero-source output unless explicitly forced.',
      'After refresh, the guard stops warning or explains the remaining stale condition with one concrete action.',
    ],
    required: [/explore[^.\n]{0,120}(warning|650|flood|loop)|stale-map|briefing[^.\n]{0,120}(hang|hung|time-box|ledger)/i],
    signals: [/slope briefing/i, /slope map/i, /CODEBASE\.md/i, /rate-?limit/i, /warning/i, /hazard ledger/i],
  },
  {
    kind: 'validate-sprint-scope',
    title: 'validate --sprint should isolate the requested sprint result',
    labels: ['bug', 'agent-dx', 'workflow'],
    summary: 'Sprint-specific validation can behave like a historical validation pass and fail on unrelated scorecards.',
    acceptanceCriteria: [
      'slope validate --sprint=N evaluates only the requested scorecard.',
      'Historical invalid scorecards do not make a valid requested sprint fail.',
      'The command output makes the validation scope explicit.',
      'Tests cover a valid requested sprint with invalid historical scorecards and an unknown sprint number.',
    ],
    required: [/validate\s+--sprint|--sprint[^.\n]{0,120}(historical|all scorecards|project-wide)/i],
    signals: [/historical/i, /scorecards/i, /nonzero/i, /valid/i, /invalid/i],
  },
  {
    kind: 'sqlite-native-abi-drift',
    title: 'sprint status should detect or recover better-sqlite3 native ABI drift',
    labels: ['bug', 'agent-dx'],
    summary: 'SQLite-backed sprint status commands can fail with opaque native module ABI errors.',
    acceptanceCriteria: [
      'slope sprint status catches stale native binding failures and prints a concrete repair command.',
      'The recovery message names active Node version and NODE_MODULE_VERSION details when available.',
      'A health or status path exercises SQLite-backed commands during sprint start and closeout.',
      'Tests cover stale native module errors for sprint status.',
    ],
    required: [/better-sqlite3|NODE_MODULE_VERSION|native ABI|native module/i],
    signals: [/sprint status/i, /sqlite/i, /node/i, /compiled/i, /rebuild/i],
  },
];

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9#.\-/]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function evidenceText(evidence: IssueScoutEvidence | IssueScoutEvidence[]): string {
  const items = Array.isArray(evidence) ? evidence : [evidence];
  return items
    .map(item => [
      item.source,
      item.sourcePath ?? '',
      item.sprint == null ? '' : `S${item.sprint}`,
      item.command ?? '',
      item.quote,
      item.details ? JSON.stringify(item.details) : '',
    ].filter(Boolean).join('\n'))
    .join('\n\n');
}

function countMatches(text: string, regexes: RegExp[]): number {
  return regexes.reduce((count, regex) => count + (regex.test(text) ? 1 : 0), 0);
}

function isLikelySlopeProductIssue(text: string): boolean {
  return countMatches(text, SLOPE_PRODUCT_SIGNALS) >= 2 && countMatches(text, PROBLEM_SIGNALS) >= 1;
}

function fallbackTitle(text: string): string {
  const firstLine = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line && !isMetadataLine(line)) ?? 'SLOPE workflow issue';
  const cleaned = firstLine
    .replace(/^[-*#\s]+/, '')
    .replace(/^issue:\s*/i, '')
    .replace(/[`*_]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'SLOPE workflow issue needs triage';
  return cleaned.length > 90 ? `${cleaned.slice(0, 87).trim()}...` : cleaned;
}

function isMetadataLine(line: string): boolean {
  const lower = line.toLowerCase();
  const pathLike = !line.includes(' ')
    && lower.includes('/')
    && ['.md', '.json', '.jsonl', '.txt', '.log'].some(ext => lower.endsWith(ext));
  const sprintLike = lower.startsWith('s') && Number.isFinite(Number(lower.slice(1)));

  return pathLike
    || sprintLike
    || line.startsWith('slope ')
    || line.startsWith('{');
}

export function classifySlopeIssue(input: string | IssueScoutEvidence | IssueScoutEvidence[]): IssueScoutClassification {
  const text = typeof input === 'string' ? input : evidenceText(input);

  let best: { pattern: PatternDefinition; score: number; requiredHits: number; signalHits: number } | null = null;
  for (const pattern of PATTERNS) {
    const requiredHits = countMatches(text, pattern.required);
    if (requiredHits === 0) continue;
    const signalHits = countMatches(text, pattern.signals);
    const score = requiredHits * 3 + signalHits;
    if (!best || score > best.score) {
      best = { pattern, score, requiredHits, signalHits };
    }
  }

  if (best) {
    const confidence = Math.min(0.95, 0.7 + best.signalHits * 0.04 + best.requiredHits * 0.05);
    return {
      slopeDriven: true,
      kind: best.pattern.kind,
      title: best.pattern.title,
      labels: best.pattern.labels,
      confidence: Number(confidence.toFixed(2)),
      summary: best.pattern.summary,
      acceptanceCriteria: best.pattern.acceptanceCriteria,
      reasons: [`matched ${best.pattern.kind}`, `${best.signalHits} supporting signal(s)`],
    };
  }

  if (isLikelySlopeProductIssue(text)) {
    return {
      slopeDriven: true,
      kind: 'slope-workflow-follow-up',
      title: fallbackTitle(text),
      labels: ['agent-dx', 'workflow'],
      confidence: 0.55,
      summary: 'The evidence appears to describe a SLOPE product or workflow issue that needs human triage.',
      acceptanceCriteria: [
        'Reproduce the workflow failure from the captured evidence.',
        'Decide whether the fix belongs in SLOPE product code, docs, or guard configuration.',
        'Add focused regression coverage or a documented manual verification path.',
      ],
      reasons: ['multiple SLOPE product signals found'],
    };
  }

  return {
    slopeDriven: false,
    kind: 'not-slope-driven',
    title: 'Not a SLOPE product issue',
    labels: [],
    confidence: 0,
    summary: 'Evidence does not contain enough SLOPE product signals.',
    acceptanceCriteria: [],
    reasons: ['insufficient SLOPE product signals'],
  };
}

function stableFingerprint(kind: string, title: string): string {
  const payload = JSON.stringify({ kind, title: normalizeText(title) });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

export function fingerprintCandidate(candidate: Pick<IssueScoutCandidate, 'kind' | 'title'>): string {
  return stableFingerprint(candidate.kind, candidate.title);
}

export function buildIssueCandidate(evidence: IssueScoutEvidence | IssueScoutEvidence[]): IssueScoutCandidate | null {
  const evidenceItems = Array.isArray(evidence) ? evidence : [evidence];
  const classification = classifySlopeIssue(evidenceItems);
  if (!classification.slopeDriven) return null;

  const candidate: IssueScoutCandidate = {
    kind: classification.kind,
    title: classification.title,
    labels: [...classification.labels],
    confidence: classification.confidence,
    summary: classification.summary,
    acceptanceCriteria: [...classification.acceptanceCriteria],
    evidence: evidenceItems,
    fingerprint: '',
  };
  candidate.fingerprint = fingerprintCandidate(candidate);
  return candidate;
}

export function buildIssueCandidates(evidence: IssueScoutEvidence[]): IssueScoutCandidate[] {
  const byKind = new Map<string, IssueScoutCandidate>();

  for (const item of evidence) {
    const candidate = buildIssueCandidate(item);
    if (!candidate) continue;

    const existing = byKind.get(candidate.kind);
    if (!existing) {
      byKind.set(candidate.kind, candidate);
      continue;
    }

    existing.confidence = Math.max(existing.confidence, candidate.confidence);
    existing.evidence.push(...candidate.evidence);
    existing.labels = Array.from(new Set([...existing.labels, ...candidate.labels]));
  }

  return Array.from(byKind.values()).sort((a, b) =>
    b.confidence - a.confidence || a.title.localeCompare(b.title)
  );
}

function tokens(text: string): Set<string> {
  return new Set(normalizeText(text)
    .split(' ')
    .filter(token => token.length > 2 && !STOP_WORDS.has(token)));
}

function titleSimilarity(a: string, b: string): number {
  const aTokens = tokens(a);
  const bTokens = tokens(b);
  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection++;
  }
  return intersection / Math.min(aTokens.size, bTokens.size);
}

function bodyHasFingerprint(issue: ExistingIssue, fingerprint: string): boolean {
  return (issue.body ?? '').includes(`${FINGERPRINT_MARKER}${fingerprint}`);
}

export function dedupeCandidates(
  candidates: IssueScoutCandidate[],
  existingIssues: ExistingIssue[],
): IssueScoutCandidate[] {
  return candidates.map(candidate => {
    const fingerprintMatch = existingIssues.find(issue => bodyHasFingerprint(issue, candidate.fingerprint));
    if (fingerprintMatch) {
      return {
        ...candidate,
        dedupe: {
          status: 'duplicate',
          reason: 'existing issue body contains the same scout fingerprint',
          matchedIssue: fingerprintMatch,
          similarity: 1,
        },
      };
    }

    const exactTitle = existingIssues.find(issue =>
      normalizeText(issue.title) === normalizeText(candidate.title)
    );
    if (exactTitle) {
      return {
        ...candidate,
        dedupe: {
          status: 'duplicate',
          reason: 'existing issue title matches candidate title',
          matchedIssue: exactTitle,
          similarity: 1,
        },
      };
    }

    let best: { issue: ExistingIssue; similarity: number } | null = null;
    for (const issue of existingIssues) {
      const similarity = titleSimilarity(candidate.title, issue.title);
      if (!best || similarity > best.similarity) best = { issue, similarity };
    }

    if (best && best.similarity >= 0.74) {
      return {
        ...candidate,
        dedupe: {
          status: 'duplicate',
          reason: 'existing issue title is highly similar',
          matchedIssue: best.issue,
          similarity: Number(best.similarity.toFixed(2)),
        },
      };
    }

    return {
      ...candidate,
      dedupe: {
        status: 'new',
        reason: 'no matching issue found',
      },
    };
  });
}

function cleanOneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, max = 420): string {
  const cleaned = cleanOneLine(value);
  return cleaned.length > max ? `${cleaned.slice(0, max - 3).trim()}...` : cleaned;
}

function formatEvidenceLine(evidence: IssueScoutEvidence): string {
  const parts: string[] = [];
  if (evidence.sourcePath) parts.push(evidence.sourcePath);
  if (evidence.sprint != null) parts.push(`S${evidence.sprint}`);
  if (evidence.command) parts.push(`command: ${evidence.command}`);
  const prefix = parts.length > 0 ? `${parts.join(' | ')} - ` : '';
  return `- ${prefix}${truncate(evidence.quote)}`;
}

export function formatIssueBody(candidate: IssueScoutCandidate): string {
  const lines: string[] = [
    '## Summary',
    '',
    candidate.summary,
    '',
    '## Evidence',
    '',
  ];

  for (const item of candidate.evidence.slice(0, 8)) {
    lines.push(formatEvidenceLine(item));
  }
  if (candidate.evidence.length > 8) {
    lines.push(`- ${candidate.evidence.length - 8} additional evidence item(s) omitted from this issue body.`);
  }

  lines.push('', '## Acceptance Criteria', '');
  for (const criterion of candidate.acceptanceCriteria) {
    lines.push(`- ${criterion}`);
  }

  lines.push(
    '',
    '## Scout Metadata',
    '',
    `- confidence: ${candidate.confidence.toFixed(2)}`,
    `- labels: ${candidate.labels.join(', ')}`,
    `- ${FINGERPRINT_MARKER}${candidate.fingerprint}`,
  );

  return `${lines.join('\n')}\n`;
}

export function formatIssueScoutComment(candidate: IssueScoutCandidate): string {
  const lines = [
    '## Additional SLOPE Issue Scout Evidence',
    '',
    `The scout found more evidence for this issue with confidence ${candidate.confidence.toFixed(2)}.`,
    '',
    '## Evidence',
    '',
    ...candidate.evidence.slice(0, 8).map(formatEvidenceLine),
    '',
    '## Scout Metadata',
    '',
    `- ${FINGERPRINT_MARKER}${candidate.fingerprint}`,
  ];
  return `${lines.join('\n')}\n`;
}

export function renderIssueScoutDigest(
  candidates: IssueScoutCandidate[],
  opts: { generatedAt?: string; repo?: string } = {},
): string {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const lines: string[] = [
    '# SLOPE Issue Scout Daily Digest',
    '',
    `Generated: ${generatedAt}`,
  ];
  if (opts.repo) lines.push(`Repository: ${opts.repo}`);

  const newCandidates = candidates.filter(c => c.dedupe?.status !== 'duplicate');
  const duplicates = candidates.filter(c => c.dedupe?.status === 'duplicate');

  lines.push('', '## Request Approval To Fix', '');
  if (newCandidates.length === 0) {
    lines.push('No new SLOPE-driven issue candidates need approval today.');
  } else {
    for (const candidate of newCandidates) {
      lines.push(`- ${candidate.title}`);
      lines.push(`  - confidence: ${candidate.confidence.toFixed(2)}`);
      lines.push(`  - labels: ${candidate.labels.join(', ')}`);
      lines.push(`  - fingerprint: ${candidate.fingerprint}`);
      lines.push('  - requested decision: approve fix, defer, or reject');
    }
  }

  if (duplicates.length > 0) {
    lines.push('', '## Existing Or Duplicate Candidates', '');
    for (const candidate of duplicates) {
      const issue = candidate.dedupe?.matchedIssue;
      const ref = issue ? `#${issue.number}${issue.state ? ` (${issue.state})` : ''}` : 'existing issue';
      lines.push(`- ${candidate.title} -> ${ref}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export function parseIssueScoutState(raw: string): IssueScoutState {
  try {
    const parsed = JSON.parse(raw) as Partial<IssueScoutState>;
    return {
      version: 1,
      records: Array.isArray(parsed.records) ? parsed.records.filter(isStateRecord) : [],
    };
  } catch {
    return { version: 1, records: [] };
  }
}

function isStateRecord(value: unknown): value is IssueScoutStateRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.fingerprint === 'string'
    && typeof record.title === 'string'
    && typeof record.status === 'string'
    && typeof record.updatedAt === 'string';
}

export function mergeIssueScoutState(
  state: IssueScoutState,
  records: IssueScoutStateRecord[],
): IssueScoutState {
  const merged = new Map<string, IssueScoutStateRecord>();
  for (const record of state.records) merged.set(record.fingerprint, record);
  for (const record of records) {
    const existing = merged.get(record.fingerprint);
    merged.set(record.fingerprint, {
      ...existing,
      ...record,
      sourcePaths: Array.from(new Set([
        ...(existing?.sourcePaths ?? []),
        ...(record.sourcePaths ?? []),
      ])).sort(),
    });
  }
  return {
    version: 1,
    records: Array.from(merged.values()).sort((a, b) => a.title.localeCompare(b.title)),
  };
}
