import {
  loadSprintState,
  saveSprintState,
  createSprintState,
  updateGate,
  clearSprintState,
  isSprintComplete,
  pendingGates,
  type GateName,
  type SprintPhase,
} from '../sprint-state.js';

const VALID_GATES: GateName[] = ['tests', 'code_review', 'architect_review', 'scorecard', 'review_md'];

function startCommand(args: string[], cwd: string): void {
  const numberArg = args.find(a => a.startsWith('--number='));
  if (!numberArg) {
    console.error('Error: --number=N is required. Usage: slope sprint start --number=22');
    process.exit(1);
  }

  const sprint = parseInt(numberArg.slice('--number='.length), 10);
  if (isNaN(sprint) || sprint <= 0) {
    console.error('Error: --number must be a positive integer.');
    process.exit(1);
  }

  const existing = loadSprintState(cwd);
  if (existing && existing.sprint === sprint) {
    console.log(`Sprint ${sprint} state already exists (phase: ${existing.phase}).`);
    return;
  }

  const phaseArg = args.find(a => a.startsWith('--phase='));
  const phase = (phaseArg?.slice('--phase='.length) ?? 'planning') as SprintPhase;

  const state = createSprintState(sprint, phase);
  saveSprintState(cwd, state);
  console.log(`Sprint ${sprint} started (phase: ${phase}). Use 'slope sprint gate <name>' to mark gates.`);
}

function gateCommand(args: string[], cwd: string): void {
  const gateName = args[0] as GateName | undefined;
  if (!gateName || !VALID_GATES.includes(gateName)) {
    console.error(`Error: gate name required. Valid gates: ${VALID_GATES.join(', ')}`);
    process.exit(1);
  }

  const state = loadSprintState(cwd);
  if (!state) {
    console.error("No active sprint. Run 'slope sprint start --number=N' first.");
    process.exit(1);
  }

  if (state.gates[gateName]) {
    console.log(`Gate '${gateName}' is already complete.`);
    return;
  }

  updateGate(cwd, gateName, true);
  const updated = loadSprintState(cwd)!;
  const remaining = pendingGates(updated);

  if (remaining.length === 0) {
    console.log(`Gate '${gateName}' marked complete. All gates done — ready for PR!`);
  } else {
    console.log(`Gate '${gateName}' marked complete. Remaining: ${remaining.join(', ')}`);
  }
}

function statusCommand(cwd: string): void {
  const state = loadSprintState(cwd);
  if (!state) {
    console.log('No active sprint state.');
    return;
  }

  const complete = isSprintComplete(state);
  console.log(`Sprint ${state.sprint} — phase: ${state.phase}${complete ? ' (all gates complete)' : ''}`);
  console.log(`Started: ${state.started_at}`);
  console.log(`Updated: ${state.updated_at}`);
  console.log('');
  console.log('Gates:');
  for (const [gate, done] of Object.entries(state.gates)) {
    const marker = done ? '[x]' : '[ ]';
    console.log(`  ${marker} ${gate}`);
  }

  if (!complete) {
    const pending = pendingGates(state);
    console.log(`\nRemaining: ${pending.join(', ')}`);
  }
}

function resetCommand(cwd: string): void {
  clearSprintState(cwd);
  console.log('Sprint state cleared.');
}

export async function sprintCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const sub = args[0];

  switch (sub) {
    case 'start':
      startCommand(args.slice(1), cwd);
      break;
    case 'gate':
      gateCommand(args.slice(1), cwd);
      break;
    case 'status':
      statusCommand(cwd);
      break;
    case 'reset':
      resetCommand(cwd);
      break;
    default:
      console.error(`Unknown sprint subcommand: ${sub ?? '(none)'}. Use start, gate, status, reset.`);
      process.exit(1);
  }
}
