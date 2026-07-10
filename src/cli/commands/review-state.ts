import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CodificationCost, CodificationStatus, ReviewFinding, ReviewRecommendation, ReviewType, HazardSeverity } from '../../core/types.js';
import { recommendReviews, amendScorecardWithFindings } from '../../core/review.js';
import { loadConfig, detectLatestSprint, normalizeScorecard, parseSprintNumber } from '../../core/index.js';
import { createDeferred, listDeferred, resolveDeferred } from '../../core/deferred.js';
import type { DeferredSeverity } from '../../core/deferred.js';
import { HAZARD_SEVERITY_PENALTIES } from '../../core/constants.js';
import type { GolfScorecard } from '../../core/types.js';
import {
  FINDINGS_FILE,
  createFindingId,
  displayFindingId,
  formatCodificationMetadata,
  isCodificationCandidate,
  loadFindings,
  matchesFindingId,
  saveFindings,
} from '../../core/findings.js';
export { loadFindings } from '../../core/findings.js';
export type { FindingsFile } from '../../core/findings.js';
import type { RoadmapSprint, SlopeConfig } from '../../core/index.js';
import { findPlanContent, countTickets, countPackageRefs } from '../guards/plan-analysis.js';
import { inferSprintContext, loadRoadmapForInference } from '../sprint-inference.js';
import { isActiveSprintState, loadSprintState, updateReviewRequirements, type ReviewGateRequirementInput } from '../sprint-state.js';
import { buildReviewerAgentSpecs, formatReviewerAgentGuidance } from '../reviewer-agents.js';

export interface ReviewState {
  rounds_required: number;
  rounds_completed: number;
  plan_file?: string;
  tier: string;
  started_at: string;
}

const REVIEW_STATE_FILE = '.slope/review-state.json';

const TIER_ROUNDS: Record<string, number> = {
  skip: 0,
  light: 1,
  standard: 2,
  deep: 3,
};

export function loadReviewState(cwd: string): ReviewState | null {
  const statePath = join(cwd, REVIEW_STATE_FILE);
  if (!existsSync(statePath)) return null;
  try {
    return JSON.parse(readFileSync(statePath, 'utf8')) as ReviewState;
  } catch {
    return null;
  }
}

export function saveReviewState(cwd: string, state: ReviewState): void {
  const dir = join(cwd, '.slope');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(cwd, REVIEW_STATE_FILE), JSON.stringify(state, null, 2) + '\n');
}

function detectTier(content: string): { tier: string; rounds: number } {
  const ticketCount = countTickets(content);
  const packageRefs = countPackageRefs(content);
  const hasInfra = /\b(infrastructure|new package|new service|architect)\b/i.test(content);
  const isResearchOrDocs = /^#+\s*(research|docs|documentation|infra|spike)\b/im.test(content)
    && ticketCount === 0;

  if (isResearchOrDocs || ticketCount === 0) return { tier: 'skip', rounds: 0 };
  if (ticketCount <= 2 && packageRefs <= 1) return { tier: 'light', rounds: 1 };
  if (ticketCount >= 5 || hasInfra) return { tier: 'deep', rounds: 3 };
  return { tier: 'standard', rounds: 2 };
}

