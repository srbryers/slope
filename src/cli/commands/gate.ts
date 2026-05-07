import {
  loadInitiative,
  recordReview,
  getReviewChecklist,
} from '../../core/index.js';
import type { ReviewGate, ReviewType, ReviewChecklistType, ReviewRecord } from '../../core/index.js';

/**
 * `slope gate ...` — agent-friendly aliases for initiative review gates (#313).
 *
 * Wraps `slope initiative checklist|review` with shorter, positional argument
 * forms so recommended-command output (from `slope agent status`) is easier
 * to parse and execute.
 *
 *   slope gate status                                Pending plan/pr gates per sprint
 *   slope gate status --json                         Machine-readable form
 *   slope gate checklist plan architect              Show checklist
 *   slope gate complete plan architect --sprint=N    Mark gate complete
 */

const VALID_GATES: ReadonlySet<string> = new Set(['plan', 'pr']);
const VALID_REVIEWERS: ReadonlySet<string> = new Set(
  ['architect', 'code', 'ml-engineer', 'security', 'ux', 'backend', 'database', 'frontend', 'ux-designer'],
);

interface PendingGate {
  sprint: number;
  gate: ReviewGate;
  required: string[];
  outstanding: string[];
}

export async function gateCommand(args: string[]): Promise<void> {
  const sub = args[0];

  if (sub === '--help' || sub === '-h' || sub === undefined) {
    printHelp();
    return;
  }

  if (sub === 'status') {
    await statusSubcommand(args.slice(1));
    return;
  }

  if (sub === 'checklist') {
    checklistSubcommand(args.slice(1));
    return;
  }

  if (sub === 'complete') {
    completeSubcommand(args.slice(1));
    return;
  }

  console.error(`\nUnknown gate subcommand: ${sub}\n`);
  printHelp();
  process.exit(1);
}

function printHelp(): void {
  console.log(`
slope gate — Initiative review gate aliases (agent-friendly form of \`slope initiative\`)

Usage:
  slope gate status [--json]                  Pending plan/pr gates per sprint
  slope gate checklist <gate> <reviewer>      Print review checklist
  slope gate complete <gate> <reviewer> --sprint=N [--findings=N]
                                              Record a completed review

Args:
  <gate>      'plan' | 'pr'
  <reviewer>  reviewer type — architect, code, security, ml-engineer, ux, etc.

Equivalent legacy commands:
  slope initiative checklist --gate=plan --reviewer=architect
  slope initiative review --sprint=N --gate=plan --reviewer=architect [--findings=N]
`);
}

function collectPendingGates(cwd: string): PendingGate[] {
  const initiative = loadInitiative(cwd);
  if (!initiative) return [];

  const planRequired = initiative.review_gates.plan.required;
  const prRequired = initiative.review_gates.pr.required;
  const out: PendingGate[] = [];

  for (const sprint of initiative.sprints) {
    if (sprint.phase === 'complete') continue;

    if (sprint.phase === 'plan_review' || sprint.phase === 'planning' || sprint.phase === 'pending') {
      const outstanding = planRequired.filter(
        rt => !sprint.plan_reviews.find((r: ReviewRecord) => r.reviewer === rt && r.completed),
      );
      if (outstanding.length > 0) {
        out.push({ sprint: sprint.sprint_number, gate: 'plan', required: [...planRequired], outstanding });
      }
    }

    if (sprint.phase === 'pr_review' || sprint.phase === 'scoring') {
      const outstanding = prRequired.filter(
        rt => !sprint.pr_reviews.find((r: ReviewRecord) => r.reviewer === rt && r.completed),
      );
      if (outstanding.length > 0) {
        out.push({ sprint: sprint.sprint_number, gate: 'pr', required: [...prRequired], outstanding });
      }
    }
  }
  return out;
}

async function statusSubcommand(args: string[]): Promise<void> {
  const json = args.includes('--json');
  const cwd = process.cwd();
  const pending = collectPendingGates(cwd);

  if (json) {
    console.log(JSON.stringify({ pending }, null, 2));
    return;
  }

  if (pending.length === 0) {
    const initiative = loadInitiative(cwd);
    if (!initiative) {
      console.log('\nNo initiative state found. Run `slope initiative create` first.\n');
      return;
    }
    console.log('\nNo pending plan or PR review gates.\n');
    return;
  }

  console.log('\nPending review gates:');
  console.log('─'.repeat(50));
  for (const p of pending) {
    console.log(`  S${p.sprint} ${p.gate}: ${p.outstanding.join(', ')}`);
  }
  console.log('');
  console.log('Mark complete with:');
  for (const p of pending.slice(0, 3)) {
    const r = p.outstanding[0];
    console.log(`  $ slope gate complete ${p.gate} ${r} --sprint=${p.sprint}`);
  }
  console.log('');
}

function checklistSubcommand(args: string[]): void {
  const gate = args[0];
  const reviewer = args[1];

  if (!gate || !reviewer) {
    console.error('\nUsage: slope gate checklist <gate> <reviewer>\n');
    process.exit(1);
  }
  if (!VALID_GATES.has(gate)) {
    console.error(`Invalid gate: "${gate}". Must be plan or pr.`);
    process.exit(1);
  }
  if (!VALID_REVIEWERS.has(reviewer)) {
    console.error(`Invalid reviewer: "${reviewer}". Valid: ${[...VALID_REVIEWERS].join(', ')}`);
    process.exit(1);
  }

  const items = getReviewChecklist(reviewer as ReviewChecklistType, gate as ReviewGate);
  if (items.length === 0) {
    console.log(`\nNo checklist defined for ${reviewer} at ${gate} gate.\n`);
    return;
  }
  console.log(`\n# ${reviewer} — ${gate} review checklist\n`);
  for (const item of items) {
    console.log(`  □ [${item.category}] ${item.question}`);
  }
  console.log('');
}

function completeSubcommand(args: string[]): void {
  const gate = args[0];
  const reviewer = args[1];
  const flagArgs = args.slice(2);

  const sprintArg = flagArgs.find(a => a.startsWith('--sprint='));
  const findingsArg = flagArgs.find(a => a.startsWith('--findings='));

  if (!gate || !reviewer || !sprintArg) {
    console.error('\nUsage: slope gate complete <gate> <reviewer> --sprint=N [--findings=N]\n');
    process.exit(1);
  }
  if (!VALID_GATES.has(gate)) {
    console.error(`Invalid gate: "${gate}". Must be plan or pr.`);
    process.exit(1);
  }
  if (!VALID_REVIEWERS.has(reviewer)) {
    console.error(`Invalid reviewer: "${reviewer}". Valid: ${[...VALID_REVIEWERS].join(', ')}`);
    process.exit(1);
  }
  const sprintNum = parseInt(sprintArg.slice('--sprint='.length), 10);
  if (isNaN(sprintNum) || sprintNum <= 0) {
    console.error('Invalid --sprint value');
    process.exit(1);
  }
  const findings = findingsArg ? parseInt(findingsArg.slice('--findings='.length), 10) : 0;
  if (isNaN(findings) || findings < 0) {
    console.error('Invalid --findings value');
    process.exit(1);
  }

  try {
    recordReview(process.cwd(), sprintNum, gate as ReviewGate, reviewer as ReviewType, findings);
    console.log(`\n✓ Recorded ${gate} review: ${reviewer} (${findings} findings) for S${sprintNum}\n`);
  } catch (err) {
    console.error(`\n✗ ${(err as Error).message}\n`);
    process.exit(1);
  }
}
