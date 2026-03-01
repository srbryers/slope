import {
  loadInitiative,
  createInitiative,
  advanceSprint,
  recordReview,
  getNextSprint,
  getReviewChecklist,
  formatInitiativeStatus,
} from '../../core/initiative.js';
import type {
  InitiativeDefinition,
  ReviewChecklistType,
  ReviewGate,
} from '../../core/initiative.js';

// --- Helpers ---

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)(?:=(.+))?$/);
    if (match) result[match[1]] = match[2] ?? 'true';
  }
  return result;
}

// --- Subcommands ---

function createSubcommand(flags: Record<string, string>, cwd: string): void {
  const name = flags.name;
  const roadmap = flags.roadmap;

  if (!name || !roadmap) {
    console.error('\nUsage: slope initiative create --name="..." --roadmap=<path>\n');
    process.exit(1);
  }

  const description = flags.description ?? '';

  try {
    const initiative = createInitiative(name, description, roadmap, cwd);
    console.log(`\n\u2713 Initiative created: ${initiative.name}`);
    console.log(`  Sprints: ${initiative.sprints.length}`);
    console.log(`  Plan gate: ${initiative.review_gates.plan.required.join(', ')} + ${initiative.review_gates.plan.specialists === 'auto' ? 'auto specialists' : initiative.review_gates.plan.specialists.join(', ')}`);
    console.log(`  PR gate: ${initiative.review_gates.pr.required.join(', ')}`);
    console.log('');
  } catch (err) {
    console.error(`\n\u2717 ${(err as Error).message}\n`);
    process.exit(1);
  }
}

function loadOrExit(cwd: string): InitiativeDefinition {
  const initiative = loadInitiative(cwd);
  if (!initiative) {
    console.error('\nNo initiative found. Run "slope initiative create" first.\n');
    process.exit(1);
  }
  return initiative;
}

function statusSubcommand(cwd: string): void {
  const initiative = loadOrExit(cwd);
  console.log(formatInitiativeStatus(initiative));
}

function nextSubcommand(cwd: string): void {
  const initiative = loadOrExit(cwd);

  const next = getNextSprint(initiative);
  if (!next) {
    console.log('\n\u2713 All sprints complete!\n');
    return;
  }

  console.log(`\n# Next: Sprint ${next.sprint_number}`);
  console.log(`  Phase: ${next.phase}`);

  // Show required reviews for current gate
  if (next.phase === 'plan_review') {
    console.log('\n  Plan reviews required:');
    for (const r of next.plan_reviews) {
      console.log(`    ${r.completed ? '\u2713' : '\u2717'} ${r.reviewer} (${r.reviewer_mode})`);
    }
  } else if (next.phase === 'pr_review') {
    console.log('\n  PR reviews required:');
    for (const r of next.pr_reviews) {
      console.log(`    ${r.completed ? '\u2713' : '\u2717'} ${r.reviewer} (${r.reviewer_mode})`);
    }
  }

  // Show selected specialists if plan_review pending
  if (next.phase === 'pending' || next.phase === 'planning') {
    if (initiative.review_gates.plan.specialists === 'auto') {
      console.log('\n  Specialists: auto-selected at plan_review phase');
    } else {
      console.log(`\n  Specialists: ${initiative.review_gates.plan.specialists.join(', ')}`);
    }
  }

  console.log('');
}

function advanceSubcommand(flags: Record<string, string>, cwd: string): void {
  const sprintStr = flags.sprint;
  if (!sprintStr) {
    console.error('\nUsage: slope initiative advance --sprint=N\n');
    process.exit(1);
  }

  const sprintNumber = parseInt(sprintStr, 10);
  if (isNaN(sprintNumber)) {
    console.error(`\n\u2717 Invalid sprint number: ${sprintStr}\n`);
    process.exit(1);
  }

  try {
    const result = advanceSprint(cwd, sprintNumber);
    console.log(`\n\u2713 Sprint ${sprintNumber}: ${result.previous} \u2192 ${result.phase}\n`);
  } catch (err) {
    console.error(`\n\u2717 ${(err as Error).message}\n`);
    process.exit(1);
  }
}

const VALID_REVIEWERS = new Set([
  'architect', 'code', 'backend', 'ml-engineer', 'database', 'frontend', 'ux-designer',
]);