function tierLabel(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function startCommand(args: string[], cwd: string): void {
  const roundsArg = args.find(a => a.startsWith('--rounds='));
  const tierArg = args.find(a => a.startsWith('--tier='));

  let rounds: number;
  let tier: string;
  let planFile: string | undefined;

  if (roundsArg) {
    rounds = parseInt(roundsArg.slice('--rounds='.length), 10);
    if (isNaN(rounds) || rounds < 0) {
      console.error('Error: --rounds must be a non-negative integer.');
      process.exit(1);
    }
    // Reverse-map rounds to tier name
    const entry = Object.entries(TIER_ROUNDS).find(([, r]) => r === rounds);
    tier = entry ? entry[0] : 'custom';
  } else if (tierArg) {
    tier = tierArg.slice('--tier='.length).toLowerCase();
    if (!(tier in TIER_ROUNDS)) {
      console.error(`Error: Unknown tier "${tier}". Use skip, light, standard, or deep.`);
      process.exit(1);
    }
    rounds = TIER_ROUNDS[tier];
  } else {
    // Auto-detect from plan file
    const plan = findPlanContent(cwd);
    if (plan) {
      const detected = detectTier(plan.content);
      tier = detected.tier;
      rounds = detected.rounds;
      planFile = plan.path;
    } else {
      console.error('Error: No plan file found in .claude/plans/ or ~/.claude/plans/. Use --rounds=N or --tier=<tier>.');
      process.exit(1);
    }
  }

  // Find plan file if not already set
  if (!planFile) {
    const plan = findPlanContent(cwd);
    if (plan) planFile = plan.path;
  }

  const state: ReviewState = {
    rounds_required: rounds,
    rounds_completed: 0,
    plan_file: planFile,
    tier,
    started_at: new Date().toISOString(),
  };

  saveReviewState(cwd, state);
  console.log(`Review started: ${tierLabel(tier)} (${rounds} round${rounds !== 1 ? 's' : ''}). Run 'slope review round' after each review round.`);
}

function roundCommand(cwd: string): void {
  const state = loadReviewState(cwd);
  if (!state) {
    console.error("No active review. Run 'slope review start' to begin.");
    process.exit(1);
  }

  state.rounds_completed += 1;
  saveReviewState(cwd, state);

  if (state.rounds_completed >= state.rounds_required) {
    console.log(`Round ${state.rounds_completed}/${state.rounds_required} complete. Review done — ExitPlanMode is unblocked.`);
  } else {
    const remaining = state.rounds_required - state.rounds_completed;
    console.log(`Round ${state.rounds_completed}/${state.rounds_required} complete. ${remaining} round${remaining !== 1 ? 's' : ''} remaining.`);
  }
}

function statusCommand(cwd: string): void {
  const state = loadReviewState(cwd);
  if (!state) {
    console.log("No active review. Run 'slope review start' to begin.");
    return;
  }

  const done = state.rounds_completed >= state.rounds_required;
  console.log(`Review: ${tierLabel(state.tier)} (${state.rounds_completed}/${state.rounds_required} rounds${done ? ' — complete' : ''})`);
  if (state.plan_file) console.log(`Plan: ${state.plan_file}`);
  console.log(`Started: ${state.started_at}`);
}

function resetCommand(cwd: string): void {
  const statePath = join(cwd, REVIEW_STATE_FILE);
  if (existsSync(statePath)) {
    unlinkSync(statePath);
  }
  console.log('Review state cleared.');
}

// --- Review Recommend ---

interface ReviewRecommendationContext {
  ticketCount: number;
  slope: number;
  filePatterns: string[];
  sprintNumber: number;
  hasNewInfra: boolean;
  theme?: string;
  artifacts?: string[];
  hazards?: string[];
}

function parseSprintArg(args: string[]): number | null {
  const sprintArg = args.find(a => a.startsWith('--sprint='));
  if (!sprintArg) return null;
  return parseSprintNumber(sprintArg.slice('--sprint='.length));
}

function hasLocalSlopeContext(cwd: string, config: SlopeConfig): boolean {
  return existsSync(join(cwd, '.slope', 'config.json'))
    || existsSync(join(cwd, '.slope', 'sprint-state.json'))
    || existsSync(join(cwd, config.roadmapPath))
    || existsSync(join(cwd, config.scorecardDir));
}

function collectStringValues(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, out);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStringValues(item, out);
  }
  return out;
}

function extractHazardLines(values: string[]): string[] {
  return values
    .map(value => value.replace(/\s+/g, ' ').trim())
    .filter(value => /\b(hazard|risk|gotcha|warning|failure|safety|security|boundary|review gate)\b/i.test(value))
    .slice(0, 8);
}

