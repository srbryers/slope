import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ReviewFinding, ReviewType, HazardSeverity } from '../../core/types.js';
import { recommendReviews, amendScorecardWithFindings } from '../../core/review.js';
import { loadConfig, detectLatestSprint, normalizeScorecard } from '../../core/index.js';
import { createDeferred, listDeferred, resolveDeferred } from '../../core/deferred.js';
import type { DeferredSeverity } from '../../core/deferred.js';
import { HAZARD_SEVERITY_PENALTIES } from '../../core/constants.js';
import type { GolfScorecard } from '../../core/types.js';
import { findPlanContent, countTickets, countPackageRefs } from '../guards/plan-analysis.js';

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

// --- Findings File Management ---

const FINDINGS_FILE = '.slope/review-findings.json';

export interface FindingsFile {
  sprint_number: number;
  findings: ReviewFinding[];
}

export function loadFindings(cwd: string): FindingsFile | null {
  const filePath = join(cwd, FINDINGS_FILE);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as FindingsFile;
  } catch {
    return null;
  }
}

function saveFindings(cwd: string, data: FindingsFile): void {
  const dir = join(cwd, '.slope');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(cwd, FINDINGS_FILE), JSON.stringify(data, null, 2) + '\n');
}

// --- Review Recommend ---

function recommendCommand(cwd: string): void {
  const plan = findPlanContent(cwd);
  let ticketCount = 0;
  let slope = 0;
  let filePatterns: string[] = [];
  let sprintNumber = 0;
  let hasNewInfra = false;

  if (plan) {
    ticketCount = countTickets(plan.content);
    // Extract slope from plan content
    const slopeMatch = plan.content.match(/\*\*Slope:\*\*\s*(\d+)/);
    if (slopeMatch) slope = parseInt(slopeMatch[1], 10);
    // Extract sprint number
    const sprintMatch = plan.content.match(/Sprint\s+(\d+)/);
    if (sprintMatch) sprintNumber = parseInt(sprintMatch[1], 10);
    // Extract file patterns from "Files to modify" sections
    const fileMatches = plan.content.matchAll(/`([^`]+\.[a-z]+)`/g);
    for (const m of fileMatches) filePatterns.push(m[1]);
    // Check for new infrastructure keywords
    hasNewInfra = /\b(new module|new package|new service|new infrastructure)\b/i.test(plan.content);
  } else {
    // Fallback: try to detect from config
    try {
      const config = loadConfig(cwd);
      sprintNumber = detectLatestSprint(config, cwd) + 1;
    } catch { /* no config */ }
  }

  const recs = recommendReviews({
    ticketCount,
    slope,
    filePatterns,
    hasNewInfra,
  });

  const sprintLabel = sprintNumber > 0 ? ` for Sprint ${sprintNumber}` : '';
  console.log(`Recommended reviews${sprintLabel} (${ticketCount} ticket${ticketCount !== 1 ? 's' : ''}, slope ${slope}):\n`);
  console.log('  Type           Priority      Reason');
  for (const rec of recs) {
    const type = rec.review_type.padEnd(14);
    const priority = rec.priority.padEnd(13);
    console.log(`  ${type} ${priority} ${rec.reason}`);
  }
}

// --- Findings Subcommands ---

const VALID_REVIEW_TYPES: ReviewType[] = ['architect', 'code', 'ml-engineer', 'security', 'ux'];
const VALID_SEVERITIES: HazardSeverity[] = ['minor', 'moderate', 'major', 'critical'];

function findingsAddCommand(args: string[], cwd: string): void {
  const typeArg = args.find(a => a.startsWith('--type='));
  const ticketArg = args.find(a => a.startsWith('--ticket='));
  const severityArg = args.find(a => a.startsWith('--severity='));
  const descArg = args.find(a => a.startsWith('--description='));
  const sprintArg = args.find(a => a.startsWith('--sprint='));
  const resolvedArg = args.includes('--resolved');

  if (!typeArg || !ticketArg || !descArg) {
    console.error('Error: --type, --ticket, and --description are required.');
    console.error('Usage: slope review findings add --type=architect --ticket=S34-1 --severity=moderate --description="..."');
    process.exit(1);
  }

  const reviewType = typeArg.slice('--type='.length) as ReviewType;
  if (!VALID_REVIEW_TYPES.includes(reviewType)) {
    console.error(`Error: Invalid review type "${reviewType}". Use: ${VALID_REVIEW_TYPES.join(', ')}`);
    process.exit(1);
  }

  const severity = severityArg
    ? severityArg.slice('--severity='.length) as HazardSeverity
    : 'moderate';
  if (!VALID_SEVERITIES.includes(severity)) {
    console.error(`Error: Invalid severity "${severity}". Use: ${VALID_SEVERITIES.join(', ')}`);
    process.exit(1);
  }

  const ticketKey = ticketArg.slice('--ticket='.length);
  const description = descArg.slice('--description='.length);

  // Determine sprint number
  let sprintNumber = 0;
  if (sprintArg) {
    sprintNumber = parseInt(sprintArg.slice('--sprint='.length), 10);
  } else {
    try {
      const config = loadConfig(cwd);
      sprintNumber = detectLatestSprint(config, cwd);
    } catch { /* fallback to 0 */ }
  }

  const finding: ReviewFinding = {
    review_type: reviewType,
    ticket_key: ticketKey,
    severity,
    description,
    resolved: resolvedArg,
  };

  const existing = loadFindings(cwd);
  if (existing && existing.sprint_number === sprintNumber) {
    existing.findings.push(finding);
    saveFindings(cwd, existing);
  } else if (existing && existing.sprint_number !== sprintNumber) {
    console.error(`Error: Findings file contains Sprint ${existing.sprint_number} data, but --sprint=${sprintNumber} was specified.`);
    console.error('Run `slope review findings clear` first, or use the correct --sprint value.');
    process.exit(1);
  } else {
    saveFindings(cwd, { sprint_number: sprintNumber, findings: [finding] });
  }

  console.log(`Finding added: [${reviewType}] ${ticketKey} — ${description} (${severity})`);
}

function findingsListCommand(args: string[], cwd: string): void {
  const sprintArg = args.find(a => a.startsWith('--sprint='));
  const data = loadFindings(cwd);

  if (!data || data.findings.length === 0) {
    console.log('No review findings recorded.');
    return;
  }

  if (sprintArg) {
    const requestedSprint = parseInt(sprintArg.slice('--sprint='.length), 10);
    if (data.sprint_number !== requestedSprint) {
      console.log(`No findings for Sprint ${requestedSprint}.`);
      return;
    }
  }

  console.log(`Sprint ${data.sprint_number} findings (${data.findings.length} total):\n`);
  console.log('  Ticket  Type           Severity   Description');
  for (const f of data.findings) {
    const ticket = f.ticket_key.padEnd(7);
    const type = f.review_type.padEnd(14);
    const severity = f.severity.padEnd(10);
    console.log(`  ${ticket} ${type} ${severity} ${f.description}`);
  }
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
  const sub = args[0];
  switch (sub) {
    case 'add':
      findingsAddCommand(args.slice(1), cwd);
      break;
    case 'list':
      findingsListCommand(args.slice(1), cwd);
      break;
    case 'clear':
      findingsClearCommand(args.slice(1), cwd);
      break;
    default:
      console.error(`Unknown findings subcommand: ${sub}. Use add, list, or clear.`);
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
    sprintNumber = parseInt(sprintArg.slice('--sprint='.length), 10);
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
  if (!findingsData || findingsData.findings.length === 0) {
    console.log('No review findings to amend. Use `slope review findings add` first.');
    return;
  }

  console.log(`Amending Sprint ${sprintNumber} scorecard with ${findingsData.findings.length} review finding${findingsData.findings.length !== 1 ? 's' : ''}...\n`);

  // Amend
  const result = amendScorecardWithFindings(scorecard, findingsData.findings);

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

  // Clear findings file after successful amend to prevent guard false-negatives
  const findingsFilePath = join(cwd, FINDINGS_FILE);
  if (existsSync(findingsFilePath)) {
    unlinkSync(findingsFilePath);
    console.log('Findings file cleared.');
  }
}

// --- Main Command Router ---

export async function reviewStateCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const sub = args[0];

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
      recommendCommand(cwd);
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
    default:
      console.error(`Unknown review subcommand: ${sub}. Use start, round, status, reset, recommend, findings, amend, defer, deferred, resolve.`);
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
    if (arg.startsWith('--from=')) from = parseInt(arg.slice('--from='.length), 10);
    else if (arg.startsWith('--to=')) to = parseInt(arg.slice('--to='.length), 10);
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
    if (arg.startsWith('--sprint=')) sprint = parseInt(arg.slice('--sprint='.length), 10);
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
