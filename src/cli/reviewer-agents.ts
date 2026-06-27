import type { ReviewRecommendation, ReviewType } from '../core/types.js';

export interface ReviewerAgentContext {
  sprintNumber?: number;
  theme?: string;
  filePatterns?: string[];
  artifacts?: string[];
  hazards?: string[];
}

export interface ReviewerAgentSpec {
  id: string;
  name: string;
  lane: ReviewType;
  priority: ReviewRecommendation['priority'];
  scope: string[];
  focus: string[];
  evidence: string[];
  prompt: string;
}

const EVIDENCE_REQUIREMENTS = [
  'agent id/name',
  'lane',
  'verdict',
  'required fixes',
  'how fixes were addressed',
  'transcript or output path',
];

export function buildReviewerAgentSpecs(
  recommendations: ReviewRecommendation[],
  context: ReviewerAgentContext = {},
): ReviewerAgentSpec[] {
  const domain = inferDomain(context);
  const scope = scopedArtifacts(context);
  const hazards = (context.hazards ?? []).map(cleanLine).filter(Boolean).slice(0, 4);

  return recommendations.map(rec => {
    const name = reviewerName(rec.review_type, domain);
    const focus = [
      rec.reason,
      ...hazards.map(hazard => `Known hazard: ${hazard}`),
      `Inspect sprint artifacts for ${domain}.`,
      'Challenge self-authored review notes; require independent evidence unless an explicit override is chosen.',
    ];
    const spec: Omit<ReviewerAgentSpec, 'prompt'> = {
      id: reviewerId(rec.review_type, name),
      name,
      lane: rec.review_type,
      priority: rec.priority,
      scope,
      focus,
      evidence: EVIDENCE_REQUIREMENTS,
    };
    return {
      ...spec,
      prompt: buildReviewerAgentPrompt(spec, context),
    };
  });
}

export function formatReviewerAgentGuidance(specs: ReviewerAgentSpec[]): string {
  if (specs.length === 0) return '';
  const lines = [
    'Purpose-built reviewer agents:',
    '  Create fresh reviewer agents for this sprint; they do not need to be existing cc-them agents.',
    `  Gate evidence must include: ${EVIDENCE_REQUIREMENTS.join(', ')}.`,
  ];

  for (const spec of specs) {
    lines.push(
      `  - ${spec.name} (${spec.lane}, ${spec.priority})`,
      `    Scope: ${spec.scope.join(', ')}`,
      `    Focus: ${spec.focus.slice(0, 3).join(' | ')}`,
      `    Evidence command: slope sprint gate ${gateForLane(spec.lane)} --reviewer=${spec.id} --evidence=<transcript-or-output>`,
    );
  }

  return lines.join('\n');
}

export function formatReviewerAgentSummary(specs: ReviewerAgentSpec[]): string {
  if (specs.length === 0) return '';
  const names = specs.map(spec => `${spec.name} (${spec.lane})`).join(', ');
  return [
    `Create purpose-built reviewer agents: ${names}.`,
    'They do not need to be existing cc-them agents.',
    `Review evidence must include ${EVIDENCE_REQUIREMENTS.join(', ')}.`,
  ].join(' ');
}

function buildReviewerAgentPrompt(spec: Omit<ReviewerAgentSpec, 'prompt'>, context: ReviewerAgentContext): string {
  const sprint = context.sprintNumber ? `Sprint ${context.sprintNumber}` : 'the current sprint';
  return [
    `Create a purpose-built ${spec.name} for ${sprint}.`,
    'This reviewer does not need to be an existing cc-them agent; scope it to the current sprint and artifacts.',
    `Lane: ${spec.lane}.`,
    `Scope: ${spec.scope.join(', ')}.`,
    'Focus:',
    ...spec.focus.map(item => `- ${item}`),
    'Return review evidence with:',
    ...spec.evidence.map(item => `- ${item}`),
    'Do not mark the review gate complete from self-authored notes unless the user explicitly chooses self-review or manual override.',
  ].join('\n');
}

function scopedArtifacts(context: ReviewerAgentContext): string[] {
  const explicit = [...(context.artifacts ?? []), ...(context.filePatterns ?? [])]
    .map(cleanLine)
    .filter(Boolean);
  const unique = [...new Set(explicit)].slice(0, 8);
  if (unique.length > 0) return unique;
  return ['sprint plan', 'scorecard', 'PR diff', 'changed files'];
}

function inferDomain(context: ReviewerAgentContext): string {
  const text = [
    context.theme ?? '',
    ...(context.filePatterns ?? []),
    ...(context.artifacts ?? []),
    ...(context.hazards ?? []),
  ].join(' ').toLowerCase();

  if (/\b(stock|recommend|recommendation|ranking|score|scoring|methodology|data)\b/.test(text)) {
    return 'data/scoring methodology';
  }
  if (/\b(auth|token|secret|credential|oauth|jwt|security|crypto|permission)\b/.test(text)) {
    return 'security/risk boundary';
  }
  if (/\b(cli|guard|workflow|hook|agent|codex|review gate|sprint)\b/.test(text)) {
    return 'agent workflow and CLI safety';
  }
  if (/\b(ui|ux|component|css|layout|form|button|accessibility)\b/.test(text)) {
    return 'user experience';
  }
  if (/\b(sql|sqlite|migration|schema|store|database|wal|filesystem)\b/.test(text)) {
    return 'storage and migration safety';
  }
  return 'current sprint domain';
}

function reviewerName(lane: ReviewType, domain: string): string {
  if (lane === 'architect') {
    if (domain === 'data/scoring methodology') return 'architecture/product-safety reviewer';
    if (domain === 'agent workflow and CLI safety') return 'workflow architecture reviewer';
    return 'architecture boundary reviewer';
  }
  if (lane === 'code') {
    if (domain === 'data/scoring methodology') return 'data/scoring-methodology reviewer';
    return 'implementation correctness reviewer';
  }
  if (lane === 'security') return 'security/risk-boundary reviewer';
  if (lane === 'ml-engineer') return 'data/scoring-methodology reviewer';
  if (lane === 'ux') return 'UX/accessibility reviewer';
  return `${lane} reviewer`;
}

function gateForLane(lane: ReviewType): 'architect_review' | 'code_review' {
  return lane === 'architect' ? 'architect_review' : 'code_review';
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function reviewerId(lane: ReviewType, name: string): string {
  const laneSlug = slug(lane);
  const nameSlug = slug(name);
  return nameSlug.includes(laneSlug) ? nameSlug : `${laneSlug}-${nameSlug}`;
}

function cleanLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