function recommendationFromPlan(content: string): ReviewRecommendationContext {
  const filePatterns: string[] = [];
  const slopeMatch = content.match(/\*\*Slope:\*\*\s*(\d+)/);
  const sprintMatch = content.match(/Sprint\s+(\d+(?:\.\d+)?)/);
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const fileMatches = content.matchAll(/`([^`]+\.[a-z]+)`/g);
  for (const m of fileMatches) filePatterns.push(m[1]);

  return {
    ticketCount: countTickets(content),
    slope: slopeMatch ? parseInt(slopeMatch[1], 10) : 0,
    sprintNumber: sprintMatch ? parseSprintNumber(sprintMatch[1]) ?? 0 : 0,
    filePatterns,
    theme: titleMatch?.[1],
    artifacts: filePatterns,
    hazards: extractHazardLines(content.split('\n')),
    hasNewInfra: /\b(new module|new package|new service|new infrastructure)\b/i.test(content),
  };
}

function recommendationFromRoadmapSprint(sprint: RoadmapSprint): ReviewRecommendationContext {
  const stringValues = collectStringValues(sprint);
  const filePatterns = stringValues.filter(value => /[/.]/.test(value));
  return {
    ticketCount: sprint.tickets?.length ?? 0,
    slope: sprint.slope ?? 0,
    sprintNumber: sprint.id,
    filePatterns,
    theme: sprint.theme,
    artifacts: filePatterns.length > 0 ? filePatterns : sprint.tickets?.map(ticket => `${ticket.key}: ${ticket.title}`),
    hazards: extractHazardLines(stringValues),
    hasNewInfra: /\b(new module|new package|new service|new infrastructure)\b/i.test(stringValues.join('\n')),
  };
}

function recommendationFromScorecard(card: GolfScorecard): ReviewRecommendationContext {
  const stringValues = collectStringValues(card);
  const filePatterns = stringValues.filter(value => /[/.]/.test(value));
  return {
    ticketCount: card.shots?.length ?? 0,
    slope: card.slope ?? 0,
    sprintNumber: card.sprint_number,
    filePatterns,
    theme: card.theme,
    artifacts: filePatterns,
    hazards: extractHazardLines(stringValues),
    hasNewInfra: /\b(new module|new package|new service|new infrastructure)\b/i.test(stringValues.join('\n')),
  };
}

function recommendationFromSprint(cwd: string, config: SlopeConfig, sprintNumber: number): ReviewRecommendationContext | null {
  const roadmap = loadRoadmapForInference(cwd, config);
  const roadmapSprint = roadmap?.sprints.find(sprint => sprint.id === sprintNumber);
  if (roadmapSprint) return recommendationFromRoadmapSprint(roadmapSprint);

  const scorecardPath = join(cwd, config.scorecardDir, `sprint-${sprintNumber}.json`);
  if (existsSync(scorecardPath)) {
    try {
      const card = normalizeScorecard(JSON.parse(readFileSync(scorecardPath, 'utf8')));
      return recommendationFromScorecard(card);
    } catch { /* malformed scorecard: fall through */ }
  }

  return null;
}

function inferRecommendationContext(args: string[], cwd: string): ReviewRecommendationContext {
  const config = loadConfig(cwd);
  const explicitSprint = parseSprintArg(args);
  if (explicitSprint) {
    return recommendationFromSprint(cwd, config, explicitSprint) ?? {
      ticketCount: 0,
      slope: 0,
      filePatterns: [],
      sprintNumber: explicitSprint,
      artifacts: [],
      hazards: [],
      hasNewInfra: false,
    };
  }

  const sprintState = loadSprintState(cwd);
  if (isActiveSprintState(sprintState)) {
    const context = recommendationFromSprint(cwd, config, sprintState.sprint);
    if (context) return context;
  }

  const localPlan = findPlanContent(cwd, { includeGlobal: false });
  if (localPlan) return recommendationFromPlan(localPlan.content);

  if (hasLocalSlopeContext(cwd, config)) {
    const inferred = inferSprintContext(cwd, config);
    const context = recommendationFromSprint(cwd, config, inferred.sprint);
    if (context) return context;
    return {
      ticketCount: 0,
      slope: 0,
      filePatterns: [],
      sprintNumber: inferred.sprint,
      artifacts: [],
      hazards: [],
      hasNewInfra: false,
    };
  }

  const globalPlan = findPlanContent(cwd, { includeRepoLocal: false, includeGlobal: true });
  if (globalPlan) return recommendationFromPlan(globalPlan.content);

  return {
    ticketCount: 0,
    slope: 0,
    filePatterns: [],
    sprintNumber: 0,
    artifacts: [],
    hazards: [],
    hasNewInfra: false,
  };
}

function recommendCommand(args: string[], cwd: string): void {
  const context = inferRecommendationContext(args, cwd);
  const recs = recommendReviews(context);

  const requirementInputs = reviewRequirementInputs(recs);
  const recorded = context.sprintNumber > 0
    ? updateReviewRequirements(cwd, context.sprintNumber, requirementInputs)
    : false;

  const sprintLabel = context.sprintNumber > 0 ? ` for Sprint ${context.sprintNumber}` : '';
  console.log(`Recommended reviews${sprintLabel} (${context.ticketCount} ticket${context.ticketCount !== 1 ? 's' : ''}, slope ${context.slope}):\n`);
  console.log('  Type           Priority      Reason');
  for (const rec of recs) {
    const type = rec.review_type.padEnd(14);
    const priority = rec.priority.padEnd(13);
    console.log(`  ${type} ${priority} ${rec.reason}`);
  }
  if (recorded) {
    console.log(`\nReview requirements recorded in Sprint ${context.sprintNumber} state.`);
  }

  const reviewerAgents = buildReviewerAgentSpecs(recs, {
    sprintNumber: context.sprintNumber > 0 ? context.sprintNumber : undefined,
    theme: context.theme,
    filePatterns: context.filePatterns,
    artifacts: context.artifacts,
    hazards: context.hazards,
  });
  const guidance = formatReviewerAgentGuidance(reviewerAgents);
  if (guidance) console.log(`\n${guidance}`);
}

const REVIEW_PRIORITY_RANK: Record<ReviewRecommendation['priority'], number> = {
  optional: 1,
  recommended: 2,
  required: 3,
};

function strongestRecommendation(recommendations: ReviewRecommendation[]): ReviewRecommendation | undefined {
  return recommendations.reduce<ReviewRecommendation | undefined>((strongest, current) => {
    if (!strongest || REVIEW_PRIORITY_RANK[current.priority] > REVIEW_PRIORITY_RANK[strongest.priority]) return current;
    return strongest;
  }, undefined);
}

function reviewRequirementInputs(recommendations: ReviewRecommendation[]): ReviewGateRequirementInput[] {
  const architect = strongestRecommendation(recommendations.filter(rec => rec.review_type === 'architect'));
  const code = strongestRecommendation(recommendations.filter(rec => rec.review_type !== 'architect'));
  const inputs: ReviewGateRequirementInput[] = [];
  if (architect) {
    inputs.push({
      gate: 'architect_review',
      priority: architect.priority,
      reason: architect.reason,
      source: 'review_recommend',
    });
  }
  if (code) {
    inputs.push({
      gate: 'code_review',
      priority: code.priority,
      reason: code.reason,
      source: 'review_recommend',
    });
  }
  return inputs;
}

// --- Findings Subcommands ---

const VALID_REVIEW_TYPES: ReviewType[] = ['architect', 'code', 'ml-engineer', 'security', 'ux', 'workaround'];
const VALID_SEVERITIES: HazardSeverity[] = ['minor', 'moderate', 'major', 'critical'];
const VALID_CODIFICATION_COSTS: CodificationCost[] = ['s', 'm', 'l'];
const VALID_CODIFICATION_STATUSES: CodificationStatus[] = ['open', 'paid_down', 'wontfix'];

function findingsAddCommand(args: string[], cwd: string): void {
  const typeArg = args.find(a => a.startsWith('--type='));
  const ticketArg = args.find(a => a.startsWith('--ticket='));
  const severityArg = args.find(a => a.startsWith('--severity='));
  const descArg = args.find(a => a.startsWith('--description='));
  const sprintArg = args.find(a => a.startsWith('--sprint='));
  const resolvedArg = args.includes('--resolved');
  const recursArg = args.includes('--recurs');
  const costArg = args.find(a => a.startsWith('--cost='));

  if (!typeArg || !descArg) {
    console.error('Error: --type and --description are required; --ticket is required except for --type=workaround.');
    console.error('Usage: slope review findings add --type=architect --ticket=S34-1 --severity=moderate --description="..."');
    console.error('Usage: slope review findings add --type=workaround --recurs --cost=s --description="..."');
    process.exit(1);
  }

  const reviewType = typeArg.slice('--type='.length) as ReviewType;
  if (!VALID_REVIEW_TYPES.includes(reviewType)) {
    console.error(`Error: Invalid review type "${reviewType}". Use: ${VALID_REVIEW_TYPES.join(', ')}`);
    process.exit(1);
  }

  if (!ticketArg && reviewType !== 'workaround') {
    console.error('Error: --ticket is required unless --type=workaround.');
    process.exit(1);
  }

  const cost = costArg ? costArg.slice('--cost='.length) as CodificationCost : undefined;
  if (cost && !VALID_CODIFICATION_COSTS.includes(cost)) {
    console.error(`Error: Invalid codification cost "${cost}". Use: ${VALID_CODIFICATION_COSTS.join(', ')}`);
    process.exit(1);
  }

  if (reviewType === 'workaround' && !recursArg) {
    console.error('Error: workaround findings must include --recurs so one-off workarounds are not logged as codification debt.');
    process.exit(1);
  }

  if (recursArg && !cost) {
    console.error('Error: recurring workaround findings require --cost=s|m|l.');
    process.exit(1);
  }

  if (cost && !recursArg) {
    console.error('Error: --cost requires --recurs.');
    process.exit(1);
  }

  const severity = severityArg
    ? severityArg.slice('--severity='.length) as HazardSeverity
    : 'moderate';
  if (!VALID_SEVERITIES.includes(severity)) {
    console.error(`Error: Invalid severity "${severity}". Use: ${VALID_SEVERITIES.join(', ')}`);
    process.exit(1);
  }

  const ticketKey = ticketArg ? ticketArg.slice('--ticket='.length) : 'workaround';
  const description = descArg.slice('--description='.length);

  // Determine sprint number
  let sprintNumber = 0;
  if (sprintArg) {
    sprintNumber = parseSprintNumber(sprintArg.slice('--sprint='.length)) ?? 0;
  } else {
    try {
      const config = loadConfig(cwd);
      sprintNumber = detectLatestSprint(config, cwd);
    } catch { /* fallback to 0 */ }
  }

  const finding: ReviewFinding = {
    id: createFindingId(),
    review_type: reviewType,
    ticket_key: ticketKey,
    severity,
    description,
    resolved: resolvedArg,
    recurs: recursArg || undefined,
    cost,
    codification_status: recursArg ? 'open' : undefined,
  };

  const existing = loadFindings(cwd);
  if (existing && existing.sprints[sprintNumber]) {
    existing.sprints[sprintNumber].push(finding);
    saveFindings(cwd, existing);
  } else if (existing) {
    // Multi-sprint: allow adding to any sprint
    existing.sprints[sprintNumber] = [finding];
    saveFindings(cwd, existing);
  } else {
    saveFindings(cwd, { sprints: { [sprintNumber]: [finding] } });
  }

  console.log(`Finding added: [${reviewType}] ${ticketKey} — ${description} (${severity})`);
  console.log(`  ID: ${finding.id}`);
  const codification = formatCodificationMetadata(finding);
  if (codification) console.log(`  ${codification}`);
}

function findingsListCommand(args: string[], cwd: string): void {
  const sprintArg = args.find(a => a.startsWith('--sprint='));
  const codificationStatusArg = args.find(a => a.startsWith('--codification-status='));
  const codificationStatus = codificationStatusArg
    ? codificationStatusArg.slice('--codification-status='.length) as CodificationStatus
    : undefined;
  if (codificationStatus && !VALID_CODIFICATION_STATUSES.includes(codificationStatus)) {
    console.error(`Error: Invalid codification status "${codificationStatus}". Use: ${VALID_CODIFICATION_STATUSES.join(', ')}`);
    process.exit(1);
  }
  const data = loadFindings(cwd);

  if (!data || Object.keys(data.sprints).length === 0) {
    console.log('No review findings recorded.');
    return;
  }

  if (sprintArg) {
    const requestedSprint = parseSprintNumber(sprintArg.slice('--sprint='.length)) ?? 0;
    const sprintFindings = filterFindingsForList(data.sprints[requestedSprint] ?? [], codificationStatus);
    if (!sprintFindings || sprintFindings.length === 0) {
      console.log(`No findings for Sprint ${requestedSprint}.`);
      return;
    }
    console.log(`Sprint ${requestedSprint} findings (${sprintFindings.length} total):\n`);
    console.log('  ID       Ticket  Type           Severity   Description');
    for (const [index, f] of sprintFindings.entries()) {
      const id = displayFindingId(f, requestedSprint, index).padEnd(8);
      const ticket = f.ticket_key.padEnd(7);
      const type = f.review_type.padEnd(14);
      const severity = f.severity.padEnd(10);
      const meta = formatCodificationMetadata(f);
      console.log(`  ${id} ${ticket} ${type} ${severity} ${f.description}${meta ? ` (${meta})` : ''}`);
    }
  } else {
    // Show all findings grouped by sprint
    const sprintKeys = Object.keys(data.sprints).map(Number).sort((a, b) => a - b);
    let printed = false;
    for (const sprint of sprintKeys) {
      const sprintFindings = filterFindingsForList(data.sprints[sprint] ?? [], codificationStatus);
      if (sprintFindings.length === 0) continue;
      printed = true;
      console.log(`Sprint ${sprint} findings (${sprintFindings.length}):\n`);
      console.log('  ID       Ticket  Type           Severity   Description');
      for (const [index, f] of sprintFindings.entries()) {
        const id = displayFindingId(f, sprint, index).padEnd(8);
        const ticket = f.ticket_key.padEnd(7);
        const type = f.review_type.padEnd(14);
        const severity = f.severity.padEnd(10);
        const meta = formatCodificationMetadata(f);
        console.log(`  ${id} ${ticket} ${type} ${severity} ${f.description}${meta ? ` (${meta})` : ''}`);
      }
      console.log('');
    }
    if (!printed) {
      console.log(codificationStatus
        ? `No findings match codification status "${codificationStatus}".`
        : 'No review findings recorded.');
    }
  }
}

function filterFindingsForList(findings: ReviewFinding[], codificationStatus?: CodificationStatus): ReviewFinding[] {
  if (!codificationStatus) return findings;
  return findings.filter(finding => {
    if (!isCodificationCandidate(finding)) return false;
    return (finding.codification_status ?? 'open') === codificationStatus;
  });
}

function findingsResolveCommand(args: string[], cwd: string): void {
  const id = args.find(a => !a.startsWith('--')) ?? args.find(a => a.startsWith('--id='))?.slice('--id='.length);
  const statusArg = args.find(a => a.startsWith('--status='));
  const status = statusArg ? statusArg.slice('--status='.length) as CodificationStatus : 'paid_down';

  if (!id) {
    console.error('Error: finding id is required. Usage: slope review findings resolve <id> [--status=paid_down|wontfix]');
    process.exit(1);
  }

  if (!['paid_down', 'wontfix'].includes(status)) {
    console.error('Error: --status must be paid_down or wontfix.');
    process.exit(1);
  }

  const data = loadFindings(cwd);
  if (!data) {
    console.error('Error: no review findings recorded.');
    process.exit(1);
  }

  const now = new Date().toISOString();
  for (const sprint of Object.keys(data.sprints).map(Number).sort((a, b) => a - b)) {
    const findings = data.sprints[sprint] ?? [];
    for (const [index, finding] of findings.entries()) {
      if (!matchesFindingId(finding, sprint, index, id)) continue;
      if (!isCodificationCandidate(finding)) {
        console.error(`Error: finding ${id} is not a recurring workaround codification candidate.`);
        process.exit(1);
      }

      finding.resolved = true;
      finding.codification_status = status;
      finding.resolved_at = now;
      if (status === 'paid_down') finding.codified_at = now;
      else delete finding.codified_at;
      saveFindings(cwd, data);

      console.log(`Codification candidate ${status}: ${displayFindingId(finding, sprint, index)}`);
      console.log(`  S${sprint}: ${finding.description}`);
      return;
    }
  }

  console.error(`Error: no finding found matching id "${id}".`);
  process.exit(1);
}

function findingsClearCommand(args: string[], cwd: string): void {
  const filePath = join(cwd, FINDINGS_FILE);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
    console.log('Review findings cleared.');
  } else {
    console.log('No findings to clear.');
  }
}

function findingsCommand(args: string[], cwd: string): void {
  // Handle --help on any subcommand
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: slope review findings <subcommand> [options]

Subcommands:
  add    Add a review finding; workaround candidates use --recurs --cost=s|m|l
  list   List recorded findings
  resolve Mark a codification candidate paid_down or wontfix
  clear  Clear all findings

Use 'slope review findings add --help' for add options.`);
    return;
  }

  const sub = args[0];
  switch (sub) {
    case 'add':
      findingsAddCommand(args.slice(1), cwd);
      break;
    case 'list':
      findingsListCommand(args.slice(1), cwd);
      break;
    case 'resolve':
      findingsResolveCommand(args.slice(1), cwd);
      break;
    case 'clear':
      findingsClearCommand(args.slice(1), cwd);
      break;
    default:
      console.error(`Unknown findings subcommand: ${sub}. Use add, list, resolve, or clear.`);
      process.exit(1);
  }
}

