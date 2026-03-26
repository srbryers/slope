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
import { WorkflowEngine, loadWorkflow, resolveVariables, validateWorkflow, loadConfig } from '../../core/index.js';
import type { WorkflowDefinition, WorkflowExecution } from '../../core/index.js';
import { createHash } from 'node:crypto';

/** Get workflow definition from execution snapshot (preferred) or disk (fallback for old executions) */
function getDefinition(exec: WorkflowExecution, cwd: string): { def: WorkflowDefinition; drifted: boolean } {
  // Prefer snapshot from execution
  if (exec.definition_json) {
    const def = JSON.parse(exec.definition_json) as WorkflowDefinition;
    // Check if current YAML has drifted
    let drifted = false;
    try {
      const current = loadWorkflow(exec.workflow_name, cwd);
      const currentHash = createHash('sha256').update(JSON.stringify(current)).digest('hex').slice(0, 16);
      drifted = exec.definition_hash !== currentHash;
    } catch { /* workflow file might be gone — that's fine, we have the snapshot */ }
    return { def, drifted };
  }
  // Fallback for old executions without snapshot
  return { def: loadWorkflow(exec.workflow_name, cwd), drifted: false };
}
import { createStore } from '../../store/index.js';

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

// --- Workflow-driven commands ---

function getStore(cwd: string) {
  const config = loadConfig(cwd);
  return createStore({ storePath: config.store_path ?? '.slope/slope.db', cwd });
}

async function runWorkflowCommand(args: string[], cwd: string): Promise<void> {
  const sprintArg = args.find(a => a.startsWith('--sprint=') || !a.startsWith('--'));
  const workflowArg = args.find(a => a.startsWith('--workflow='));
  const varArgs = args.filter(a => a.startsWith('--var='));

  if (!workflowArg) {
    console.error('Usage: slope sprint run <sprint_id> --workflow=<name> [--var key=value ...]');
    process.exit(1);
  }

  const sprintId = sprintArg?.startsWith('--') ? undefined : sprintArg;
  const workflowName = workflowArg.slice('--workflow='.length);

  // Parse variables
  const vars: Record<string, string> = {};
  if (sprintId) vars.sprint_id = sprintId;
  for (const v of varArgs) {
    const kv = v.slice('--var='.length);
    const eq = kv.indexOf('=');
    if (eq > 0) {
      vars[kv.slice(0, eq)] = kv.slice(eq + 1);
    }
  }

  // Load and validate workflow
  const def = loadWorkflow(workflowName, cwd);
  const validation = validateWorkflow(def);
  if (!validation.valid) {
    console.error(`Workflow "${workflowName}" has errors:`);
    for (const err of validation.errors) {
      console.error(`  - ${err.message}`);
    }
    process.exit(1);
  }

  // Resolve variables
  const resolved = resolveVariables(def, vars);

  // Start execution
  const store = getStore(cwd);
  try {
    const engine = new WorkflowEngine();
    const exec = await engine.start(resolved, store, {
      sprint_id: sprintId,
      variables: vars,
    });

    const next = await engine.next(exec.id, resolved, store);

    console.log(`\nWorkflow "${def.name}" started (execution: ${exec.id})`);
    if (sprintId) console.log(`Sprint: ${sprintId}`);
    console.log(`Status: ${exec.status}`);
    console.log(`\nFirst step:`);
    console.log(`  Phase: ${next.phase}`);
    console.log(`  Step:  ${next.step?.id} (${next.step?.type})`);
    if (next.step?.prompt) console.log(`  Prompt: ${next.step.prompt}`);
    if (next.step?.command) console.log(`  Command: ${next.step.command}`);
    console.log('');
  } finally {
    store.close();
  }
}

async function workflowStatusCommand(args: string[], cwd: string): Promise<void> {
  const sprintArg = args.find(a => !a.startsWith('--'));
  const store = getStore(cwd);

  try {
    if (sprintArg) {
      const exec = await store.getExecutionBySprint(sprintArg);
      if (!exec) {
        console.log(`No active workflow execution for sprint ${sprintArg}.`);
        return;
      }
      printExecution(exec);
    } else {
      const active = await store.listExecutions({ status: 'running' });
      if (active.length === 0) {
        // Fall through to legacy status
        statusCommand(cwd);
        return;
      }
      console.log(`\n${active.length} active workflow execution(s):\n`);
      for (const exec of active) {
        printExecution(exec);
      }
    }
  } finally {
    store.close();
  }
}

function printExecution(exec: { id: string; workflow_name: string; sprint_id?: string; current_phase?: string; current_step?: string; status: string; completed_steps: unknown[]; started_at: string }): void {
  console.log(`  Execution: ${exec.id}`);
  console.log(`  Workflow:  ${exec.workflow_name}`);
  if (exec.sprint_id) console.log(`  Sprint:    ${exec.sprint_id}`);
  console.log(`  Status:    ${exec.status}`);
  console.log(`  Phase:     ${exec.current_phase ?? '-'}`);
  console.log(`  Step:      ${exec.current_step ?? '-'}`);
  console.log(`  Progress:  ${exec.completed_steps.length} steps completed`);
  console.log(`  Started:   ${exec.started_at}`);
  console.log('');
}