function reviewSubcommand(flags: Record<string, string>, cwd: string): void {
  const sprintStr = flags.sprint;
  const gate = flags.gate as ReviewGate | undefined;
  const reviewer = flags.reviewer as ReviewChecklistType | undefined;
  const findingsStr = flags.findings;

  if (!sprintStr || !gate || !reviewer) {
    console.error('\nUsage: slope initiative review --sprint=N --gate=<plan|pr> --reviewer=<type> [--findings=N]\n');
    process.exit(1);
  }

  if (gate !== 'plan' && gate !== 'pr') {
    console.error(`\n\u2717 Invalid gate: "${gate}". Must be "plan" or "pr".\n`);
    process.exit(1);
  }

  if (!VALID_REVIEWERS.has(reviewer)) {
    console.error(`\n\u2717 Invalid reviewer: "${reviewer}". Valid: ${[...VALID_REVIEWERS].join(', ')}\n`);
    process.exit(1);
  }

  const sprintNumber = parseInt(sprintStr, 10);
  if (isNaN(sprintNumber)) {
    console.error(`\n\u2717 Invalid sprint number: ${sprintStr}\n`);
    process.exit(1);
  }

  const findingsCount = findingsStr ? parseInt(findingsStr, 10) : 0;
  if (isNaN(findingsCount) || findingsCount < 0) {
    console.error(`\n\u2717 Invalid findings count: ${findingsStr}\n`);
    process.exit(1);
  }

  try {
    recordReview(cwd, sprintNumber, gate, reviewer, findingsCount);
    console.log(`\n\u2713 Recorded ${gate} review: ${reviewer} (${findingsCount} findings) for sprint ${sprintNumber}\n`);
  } catch (err) {
    console.error(`\n\u2717 ${(err as Error).message}\n`);
    process.exit(1);
  }
}

function checklistSubcommand(flags: Record<string, string>): void {
  const reviewer = flags.reviewer as ReviewChecklistType | undefined;
  const gate = flags.gate as ReviewGate | undefined;

  if (!reviewer || !gate) {
    console.error('\nUsage: slope initiative checklist --reviewer=<type> --gate=<plan|pr>\n');
    process.exit(1);
  }

  const items = getReviewChecklist(reviewer, gate);
  if (items.length === 0) {
    console.log(`\nNo checklist defined for ${reviewer} at ${gate} gate.\n`);
    return;
  }

  console.log(`\n# ${reviewer} — ${gate} review checklist\n`);
  for (const item of items) {
    console.log(`  \u25A1 [${item.category}] ${item.question}`);
  }
  console.log('');
}

// --- Main Command ---

export async function initiativeCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const flags = parseArgs(args.slice(1));
  const cwd = process.cwd();

  switch (sub) {
    case 'create':
      createSubcommand(flags, cwd);
      break;
    case 'status':
      statusSubcommand(cwd);
      break;
    case 'next':
      nextSubcommand(cwd);
      break;
    case 'advance':
      advanceSubcommand(flags, cwd);
      break;
    case 'review':
      reviewSubcommand(flags, cwd);
      break;
    case 'checklist':
      checklistSubcommand(flags);
      break;
    default:
      console.log(`
slope initiative — Multi-sprint initiative orchestration

Usage:
  slope initiative create --name="..." --roadmap=<path>  Create initiative from roadmap
  slope initiative status                                 Show initiative status table
  slope initiative next                                   Show next sprint + required reviews
  slope initiative advance --sprint=N                     Move sprint to next phase
  slope initiative review --sprint=N --gate=<plan|pr> --reviewer=<type> [--findings=N]
                                                          Record a review completion
  slope initiative checklist --reviewer=<type> --gate=<plan|pr>
                                                          Show review checklist

Options:
  --name=<str>       Initiative name
  --roadmap=<path>   Path to roadmap JSON
  --sprint=N         Sprint number
  --gate=plan|pr     Review gate (plan or pr)
  --reviewer=<type>  Reviewer type (architect, code, backend, ml-engineer, etc.)
  --findings=N       Number of findings (default: 0)
  --description=<s>  Initiative description
`);
      if (sub) process.exit(1);
  }
}