// --- Amend Subcommand ---

function amendCommand(args: string[], cwd: string): void {
  const sprintArg = args.find(a => a.startsWith('--sprint='));

  let config;
  try {
    config = loadConfig(cwd);
  } catch {
    console.error('Error: No SLOPE config found. Run `slope init` first.');
    process.exit(1);
  }

  // Determine sprint number
  let sprintNumber: number;
  if (sprintArg) {
    sprintNumber = parseSprintNumber(sprintArg.slice('--sprint='.length)) ?? 0;
  } else {
    sprintNumber = detectLatestSprint(config, cwd);
    if (sprintNumber === 0) {
      console.error('Error: No scorecards found. Use --sprint=N to specify.');
      process.exit(1);
    }
  }

  // Load scorecard
  const scorecardPath = join(cwd, config.scorecardDir, `sprint-${sprintNumber}.json`);
  if (!existsSync(scorecardPath)) {
    console.error(`Error: Scorecard not found at ${scorecardPath}`);
    process.exit(1);
  }

  let scorecard: GolfScorecard;
  try {
    scorecard = normalizeScorecard(JSON.parse(readFileSync(scorecardPath, 'utf8')));
  } catch {
    console.error(`Error: Could not parse scorecard at ${scorecardPath}`);
    process.exit(1);
  }

  // Load findings
  const findingsData = loadFindings(cwd);
  const sprintFindings = findingsData?.sprints[sprintNumber] ?? [];
  if (sprintFindings.length === 0) {
    console.log('No review findings to amend. Use `slope review findings add` first.');
    return;
  }

  console.log(`Amending Sprint ${sprintNumber} scorecard with ${sprintFindings.length} review finding${sprintFindings.length !== 1 ? 's' : ''}...\n`);

  // Amend
  let result;
  try {
    result = amendScorecardWithFindings(scorecard, sprintFindings);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }

  if (result.amendments.length === 0) {
    console.log('No new amendments applied (findings already present or no matching tickets).');
    return;
  }

  // Display amendments
  console.log('  Ticket  Finding                          Hazard    Penalty');
  for (const a of result.amendments) {
    const ticket = a.ticket_key.padEnd(7);
    const desc = a.description.length > 32 ? a.description.slice(0, 29) + '...' : a.description.padEnd(32);
    const hazard = a.hazard_type.padEnd(9);
    const penalty = HAZARD_SEVERITY_PENALTIES[a.severity];
    const penaltyStr = penalty > 0 ? `+${penalty}` : '+0';
    console.log(`  ${ticket} ${desc} ${hazard} ${penaltyStr}`);
  }

  console.log(`\nScore: ${result.score_before} → ${result.score_after} (${result.label_before} → ${result.label_after})`);

  // Write amended scorecard
  writeFileSync(scorecardPath, JSON.stringify(result.scorecard, null, 2) + '\n');
  console.log(`Scorecard updated: ${config.scorecardDir}/sprint-${sprintNumber}.json`);

  // Clear this sprint's findings after successful amend to prevent guard false-negatives
  if (findingsData) {
    delete findingsData.sprints[sprintNumber];
    if (Object.keys(findingsData.sprints).length === 0) {
      // All sprints cleared — delete the file
      const findingsFilePath = join(cwd, FINDINGS_FILE);
      if (existsSync(findingsFilePath)) unlinkSync(findingsFilePath);
      console.log('Findings file cleared.');
    } else {
      saveFindings(cwd, findingsData);
      console.log(`Findings for Sprint ${sprintNumber} cleared.`);
    }
  }
}