async function resumeCommand(args: string[], cwd: string): Promise<void> {
  const sprintArg = args.find(a => !a.startsWith('--'));
  if (!sprintArg) {
    console.error('Usage: slope sprint resume <sprint_id>');
    process.exit(1);
  }

  const store = getStore(cwd);
  try {
    const exec = await store.getExecutionBySprint(sprintArg);
    if (!exec) {
      console.error(`No active workflow execution for sprint ${sprintArg}.`);
      process.exit(1);
    }

    const { def, drifted } = getDefinition(exec, cwd);
    if (drifted) console.log(`\x1b[33m⚠ Workflow definition has changed since this execution started. Using snapshot from start.\x1b[0m`);
    const resolved = resolveVariables(def, exec.variables);
    const engine = new WorkflowEngine();

    // Transition paused → running before querying next step
    if (exec.status === 'paused') {
      await engine.resume(exec.id, store);
    }

    const next = await engine.next(exec.id, resolved, store);

    if (next.is_complete) {
      console.log(`Workflow for sprint ${sprintArg} is already complete.`);
      return;
    }

    console.log(`\nResuming workflow for sprint ${sprintArg} (execution: ${exec.id})`);
    console.log(`\nNext step:`);
    console.log(`  Phase: ${next.phase}`);
    console.log(`  Step:  ${next.step?.id} (${next.step?.type})`);
    if (next.current_item) console.log(`  Item:  ${next.current_item} (${(next.item_index ?? 0) + 1}/${next.total_items})`);
    if (next.step?.prompt) console.log(`  Prompt: ${next.step.prompt}`);
    if (next.step?.command) console.log(`  Command: ${next.step.command}`);
    console.log('');
  } finally {
    store.close();
  }
}

async function skipCommand(args: string[], cwd: string): Promise<void> {
  const sprintArg = args.find(a => !a.startsWith('--'));
  const stepArg = args.find(a => a.startsWith('--step='));
  const reasonArg = args.find(a => a.startsWith('--reason='));

  if (!sprintArg || !stepArg) {
    console.error('Usage: slope sprint skip <sprint_id> --step=<id> --reason="..."');
    process.exit(1);
  }

  const stepId = stepArg.slice('--step='.length);
  const reason = reasonArg?.slice('--reason='.length) ?? 'Skipped via CLI';

  const store = getStore(cwd);
  try {
    const exec = await store.getExecutionBySprint(sprintArg);
    if (!exec) {
      console.error(`No active workflow execution for sprint ${sprintArg}.`);
      process.exit(1);
    }

    const { def, drifted } = getDefinition(exec, cwd);
    if (drifted) console.log(`\x1b[33m⚠ Workflow definition has changed since this execution started. Using snapshot from start.\x1b[0m`);
    const resolved = resolveVariables(def, exec.variables);
    const engine = new WorkflowEngine();
    const result = await engine.skip(exec.id, stepId, reason, resolved, store);

    if (result.is_complete) {
      console.log(`Step "${stepId}" skipped. Workflow is now complete.`);
    } else {
      console.log(`Step "${stepId}" skipped (reason: ${reason}).`);
      console.log(`Next: ${result.advanced_to?.phase}/${result.advanced_to?.step}`);
    }
  } finally {
    store.close();
  }
}

async function pauseCommand(args: string[], cwd: string): Promise<void> {
  const sprintArg = args.find(a => !a.startsWith('--'));

  if (!sprintArg) {
    console.error('Usage: slope sprint pause <sprint_id>');
    process.exit(1);
  }

  const store = getStore(cwd);
  try {
    const exec = await store.getExecutionBySprint(sprintArg);
    if (!exec) {
      console.error(`No active workflow execution for sprint ${sprintArg}.`);
      process.exit(1);
    }

    const engine = new WorkflowEngine();
    await engine.pause(exec.id, store);
    console.log(`Sprint ${sprintArg} paused at ${exec.current_phase}/${exec.current_step}.`);
    console.log('Resume with: slope sprint resume ' + sprintArg);
  } finally {
    store.close();
  }
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
      await workflowStatusCommand(args.slice(1), cwd);
      break;
    case 'reset':
      resetCommand(cwd);
      break;
    case 'run':
      await runWorkflowCommand(args.slice(1), cwd);
      break;
    case 'resume':
      await resumeCommand(args.slice(1), cwd);
      break;
    case 'skip':
      await skipCommand(args.slice(1), cwd);
      break;
    case 'pause':
      await pauseCommand(args.slice(1), cwd);
      break;
    default:
      console.log(`
slope sprint — Sprint lifecycle management

Legacy commands:
  slope sprint start --number=N      Start sprint state tracking
  slope sprint gate <name>           Mark a gate as complete
  slope sprint status                Show sprint state and gates
  slope sprint reset                 Clear sprint state

Workflow commands:
  slope sprint run <id> --workflow=<name> [--var k=v ...]   Start workflow execution
  slope sprint status [sprint_id]    Show workflow execution progress
  slope sprint resume <sprint_id>    Resume a paused workflow execution
  slope sprint pause <sprint_id>     Pause a running workflow execution
  slope sprint skip <id> --step=<s> --reason="..."          Skip a blocking step
`);
      if (sub) process.exit(1);
      break;
  }
}