// --- Main Command Router ---

export const REVIEW_STATE_SUBCOMMANDS = [
  'start',
  'round',
  'status',
  'reset',
  'recommend',
  'findings',
  'amend',
  'defer',
  'deferred',
  'resolve',
  'run',
];

export function shouldRouteToReviewState(args: string[]): boolean {
  const sub = args[0];
  const help = args.includes('--help') || args.includes('-h');
  return REVIEW_STATE_SUBCOMMANDS.includes(sub) || (help && (!sub || sub.startsWith('-')));
}

/** Per-subcommand usage text. Kept inside the dispatcher so `--help` can
 *  short-circuit before any state-mutating handler runs (#353). */
function printReviewHelp(sub: string | undefined): void {
  switch (sub) {
    case 'start':
      console.log(`Usage: slope review start [--rounds=N | --tier=<tier>]

Start a review on the current plan. Tiers map to round counts:
  skip      0 rounds   research/infra/docs-only sprints
  light     1 round    1-2 tickets, familiar patterns, single-package
  standard  2 rounds   3-4 tickets, multi-package, schema/API changes
  deep      3 rounds   5+ tickets, new infrastructure, architectural changes

Without --rounds or --tier, the tier is auto-detected from the most recent
plan file in .claude/plans/ or ~/.claude/plans/.`);
      break;
    case 'round':
      console.log(`Usage: slope review round

Mark one review round complete. Errors when no review is in progress
(start one with \`slope review start\`).`);
      break;
    case 'status':
      console.log(`Usage: slope review status

Print the active review's tier and rounds-remaining counter, or "No
active review" when none is in progress.`);
      break;
    case 'reset':
      console.log(`Usage: slope review reset

Clear any active review state. Use when a plan has been replaced or you
want to restart the review counter.`);
      break;
    case 'recommend':
      console.log(`Usage: slope review recommend [--sprint=N]

Suggest which implementation review types (architect/code/ml/security/
ux) apply to the current sprint based on active sprint state, roadmap,
scorecard, or plan metadata.`);
      break;
    case 'findings':
      console.log(`Usage: slope review findings <add|list|resolve|clear> [options]

Subcommands:
  add    Record a review finding (--type, --ticket, --severity, --description; workaround uses --recurs --cost=s|m|l)
  list   List recorded findings (optionally --sprint=N or --codification-status=open|paid_down|wontfix)
  resolve Mark a recurring workaround candidate paid_down or wontfix by id
  clear  Clear all findings`);
      break;
    case 'amend':
      console.log(`Usage: slope review amend [--sprint=N]

Apply recorded findings to the sprint scorecard as hazards and recompute
the score. Defaults to the latest sprint with a scorecard on disk.`);
      break;
    case 'defer':
      console.log(`Usage: slope review defer --from=<sprint> --description="..." [--to=<sprint>] [--severity=<low|medium|high|critical>] [--category=<text>]

Record a finding to address in a future sprint instead of amending the
current scorecard.`);
      break;
    case 'deferred':
      console.log(`Usage: slope review deferred [--sprint=N]

List deferred findings, optionally filtered by their target sprint.`);
      break;
    case 'resolve':
      console.log(`Usage: slope review resolve <id> [--note="..."]

Mark a deferred finding as resolved. Use \`slope review deferred\` to
look up ids.`);
      break;
    case 'run':
      console.log(`Usage: slope review run [options]

Run a structured review pass on the current sprint plan or PR. Pass
\`--help\` after \`run\` for full options.`);
      break;
    default:
      console.log(`Usage:
  slope review [scorecard.json] [--plain] [--metaphor=<name>]
  slope review <subcommand> [options]

Retrospective:
  Format sprint retrospective markdown from a scorecard. Defaults to the
  latest scorecard when no scorecard path is provided.

Subcommands:
  start       Start a review (auto-detects tier or use --rounds/--tier)
  round       Mark one review round complete
  status      Show active review state
  reset       Clear active review state
  recommend   Suggest implementation review types for the current sprint
  findings    Record/list/clear review findings
  amend       Apply findings to the sprint scorecard
  defer       Record a finding to address in a later sprint
  deferred    List deferred findings
  resolve     Mark a deferred finding as resolved
  run         Run a structured review pass

Use \`slope review <subcommand> --help\` for per-subcommand options.`);
  }
}

export async function reviewStateCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const sub = args[0];

  // --help/-h must short-circuit BEFORE any subcommand handler runs.
  // Previously `slope review start --help` actually started a review and
  // `slope review round --help` advanced the round counter — agents
  // probing command syntax with --help were corrupting review state. (#353)
  if (args.includes('--help') || args.includes('-h')) {
    printReviewHelp(sub);
    return;
  }

  switch (sub) {
    case 'start':
      startCommand(args.slice(1), cwd);
      break;
    case 'round':
      roundCommand(cwd);
      break;
    case 'status':
      statusCommand(cwd);
      break;
    case 'reset':
      resetCommand(cwd);
      break;
    case 'recommend':
      recommendCommand(args.slice(1), cwd);
      break;
    case 'findings':
      findingsCommand(args.slice(1), cwd);
      break;
    case 'amend':
      amendCommand(args.slice(1), cwd);
      break;
    case 'defer':
      deferCommand(args.slice(1), cwd);
      break;
    case 'deferred':
      deferredCommand(args.slice(1), cwd);
      break;
    case 'resolve':
      resolveCommand(args.slice(1), cwd);
      break;
    case 'run': {
      const { reviewRunCommand } = await import('./review-run.js');
      await reviewRunCommand(args.slice(1));
      break;
    }
    default:
      console.error(`Unknown review subcommand: ${sub}. Use start, round, status, reset, recommend, findings, amend, defer, deferred, resolve, run.`);
      process.exit(1);
  }
}

// --- Deferred Findings CLI ---

function deferCommand(args: string[], cwd: string): void {
  let from: number | undefined;
  let to: number | undefined;
  let severity: DeferredSeverity = 'medium';
  let description = '';
  let category: string | undefined;

  for (const arg of args) {
    if (arg.startsWith('--from=')) from = parseSprintNumber(arg.slice('--from='.length)) ?? undefined;
    else if (arg.startsWith('--to=')) to = parseSprintNumber(arg.slice('--to='.length)) ?? undefined;
    else if (arg.startsWith('--severity=')) severity = arg.slice('--severity='.length) as DeferredSeverity;
    else if (arg.startsWith('--description=')) description = arg.slice('--description='.length);
    else if (arg.startsWith('--category=')) category = arg.slice('--category='.length);
  }

  if (!from) {
    console.error('Missing --from=<sprint> (source sprint where finding was discovered)');
    process.exit(1);
  }

  if (!description) {
    console.error('Missing --description="..." (what needs to be addressed)');
    process.exit(1);
  }

  if (!['low', 'medium', 'high', 'critical'].includes(severity)) {
    console.error(`Invalid severity: ${severity}. Use low, medium, high, or critical.`);
    process.exit(1);
  }

  const finding = createDeferred(cwd, {
    source_sprint: from,
    target_sprint: to ?? null,
    severity,
    description,
    category,
  });

  const targetLabel = finding.target_sprint ? `S${finding.target_sprint}` : 'unscheduled';
  console.log(`\nDeferred finding created:`);
  console.log(`  ID: ${finding.id}`);
  console.log(`  S${finding.source_sprint} → ${targetLabel} [${severity.toUpperCase()}]`);
  console.log(`  ${description}`);
  if (category) console.log(`  Category: ${category}`);
  console.log('');
}

function deferredCommand(args: string[], cwd: string): void {
  let sprint: number | undefined;
  let status: string | undefined;

  for (const arg of args) {
    if (arg.startsWith('--sprint=')) sprint = parseSprintNumber(arg.slice('--sprint='.length)) ?? undefined;
    else if (arg.startsWith('--status=')) status = arg.slice('--status='.length);
  }

  const findings = listDeferred(cwd, {
    sprint,
    status: status as 'open' | 'resolved' | 'wontfix' | undefined,
  });

  if (findings.length === 0) {
    const filter = sprint ? ` targeting Sprint ${sprint}` : '';
    const statusFilter = status ? ` with status "${status}"` : '';
    console.log(`\nNo deferred findings found${filter}${statusFilter}.\n`);
    return;
  }

  const label = sprint ? `Deferred findings for Sprint ${sprint}` : 'All deferred findings';
  console.log(`\n${label} (${findings.length}):\n`);

  for (const f of findings) {
    const targetLabel = f.target_sprint ? `S${f.target_sprint}` : 'unscheduled';
    const statusTag = f.status === 'open' ? '' : ` [${f.status}]`;
    const cat = f.category ? ` (${f.category})` : '';
    console.log(`  [${f.severity.toUpperCase()}] S${f.source_sprint} → ${targetLabel}: ${f.description}${cat}${statusTag}`);
    console.log(`    ID: ${f.id.slice(0, 8)}...`);
  }
  console.log('');
}

function resolveCommand(args: string[], cwd: string): void {
  let id: string | undefined;
  let status: 'resolved' | 'wontfix' = 'resolved';

  for (const arg of args) {
    if (arg.startsWith('--id=')) id = arg.slice('--id='.length);
    else if (arg.startsWith('--status=')) status = arg.slice('--status='.length) as 'resolved' | 'wontfix';
  }

  if (!id) {
    console.error('Missing --id=<uuid> (finding ID or prefix)');
    process.exit(1);
  }

  const finding = resolveDeferred(cwd, id, status);
  if (!finding) {
    console.error(`No finding found matching ID: ${id}`);
    process.exit(1);
  }

  console.log(`\nFinding ${status}:`);
  console.log(`  ID: ${finding.id}`);
  console.log(`  ${finding.description}`);
  console.log('');
}
